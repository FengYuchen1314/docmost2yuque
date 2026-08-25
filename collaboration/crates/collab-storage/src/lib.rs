#![forbid(unsafe_code)]

use async_trait::async_trait;
use sqlx::postgres::PgConnectOptions;
use sqlx::{PgPool, Row as _};
use std::{collections::HashMap, sync::Arc};
use thiserror::Error;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredUpdate {
    pub sequence: u64,
    pub payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredDocument {
    pub page_id: Uuid,
    pub sequence: u64,
    pub snapshot_sequence: u64,
    pub snapshot: Vec<u8>,
    pub updates: Vec<StoredUpdate>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMaterialization {
    pub page_id: Uuid,
    pub sequence: u64,
    pub actor_id: Uuid,
    pub content_type: String,
    pub plain_text: String,
    pub attempts: u32,
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("optimistic lock failed")]
    OptimisticLock,
    #[error("storage backend failed: {0}")]
    Backend(String),
}

#[async_trait]
pub trait CollaborationStorage: Send + Sync {
    async fn load(&self, page_id: Uuid) -> Result<Option<StoredDocument>, StorageError>;

    async fn append_update(
        &self,
        page_id: Uuid,
        payload: &[u8],
        actor_id: Uuid,
        content_type: &str,
        plain_text: &str,
    ) -> Result<u64, StorageError>;

    async fn compact(
        &self,
        page_id: Uuid,
        through_sequence: u64,
        snapshot: &[u8],
    ) -> Result<(), StorageError>;
}

#[derive(Clone)]
pub struct PostgresCollaborationStorage {
    pool: PgPool,
}

impl PostgresCollaborationStorage {
    pub async fn connect(database_url: &str) -> Result<Self, StorageError> {
        let pool = PgPool::connect(database_url).await.map_err(backend)?;
        Self::initialize(pool).await
    }

    pub async fn connect_with_settings(
        host: &str,
        port: u16,
        database: &str,
        username: &str,
        password: &str,
    ) -> Result<Self, StorageError> {
        let options = PgConnectOptions::new()
            .host(host)
            .port(port)
            .database(database)
            .username(username)
            .password(password);
        let pool = PgPool::connect_with(options).await.map_err(backend)?;
        Self::initialize(pool).await
    }

    pub async fn ping(&self) -> Result<(), StorageError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(())
    }

    pub async fn permission_version(&self, workspace_id: Uuid) -> Result<u64, StorageError> {
        let version =
            sqlx::query("SELECT version FROM permission_versions WHERE workspace_id = $1")
                .bind(workspace_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(backend)?
                .map(|row| row.try_get::<i64, _>("version"))
                .transpose()
                .map_err(backend)?
                .unwrap_or(1);
        as_u64(version)
    }

    pub async fn session_active(
        &self,
        session_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, StorageError> {
        let row = sqlx::query(
            "SELECT EXISTS(
                SELECT 1 FROM collaboration_sessions
                WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
            ) AS active",
        )
        .bind(session_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(backend)?;
        row.try_get("active").map_err(backend)
    }

    pub async fn claim_materializations(
        &self,
        worker_id: Uuid,
        limit: i64,
    ) -> Result<Vec<PendingMaterialization>, StorageError> {
        let rows = sqlx::query(
            "WITH candidates AS (
                SELECT page_id
                FROM collaboration_materialization_outbox
                WHERE available_at <= now()
                  AND (locked_at IS NULL OR locked_at < now() - interval '30 seconds')
                ORDER BY available_at, updated_at
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            UPDATE collaboration_materialization_outbox AS outbox
            SET locked_at = now(), locked_by = $1
            FROM candidates
            WHERE outbox.page_id = candidates.page_id
            RETURNING outbox.page_id, outbox.sequence, outbox.actor_id,
                      outbox.content_type, outbox.plain_text, outbox.attempts",
        )
        .bind(worker_id)
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?;
        rows.into_iter()
            .map(|row| {
                Ok(PendingMaterialization {
                    page_id: row.try_get("page_id").map_err(backend)?,
                    sequence: as_u64(row.try_get::<i64, _>("sequence").map_err(backend)?)?,
                    actor_id: row.try_get("actor_id").map_err(backend)?,
                    content_type: row.try_get("content_type").map_err(backend)?,
                    plain_text: row.try_get("plain_text").map_err(backend)?,
                    attempts: row
                        .try_get::<i32, _>("attempts")
                        .map_err(backend)?
                        .try_into()
                        .map_err(|_| backend("negative materialization attempts"))?,
                })
            })
            .collect()
    }

    pub async fn complete_materialization(
        &self,
        worker_id: Uuid,
        page_id: Uuid,
        sequence: u64,
    ) -> Result<(), StorageError> {
        sqlx::query(
            "DELETE FROM collaboration_materialization_outbox
             WHERE page_id = $1 AND sequence = $2 AND locked_by = $3",
        )
        .bind(page_id)
        .bind(as_i64(sequence)?)
        .bind(worker_id)
        .execute(&self.pool)
        .await
        .map_err(backend)?;
        Ok(())
    }

    pub async fn retry_materialization(
        &self,
        worker_id: Uuid,
        page_id: Uuid,
        sequence: u64,
        delay_seconds: i32,
        error: &str,
    ) -> Result<(), StorageError> {
        sqlx::query(
            "UPDATE collaboration_materialization_outbox
             SET attempts = attempts + 1,
                 available_at = now() + ($4 * interval '1 second'),
                 locked_at = NULL,
                 locked_by = NULL,
                 last_error = $5,
                 updated_at = now()
             WHERE page_id = $1 AND sequence = $2 AND locked_by = $3",
        )
        .bind(page_id)
        .bind(as_i64(sequence)?)
        .bind(worker_id)
        .bind(delay_seconds.clamp(1, 900))
        .bind(abbreviate(error, 2_000))
        .execute(&self.pool)
        .await
        .map_err(backend)?;
        Ok(())
    }

    async fn initialize(pool: PgPool) -> Result<Self, StorageError> {
        sqlx::migrate!("../../migrations")
            .run(&pool)
            .await
            .map_err(backend)?;
        Ok(Self { pool })
    }
}

#[async_trait]
impl CollaborationStorage for PostgresCollaborationStorage {
    async fn load(&self, page_id: Uuid) -> Result<Option<StoredDocument>, StorageError> {
        let row = sqlx::query(
            "SELECT sequence, snapshot_sequence, snapshot
             FROM collaboration_documents WHERE page_id = $1",
        )
        .bind(page_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(backend)?;
        let Some(row) = row else { return Ok(None) };
        let sequence = as_u64(row.try_get::<i64, _>("sequence").map_err(backend)?)?;
        let snapshot_sequence = as_u64(
            row.try_get::<i64, _>("snapshot_sequence")
                .map_err(backend)?,
        )?;
        let snapshot = row.try_get::<Vec<u8>, _>("snapshot").map_err(backend)?;
        let rows = sqlx::query(
            "SELECT sequence, payload FROM collaboration_updates
             WHERE page_id = $1 AND sequence > $2 ORDER BY sequence",
        )
        .bind(page_id)
        .bind(as_i64(snapshot_sequence)?)
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?;
        let updates = rows
            .into_iter()
            .map(|update| {
                Ok(StoredUpdate {
                    sequence: as_u64(update.try_get::<i64, _>("sequence").map_err(backend)?)?,
                    payload: update.try_get("payload").map_err(backend)?,
                })
            })
            .collect::<Result<Vec<_>, StorageError>>()?;
        Ok(Some(StoredDocument {
            page_id,
            sequence,
            snapshot_sequence,
            snapshot,
            updates,
        }))
    }

    async fn append_update(
        &self,
        page_id: Uuid,
        payload: &[u8],
        actor_id: Uuid,
        content_type: &str,
        plain_text: &str,
    ) -> Result<u64, StorageError> {
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        sqlx::query(
            "INSERT INTO collaboration_documents(page_id) VALUES ($1)
             ON CONFLICT (page_id) DO NOTHING",
        )
        .bind(page_id)
        .execute(&mut *transaction)
        .await
        .map_err(backend)?;
        let row = sqlx::query(
            "UPDATE collaboration_documents
             SET sequence = sequence + 1, updated_at = now()
             WHERE page_id = $1 RETURNING sequence",
        )
        .bind(page_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(backend)?;
        let sequence = as_u64(row.try_get::<i64, _>("sequence").map_err(backend)?)?;
        sqlx::query(
            "INSERT INTO collaboration_updates(page_id, sequence, payload)
             VALUES ($1, $2, $3)",
        )
        .bind(page_id)
        .bind(as_i64(sequence)?)
        .bind(payload)
        .execute(&mut *transaction)
        .await
        .map_err(backend)?;
        sqlx::query(
            "INSERT INTO collaboration_materialization_outbox(
                page_id, sequence, actor_id, content_type, plain_text
             ) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (page_id) DO UPDATE SET
                sequence = EXCLUDED.sequence,
                actor_id = EXCLUDED.actor_id,
                content_type = EXCLUDED.content_type,
                plain_text = EXCLUDED.plain_text,
                attempts = 0,
                available_at = now(),
                locked_at = NULL,
                locked_by = NULL,
                last_error = NULL,
                updated_at = now()
             WHERE collaboration_materialization_outbox.sequence < EXCLUDED.sequence",
        )
        .bind(page_id)
        .bind(as_i64(sequence)?)
        .bind(actor_id)
        .bind(content_type)
        .bind(plain_text)
        .execute(&mut *transaction)
        .await
        .map_err(backend)?;
        transaction.commit().await.map_err(backend)?;
        Ok(sequence)
    }

    async fn compact(
        &self,
        page_id: Uuid,
        through_sequence: u64,
        snapshot: &[u8],
    ) -> Result<(), StorageError> {
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        let changed = sqlx::query(
            "UPDATE collaboration_documents
             SET snapshot = $3, snapshot_sequence = $2, updated_at = now()
             WHERE page_id = $1 AND sequence >= $2 AND snapshot_sequence < $2",
        )
        .bind(page_id)
        .bind(as_i64(through_sequence)?)
        .bind(snapshot)
        .execute(&mut *transaction)
        .await
        .map_err(backend)?
        .rows_affected();
        if changed == 0 {
            transaction.rollback().await.map_err(backend)?;
            return Err(StorageError::OptimisticLock);
        }
        sqlx::query("DELETE FROM collaboration_updates WHERE page_id = $1 AND sequence <= $2")
            .bind(page_id)
            .bind(as_i64(through_sequence)?)
            .execute(&mut *transaction)
            .await
            .map_err(backend)?;
        transaction.commit().await.map_err(backend)?;
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct InMemoryCollaborationStorage {
    documents: Arc<RwLock<HashMap<Uuid, StoredDocument>>>,
}

#[async_trait]
impl CollaborationStorage for InMemoryCollaborationStorage {
    async fn load(&self, page_id: Uuid) -> Result<Option<StoredDocument>, StorageError> {
        Ok(self.documents.read().await.get(&page_id).cloned())
    }

    async fn append_update(
        &self,
        page_id: Uuid,
        payload: &[u8],
        _actor_id: Uuid,
        _content_type: &str,
        _plain_text: &str,
    ) -> Result<u64, StorageError> {
        let mut documents = self.documents.write().await;
        let document = documents.entry(page_id).or_insert_with(|| StoredDocument {
            page_id,
            sequence: 0,
            snapshot_sequence: 0,
            snapshot: Vec::new(),
            updates: Vec::new(),
        });
        document.sequence += 1;
        document.updates.push(StoredUpdate {
            sequence: document.sequence,
            payload: payload.to_vec(),
        });
        Ok(document.sequence)
    }

    async fn compact(
        &self,
        page_id: Uuid,
        through_sequence: u64,
        snapshot: &[u8],
    ) -> Result<(), StorageError> {
        let mut documents = self.documents.write().await;
        let document = documents
            .get_mut(&page_id)
            .ok_or(StorageError::OptimisticLock)?;
        if document.sequence < through_sequence || document.snapshot_sequence >= through_sequence {
            return Err(StorageError::OptimisticLock);
        }
        document.snapshot = snapshot.to_vec();
        document.snapshot_sequence = through_sequence;
        document
            .updates
            .retain(|update| update.sequence > through_sequence);
        Ok(())
    }
}

fn backend(error: impl std::fmt::Display) -> StorageError {
    StorageError::Backend(error.to_string())
}

fn as_u64(value: i64) -> Result<u64, StorageError> {
    value
        .try_into()
        .map_err(|_| backend("negative collaboration sequence"))
}

fn as_i64(value: u64) -> Result<i64, StorageError> {
    value
        .try_into()
        .map_err(|_| backend("collaboration sequence overflow"))
}

fn abbreviate(value: &str, maximum_length: usize) -> &str {
    if value.len() <= maximum_length {
        value
    } else {
        let mut boundary = maximum_length;
        while !value.is_char_boundary(boundary) {
            boundary -= 1;
        }
        &value[..boundary]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn memory_storage_appends_and_compacts() {
        let storage = InMemoryCollaborationStorage::default();
        let page_id = Uuid::now_v7();
        let actor_id = Uuid::now_v7();
        assert_eq!(
            storage
                .append_update(page_id, &[1, 2], actor_id, "DOCUMENT", "one")
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            storage
                .append_update(page_id, &[3, 4], actor_id, "DOCUMENT", "two")
                .await
                .unwrap(),
            2
        );
        storage.compact(page_id, 2, &[9]).await.unwrap();
        let loaded = storage.load(page_id).await.unwrap().unwrap();
        assert_eq!(loaded.snapshot, vec![9]);
        assert!(loaded.updates.is_empty());
    }
}

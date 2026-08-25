use collab_protocol::{AWARENESS_FRAME, UPDATE_FRAME, decode_frame, encode_frame};
use collab_storage::{CollaborationStorage, StorageError};
use std::{
    collections::{HashMap, hash_map::Entry},
    sync::Arc,
};
use thiserror::Error;
use tokio::sync::{Mutex, broadcast};
use uuid::Uuid;
use yrs::updates::decoder::Decode as _;
use yrs::{Doc, GetString as _, ReadTxn as _, StateVector, Transact as _, Update};

const ROOM_CAPACITY: usize = 512;
const COMPACTION_INTERVAL: u64 = 100;

#[derive(Clone, Debug)]
pub struct RoomFrame {
    pub sender: Uuid,
    pub payload: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum RoomError {
    #[error("collaboration storage failed: {0}")]
    Storage(#[from] StorageError),
    #[error("Yrs update payload is invalid")]
    InvalidUpdate,
    #[error("collaboration frame is invalid")]
    InvalidFrame,
}

#[derive(Clone)]
pub struct RoomHub {
    rooms: Arc<Mutex<HashMap<Uuid, Room>>>,
    storage: Arc<dyn CollaborationStorage>,
}

struct Room {
    sender: broadcast::Sender<RoomFrame>,
    document: Arc<Mutex<RoomDocument>>,
    connection_count: usize,
}

struct RoomDocument {
    doc: Doc,
    updates_since_compaction: u64,
}

pub struct RoomSubscription {
    connection_id: Uuid,
    page_id: Uuid,
    actor_id: Uuid,
    content_type: String,
    sender: broadcast::Sender<RoomFrame>,
    receiver: broadcast::Receiver<RoomFrame>,
    document: Arc<Mutex<RoomDocument>>,
    storage: Arc<dyn CollaborationStorage>,
    initial_snapshot: Vec<u8>,
}

impl RoomHub {
    pub fn new(storage: Arc<dyn CollaborationStorage>) -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            storage,
        }
    }

    pub async fn join(
        &self,
        page_id: Uuid,
        actor_id: Uuid,
        content_type: String,
        connection_id: Uuid,
    ) -> Result<RoomSubscription, RoomError> {
        let mut rooms = self.rooms.lock().await;
        if let Entry::Vacant(entry) = rooms.entry(page_id) {
            let document = self.load_document(page_id).await?;
            let (sender, _) = broadcast::channel(ROOM_CAPACITY);
            entry.insert(Room {
                sender,
                document: Arc::new(Mutex::new(document)),
                connection_count: 0,
            });
        }

        let room = rooms.get_mut(&page_id).expect("room was inserted");
        room.connection_count += 1;
        let initial_snapshot = {
            let document = room.document.lock().await;
            encode_snapshot(&document.doc)
        };
        Ok(RoomSubscription {
            connection_id,
            page_id,
            actor_id,
            content_type,
            sender: room.sender.clone(),
            receiver: room.sender.subscribe(),
            document: room.document.clone(),
            storage: self.storage.clone(),
            initial_snapshot,
        })
    }

    pub async fn leave(&self, page_id: Uuid) {
        let mut rooms = self.rooms.lock().await;
        let should_remove = if let Some(room) = rooms.get_mut(&page_id) {
            room.connection_count = room.connection_count.saturating_sub(1);
            room.connection_count == 0
        } else {
            false
        };
        if should_remove {
            rooms.remove(&page_id);
        }
    }

    async fn load_document(&self, page_id: Uuid) -> Result<RoomDocument, RoomError> {
        let stored = self.storage.load(page_id).await?;
        let doc = Doc::new();
        let mut updates_since_compaction = 0;
        if let Some(stored) = stored {
            if !stored.snapshot.is_empty() {
                apply_update(&doc, &stored.snapshot)?;
            }
            for update in &stored.updates {
                apply_update(&doc, &update.payload)?;
            }
            updates_since_compaction = stored.sequence.saturating_sub(stored.snapshot_sequence);
        }
        Ok(RoomDocument {
            doc,
            updates_since_compaction,
        })
    }
}

impl RoomSubscription {
    pub fn initial_snapshot(&self) -> &[u8] {
        &self.initial_snapshot
    }

    pub async fn process_frame(&self, frame: &[u8]) -> Result<Option<u64>, RoomError> {
        let (kind, payload) = decode_frame(frame).map_err(|_| RoomError::InvalidFrame)?;
        match kind {
            UPDATE_FRAME => self.process_update(payload).await.map(Some),
            AWARENESS_FRAME => {
                self.publish(encode_frame(AWARENESS_FRAME, payload));
                Ok(None)
            }
            _ => Err(RoomError::InvalidFrame),
        }
    }

    pub async fn receive(&mut self) -> Result<RoomFrame, broadcast::error::RecvError> {
        self.receiver.recv().await
    }

    async fn process_update(&self, payload: &[u8]) -> Result<u64, RoomError> {
        let update = Update::decode_v1(payload).map_err(|_| RoomError::InvalidUpdate)?;
        let mut document = self.document.lock().await;

        {
            let mut transaction = document.doc.transact_mut();
            transaction
                .apply_update(update)
                .map_err(|_| RoomError::InvalidUpdate)?;
        }
        let plain_text = document
            .doc
            .get_or_insert_text("content")
            .get_string(&document.doc.transact());
        let sequence = self
            .storage
            .append_update(
                self.page_id,
                payload,
                self.actor_id,
                &self.content_type,
                &plain_text,
            )
            .await?;
        document.updates_since_compaction += 1;

        if document.updates_since_compaction >= COMPACTION_INTERVAL {
            let snapshot = encode_snapshot(&document.doc);
            match self
                .storage
                .compact(self.page_id, sequence, &snapshot)
                .await
            {
                Ok(()) => document.updates_since_compaction = 0,
                Err(StorageError::OptimisticLock) => {
                    document.updates_since_compaction = 0;
                }
                Err(error) => return Err(RoomError::Storage(error)),
            }
        }

        self.publish(encode_frame(UPDATE_FRAME, payload));
        Ok(sequence)
    }

    fn publish(&self, payload: Vec<u8>) {
        let _ = self.sender.send(RoomFrame {
            sender: self.connection_id,
            payload,
        });
    }
}

fn apply_update(doc: &Doc, payload: &[u8]) -> Result<(), RoomError> {
    let update = Update::decode_v1(payload).map_err(|_| RoomError::InvalidUpdate)?;
    let mut transaction = doc.transact_mut();
    transaction
        .apply_update(update)
        .map_err(|_| RoomError::InvalidUpdate)?;
    Ok(())
}

fn encode_snapshot(doc: &Doc) -> Vec<u8> {
    let transaction = doc.transact();
    transaction.encode_state_as_update_v1(&StateVector::default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use collab_storage::InMemoryCollaborationStorage;
    use yrs::Text as _;

    #[tokio::test]
    async fn document_is_recovered_after_room_eviction() {
        let storage = Arc::new(InMemoryCollaborationStorage::default());
        let hub = RoomHub::new(storage);
        let page_id = Uuid::now_v7();
        let connection_id = Uuid::now_v7();
        let room = hub
            .join(
                page_id,
                Uuid::now_v7(),
                "DOCUMENT".to_owned(),
                connection_id,
            )
            .await
            .expect("room joins");

        let source = Doc::new();
        let text = source.get_or_insert_text("content");
        let update = {
            let mut transaction = source.transact_mut();
            text.insert(&mut transaction, 0, "hello");
            transaction.encode_update_v1()
        };
        room.process_frame(&encode_frame(UPDATE_FRAME, &update))
            .await
            .expect("update persists");
        drop(room);
        hub.leave(page_id).await;

        let recovered = hub
            .join(
                page_id,
                Uuid::now_v7(),
                "DOCUMENT".to_owned(),
                Uuid::now_v7(),
            )
            .await
            .expect("room recovers");
        let restored = Doc::new();
        apply_update(&restored, recovered.initial_snapshot()).expect("snapshot applies");
        let text = restored.get_or_insert_text("content");
        assert_eq!(text.get_string(&restored.transact()), "hello");
    }
}

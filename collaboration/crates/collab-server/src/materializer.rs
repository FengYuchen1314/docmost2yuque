use collab_storage::{PendingMaterialization, PostgresCollaborationStorage};
use reqwest::Client;
use serde::Serialize;
use std::{env, time::Duration};
use tracing::{error, info, warn};
use uuid::Uuid;

#[derive(Clone)]
pub struct MaterializerConfig {
    endpoint: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MaterializationRequest<'a> {
    page_id: Uuid,
    sequence: u64,
    actor_id: Uuid,
    content_type: &'a str,
    plain_text: &'a str,
}

impl MaterializerConfig {
    pub fn from_environment() -> Option<Self> {
        let endpoint = env::var("COLLAB_MATERIALIZATION_URL").ok()?;
        let token = env::var("COLLAB_INTERNAL_TOKEN").ok()?;
        if endpoint.is_empty() || token.len() < 32 {
            return None;
        }
        Some(Self { endpoint, token })
    }
}

pub fn spawn(storage: PostgresCollaborationStorage, config: MaterializerConfig) {
    tokio::spawn(async move {
        let worker_id = Uuid::now_v7();
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(10))
            .build()
            .expect("materialization HTTP client must build");
        loop {
            match storage.claim_materializations(worker_id, 20).await {
                Ok(items) if items.is_empty() => {
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                Ok(items) => {
                    for item in items {
                        process(&client, &storage, &config, worker_id, item).await;
                    }
                }
                Err(cause) => {
                    error!(%cause, "failed to claim collaboration materializations");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    });
}

pub fn warn_if_disabled() {
    warn!(
        "collaboration materialization is disabled; set COLLAB_MATERIALIZATION_URL and COLLAB_INTERNAL_TOKEN"
    );
}

async fn process(
    client: &Client,
    storage: &PostgresCollaborationStorage,
    config: &MaterializerConfig,
    worker_id: Uuid,
    item: PendingMaterialization,
) {
    let request = MaterializationRequest {
        page_id: item.page_id,
        sequence: item.sequence,
        actor_id: item.actor_id,
        content_type: &item.content_type,
        plain_text: &item.plain_text,
    };
    let result = client
        .post(&config.endpoint)
        .header("X-Internal-Token", &config.token)
        .json(&request)
        .send()
        .await;
    let failure = match result {
        Ok(response) if response.status().is_success() => {
            if let Err(cause) = storage
                .complete_materialization(worker_id, item.page_id, item.sequence)
                .await
            {
                error!(page_id = %item.page_id, %cause, "failed to complete materialization outbox item");
            } else {
                info!(page_id = %item.page_id, sequence = item.sequence, "page collaboration materialized");
            }
            return;
        }
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            format!("HTTP {status}: {body}")
        }
        Err(cause) => cause.to_string(),
    };
    let delay = (1_u32 << item.attempts.min(8)).min(300) as i32;
    if let Err(cause) = storage
        .retry_materialization(worker_id, item.page_id, item.sequence, delay, &failure)
        .await
    {
        error!(page_id = %item.page_id, %cause, "failed to retry materialization outbox item");
    }
}

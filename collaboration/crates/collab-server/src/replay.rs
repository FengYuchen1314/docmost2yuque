use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct ReplayGuard {
    claimed: Arc<Mutex<HashMap<Uuid, i64>>>,
}

impl ReplayGuard {
    pub async fn claim(&self, nonce: Uuid, expires_at: i64) -> bool {
        let mut claimed = self.claimed.lock().await;
        claimed.retain(|_, expiry| *expiry > current_epoch_seconds());
        claimed.insert(nonce, expires_at).is_none()
    }
}

fn current_epoch_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock must be after Unix epoch")
        .as_secs() as i64
}

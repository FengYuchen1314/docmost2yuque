#![forbid(unsafe_code)]

use collab_protocol::{COLLABORATE_SCOPE, CollaborationTicket};
use uuid::Uuid;

pub fn collaboration_ticket(now_epoch_seconds: i64) -> CollaborationTicket {
    CollaborationTicket {
        version: 2,
        page_id: Uuid::now_v7(),
        user_id: Uuid::now_v7(),
        workspace_id: Uuid::now_v7(),
        content_type: "DOCUMENT".to_owned(),
        capabilities: vec![COLLABORATE_SCOPE.to_owned()],
        permission_version: 1,
        session_id: Uuid::now_v7(),
        nonce: Uuid::now_v7(),
        scope: COLLABORATE_SCOPE.to_owned(),
        issued_at: now_epoch_seconds,
        expires_at: now_epoch_seconds + 60,
    }
}

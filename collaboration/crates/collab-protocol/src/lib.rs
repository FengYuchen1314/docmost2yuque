#![forbid(unsafe_code)]

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer as _, SigningKey, Verifier as _, VerifyingKey};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const COLLABORATE_SCOPE: &str = "collaborate";
pub const UPDATE_FRAME: u8 = 0;
pub const AWARENESS_FRAME: u8 = 1;
pub const SNAPSHOT_FRAME: u8 = 2;
pub const ACK_FRAME: u8 = 3;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CollaborationTicket {
    pub version: u8,
    pub page_id: Uuid,
    pub user_id: Uuid,
    pub workspace_id: Uuid,
    pub content_type: String,
    pub capabilities: Vec<String>,
    pub permission_version: u64,
    pub session_id: Uuid,
    pub nonce: Uuid,
    pub scope: String,
    pub issued_at: i64,
    pub expires_at: i64,
}

impl CollaborationTicket {
    pub fn validate(&self, now_epoch_seconds: i64) -> Result<(), TicketError> {
        if self.version != 2 {
            return Err(TicketError::UnsupportedVersion);
        }
        if self.scope != COLLABORATE_SCOPE
            || self.capabilities.len() != 1
            || self.capabilities[0] != COLLABORATE_SCOPE
        {
            return Err(TicketError::InvalidScope);
        }
        if !matches!(
            self.content_type.as_str(),
            "DOCUMENT" | "WHITEBOARD" | "SPREADSHEET" | "DATABASE"
        ) {
            return Err(TicketError::InvalidContentType);
        }
        if self.issued_at > now_epoch_seconds + 30 {
            return Err(TicketError::IssuedInFuture);
        }
        if self.expires_at <= now_epoch_seconds {
            return Err(TicketError::Expired);
        }
        if self.expires_at - self.issued_at > 120 {
            return Err(TicketError::LifetimeTooLong);
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum TicketError {
    #[error("ticket format is invalid")]
    InvalidFormat,
    #[error("ticket encoding is invalid")]
    InvalidEncoding,
    #[error("ticket signature is invalid")]
    InvalidSignature,
    #[error("ticket payload is invalid")]
    InvalidPayload,
    #[error("ticket version is unsupported")]
    UnsupportedVersion,
    #[error("ticket scope is invalid")]
    InvalidScope,
    #[error("ticket content type is invalid")]
    InvalidContentType,
    #[error("ticket was issued in the future")]
    IssuedInFuture,
    #[error("ticket has expired")]
    Expired,
    #[error("ticket lifetime is too long")]
    LifetimeTooLong,
    #[error("ticket key must contain exactly 32 bytes")]
    InvalidKey,
}

#[derive(Clone)]
pub struct TicketVerifier {
    key: VerifyingKey,
}

impl TicketVerifier {
    pub fn new(public_key: &[u8]) -> Result<Self, TicketError> {
        let bytes: &[u8; 32] = public_key.try_into().map_err(|_| TicketError::InvalidKey)?;
        let key = VerifyingKey::from_bytes(bytes).map_err(|_| TicketError::InvalidKey)?;
        Ok(Self { key })
    }

    pub fn decode_and_verify(
        &self,
        encoded_ticket: &str,
        now_epoch_seconds: i64,
    ) -> Result<CollaborationTicket, TicketError> {
        let (payload, signature) = encoded_ticket
            .split_once('.')
            .ok_or(TicketError::InvalidFormat)?;
        if signature.contains('.') {
            return Err(TicketError::InvalidFormat);
        }
        let signature_bytes = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| TicketError::InvalidEncoding)?;
        let signature =
            Signature::from_slice(&signature_bytes).map_err(|_| TicketError::InvalidSignature)?;
        self.key
            .verify(payload.as_bytes(), &signature)
            .map_err(|_| TicketError::InvalidSignature)?;

        let payload = URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| TicketError::InvalidEncoding)?;
        let ticket: CollaborationTicket =
            serde_json::from_slice(&payload).map_err(|_| TicketError::InvalidPayload)?;
        ticket.validate(now_epoch_seconds)?;
        Ok(ticket)
    }
}

pub struct TicketSigner {
    key: SigningKey,
}

impl TicketSigner {
    pub fn new(private_key: &[u8]) -> Result<Self, TicketError> {
        let bytes: &[u8; 32] = private_key
            .try_into()
            .map_err(|_| TicketError::InvalidKey)?;
        Ok(Self {
            key: SigningKey::from_bytes(bytes),
        })
    }

    pub fn public_key(&self) -> [u8; 32] {
        self.key.verifying_key().to_bytes()
    }

    pub fn encode(&self, ticket: &CollaborationTicket) -> Result<String, TicketError> {
        let payload = serde_json::to_vec(ticket).map_err(|_| TicketError::InvalidPayload)?;
        let encoded_payload = URL_SAFE_NO_PAD.encode(payload);
        let signature = self.key.sign(encoded_payload.as_bytes());
        Ok(format!(
            "{encoded_payload}.{}",
            URL_SAFE_NO_PAD.encode(signature.to_bytes())
        ))
    }
}

pub fn encode_frame(kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 1);
    frame.push(kind);
    frame.extend_from_slice(payload);
    frame
}

pub fn decode_frame(frame: &[u8]) -> Result<(u8, &[u8]), FrameError> {
    let (&kind, payload) = frame.split_first().ok_or(FrameError::Empty)?;
    if !matches!(kind, UPDATE_FRAME | AWARENESS_FRAME) {
        return Err(FrameError::UnsupportedType);
    }
    if payload.is_empty() {
        return Err(FrameError::EmptyPayload);
    }
    Ok((kind, payload))
}

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("collaboration frame is empty")]
    Empty,
    #[error("collaboration frame type is unsupported")]
    UnsupportedType,
    #[error("collaboration frame payload is empty")]
    EmptyPayload,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ticket() -> CollaborationTicket {
        CollaborationTicket {
            version: 2,
            page_id: Uuid::from_u128(1),
            user_id: Uuid::from_u128(2),
            workspace_id: Uuid::from_u128(3),
            content_type: "DOCUMENT".to_owned(),
            capabilities: vec![COLLABORATE_SCOPE.to_owned()],
            permission_version: 7,
            session_id: Uuid::from_u128(4),
            nonce: Uuid::from_u128(5),
            scope: COLLABORATE_SCOPE.to_owned(),
            issued_at: 1_000,
            expires_at: 1_060,
        }
    }

    #[test]
    fn signed_ticket_round_trips() {
        let signer = TicketSigner::new(&[7_u8; 32]).expect("valid signer");
        let verifier = TicketVerifier::new(&signer.public_key()).expect("valid verifier");
        let encoded = signer.encode(&ticket()).expect("ticket encodes");
        assert_eq!(
            verifier
                .decode_and_verify(&encoded, 1_010)
                .expect("ticket verifies"),
            ticket()
        );
    }

    #[test]
    fn expired_ticket_is_rejected() {
        let signer = TicketSigner::new(&[7_u8; 32]).expect("valid signer");
        let verifier = TicketVerifier::new(&signer.public_key()).expect("valid verifier");
        let encoded = signer.encode(&ticket()).expect("ticket encodes");
        assert!(matches!(
            verifier.decode_and_verify(&encoded, 1_060),
            Err(TicketError::Expired)
        ));
    }

    #[test]
    fn tampered_ticket_is_rejected() {
        let signer = TicketSigner::new(&[7_u8; 32]).expect("valid signer");
        let verifier = TicketVerifier::new(&signer.public_key()).expect("valid verifier");
        let mut encoded = signer.encode(&ticket()).expect("ticket encodes");
        encoded.replace_range(0..1, "x");
        assert!(matches!(
            verifier.decode_and_verify(&encoded, 1_010),
            Err(TicketError::InvalidSignature)
        ));
    }

    #[test]
    fn frames_reject_unknown_types() {
        assert!(matches!(
            decode_frame(&[99, 1]),
            Err(FrameError::UnsupportedType)
        ));
    }
}

#![forbid(unsafe_code)]

mod materializer;
mod replay;
mod rooms;

use axum::{
    Json, Router,
    extract::{
        Path, Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{any, get},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use collab_protocol::{
    ACK_FRAME, CollaborationTicket, SNAPSHOT_FRAME, TicketVerifier, encode_frame,
};
use collab_storage::PostgresCollaborationStorage;
use materializer::MaterializerConfig;
use replay::ReplayGuard;
use rooms::RoomHub;
use serde::{Deserialize, Serialize};
use std::{
    env,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpListener;
use tower_http::{
    catch_panic::CatchPanicLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing::{error, info};
use uuid::Uuid;

const REQUEST_ID_HEADER: &str = "x-request-id";
const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone)]
struct AppState {
    tickets: TicketVerifier,
    replay: ReplayGuard,
    rooms: RoomHub,
    storage: PostgresCollaborationStorage,
}

#[derive(Debug, Deserialize)]
struct ConnectionQuery {
    ticket: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug)]
enum ConnectError {
    Unauthorized,
    PageMismatch,
    TicketReplayed,
    PermissionChanged,
    SessionRevoked,
    ServiceUnavailable,
}

impl IntoResponse for ConnectError {
    fn into_response(self) -> Response {
        let code = match self {
            Self::Unauthorized => "COLLAB_TICKET_INVALID",
            Self::PageMismatch => "COLLAB_PAGE_MISMATCH",
            Self::TicketReplayed => "COLLAB_TICKET_REPLAYED",
            Self::PermissionChanged => "COLLAB_PERMISSION_CHANGED",
            Self::SessionRevoked => "COLLAB_SESSION_REVOKED",
            Self::ServiceUnavailable => "COLLAB_AUTHORIZATION_UNAVAILABLE",
        };
        let status = match self {
            Self::PermissionChanged | Self::SessionRevoked => StatusCode::FORBIDDEN,
            Self::ServiceUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::UNAUTHORIZED,
        };
        (status, Json(serde_json::json!({ "code": code }))).into_response()
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "collab_server=info,tower_http=info".into()),
        )
        .json()
        .init();

    let public_key = env::var("COLLAB_TICKET_PUBLIC_KEY")
        .expect("COLLAB_TICKET_PUBLIC_KEY must be set to a base64-encoded Ed25519 public key");
    let public_key = STANDARD
        .decode(public_key)
        .expect("COLLAB_TICKET_PUBLIC_KEY must be valid base64");
    let tickets = TicketVerifier::new(&public_key)
        .expect("COLLAB_TICKET_PUBLIC_KEY must decode to exactly 32 bytes");
    let database_port = env::var("DATABASE_PORT")
        .unwrap_or_else(|_| "5432".to_owned())
        .parse::<u16>()
        .expect("DATABASE_PORT must be a valid TCP port");
    let storage = PostgresCollaborationStorage::connect_with_settings(
        &env::var("DATABASE_HOST").unwrap_or_else(|_| "database".to_owned()),
        database_port,
        &env::var("DATABASE_NAME").unwrap_or_else(|_| "knowledge".to_owned()),
        &env::var("DATABASE_USER").unwrap_or_else(|_| "knowledge".to_owned()),
        &env::var("DATABASE_PASSWORD").expect("DATABASE_PASSWORD must be set"),
    )
    .await
    .expect("failed to initialize collaboration storage");
    if let Some(config) = MaterializerConfig::from_environment() {
        materializer::spawn(storage.clone(), config);
    } else {
        materializer::warn_if_disabled();
    }
    let state = AppState {
        tickets,
        replay: ReplayGuard::default(),
        rooms: RoomHub::new(Arc::new(storage.clone())),
        storage,
    };

    let request_id_header: axum::http::HeaderName = REQUEST_ID_HEADER
        .parse()
        .expect("request id header name is valid");
    let app = Router::new()
        .route("/health/live", get(liveness))
        .route("/health/ready", get(readiness))
        .route("/api/v1/collaboration/{page_id}", any(connect))
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .layer(CatchPanicLayer::new())
        .with_state(state);

    let address = env::var("COLLAB_BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:8090".to_owned());
    let listener = TcpListener::bind(&address)
        .await
        .unwrap_or_else(|error| panic!("failed to bind {address}: {error}"));
    info!(%address, "collaboration service listening");
    axum::serve(listener, app)
        .await
        .expect("collaboration server failed");
}

async fn liveness() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn readiness(State(state): State<AppState>) -> Result<Json<HealthResponse>, StatusCode> {
    state
        .storage
        .ping()
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    Ok(Json(HealthResponse { status: "ok" }))
}

async fn connect(
    Path(page_id): Path<Uuid>,
    Query(query): Query<ConnectionQuery>,
    State(state): State<AppState>,
    websocket: WebSocketUpgrade,
) -> Result<Response, ConnectError> {
    let ticket = state
        .tickets
        .decode_and_verify(&query.ticket, now_epoch_seconds())
        .map_err(|_| ConnectError::Unauthorized)?;
    if ticket.page_id != page_id {
        return Err(ConnectError::PageMismatch);
    }
    let permission_version = state
        .storage
        .permission_version(ticket.workspace_id)
        .await
        .map_err(|_| ConnectError::ServiceUnavailable)?;
    if permission_version != ticket.permission_version {
        return Err(ConnectError::PermissionChanged);
    }
    let session_active = state
        .storage
        .session_active(ticket.session_id, ticket.user_id)
        .await
        .map_err(|_| ConnectError::ServiceUnavailable)?;
    if !session_active {
        return Err(ConnectError::SessionRevoked);
    }
    if !state.replay.claim(ticket.nonce, ticket.expires_at).await {
        return Err(ConnectError::TicketReplayed);
    }

    Ok(websocket
        .max_message_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state, ticket)))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, ticket: CollaborationTicket) {
    let rooms = state.rooms.clone();
    let connection_id = Uuid::now_v7();
    let mut last_permission_check = Instant::now();
    let mut room = match rooms
        .join(
            ticket.page_id,
            ticket.user_id,
            ticket.content_type.clone(),
            connection_id,
        )
        .await
    {
        Ok(room) => room,
        Err(error) => {
            error!(%connection_id, %error, "failed to join collaboration room");
            let _ = socket.send(Message::Close(None)).await;
            return;
        }
    };
    let initial_snapshot = encode_frame(SNAPSHOT_FRAME, room.initial_snapshot());
    if socket
        .send(Message::Binary(initial_snapshot.into()))
        .await
        .is_err()
    {
        rooms.leave(ticket.page_id).await;
        return;
    }
    let (mut sender, mut receiver) = socket.split();

    loop {
        tokio::select! {
            incoming = receiver.next() => {
                match incoming {
                    Some(Ok(Message::Binary(payload))) => {
                        if last_permission_check.elapsed() >= Duration::from_secs(5) {
                            let authorization = async {
                                let version = state.storage.permission_version(ticket.workspace_id).await?;
                                let session_active = state.storage.session_active(ticket.session_id, ticket.user_id).await?;
                                Ok::<bool, collab_storage::StorageError>(
                                    version == ticket.permission_version && session_active,
                                )
                            }.await;
                            match authorization {
                                Ok(true) => {
                                    last_permission_check = Instant::now();
                                }
                                Ok(false) => {
                                    info!(%connection_id, "closing collaboration socket after authorization change");
                                    let _ = sender.send(Message::Close(None)).await;
                                    break;
                                }
                                Err(error) => {
                                    error!(%connection_id, %error, "collaboration permission check failed");
                                    let _ = sender.send(Message::Close(None)).await;
                                    break;
                                }
                            }
                        }
                        match room.process_frame(&payload).await {
                            Ok(Some(sequence)) => {
                                let acknowledgement = encode_frame(ACK_FRAME, &sequence.to_be_bytes());
                                if sender.send(Message::Binary(acknowledgement.into())).await.is_err() {
                                    break;
                                }
                            }
                            Ok(None) => {}
                            Err(error) => {
                                error!(%connection_id, %error, "invalid collaboration frame");
                                let _ = sender.send(Message::Close(None)).await;
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(_))) => {
                        let _ = sender.send(Message::Close(None)).await;
                        break;
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Err(error)) => {
                        error!(%connection_id, %error, "collaboration socket receive failed");
                        break;
                    }
                }
            }
            outgoing = room.receive() => {
                match outgoing {
                    Ok(frame) if frame.sender != connection_id => {
                        if sender.send(Message::Binary(frame.payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        error!(%connection_id, %error, "collaboration room subscription failed");
                        break;
                    }
                }
            }
        }
    }
    rooms.leave(ticket.page_id).await;
}

fn now_epoch_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock must be after Unix epoch")
        .as_secs() as i64
}

use futures_util::{SinkExt as _, StreamExt as _};

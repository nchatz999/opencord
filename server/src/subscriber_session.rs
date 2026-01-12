use crate::auth::Session;
use crate::db::Postgre;
use crate::error::DatabaseError;
use crate::managers::LogManager;
use crate::model::EventPayload;
use crate::transport::{
    CommandPayload, ConnectionMessage, ControlRoutingPolicy, DomainError, ServerMessage,
    SubscriberMessage,
};
use axum::extract::ws::{CloseFrame, Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::time::interval;

const CLOSE_CODE_DISCONNECTED: u16 = 4002;

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

pub const PING_INTERVAL_MS: u64 = 5000;
pub const PONG_TIMEOUT_MS: u64 = 10000;
pub const MAX_MISSED_PONGS: usize = 3;

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, thiserror::Error)]
#[error("{0}")]
pub struct SessionError(pub String);

impl From<DomainError> for SessionError {
    fn from(err: DomainError) -> Self {
        SessionError(err.to_string())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

pub trait SessionRepository: Send + Sync + Clone {
    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError>;
}

impl SessionRepository for Postgre {
    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"SELECT * FROM sessions
               WHERE session_token = $1
               AND (expires_at IS NULL OR expires_at > NOW())"#,
            session_token
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct SessionService<R: SessionRepository, L: LogManager> {
    repository: R,
    pub logger: L,
}

impl<R: SessionRepository, L: LogManager> SessionService<R, L> {
    pub fn new(repository: R, logger: L) -> Self {
        Self { repository, logger }
    }

    pub async fn authenticate_session(
        &self,
        session_token: &str,
    ) -> Result<Option<Session>, DomainError> {
        Ok(self.repository.find_session(session_token).await?)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PING TRACKING
// ═══════════════════════════════════════════════════════════════════════════════

struct PendingPing {
    timestamp: u64,
    sent_at: Instant,
}

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION
// ═══════════════════════════════════════════════════════════════════════════════

pub struct SubscriberSession<R: SessionRepository, L: LogManager> {
    session: Session,
    observer_tx: mpsc::Sender<ServerMessage>,
    server_tx: mpsc::Sender<SubscriberMessage>,
    server_rx: mpsc::Receiver<SubscriberMessage>,
    service: SessionService<R, L>,
    identifier: String,
    pending_pings: Vec<PendingPing>,
    missed_pongs: usize,
}

impl<R: SessionRepository, L: LogManager> SubscriberSession<R, L> {
    pub fn new(
        observer_tx: mpsc::Sender<ServerMessage>,
        service: SessionService<R, L>,
        identifier: String,
        session: Session,
    ) -> Self {
        let (server_tx, server_rx) = mpsc::channel(10000);
        Self {
            session,
            observer_tx,
            server_tx,
            server_rx,
            service,
            identifier,
            pending_pings: Vec::new(),
            missed_pongs: 0,
        }
    }

    pub async fn run(&mut self, socket: WebSocket) {
        let (mut ws_sender, mut ws_receiver) = socket.split();

        let _ = self
            .observer_tx
            .send(ServerMessage::Command(CommandPayload::Connect(
                self.session.user_id,
                self.session.session_id,
                self.server_tx.clone(),
                self.identifier.clone(),
                self.session.session_token.clone(),
            )))
            .await;

        let mut ping_interval = interval(Duration::from_millis(PING_INTERVAL_MS));
        let mut pong_check_interval = interval(Duration::from_secs(1));

        loop {
            tokio::select! {
                Some(msg) = self.server_rx.recv() => {
                    if self.handle_server_message(msg, &mut ws_sender).await.is_err() {
                        break;
                    }
                }
                may_msg = ws_receiver.next() => {
                    match may_msg {
                        Some(Ok(Message::Binary(data))) => {
                            if self.handle_message(&data, &mut ws_sender).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) => break,
                        Some(Err(_)) => break,
                        None => break,
                        _ => {}
                    }
                }
                _ = ping_interval.tick() => {
                    if self.send_ping(&mut ws_sender).await.is_err() {
                        break;
                    }
                }
                _ = pong_check_interval.tick() => {
                    if self.check_pong_timeouts() {
                        break;
                    }
                }
            }
        }

        let _ = self
            .service
            .logger
            .log_entry(
                format!("User {} disconnected", self.session.user_id),
                "websocket".to_string(),
            )
            .await;
        let _ = self
            .observer_tx
            .send(ServerMessage::Command(CommandPayload::Timeout(
                self.session.user_id,
                self.identifier.clone(),
            )))
            .await;
    }

    async fn handle_message(
        &mut self,
        data: &[u8],
        ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ) -> Result<(), SessionError> {
        let message: ConnectionMessage = rmp_serde::from_slice(data)
            .map_err(|_| SessionError("Invalid message format".to_string()))?;

        match message {
            ConnectionMessage::Ping { timestamp } => {
                self.send(ws_sender, ConnectionMessage::Pong { timestamp })
                    .await?;
            }
            ConnectionMessage::Pong { timestamp } => {
                self.pending_pings.retain(|p| p.timestamp != timestamp);
                self.missed_pongs = 0;
            }
            ConnectionMessage::Event { payload } => {
                if let EventPayload::SpeakStatusUpdated { user_id, speaking } = payload {
                    if user_id == self.session.user_id {
                        let _ = self
                            .observer_tx
                            .send(ServerMessage::Control(
                                EventPayload::SpeakStatusUpdated { user_id, speaking },
                                ControlRoutingPolicy::Broadcast,
                            ))
                            .await;
                    }
                }
            }
        }
        Ok(())
    }

    async fn handle_server_message(
        &mut self,
        msg: SubscriberMessage,
        ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ) -> Result<(), SessionError> {
        match msg {
            SubscriberMessage::Event(payload) => {
                self.send(ws_sender, ConnectionMessage::Event { payload })
                    .await?;
            }
            SubscriberMessage::Error(reason) => {
                return Err(SessionError(reason));
            }
            SubscriberMessage::Close => {
                let close_frame = CloseFrame {
                    code: CLOSE_CODE_DISCONNECTED,
                    reason: "Disconnected".into(),
                };
                let _ = ws_sender.send(Message::Close(Some(close_frame))).await;
                return Err(SessionError("Close".to_string()));
            }
        }
        Ok(())
    }

    async fn send(
        &self,
        ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
        message: ConnectionMessage,
    ) -> Result<(), SessionError> {
        let bytes = rmp_serde::to_vec_named(&message).expect("serialization");
        ws_sender
            .send(Message::Binary(bytes.into()))
            .await
            .map_err(|_| SessionError("Send failed".to_string()))
    }

    async fn send_ping(
        &mut self,
        ws_sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    ) -> Result<(), SessionError> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        self.pending_pings.push(PendingPing {
            timestamp,
            sent_at: Instant::now(),
        });

        self.send(ws_sender, ConnectionMessage::Ping { timestamp })
            .await
    }

    fn check_pong_timeouts(&mut self) -> bool {
        let now = Instant::now();
        let timeout = Duration::from_millis(PONG_TIMEOUT_MS);

        let timed_out = self
            .pending_pings
            .iter()
            .filter(|p| now.duration_since(p.sent_at) > timeout)
            .count();

        self.pending_pings
            .retain(|p| now.duration_since(p.sent_at) <= timeout);
        self.missed_pongs += timed_out;

        self.missed_pongs >= MAX_MISSED_PONGS
    }
}

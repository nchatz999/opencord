use crate::auth::Session;
use crate::db::Postgre;
use crate::error::DatabaseError;
use crate::managers::LogManager;
use crate::transport::{
    AnswerPayload, CommandPayload, ConnectionMessage, ControlPayload, DomainError, ServerMessage,
    SubscriberMessage, VoipPayload,
};
use opencord_transport_server::{Connection, Message};
use tokio::sync::mpsc;

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
// SESSION
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_BYTES_PER_SECOND: u64 = 30_000_000;
const RATE_LIMIT_WINDOW_MS: u128 = 1000;

pub struct SubscriberSession<R: SessionRepository, L: LogManager> {
    pub may_session: Option<Session>,
    pub observer_tx: mpsc::Sender<ServerMessage>,
    server_tx: mpsc::Sender<SubscriberMessage>,
    pub server_rx: mpsc::Receiver<SubscriberMessage>,
    pub service: SessionService<R, L>,
    pub connection: Connection,
    pub identifier: String,
    bytes_this_window: u64,
    window_start: std::time::Instant,
}

impl<R: SessionRepository, L: LogManager> SubscriberSession<R, L> {
    pub fn new(
        observer_tx: mpsc::Sender<ServerMessage>,
        service: SessionService<R, L>,
        conn: Connection,
        token: String,
    ) -> Self {
        let (server_tx, server_rx): (
            mpsc::Sender<SubscriberMessage>,
            mpsc::Receiver<SubscriberMessage>,
        ) = mpsc::channel(10000);
        Self {
            may_session: None,
            observer_tx,
            server_tx,
            server_rx,
            service,
            connection: conn,
            identifier: token,
            bytes_this_window: 0,
            window_start: std::time::Instant::now(),
        }
    }

    pub async fn send_error(&mut self, reason: String) {
        let bytes = rmp_serde::to_vec_named(&ConnectionMessage::Control {
            payload: ControlPayload::Error { reason },
        })
        .expect("serialization");
        self.connection.send_ordered(bytes.into()).await;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    pub async fn handle_server_message(
        &mut self,
        msg: SubscriberMessage,
    ) -> Result<(), SessionError> {
        match msg {
            SubscriberMessage::Event(payload) => {
                let bytes = rmp_serde::to_vec_named(&ConnectionMessage::Event { payload })
                    .expect("serialization");
                self.connection.send_ordered(bytes.into()).await;
            }
            SubscriberMessage::Voip(payload) => {
                let bytes = rmp_serde::to_vec_named(&ConnectionMessage::Voip { payload })
                    .expect("serialization");
                self.connection.send_unordered(bytes.into()).await;
            }
            SubscriberMessage::Error(reason) => {
                return Err(SessionError(reason));
            }
            SubscriberMessage::Close => {
                let bytes = rmp_serde::to_vec_named(&ConnectionMessage::Control {
                    payload: ControlPayload::Close,
                })
                .expect("serialization");
                self.connection.send_ordered(bytes.into()).await;
                return Err(SessionError("Close".to_string()));
            }
        }
        Ok(())
    }

    pub async fn handle_connection_message(&mut self, msg: Message) -> Result<(), SessionError> {
        match msg {
            Message::Unordered(bytes) => {
                if let Ok(voip_msg) = rmp_serde::from_slice::<VoipPayload>(&bytes) {
                    return self.handle_voip_message(voip_msg).await;
                }
                Err(SessionError("Invalid VoIP message format".to_string()))
            }
            Message::Ordered(bytes) => {
                if let Ok(ctr_msg) = rmp_serde::from_slice::<ControlPayload>(&bytes) {
                    return self.handle_control_message(ctr_msg).await;
                }
                Err(SessionError("Invalid control message format".to_string()))
            }
        }
    }

    async fn handle_voip_message(&mut self, payload: VoipPayload) -> Result<(), SessionError> {
        let user_session = self
            .may_session
            .clone()
            .ok_or_else(|| SessionError("No user authenticated".to_string()))?;

        let payload_user_id = match &payload {
            VoipPayload::Speech { user_id, .. } => *user_id,
            VoipPayload::Media { user_id, .. } => *user_id,
        };
        if payload_user_id != user_session.user_id as u64 {
            return Err(SessionError("User ID mismatch".to_string()));
        }

        let now = std::time::Instant::now();
        if now.duration_since(self.window_start).as_millis() > RATE_LIMIT_WINDOW_MS {
            self.bytes_this_window = 0;
            self.window_start = now;
        }

        let payload_size = match &payload {
            VoipPayload::Speech { .. } => 32,
            VoipPayload::Media { data, .. } => data.len() as u64,
        };

        self.bytes_this_window += payload_size;
        if self.bytes_this_window > MAX_BYTES_PER_SECOND {
            return Err(SessionError("VoIP abuse detected".to_string()));
        }

        self.send_to_server(ServerMessage::Voip(payload, self.identifier.clone()))
            .await;

        Ok(())
    }

    async fn handle_control_message(
        &mut self,
        payload: ControlPayload,
    ) -> Result<(), SessionError> {
        match payload {
            ControlPayload::Connect { token } => {
                match self.service.authenticate_session(&token).await? {
                    Some(ref session) => {
                        self.may_session = Some(session.clone());
                        self.send_to_server(ServerMessage::Command(CommandPayload::Connect(
                            session.user_id,
                            session.session_id,
                            self.server_tx.clone(),
                            self.identifier.clone(),
                            session.session_token.clone(),
                        )))
                        .await;
                        self.send_to_connection(
                            ConnectionMessage::Control {
                                payload: ControlPayload::Answer {
                                    answer: AnswerPayload::Accept,
                                },
                            },
                            true,
                        )
                        .await;
                        Ok(())
                    }
                    None => {
                        self.send_to_connection(
                            ConnectionMessage::Control {
                                payload: ControlPayload::Answer {
                                    answer: AnswerPayload::Decline {
                                        reason: "Bad Credentials".to_string(),
                                    },
                                },
                            },
                            true,
                        )
                        .await;
                        Ok(())
                    }
                }
            }
            ControlPayload::Answer { .. } => {
                Err(SessionError("Unexpected answer payload".to_string()))
            }
            ControlPayload::Close => Err(SessionError("Session End".to_string())),
            ControlPayload::Error { .. } => {
                Err(SessionError("Received error from client".to_string()))
            }
        }
    }

    async fn send_to_connection<T>(&mut self, payload: T, ordered: bool)
    where
        T: serde::Serialize,
    {
        let bytes = rmp_serde::to_vec_named(&payload).expect("serialization");
        if ordered {
            self.connection.send_ordered(bytes.into()).await;
        } else {
            self.connection.send_unordered(bytes.into()).await;
        }
    }

    async fn send_to_server(&mut self, payload: ServerMessage) {
        let _ = self.observer_tx.send(payload).await;
    }
}

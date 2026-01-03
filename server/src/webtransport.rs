use crate::{
    auth::Session,
    db::Postgre,
    error::DatabaseError,
    managers::LogManager,
    model::EventPayload,
    user::{User, UserStatusType},
    voip::{MediaType, Subscription, VoipParticipant},
};
use opencord_transport_server::{Connection, Message, Server};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::time::{Duration, interval};
use uuid::Uuid;

fn server_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum DomainError {
    #[error("Bad Request")]
    BadRequest(String),
    #[error("Internal error: {0}")]
    InternalError(#[from] DatabaseError),
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum SessionError {
    #[error("Bad Request: {0}")]
    BadRequest(String),
    #[error("Internal error")]
    InternalError(#[from] DomainError),
}

pub struct ServerError;

impl From<DomainError> for ServerError {
    fn from(_err: DomainError) -> Self {
        ServerError
    }
}

impl From<DatabaseError> for ServerError {
    fn from(_err: DatabaseError) -> Self {
        ServerError
    }
}

#[derive(Debug, Clone)]
pub enum ControlRoutingPolicy {
    GroupRights {
        group_id: i64,
        minimun_rights: i64,
    },
    ChannelRights {
        channel_id: i64,
        minimun_rights: i64,
    },
    User {
        user_id: i64,
    },
    Role {
        role_id: i64,
    },
    Broadcast,
}

pub enum VoipRoutingPolicy {
    Channel(i64),
    Recipient(i64),
}

#[derive(Debug, Clone)]
pub enum CommandPayload {
    Connect(i64, i64, mpsc::Sender<SubscriberMessage>, String, String),
    Timeout(i64, String),
    Disconnect(i64, String),
    DisconnectUser(i64),
}

pub enum ServerMessage {
    Command(CommandPayload),
    Control(EventPayload, ControlRoutingPolicy),
    Voip(VoipPayload, VoipRoutingPolicy),
}

pub enum SubscriberMessage {
    Voip(VoipPayload),
    Event(EventPayload),
    Close,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "camelCase")]
pub enum AnswerPayload {
    Accept,
    Decline { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "camelCase")]
pub enum ControlPayload {
    Connect { token: String },
    Answer { answer: AnswerPayload },
    Close,
    Error { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "camelCase")]
pub enum ConnectionMessage {
    Voip { payload: VoipPayload },
    Event { payload: EventPayload },
    Control { payload: ControlPayload },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VoipDataType {
    Voice,
    Camera,
    Screen,
    ScreenSound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyType {
    Key,
    Delta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum VoipPayload {
    #[serde(rename_all = "camelCase")]
    Speech { user_id: u64, is_speaking: bool },
    #[serde(rename_all = "camelCase")]
    Media {
        user_id: u64,
        media_type: VoipDataType,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
        timestamp: u64,
        real_timestamp: u64,
        key: KeyType,
        sequence: u64,
    },
}

pub trait Repository: Send + Sync + Clone {
    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError>;

    async fn find_user_channel_rights(
        &self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_user_group_rights(
        &self,
        group_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError>;

    async fn find_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

    async fn update_user_status(
        &mut self,
        user_id: i64,
        status: UserStatusType,
    ) -> Result<Option<User>, DatabaseError>;

    async fn remove_voip_participant(
        &mut self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

    async fn remove_subscriptions(
        &mut self,
        user_id: i64,
    ) -> Result<Vec<Subscription>, DatabaseError>;

    async fn is_subscribed_to_media(
        &self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<bool, DatabaseError>;
}

#[derive(Clone)]
pub struct Service<L: LogManager> {
    repository: Postgre,
    pub logger: L,
}

impl<L: LogManager> Service<L> {
    pub fn new(repository: Postgre, logger: L) -> Self {
        Self { repository, logger }
    }

    pub async fn get_user_role(&self, user_id: i64) -> Result<Option<i64>, DomainError> {
        self.repository
            .find_user_role(user_id)
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_channel_rights(
        &self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<i64, DomainError> {
        Ok(self
            .repository
            .find_user_channel_rights(channel_id, user_id)
            .await?
            .unwrap_or(0))
    }

    pub async fn get_group_rights(&self, group_id: i64, user_id: i64) -> Result<i64, DomainError> {
        Ok(self
            .repository
            .find_user_group_rights(group_id, user_id)
            .await?
            .unwrap_or(0))
    }

    pub async fn get_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DomainError> {
        self.repository
            .find_voip_participant(user_id)
            .await
            .map_err(DomainError::from)
    }

    pub async fn authenticate_session(
        &self,
        session_token: &str,
    ) -> Result<Option<Session>, DomainError> {
        return Ok(self.repository.find_session(session_token).await?);
    }

    pub async fn update_user_status(
        &self,
        user_id: i64,
        status: UserStatusType,
    ) -> Result<Option<User>, DomainError> {
        let mut repo = self.repository.clone();
        let result = repo
            .update_user_status(user_id, status.clone())
            .await
            .map_err(DomainError::from)?;

        if result.is_some() {
            let _ = self
                .logger
                .log_entry(
                    format!(
                        "User {} status changed to {:?} via WebTransport",
                        user_id, status
                    ),
                    "webtransport".to_string(),
                )
                .await;
        }

        Ok(result)
    }

    pub async fn remove_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DomainError> {
        let mut repo = self.repository.clone();
        let result = repo
            .remove_voip_participant(user_id)
            .await
            .map_err(DomainError::from)?;

        if result.is_some() {
            let _ = self
                .logger
                .log_entry(
                    format!("VoIP participant {} removed via WebTransport", user_id),
                    "webtransport".to_string(),
                )
                .await;
        }

        Ok(result)
    }

    pub async fn remove_all_subscriptions(
        &self,
        user_id: i64,
    ) -> Result<Vec<Subscription>, DomainError> {
        let mut repo = self.repository.clone();
        let subscriptions = repo
            .remove_subscriptions(user_id)
            .await
            .map_err(DomainError::from)?;
        Ok(subscriptions)
    }

    pub async fn is_subscribed_to_media(
        &self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<bool, DomainError> {
        self.repository
            .is_subscribed_to_media(user_id, publisher_id, media_type)
            .await
            .map_err(DomainError::from)
    }
}

impl Repository for Postgre {
    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!("SELECT role_id FROM users WHERE user_id = $1", user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(result)
    }

    async fn find_user_channel_rights(
        &self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT grr.rights 
            FROM group_role_rights grr
            INNER JOIN channels c ON c.group_id = grr.group_id    
            INNER JOIN users u ON u.role_id = grr.role_id
            WHERE c.channel_id = $1 AND u.user_id = $2"#,
            channel_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }

    async fn find_user_group_rights(
        &self,
        group_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT grr.rights 
            FROM group_role_rights grr
            INNER JOIN users u ON u.role_id = grr.role_id
            WHERE grr.group_id = $1 AND u.user_id = $2"#,
            group_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }

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

    async fn find_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError> {
        let result = sqlx::query_as!(
            VoipParticipant,
            r#"SELECT 
                   vp.user_id, 
                   vp.channel_id, 
                   vp.recipient_id, 
                   vp.local_deafen, 
                   vp.local_mute, 
                   vp.publish_screen, 
                   vp.publish_camera, 
                   vp.created_at
               FROM voip_participants vp
               WHERE vp.user_id = $1"#,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }
    async fn update_user_status(
        &mut self,
        user_id: i64,
        status: UserStatusType,
    ) -> Result<Option<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"UPDATE users
               SET status = $2
               WHERE user_id = $1
               RETURNING
                   user_id,
                   username, 
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE(manual_status, status) END as "status!: UserStatusType",
                   avatar_file_id,
                   created_at,
                   server_mute,
                   server_deafen,
                   role_id"#,
            user_id,
            status as UserStatusType
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }

    async fn remove_voip_participant(
        &mut self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError> {
        let result = sqlx::query_as!(
            VoipParticipant,
            r#"DELETE FROM voip_participants
               WHERE user_id = $1
               RETURNING 
                   user_id, 
                   channel_id, 
                   recipient_id, 
                   local_deafen, 
                   local_mute, 
                   publish_screen, 
                   publish_camera, 
                   created_at"#,
            user_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(DatabaseError::from)?;

        Ok(result)
    }

    async fn remove_subscriptions(
        &mut self,
        user_id: i64,
    ) -> Result<Vec<Subscription>, DatabaseError> {
        let subscriptions = sqlx::query_as!(
            Subscription,
            r#"DELETE FROM subscriptions
               WHERE user_id = $1 OR publisher_id = $1
               RETURNING user_id, publisher_id, media_type as "media_type: MediaType", created_at"#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(subscriptions)
    }

    async fn is_subscribed_to_media(
        &self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<bool, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT EXISTS(
                SELECT 1 FROM subscriptions
                WHERE user_id = $1 AND publisher_id = $2 AND media_type = $3
            ) as "exists!""#,
            user_id,
            publisher_id,
            media_type as MediaType
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }
}

pub struct SubscriberHandler {
    user_id: i64,
    session_id: i64,
    sender: mpsc::Sender<SubscriberMessage>,
    session_token: String,
    identifier: String,
}

impl SubscriberHandler {
    pub fn user_id(&self) -> i64 {
        self.user_id
    }

    async fn send(&self, msg: SubscriberMessage) -> bool {
        self.sender.send(msg).await.is_ok()
    }
}

const MAX_INVALID_VOIP_PACKETS: u32 = 1000;
const MAX_BYTES_PER_SECOND: u64 = 30_000_000;
const RATE_LIMIT_WINDOW_MS: u128 = 1000;

struct SubscriberSession<L: LogManager> {
    may_session: Option<Session>,
    observer_tx: mpsc::Sender<ServerMessage>,
    server_tx: mpsc::Sender<SubscriberMessage>,
    pub server_rx: mpsc::Receiver<SubscriberMessage>,
    service: Service<L>,
    pub connection: Connection,
    identifier: String,
    invalid_voip_count: u32,
    bytes_this_window: u64,
    window_start: std::time::Instant,
}

impl<L: LogManager> SubscriberSession<L> {
    fn new(
        observer_tx: mpsc::Sender<ServerMessage>,
        service: Service<L>,
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
            invalid_voip_count: 0,
            bytes_this_window: 0,
            window_start: std::time::Instant::now(),
        }
    }

    async fn send_error(&mut self, reason: String) {
        let bytes = rmp_serde::to_vec_named(&ConnectionMessage::Control {
            payload: ControlPayload::Error { reason },
        })
        .expect("serialization");
        self.connection.send_ordered(bytes.into()).await;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }

    async fn handle_server_message(&mut self, msg: SubscriberMessage) -> Result<(), SessionError> {
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
            SubscriberMessage::Close => {
                let bytes = rmp_serde::to_vec_named(&ConnectionMessage::Control {
                    payload: ControlPayload::Close,
                })
                .expect("serialization");
                self.connection.send_ordered(bytes.into()).await;
                return Err(SessionError::BadRequest("Close".to_string()));
            }
        }
        Ok(())
    }

    async fn handle_connection_message(&mut self, msg: Message) -> Result<(), SessionError> {
        match msg {
            Message::Unordered(bytes) => {
                if let Ok(voip_msg) = rmp_serde::from_slice::<VoipPayload>(&bytes) {
                    return self.handle_voip_message(voip_msg).await;
                }
                Err(SessionError::BadRequest(
                    "Invalid VoIP message format".to_string(),
                ))
            }
            Message::Ordered(bytes) => {
                if let Ok(ctr_msg) = rmp_serde::from_slice::<ControlPayload>(&bytes) {
                    return self.handle_control_message(ctr_msg).await;
                }
                Err(SessionError::BadRequest(
                    "Invalid control message format".to_string(),
                ))
            }
        }
    }

    async fn handle_voip_message(&mut self, payload: VoipPayload) -> Result<(), SessionError> {
        let user_session = self
            .may_session
            .clone()
            .ok_or_else(|| SessionError::BadRequest("No user authenticated".to_string()))?;

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
            return Err(SessionError::BadRequest("VoIP abuse detected".to_string()));
        }

        let Some(voip_session) = self
            .service
            .get_voip_participant(user_session.user_id)
            .await?
        else {
            self.invalid_voip_count += 1;
            if self.invalid_voip_count > MAX_INVALID_VOIP_PACKETS {
                return Err(SessionError::BadRequest("VoIP abuse detected".to_string()));
            }
            return Ok(());
        };

        self.invalid_voip_count = 0;

        if let Some(channel_id) = voip_session.channel_id {
            let _ = self
                .route_to_channel(payload, channel_id, user_session.user_id)
                .await;
        } else if let Some(recipient_id) = voip_session.recipient_id {
            self.route_to_recipient(payload, recipient_id).await;
        }

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
            ControlPayload::Answer { .. } => Err(SessionError::BadRequest(
                "Unexpected answer payload".to_string(),
            )),
            ControlPayload::Close => {
                return Err(SessionError::BadRequest("Session End".to_string()));
            }
            ControlPayload::Error { .. } => {
                return Err(SessionError::BadRequest(
                    "Received error from client".to_string(),
                ));
            }
        }
    }

    async fn route_to_channel(
        &mut self,
        payload: VoipPayload,
        channel_id: i64,
        sender_id: i64,
    ) -> Result<(), SessionError> {
        if self
            .service
            .get_channel_rights(channel_id, sender_id)
            .await?
            > 2
        {
            self.send_to_server(ServerMessage::Voip(
                payload,
                VoipRoutingPolicy::Channel(channel_id),
            ))
            .await;
        }
        Ok(())
    }

    async fn route_to_recipient(&mut self, payload: VoipPayload, recipient_id: i64) {
        self.send_to_server(ServerMessage::Voip(
            payload,
            VoipRoutingPolicy::Recipient(recipient_id),
        ))
        .await;
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

pub struct RealtimeServer<L: LogManager> {
    observers: Vec<SubscriberHandler>,
    service: Service<L>,
    receiver: mpsc::Receiver<ServerMessage>,
    sender: mpsc::Sender<ServerMessage>,
    cert_path: PathBuf,
    key_path: PathBuf,
}

impl<L: LogManager + 'static> RealtimeServer<L> {
    pub fn new(repository: Postgre, logger: L, cert_path: PathBuf, key_path: PathBuf) -> Self {
        let (server_tx, server_rx): (mpsc::Sender<ServerMessage>, mpsc::Receiver<ServerMessage>) =
            mpsc::channel(1000);

        Self {
            observers: vec![],
            service: Service::new(repository, logger),
            receiver: server_rx,
            sender: server_tx,
            cert_path,
            key_path,
        }
    }

    fn count_user_sessions(&self, user_id: i64) -> i64 {
        self.observers
            .iter()
            .filter(|u| u.user_id == user_id)
            .count() as i64
    }

    async fn handle_timeout(
        &mut self,
        user_id: i64,
        identifier: String,
    ) -> Result<(), ServerError> {
        self.observers
            .retain(|subscriber| subscriber.identifier != identifier);

        if self.count_user_sessions(user_id) == 0 {
            let _ = self
                .handle_user_status_update(user_id, UserStatusType::Offline)
                .await?;

            let _ = self.handle_voip_participant_removal(user_id).await?;
        }

        Ok(())
    }

    async fn handle_connect(
        &mut self,
        user_id: i64,
        session_id: i64,
        sender: mpsc::Sender<SubscriberMessage>,
        session_token: String,
        identifier: String,
    ) -> Result<(), ServerError> {
        let subscriber = SubscriberHandler {
            user_id,
            session_id,
            sender,
            identifier,
            session_token,
        };
        self.observers.push(subscriber);
        let _ = self
            .handle_user_status_update(user_id, UserStatusType::Online)
            .await;
        let _ = self.handle_voip_participant_removal(user_id).await;
        Ok(())
    }

    async fn handle_disconnect(
        &mut self,
        user_id: i64,
        session_token: String,
    ) -> Result<(), ServerError> {
        for o in self
            .observers
            .iter()
            .filter(|o| o.session_token == session_token)
        {
            o.send(SubscriberMessage::Close).await;
        }
        self.observers
            .retain(|subscriber| subscriber.session_token != session_token);
        if self.count_user_sessions(user_id) == 0 {
            self.handle_user_status_update(user_id, UserStatusType::Offline)
                .await?;
            self.handle_voip_participant_removal(user_id).await?;
        }
        Ok(())
    }

    async fn handle_disconnect_user(&mut self, user_id: i64) -> Result<(), ServerError> {
        for o in self.observers.iter().filter(|o| o.user_id() == user_id) {
            o.send(SubscriberMessage::Close).await;
        }
        self.observers
            .retain(|subscriber| subscriber.user_id() != user_id);
        Ok(())
    }

    async fn handle_voip(
        &self,
        payload: VoipPayload,
        policy: VoipRoutingPolicy,
    ) -> Result<(), ServerError> {
        match &payload {
            VoipPayload::Speech { user_id, .. } => {
                self.handle_speech(payload.clone(), policy, *user_id as i64)
                    .await
            }
            VoipPayload::Media {
                user_id,
                media_type: VoipDataType::Voice,
                ..
            } => {
                self.handle_voice(payload.clone(), policy, *user_id as i64)
                    .await
            }
            VoipPayload::Media {
                user_id,
                media_type,
                ..
            } => {
                self.handle_media(payload.clone(), *user_id as i64, media_type.clone())
                    .await
            }
        }
    }

    async fn handle_speech(
        &self,
        payload: VoipPayload,
        policy: VoipRoutingPolicy,
        sender_id: i64,
    ) -> Result<(), ServerError> {
        for subscriber in &self.observers {
            let can_receive = match &policy {
                VoipRoutingPolicy::Channel(channel_id) => {
                    self.service
                        .get_channel_rights(*channel_id, subscriber.user_id())
                        .await?
                        >= 1
                }
                VoipRoutingPolicy::Recipient(target_user_id) => {
                    subscriber.user_id() == *target_user_id || subscriber.user_id() == sender_id
                }
            };

            if can_receive {
                subscriber
                    .send(SubscriberMessage::Voip(payload.clone()))
                    .await;
            }
        }
        Ok(())
    }

    async fn handle_voice(
        &self,
        payload: VoipPayload,
        policy: VoipRoutingPolicy,
        sender_id: i64,
    ) -> Result<(), ServerError> {
        for subscriber in &self.observers {
            if let Some(participant) = self
                .service
                .get_voip_participant(subscriber.user_id())
                .await?
                && !participant.local_deafen
            {
                let can_receive = match (&policy, participant.channel_id, participant.recipient_id)
                {
                    (VoipRoutingPolicy::Channel(id), Some(channel_id), None)
                        if *id == channel_id && subscriber.user_id() != sender_id =>
                    {
                        true
                    }
                    (VoipRoutingPolicy::Recipient(target_user_id), None, Some(_recipient_id))
                        if subscriber.user_id() == *target_user_id =>
                    {
                        true
                    }
                    (_, _, _) => false,
                };

                if can_receive {
                    subscriber
                        .send(SubscriberMessage::Voip(payload.clone()))
                        .await;
                }
            }
        }
        Ok(())
    }

    async fn handle_media(
        &self,
        payload: VoipPayload,
        publisher_id: i64,
        media_type: VoipDataType,
    ) -> Result<(), ServerError> {
        let db_media_type = match media_type {
            VoipDataType::Camera => MediaType::Camera,
            VoipDataType::Screen | VoipDataType::ScreenSound => MediaType::Screen,
            VoipDataType::Voice => return Ok(()),
        };

        for subscriber in &self.observers {
            let is_subscribed = self
                .service
                .is_subscribed_to_media(subscriber.user_id(), publisher_id, db_media_type.clone())
                .await?;

            if is_subscribed {
                subscriber
                    .send(SubscriberMessage::Voip(payload.clone()))
                    .await;
            }
        }
        Ok(())
    }

    async fn handle_control(
        &self,
        payload: EventPayload,
        policy: ControlRoutingPolicy,
    ) -> Result<(), ServerError> {
        self.route_control(payload, policy).await?;
        Ok(())
    }

    async fn handle_command(&mut self, payload: CommandPayload) -> Result<(), ServerError> {
        match payload {
            CommandPayload::Connect(user_id, session_id, sender, identifier, session_token) => {
                self.handle_connect(user_id, session_id, sender, session_token, identifier)
                    .await?
            }
            CommandPayload::Timeout(user_id, token) => {
                self.handle_timeout(user_id, token).await?;
            }
            CommandPayload::Disconnect(user_id, session_token) => {
                self.handle_disconnect(user_id, session_token).await?
            }
            CommandPayload::DisconnectUser(user_id) => self.handle_disconnect_user(user_id).await?,
        }
        Ok(())
    }

    async fn route_control(
        &self,
        payload: EventPayload,
        policy: ControlRoutingPolicy,
    ) -> Result<(), ServerError> {
        for subscriber in &self.observers {
            let can_receive = match &policy {
                ControlRoutingPolicy::GroupRights {
                    group_id,
                    minimun_rights,
                } => {
                    self.service
                        .get_group_rights(*group_id, subscriber.user_id())
                        .await?
                        >= *minimun_rights
                }
                ControlRoutingPolicy::ChannelRights {
                    channel_id,
                    minimun_rights,
                } => {
                    self.service
                        .get_channel_rights(*channel_id, subscriber.user_id())
                        .await?
                        >= *minimun_rights
                }
                ControlRoutingPolicy::User { user_id } => subscriber.user_id() == *user_id,
                ControlRoutingPolicy::Role { role_id } => {
                    self.service.get_user_role(subscriber.user_id()).await? == Some(*role_id)
                }
                ControlRoutingPolicy::Broadcast => true,
            };

            if can_receive {
                subscriber
                    .send(SubscriberMessage::Event(payload.clone()))
                    .await;
            }
        }
        return Ok(());
    }

    pub async fn run(mut self) -> Result<(), ServerError> {
        let mut server = Server::bind(
            "[::]:4443",
            self.cert_path.to_str().expect("Invalid cert path"),
            self.key_path.to_str().expect("Invalid key path"),
        )
        .await
        .expect("Failed to start server");

        let sender = self.subscribe_channel().await;
        let mut session_check_interval = interval(Duration::from_secs(5));

        loop {
            tokio::select! {
                Some(msg)= self.receiver.recv() => {
                    match msg{
                        ServerMessage::Command(payload) => self.handle_command(payload).await?,
                        ServerMessage::Control(control_payload, control_routing_policy) => self.handle_control(control_payload,control_routing_policy).await?,
                        ServerMessage::Voip(voip_payload, voip_routing_policy) => self.handle_voip(voip_payload,voip_routing_policy).await?,
                    }
                }
                Some(req)= server.get_request() => {
                    if let Some(conn) = server.accept_request(req).await{
                        let service = self.service.clone();
                        let tx = sender.clone();
                        tokio::spawn(async move {
                            RealtimeServer::handle_subscriber_session(conn, service, tx).await;
                        });
                    }
                }
                _ = session_check_interval.tick() => {
                    let _ = self.check_expired_sessions().await;
                }
            }
        }
    }

    pub async fn subscribe_channel(&mut self) -> mpsc::Sender<ServerMessage> {
        self.sender.clone()
    }

    pub async fn handle_user_status_update(
        &mut self,
        user_id: i64,
        status: UserStatusType,
    ) -> Result<(), ServerError> {
        if let Some(ref user) = self.service.update_user_status(user_id, status).await? {
            self.route_control(
                EventPayload::UserUpdated { user: user.clone() },
                ControlRoutingPolicy::Broadcast,
            )
            .await?;
        }
        Ok(())
    }

    pub async fn handle_voip_participant_removal(
        &mut self,
        user_id: i64,
    ) -> Result<(), ServerError> {
        let subscriptions = self.service.remove_all_subscriptions(user_id).await?;

        for subscription in subscriptions {
            let event = EventPayload::MediaUnsubscription {
                subscription: subscription.clone(),
            };
            let _ = self
                .route_control(
                    event.clone(),
                    ControlRoutingPolicy::User {
                        user_id: subscription.user_id,
                    },
                )
                .await;
            let _ = self
                .route_control(
                    event,
                    ControlRoutingPolicy::User {
                        user_id: subscription.publisher_id,
                    },
                )
                .await;
        }

        if let Some(ref participant) = self.service.remove_voip_participant(user_id).await? {
            let policy = if let Some(channel_id) = participant.channel_id {
                ControlRoutingPolicy::ChannelRights {
                    channel_id,
                    minimun_rights: 2,
                }
            } else {
                ControlRoutingPolicy::User {
                    user_id: participant.recipient_id.unwrap(),
                }
            };
            self.route_control(
                EventPayload::VoipParticipantDeleted {
                    user_id: participant.user_id,
                },
                policy,
            )
            .await?;
        }
        Ok(())
    }

    async fn check_expired_sessions(&mut self) -> Result<(), ServerError> {
        let mut expired_sessions: Vec<(i64, String)> = Vec::new();

        for observer in &self.observers {
            let session = self
                .service
                .authenticate_session(&observer.session_token)
                .await?;

            if let None = session {
                expired_sessions.push((observer.user_id, observer.session_token.clone()));
            }
        }

        for (user_id, session_token) in expired_sessions {
            let _ = self
                .service
                .logger
                .log_entry(
                    format!("Session expired for user {}", user_id),
                    "webtransport".to_string(),
                )
                .await;
            self.handle_disconnect(user_id, session_token).await?;
        }

        Ok(())
    }

    async fn handle_subscriber_session(
        connection: Connection,
        service: Service<L>,
        observer_tx: mpsc::Sender<ServerMessage>,
    ) {
        let session_token = Uuid::new_v4().to_string();
        let mut session = SubscriberSession::new(observer_tx, service, connection, session_token);
        loop {
            tokio::select! {
                Some(msg) = session.server_rx.recv() => {
                    if let Err(e) = session.handle_server_message(msg).await{
                        let error_msg = format!("{:?}", e);
                        session.send_error(error_msg).await;
                        break;
                    }
                }
                may_msg = session.connection.read_message() => {
                    match may_msg {
                        Some(msg) => {
                            if let Err(e) = session.handle_connection_message(msg).await {
                                let error_msg = format!("{:?}", e);
                                session.send_error(error_msg).await;
                                break;
                            }
                        }
                        None => break,
                    }
                }
            }
        }

        if let Some(ref user_session) = session.may_session {
            let _ = session
                .service
                .logger
                .log_entry(
                    format!("User {} disconnected (timeout)", user_session.user_id),
                    "webtransport".to_string(),
                )
                .await;
            let _ = session
                .observer_tx
                .send(ServerMessage::Command(CommandPayload::Timeout(
                    user_session.user_id,
                    session.identifier.clone(),
                )))
                .await;
        }
    }
}

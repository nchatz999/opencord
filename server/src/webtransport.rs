use crate::{
    auth::Session,
    channel::Channel,
    db::Postgre,
    error::DatabaseError,
    group::GroupRoleRights,
    managers::LogManager,
    model::EventPayload,
    user::{User, UserStatusType},
    voip::{MediaType, Subscription, VoipParticipant},
};
use opencord_transport_server::{Connection, Message, Server};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::mpsc;
use tokio::time::{Duration, interval};
use uuid::Uuid;

const MAX_INVALID_VOIP_PACKETS: u32 = 1000;

#[derive(Debug, Clone, thiserror::Error)]
pub enum DomainError {
    #[error("Internal error: {0}")]
    InternalError(#[from] DatabaseError),
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("{0}")]
pub struct SessionError(String);

impl From<DomainError> for SessionError {
    fn from(err: DomainError) -> Self {
        SessionError(err.to_string())
    }
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
    Voip(VoipPayload, i64),
    InvalidateVoip,
    InvalidateAcl,
    InvalidateSubscriptions,
}

pub enum SubscriberMessage {
    Voip(VoipPayload),
    Event(EventPayload),
    Error(String),
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
    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError>;

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

    async fn find_all_voip_participants(&self) -> Result<Vec<VoipParticipant>, DatabaseError>;
    async fn find_all_group_role_rights(&self) -> Result<Vec<GroupRoleRights>, DatabaseError>;
    async fn find_all_users(&self) -> Result<Vec<User>, DatabaseError>;
    async fn find_all_channels(&self) -> Result<Vec<Channel>, DatabaseError>;
    async fn find_all_subscriptions(&self) -> Result<Vec<Subscription>, DatabaseError>;
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

    pub async fn get_all_voip_participants(&self) -> Result<Vec<VoipParticipant>, DomainError> {
        self.repository
            .find_all_voip_participants()
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_all_group_role_rights(&self) -> Result<Vec<GroupRoleRights>, DomainError> {
        self.repository
            .find_all_group_role_rights()
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_all_users(&self) -> Result<Vec<User>, DomainError> {
        self.repository
            .find_all_users()
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_all_channels(&self) -> Result<Vec<Channel>, DomainError> {
        self.repository
            .find_all_channels()
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_all_subscriptions(&self) -> Result<Vec<Subscription>, DomainError> {
        self.repository
            .find_all_subscriptions()
            .await
            .map_err(DomainError::from)
    }
}

impl Repository for Postgre {
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

    async fn find_all_voip_participants(&self) -> Result<Vec<VoipParticipant>, DatabaseError> {
        let result = sqlx::query_as!(
            VoipParticipant,
            r#"SELECT user_id, channel_id, recipient_id, local_deafen, local_mute,
                      publish_screen, publish_camera, created_at
               FROM voip_participants"#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(result)
    }

    async fn find_all_group_role_rights(&self) -> Result<Vec<GroupRoleRights>, DatabaseError> {
        let result = sqlx::query_as!(
            GroupRoleRights,
            r#"SELECT group_id, role_id, rights FROM group_role_rights"#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(result)
    }

    async fn find_all_users(&self) -> Result<Vec<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"SELECT user_id, username, created_at, avatar_file_id, role_id,
                      status as "status: UserStatusType", server_mute, server_deafen
               FROM users"#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(result)
    }

    async fn find_all_channels(&self) -> Result<Vec<Channel>, DatabaseError> {
        let result = sqlx::query_as!(
            Channel,
            r#"SELECT channel_id, channel_name, group_id,
                      channel_type as "channel_type: _"
               FROM channels"#
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(result)
    }

    async fn find_all_subscriptions(&self) -> Result<Vec<Subscription>, DatabaseError> {
        let result = sqlx::query_as!(
            Subscription,
            r#"SELECT user_id, publisher_id, media_type as "media_type: MediaType", created_at
               FROM subscriptions"#
        )
        .fetch_all(&self.pool)
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
    invalid_voip_count: u32,
}

impl SubscriberHandler {
    pub fn user_id(&self) -> i64 {
        self.user_id
    }

    async fn send(&self, msg: SubscriberMessage) -> bool {
        self.sender.send(msg).await.is_ok()
    }

    async fn send_error(&self, reason: String) {
        let _ = self.sender.send(SubscriberMessage::Error(reason)).await;
    }
}

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

    async fn handle_connection_message(&mut self, msg: Message) -> Result<(), SessionError> {
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

        self.send_to_server(ServerMessage::Voip(payload, user_session.user_id))
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
            ControlPayload::Close => {
                return Err(SessionError("Session End".to_string()));
            }
            ControlPayload::Error { .. } => {
                return Err(SessionError("Received error from client".to_string()));
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

pub struct RealtimeServer<L: LogManager> {
    observers: Vec<SubscriberHandler>,
    service: Service<L>,
    receiver: mpsc::Receiver<ServerMessage>,
    sender: mpsc::Sender<ServerMessage>,
    cert_path: PathBuf,
    key_path: PathBuf,
    voip_cache: Vec<VoipParticipant>,
    acl_cache: Vec<GroupRoleRights>,
    user_cache: Vec<User>,
    channel_cache: Vec<Channel>,
    subscription_cache: Vec<Subscription>,
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
            voip_cache: vec![],
            acl_cache: vec![],
            user_cache: vec![],
            channel_cache: vec![],
            subscription_cache: vec![],
        }
    }

    fn count_user_sessions(&self, user_id: i64) -> i64 {
        self.observers
            .iter()
            .filter(|u| u.user_id == user_id)
            .count() as i64
    }

    async fn reload_voip_cache(&mut self) {
        if let Ok(participants) = self.service.get_all_voip_participants().await {
            self.voip_cache = participants;
        }
    }

    async fn reload_acl_cache(&mut self) {
        if let Ok(rights) = self.service.get_all_group_role_rights().await {
            self.acl_cache = rights;
        }
        if let Ok(users) = self.service.get_all_users().await {
            self.user_cache = users;
        }
        if let Ok(channels) = self.service.get_all_channels().await {
            self.channel_cache = channels;
        }
    }

    async fn reload_subscription_cache(&mut self) {
        if let Ok(subscriptions) = self.service.get_all_subscriptions().await {
            self.subscription_cache = subscriptions;
        }
    }

    fn get_cached_voip(&self, user_id: i64) -> Option<&VoipParticipant> {
        self.voip_cache.iter().find(|p| p.user_id == user_id)
    }

    fn is_cached_subscribed(
        &self,
        user_id: i64,
        publisher_id: i64,
        media_type: &MediaType,
    ) -> bool {
        self.subscription_cache.iter().any(|s| {
            s.user_id == user_id && s.publisher_id == publisher_id && s.media_type == *media_type
        })
    }

    fn get_cached_channel_rights(&self, channel_id: i64, user_id: i64) -> i64 {
        let role_id = self
            .user_cache
            .iter()
            .find(|u| u.user_id == user_id)
            .map(|u| u.role_id);
        let group_id = self
            .channel_cache
            .iter()
            .find(|c| c.channel_id == channel_id)
            .map(|c| c.group_id);

        match (role_id, group_id) {
            (Some(r), Some(g)) => self
                .acl_cache
                .iter()
                .find(|a| a.group_id == g && a.role_id == r)
                .map(|a| a.rights)
                .unwrap_or(0),
            _ => 0,
        }
    }

    fn get_cached_group_rights(&self, group_id: i64, user_id: i64) -> i64 {
        let role_id = self
            .user_cache
            .iter()
            .find(|u| u.user_id == user_id)
            .map(|u| u.role_id);

        match role_id {
            Some(r) => self
                .acl_cache
                .iter()
                .find(|a| a.group_id == group_id && a.role_id == r)
                .map(|a| a.rights)
                .unwrap_or(0),
            _ => 0,
        }
    }

    fn get_cached_user_role(&self, user_id: i64) -> Option<i64> {
        self.user_cache
            .iter()
            .find(|u| u.user_id == user_id)
            .map(|u| u.role_id)
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
            invalid_voip_count: 0,
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

    async fn send_error_to_user(&self, user_id: i64, reason: String) {
        if let Some(subscriber) = self.observers.iter().find(|o| o.user_id() == user_id) {
            subscriber.send_error(reason).await;
        }
    }

    fn increment_invalid_voip(&mut self, user_id: i64) -> bool {
        if let Some(subscriber) = self.observers.iter_mut().find(|o| o.user_id() == user_id) {
            subscriber.invalid_voip_count += 1;
            return subscriber.invalid_voip_count > MAX_INVALID_VOIP_PACKETS;
        }
        false
    }

    fn reset_invalid_voip(&mut self, user_id: i64) {
        if let Some(subscriber) = self.observers.iter_mut().find(|o| o.user_id() == user_id) {
            subscriber.invalid_voip_count = 0;
        }
    }

    async fn handle_voip(
        &mut self,
        payload: VoipPayload,
        sender_id: i64,
    ) -> Result<(), ServerError> {
        match payload {
            VoipPayload::Speech { is_speaking, .. } => {
                self.handle_speech(sender_id, is_speaking).await
            }
            VoipPayload::Media {
                media_type: VoipDataType::Voice,
                data,
                timestamp,
                real_timestamp,
                key,
                sequence,
                ..
            } => {
                self.handle_voice(sender_id, data, timestamp, real_timestamp, key, sequence)
                    .await
            }
            VoipPayload::Media {
                media_type,
                data,
                timestamp,
                real_timestamp,
                key,
                sequence,
                ..
            } => {
                self.handle_media(
                    sender_id,
                    media_type,
                    data,
                    timestamp,
                    real_timestamp,
                    key,
                    sequence,
                )
                .await
            }
        }
    }

    async fn handle_speech(
        &mut self,
        sender_id: i64,
        is_speaking: bool,
    ) -> Result<(), ServerError> {
        let Some(sender_participant) = self.get_cached_voip(sender_id) else {
            if self.increment_invalid_voip(sender_id) {
                self.send_error_to_user(sender_id, "VoIP abuse detected".into())
                    .await;
                self.handle_disconnect_user(sender_id).await?;
            }
            return Ok(());
        };

        let payload = VoipPayload::Speech {
            user_id: sender_id as u64,
            is_speaking,
        };

        if let Some(channel_id) = sender_participant.channel_id {
            if self.get_cached_channel_rights(channel_id, sender_id) <= 2 {
                if self.increment_invalid_voip(sender_id) {
                    self.send_error_to_user(sender_id, "VoIP abuse detected".into())
                        .await;
                    self.handle_disconnect_user(sender_id).await?;
                }
                return Ok(());
            }
            self.reset_invalid_voip(sender_id);
            for subscriber in &self.observers {
                if self.get_cached_channel_rights(channel_id, subscriber.user_id()) >= 1 {
                    subscriber
                        .send(SubscriberMessage::Voip(payload.clone()))
                        .await;
                }
            }
        } else if let Some(recipient_id) = sender_participant.recipient_id {
            self.reset_invalid_voip(sender_id);
            for subscriber in &self.observers {
                if subscriber.user_id() == recipient_id || subscriber.user_id() == sender_id {
                    subscriber
                        .send(SubscriberMessage::Voip(payload.clone()))
                        .await;
                }
            }
        }

        Ok(())
    }

    async fn handle_voice(
        &mut self,
        sender_id: i64,
        data: Vec<u8>,
        timestamp: u64,
        real_timestamp: u64,
        key: KeyType,
        sequence: u64,
    ) -> Result<(), ServerError> {
        let Some(sender_participant) = self.get_cached_voip(sender_id) else {
            if self.increment_invalid_voip(sender_id) {
                self.send_error_to_user(sender_id, "VoIP abuse detected".into())
                    .await;
                self.handle_disconnect_user(sender_id).await?;
            }
            return Ok(());
        };

        let payload = VoipPayload::Media {
            user_id: sender_id as u64,
            media_type: VoipDataType::Voice,
            data,
            timestamp,
            real_timestamp,
            key,
            sequence,
        };

        if let Some(channel_id) = sender_participant.channel_id {
            if self.get_cached_channel_rights(channel_id, sender_id) <= 2 {
                if self.increment_invalid_voip(sender_id) {
                    self.send_error_to_user(sender_id, "VoIP abuse detected".into())
                        .await;
                    self.handle_disconnect_user(sender_id).await?;
                }
                return Ok(());
            }
            self.reset_invalid_voip(sender_id);
            for subscriber in &self.observers {
                if let Some(participant) = self.get_cached_voip(subscriber.user_id()) {
                    if participant.channel_id == Some(channel_id)
                        && !participant.local_deafen
                        && subscriber.user_id() != sender_id
                    {
                        subscriber
                            .send(SubscriberMessage::Voip(payload.clone()))
                            .await;
                    }
                }
            }
        } else if let Some(recipient_id) = sender_participant.recipient_id {
            self.reset_invalid_voip(sender_id);
            for subscriber in &self.observers {
                if let Some(participant) = self.get_cached_voip(subscriber.user_id()) {
                    if participant.recipient_id.is_some()
                        && !participant.local_deafen
                        && subscriber.user_id() == recipient_id
                    {
                        subscriber
                            .send(SubscriberMessage::Voip(payload.clone()))
                            .await;
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_media(
        &self,
        sender_id: i64,
        media_type: VoipDataType,
        data: Vec<u8>,
        timestamp: u64,
        real_timestamp: u64,
        key: KeyType,
        sequence: u64,
    ) -> Result<(), ServerError> {
        let db_media_type = if matches!(media_type, VoipDataType::Camera) {
            MediaType::Camera
        } else {
            MediaType::Screen
        };

        let payload = VoipPayload::Media {
            user_id: sender_id as u64,
            media_type,
            data,
            timestamp,
            real_timestamp,
            key,
            sequence,
        };

        for subscriber in &self.observers {
            if self.is_cached_subscribed(subscriber.user_id(), sender_id, &db_media_type) {
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
                    self.get_cached_group_rights(*group_id, subscriber.user_id()) >= *minimun_rights
                }
                ControlRoutingPolicy::ChannelRights {
                    channel_id,
                    minimun_rights,
                } => {
                    self.get_cached_channel_rights(*channel_id, subscriber.user_id())
                        >= *minimun_rights
                }
                ControlRoutingPolicy::User { user_id } => subscriber.user_id() == *user_id,
                ControlRoutingPolicy::Role { role_id } => {
                    self.get_cached_user_role(subscriber.user_id()) == Some(*role_id)
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

        self.reload_voip_cache().await;
        self.reload_acl_cache().await;
        self.reload_subscription_cache().await;

        let sender = self.subscribe_channel().await;
        let mut session_check_interval = interval(Duration::from_secs(5));

        loop {
            tokio::select! {
                Some(msg)= self.receiver.recv() => {
                    match msg{
                        ServerMessage::Command(payload) => self.handle_command(payload).await?,
                        ServerMessage::Control(control_payload, control_routing_policy) => self.handle_control(control_payload,control_routing_policy).await?,
                        ServerMessage::Voip(voip_payload, sender_id) => self.handle_voip(voip_payload, sender_id).await?,
                        ServerMessage::InvalidateVoip => self.reload_voip_cache().await,
                        ServerMessage::InvalidateAcl => self.reload_acl_cache().await,
                        ServerMessage::InvalidateSubscriptions => self.reload_subscription_cache().await,
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

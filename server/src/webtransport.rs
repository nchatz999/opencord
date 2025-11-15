use crate::{
    auth::Session,
    db::Postgre,
    error::DatabaseError,
    model::EventPayload,
    user::{User, UserStatusType},
    voip::VoipParticipant,
};
use opencord_transport_server::{Connection, Message, Server};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

#[derive(Debug, Clone)]
pub enum DomainError {
    BadRequest(String),
    InternalError(String),
}

impl From<DatabaseError> for DomainError {
    fn from(err: DatabaseError) -> Self {
        DomainError::InternalError(format!("Database error: {:?}", err))
    }
}

#[derive(Debug, Clone)]
pub enum SessionError {
    BadRequest(String),
    InternalError,
}

pub struct ServerError;

impl From<DomainError> for ServerError {
    fn from(err: DomainError) -> Self {
        ServerError
    }
}

impl From<DomainError> for SessionError {
    fn from(err: DomainError) -> Self {
        match err {
            DomainError::BadRequest(msg) => SessionError::BadRequest(msg),
            DomainError::InternalError(_) => SessionError::InternalError,
        }
    }
}

pub enum WebTransportError {
    Database(DatabaseError),
    UserNotFound { user_id: i64 },
    Session(String),
    Transport(String),
}

impl From<DatabaseError> for WebTransportError {
    fn from(err: DatabaseError) -> Self {
        WebTransportError::Database(err)
    }
}

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
    Channel(i64, bool),
    Recipient(i64),
}

//These can come from endpoints or subscribers
pub enum CommandPayload {
    Connect(i64, mpsc::Sender<SubscriberMessage>), //comes from subscribers with token
    Timeout(i64),                                  //when a subscriber times out
    Disconnect(i64),                               // can come from endpoint  and subscriber
    Remove(i64, String),
}

pub enum ServerMessage {
    Command(CommandPayload), //commands from endpoints or subscribers
    Control(EventPayload, ControlRoutingPolicy), //events from endpoints
    Voip(VoipPayload, VoipRoutingPolicy), //voip data from subscribers, for voip routing policy is always same channel
}

pub enum SubscriberMessage {
    Voip(VoipPayload),
    Event(EventPayload),
    Close(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AnswerPayload {
    Accept,
    Decline(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ControlPayload {
    Connect(String),
    Answer(AnswerPayload),
    Close(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConnectionMessage {
    Voip(VoipPayload),
    Event(EventPayload),
    Control(ControlPayload),
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
#[serde(rename_all = "camelCase", tag = "type")]
pub struct SpeechPayload {
    user_id: u64,
    is_speaking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct MediaPayload {
    user_id: u64,
    media_type: VoipDataType,
    data: Vec<u8>,
    timestamp: u64,
    real_timestamp: u64,
    key: KeyType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum VoipPayload {
    #[serde(rename_all = "camelCase")]
    Speech(SpeechPayload),
    #[serde(rename_all = "camelCase")]
    Media(MediaPayload),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyType {
    Key,
    Delta,
}

pub trait WebTransportTransaction: Send + Sync {
    async fn update_user_status(
        &mut self,
        user_id: i64,
        status: UserStatusType,
    ) -> Result<Option<User>, DatabaseError>;

    async fn remove_voip_participant(
        &mut self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;
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

    async fn find_voip_participants_for_channel(
        &self,
        channel_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError>;

    async fn find_voip_participant_for_dm(
        &self,
        user_id: i64,
        recipient_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

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
}

#[derive(Clone)]
pub struct Service {
    repository: Postgre,
}

impl Service {
    pub fn new(repository: Postgre) -> Self {
        Self { repository }
    }

    pub async fn get_user_role(&self, user_id: i64) -> Result<Option<i64>, DomainError> {
        if user_id <= 0 {
            return Err(DomainError::BadRequest("Invalid user ID".to_string()));
        }

        self.repository
            .find_user_role(user_id)
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_user_rights_in_channel(
        &self,
        user_id: i64,
        channel_id: i64,
    ) -> Result<Option<i64>, DomainError> {
        if user_id <= 0 {
            return Err(DomainError::BadRequest("Invalid user ID".to_string()));
        }
        if channel_id <= 0 {
            return Err(DomainError::BadRequest("Invalid channel ID".to_string()));
        }

        self.repository
            .find_user_channel_rights(channel_id, user_id)
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_user_group_rights(
        &self,
        user_id: i64,
        group_id: i64,
    ) -> Result<Option<i64>, DomainError> {
        if user_id <= 0 {
            return Err(DomainError::BadRequest("Invalid user ID".to_string()));
        }
        if group_id <= 0 {
            return Err(DomainError::BadRequest("Invalid group ID".to_string()));
        }

        self.repository
            .find_user_group_rights(group_id, user_id)
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_channel_voip_participants(
        &self,
        channel_id: i64,
    ) -> Result<Vec<VoipParticipant>, DomainError> {
        if channel_id <= 0 {
            return Err(DomainError::BadRequest("Invalid channel ID".to_string()));
        }

        self.repository
            .find_voip_participants_for_channel(channel_id)
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_dm_voip_participant(
        &self,
        user_id: i64,
        recipient_id: i64,
    ) -> Result<Option<VoipParticipant>, DomainError> {
        if user_id <= 0 {
            return Err(DomainError::BadRequest("Invalid user ID".to_string()));
        }
        if recipient_id <= 0 {
            return Err(DomainError::BadRequest("Invalid recipient ID".to_string()));
        }

        self.repository
            .find_voip_participant_for_dm(user_id, recipient_id)
            .await
            .map_err(DomainError::from)
    }

    pub async fn get_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DomainError> {
        if user_id <= 0 {
            return Err(DomainError::BadRequest("Invalid user ID".to_string()));
        }

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
        if user_id <= 0 {
            return Err(DomainError::BadRequest("Invalid user ID".to_string()));
        }

        let mut repo = self.repository.clone();
        repo.update_user_status(user_id, status)
            .await
            .map_err(DomainError::from)
    }

    pub async fn remove_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DomainError> {
        if user_id <= 0 {
            return Err(DomainError::BadRequest("Invalid user ID".to_string()));
        }

        let mut repo = self.repository.clone();
        repo.remove_voip_participant(user_id)
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

    async fn find_voip_participants_for_channel(
        &self,
        channel_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError> {
        let results = sqlx::query_as!(
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
               WHERE vp.channel_id = $1"#,
            channel_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
    }

    async fn find_voip_participant_for_dm(
        &self,
        user_id: i64,
        recipient_id: i64,
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
               WHERE (vp.user_id = $1 AND vp.recipient_id = $2)
                  OR (vp.user_id = $2 AND vp.recipient_id = $1)"#,
            user_id,
            recipient_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"SELECT * FROM sessions WHERE session_token = $1"#,
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
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
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
}

pub struct SubscriberHandler {
    user_id: i64,
    sender: mpsc::Sender<SubscriberMessage>,
}

impl SubscriberHandler {
    pub fn user_id(&self) -> i64 {
        self.user_id
    }

    async fn send(&self, msg: SubscriberMessage) -> bool {
        self.sender.send(msg).await.is_ok()
    }
}

struct SubscriberSession {
    may_user_id: Option<i64>,
    observer_tx: mpsc::Sender<ServerMessage>,
    server_tx: mpsc::Sender<SubscriberMessage>,
    server_rx: mpsc::Receiver<SubscriberMessage>,
    service: Service,
    connection: Connection,
}

impl SubscriberSession {
    fn new(observer_tx: mpsc::Sender<ServerMessage>, service: Service, conn: Connection) -> Self {
        let (server_tx, server_rx): (
            mpsc::Sender<SubscriberMessage>,
            mpsc::Receiver<SubscriberMessage>,
        ) = mpsc::channel(10000);
        Self {
            may_user_id: None,
            observer_tx,
            server_tx,
            server_rx,
            service,
            connection: conn,
        }
    }

    async fn close(&mut self, reason: String) {
        if let Ok(serialized_event) =
            rmp_serde::to_vec_named(&ConnectionMessage::Control(ControlPayload::Close(reason)))
        {
            self.connection
                .send_data_safe(serialized_event.into())
                .await;
        }
    }

    async fn handle_server_message(&mut self, msg: SubscriberMessage) {
        match msg {
            SubscriberMessage::Event(payload) => {
                if let Ok(serialized_event) =
                    rmp_serde::to_vec_named(&ConnectionMessage::Event(payload))
                {
                    self.connection
                        .send_data_safe(serialized_event.into())
                        .await;
                }
            }
            SubscriberMessage::Voip(payload) => {
                if let Ok(serialized_event) =
                    rmp_serde::to_vec_named(&ConnectionMessage::Voip(payload))
                {
                    self.connection.send_data(serialized_event.into()).await;
                }
            }
            SubscriberMessage::Close(reason) => {
                if let Ok(serialized_event) = rmp_serde::to_vec_named(&ConnectionMessage::Control(
                    ControlPayload::Close(reason),
                )) {
                    self.connection.send_data(serialized_event.into()).await;
                }
            }
        }
    }

    async fn handle_connection_message(&mut self, msg: Message) -> Result<(), SessionError> {
        match msg {
            Message::Unsafe(bytes) => {
                if let Ok(voip_msg) = rmp_serde::from_slice::<VoipPayload>(&bytes) {
                    return self.handle_voip_message(voip_msg).await;
                }
                Err(SessionError::BadRequest(
                    "Invalid VoIP message format".to_string(),
                ))
            }
            Message::Safe(bytes) => {
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
        return Ok(self.process_voip_message(payload).await?);
    }

    async fn process_voip_message(&mut self, payload: VoipPayload) -> Result<(), SessionError> {
        let user_id = self
            .may_user_id
            .ok_or_else(|| SessionError::BadRequest("No user authenticated".to_string()))?;

        let session = self
            .service
            .get_voip_participant(user_id)
            .await?
            .ok_or_else(|| SessionError::BadRequest("No active VoIP session".to_string()))?;

        if let Some(channel_id) = session.channel_id {
            self.route_to_channel(payload, channel_id).await;
        } else if let Some(recipient_id) = session.recipient_id {
            self.route_to_recipient(payload, recipient_id).await;
        }

        Ok(())
    }
    async fn handle_control_message(
        &mut self,
        payload: ControlPayload,
    ) -> Result<(), SessionError> {
        match payload {
            ControlPayload::Connect(token) => {
                match self.service.authenticate_session(&token).await? {
                    Some(session) => {
                        self.may_user_id = Some(session.user_id);
                        let _ = self
                            .observer_tx
                            .send(ServerMessage::Command(CommandPayload::Connect(
                                session.user_id,
                                self.server_tx.clone(),
                            )))
                            .await;
                        self.send_ordered(ConnectionMessage::Control(ControlPayload::Answer(
                            AnswerPayload::Accept,
                        )))
                        .await;
                        Ok(())
                    }
                    None => {
                        self.send_ordered(ConnectionMessage::Control(ControlPayload::Answer(
                            AnswerPayload::Decline("Bad Credentials".to_string()),
                        )))
                        .await;
                        Ok(())
                    }
                }
            }
            ControlPayload::Answer(_answer_payload) => Err(SessionError::BadRequest(
                "Unexpected answer payload".to_string(),
            )),
            ControlPayload::Close(reason) => Err(SessionError::BadRequest(format!(
                "Connection closed: {}",
                reason
            ))),
        }
    }

    async fn route_to_channel(&mut self, payload: VoipPayload, channel_id: i64) {
        let is_media = matches!(payload, VoipPayload::Media(_));
        let _ = self
            .observer_tx
            .send(ServerMessage::Voip(
                payload,
                VoipRoutingPolicy::Channel(channel_id, is_media),
            ))
            .await;
    }

    async fn route_to_recipient(&mut self, payload: VoipPayload, recipient_id: i64) {
        let _ = self
            .observer_tx
            .send(ServerMessage::Voip(
                payload,
                VoipRoutingPolicy::Recipient(recipient_id),
            ))
            .await;
    }
    async fn send_ordered<T>(&mut self, payload: T)
    where
        T: serde::Serialize,
    {
        if let Ok(serialized_data) = rmp_serde::to_vec_named(&payload) {
            self.connection.send_data_safe(serialized_data.into()).await;
        }
    }

    async fn read_connection_message(&mut self) -> Option<Message> {
        self.connection.read_message().await
    }
}

struct RealtimeServer {
    observers: HashMap<String, SubscriberHandler>,
    service: Service,
    receiver: mpsc::Receiver<ServerMessage>,
    sender: mpsc::Sender<ServerMessage>,
}

impl RealtimeServer {
    fn new(repository: Postgre) -> Self {
        let (server_tx, server_rx): (mpsc::Sender<ServerMessage>, mpsc::Receiver<ServerMessage>) =
            mpsc::channel(1000);

        Self {
            observers: HashMap::new(),
            service: Service::new(repository),
            receiver: server_rx,
            sender: server_tx,
        }
    }
    async fn handle_timeout(&mut self, user_id: i64) {
        let _ = self.broadcast_user_status_update(user_id, UserStatusType::Offline)
            .await;

        let _ = self.handle_voip_participant_removal(user_id).await;

        self.observers
            .retain(|_, subscriber| subscriber.user_id() != user_id);
    }

    async fn handle_connect(
        &mut self,
        user_id: i64,
        sender: mpsc::Sender<SubscriberMessage>,
    ) -> Result<(), ServerError> {
        for (_, existing_subscriber) in &self.observers {
            if existing_subscriber.user_id() == user_id {
                existing_subscriber
                    .send(SubscriberMessage::Close("New session started".to_string()))
                    .await;
            }
        }

        self.observers.retain(|_, sub| sub.user_id() != user_id);
        let _ = self.broadcast_user_status_update(user_id, UserStatusType::Online)
            .await;
        let subscriber = SubscriberHandler { user_id, sender };
        self.observers
            .insert(subscriber.user_id().to_string(), subscriber);
        Ok(())
    }

    async fn handle_disconnect(&mut self, user_id: i64) -> Result<(), ServerError> {
        self.broadcast_user_status_update(user_id, UserStatusType::Offline)
            .await?;

        self.handle_voip_participant_removal(user_id).await?;

        self.observers
            .retain(|_, subscriber| subscriber.user_id() != user_id);
        Ok(())
    }

    async fn handle_removal(&mut self, user_id: i64, reason: String) -> Result<(), ServerError> {
        self.broadcast_user_status_update(user_id, UserStatusType::Offline)
            .await?;

        self.handle_voip_participant_removal(user_id).await?;

        if let Some(observer) = self.observers.get(&user_id.to_string()) {
            observer.send(SubscriberMessage::Close(reason)).await;
        }
        self.observers
            .retain(|_, subscriber| subscriber.user_id() != user_id);
        Ok(())
    }

    async fn handle_voip(
        &self,
        payload: VoipPayload,
        policy: VoipRoutingPolicy,
    ) -> Result<(), ServerError> {
        self.route_voip(payload, policy).await?;
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
            CommandPayload::Connect(user_id, sender) => {
                self.handle_connect(user_id, sender).await?
            }
            CommandPayload::Timeout(_) => todo!(),
            CommandPayload::Disconnect(user_id) => self.handle_disconnect(user_id).await?,
            CommandPayload::Remove(user_id, reason) => self.handle_removal(user_id, reason).await?,
        }
        Ok(())
    }

    async fn route_control(
        &self,
        payload: EventPayload,
        policy: ControlRoutingPolicy,
    ) -> Result<(), ServerError> {
        for (_, subscriber) in &self.observers {
            let can_receive = match &policy {
                ControlRoutingPolicy::GroupRights {
                    group_id,
                    minimun_rights,
                } => {
                    if let Some(rights) = self
                        .service
                        .get_user_group_rights(subscriber.user_id(), *group_id)
                        .await?
                    {
                        rights >= *minimun_rights
                    } else {
                        false
                    }
                }
                ControlRoutingPolicy::ChannelRights {
                    channel_id,
                    minimun_rights,
                } => {
                    if let Some(rights) = self
                        .service
                        .get_user_rights_in_channel(subscriber.user_id(), *channel_id)
                        .await?
                    {
                        rights >= *minimun_rights
                    } else {
                        false
                    }
                }
                ControlRoutingPolicy::User { user_id } => subscriber.user_id() == *user_id,
                ControlRoutingPolicy::Role { role_id } => {
                    if let Some(user_role) =
                        self.service.get_user_role(subscriber.user_id()).await?
                    {
                        user_role == *role_id
                    } else {
                        false
                    }
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

    async fn route_voip(
        &self,
        event: VoipPayload,
        policy: VoipRoutingPolicy,
    ) -> Result<(), ServerError> {
        match policy {
            VoipRoutingPolicy::Channel(channel_id, include_sender) => {
                let participants = self.service.get_channel_voip_participants(channel_id).await?;
                
                for participant in participants {
                    // Skip sender if include_sender is false
                    if !include_sender {
                        if let VoipPayload::Speech(ref speech) = event {
                            if speech.user_id as i64 == participant.user_id {
                                continue;
                            }
                        }
                        if let VoipPayload::Media(ref media) = event {
                            if media.user_id as i64 == participant.user_id {
                                continue;
                            }
                        }
                    }
                    
                    if let Some(subscriber) = self.observers.get(&participant.user_id.to_string()) {
                        subscriber.send(SubscriberMessage::Voip(event.clone())).await;
                    }
                }
            }
            VoipRoutingPolicy::Recipient(recipient_id) => {
                if let Some(subscriber) = self.observers.get(&recipient_id.to_string()) {
                    subscriber.send(SubscriberMessage::Voip(event)).await;
                }
            }
        }
        Ok(())
    }

    pub async fn run(mut self) -> Result<(), ServerError> {
        let cert_path = std::env::var("CERT_PATH").expect("Cert not found");
        let key_path = std::env::var("KEY_PATH").expect("Key not found");

        let mut server = Server::bind("[::]:4443", &cert_path, &key_path)
            .await
            .expect("Failed to start server");

        let sender = self.subscribe_channel().await;
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
            }
        }
    }

    pub async fn subscribe_channel(&mut self) -> mpsc::Sender<ServerMessage> {
        self.sender.clone()
    }

    pub async fn broadcast_user_status_update(
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

    async fn handle_subscriber_session(
        connection: Connection,
        service: Service,
        observer_tx: mpsc::Sender<ServerMessage>,
    ) {
        let mut session = SubscriberSession::new(observer_tx, service, connection);
        let (server_tx, mut server_rx) = mpsc::channel(1000);

        loop {
            tokio::select! {
                Some(msg) = server_rx.recv() => {
                    session.handle_server_message(msg).await;

                }
                Some(msg) = session.read_connection_message() => {
                    if let Err(e) = session.handle_connection_message(msg).await {
                        session.close("sadf".to_string()).await;
                        break;
                    }
                }
            }
        }
    }
}

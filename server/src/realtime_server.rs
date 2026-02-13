use crate::auth::Session;
use crate::channel::Channel;
use crate::db::Postgre;
use crate::error::DatabaseError;
use crate::group::GroupRoleRights;
use crate::managers::LogManager;
use crate::model::EventPayload;
use crate::subscriber_session::SessionService;
use crate::transport::{
    CommandPayload, ControlRoutingPolicy, DomainError, ServerMessage, SubscriberHandler,
    SubscriberMessage,
};
use crate::user::{User, UserStatusType};
use crate::voip::VoipParticipant;
use axum::extract::ws::{CloseFrame, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio::time::{Duration, interval};
use uuid::Uuid;

const CLOSE_CODE_AUTH_FAILED: u16 = 4001;
const CLOSE_CODE_DISCONNECTED: u16 = 4002;

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

// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

pub trait ServerRepository: Send + Sync + Clone {
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
    async fn find_all_voip_participants(&self) -> Result<Vec<VoipParticipant>, DatabaseError>;
    async fn find_all_group_role_rights(&self) -> Result<Vec<GroupRoleRights>, DatabaseError>;
    async fn find_all_users(&self) -> Result<Vec<User>, DatabaseError>;
    async fn find_all_channels(&self) -> Result<Vec<Channel>, DatabaseError>;
}

impl ServerRepository for Postgre {
    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"SELECT * FROM sessions
               WHERE session_token = $1
               AND expires_at > NOW()"#,
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct ServerService<R: ServerRepository, L: LogManager> {
    repository: R,
    pub logger: L,
}

impl<R: ServerRepository, L: LogManager> ServerService<R, L> {
    pub fn new(repository: R, logger: L) -> Self {
        Self { repository, logger }
    }

    pub async fn authenticate_session(
        &self,
        session_token: &str,
    ) -> Result<Option<Session>, DomainError> {
        Ok(self.repository.find_session(session_token).await?)
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
                        "User {} status changed to {:?} via WebSocket",
                        user_id, status
                    ),
                    "websocket".to_string(),
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
                    format!("VoIP participant {} removed via WebSocket", user_id),
                    "websocket".to_string(),
                )
                .await;
        }

        Ok(result)
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
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct WebSocketState<L: LogManager> {
    pub session_service: SessionService<Postgre, L>,
    pub observer_tx: mpsc::Sender<ServerMessage>,
}

#[derive(Deserialize)]
pub struct WebSocketParams {
    token: String,
}

pub async fn websocket_handler<L: LogManager + 'static>(
    ws: WebSocketUpgrade,
    State(state): State<WebSocketState<L>>,
    Query(params): Query<WebSocketParams>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, params.token))
}

async fn handle_socket<L: LogManager>(mut socket: WebSocket, state: WebSocketState<L>, token: String) {
    use crate::subscriber_session::SubscriberSession;
    use axum::extract::ws::Message;

    use crate::transport::ConnectionMessage;

    let session = match state.session_service.authenticate_session(&token).await {
        Ok(Some(session)) => session,
        _ => {
            let answer = rmp_serde::to_vec_named(&ConnectionMessage::Answer { ok: false })
                .expect("serialization");
            let _ = socket.send(Message::Binary(answer.into())).await;
            return;
        }
    };

    let answer =
        rmp_serde::to_vec_named(&ConnectionMessage::Answer { ok: true }).expect("serialization");
    let _ = socket.send(Message::Binary(answer.into())).await;

    let identifier = Uuid::new_v4().to_string();
    let mut subscriber_session = SubscriberSession::new(
        state.observer_tx,
        state.session_service,
        identifier,
        session,
    );
    subscriber_session.run(socket).await;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════════════════════

pub struct RealtimeServer<L: LogManager> {
    observers: Vec<SubscriberHandler>,
    service: ServerService<Postgre, L>,
    receiver: mpsc::Receiver<ServerMessage>,
    sender: mpsc::Sender<ServerMessage>,
    voip_cache: Vec<VoipParticipant>,
    acl_cache: Vec<GroupRoleRights>,
    user_cache: Vec<User>,
    channel_cache: Vec<Channel>,
}

impl<L: LogManager + 'static> RealtimeServer<L> {
    pub fn new(
        repository: Postgre,
        logger: L,
        receiver: mpsc::Receiver<ServerMessage>,
        sender: mpsc::Sender<ServerMessage>,
    ) -> Self {
        Self {
            observers: vec![],
            service: ServerService::new(repository, logger),
            receiver,
            sender,
            voip_cache: vec![],
            acl_cache: vec![],
            user_cache: vec![],
            channel_cache: vec![],
        }
    }

    pub fn sender(&self) -> mpsc::Sender<ServerMessage> {
        self.sender.clone()
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

    async fn reload_user_cache(&mut self) {
        if let Ok(users) = self.service.get_all_users().await {
            self.user_cache = users;
        }
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
        self.handle_user_status_update(user_id, UserStatusType::Offline)
            .await?;
        self.handle_voip_participant_removal(user_id).await?;
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
                ControlRoutingPolicy::Users { user_ids } => user_ids.contains(&subscriber.user_id()),
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
        Ok(())
    }

    pub async fn run(mut self) -> Result<(), ServerError> {
        self.reload_voip_cache().await;
        self.reload_acl_cache().await;

        let mut session_check_interval = interval(Duration::from_secs(5));

        loop {
            tokio::select! {
                Some(msg) = self.receiver.recv() => {
                    match msg {
                        ServerMessage::Command(payload) => self.handle_command(payload).await?,
                        ServerMessage::Control(control_payload, control_routing_policy) => {
                            self.handle_control(control_payload, control_routing_policy).await?
                        }
                        ServerMessage::InvalidateVoip => self.reload_voip_cache().await,
                        ServerMessage::InvalidateAcl => self.reload_acl_cache().await,
                        ServerMessage::InvalidateUsers => self.reload_user_cache().await,
                    }
                }
                _ = session_check_interval.tick() => {
                    let _ = self.check_expired_sessions().await;
                }
            }
        }
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

            if session.is_none() {
                expired_sessions.push((observer.user_id, observer.session_token.clone()));
            }
        }

        for (user_id, session_token) in expired_sessions {
            let _ = self
                .service
                .logger
                .log_entry(
                    format!("Session expired for user {}", user_id),
                    "websocket".to_string(),
                )
                .await;
            self.handle_disconnect(user_id, session_token).await?;
        }

        Ok(())
    }
}

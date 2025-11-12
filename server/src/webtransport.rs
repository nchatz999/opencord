use crate::{
    db::Postgre,
    error::DatabaseError,
    managers::NotificationMessage,
    model::ControlPayload,
    user::{User, UserStatusType},
    voip::VoipParticipant,
};
use http::status;
use opencord_transport_server::{Connection, Message, Server};
use rmp_serde;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::mpsc;
use tracing::{error, info};

#[derive(Debug, thiserror::Error)]
pub enum WebTransportError {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Session error: {0}")]
    Session(String),

    #[error("Deserialization error: {0}")]
    Deserialization(#[from] rmp_serde::decode::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] rmp_serde::encode::Error),

    #[error("Database error: {0}")]
    Database(#[from] DatabaseError),

    #[error("Protocol error: {0}")]
    Er(#[from] sqlx::Error),

    #[error("Service operation failed: {0}")]
    ServiceError(String),

    #[error("User not found: {user_id}")]
    UserNotFound { user_id: i64 },
}

impl From<opencord_transport_server::WebTransportError> for WebTransportError {
    fn from(e: opencord_transport_server::WebTransportError) -> Self {
        WebTransportError::Connection(e.to_string())
    }
}

pub enum ObserverMessage {
    Voip(VoipPayload),
    Event(ControlPayload),
    Close,
}

#[derive(Debug)]
pub enum SubjectMessage {
    BroadcastVoip(i64, VoipPayload),
    ClientTimout { user_id: i64 },
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
pub enum VoipPayload {
    #[serde(rename_all = "camelCase")]
    Speech { user_id: u64, is_speaking: bool },

    #[serde(rename_all = "camelCase")]
    MediaData {
        user_id: u64,
        media_type: VoipDataType,
        data: Vec<u8>,
        timestamp: u64,
        real_timestamp: u64,
        key: KeyType,
    },
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

pub trait WebTransportRepository: Send + Sync + Clone {
    type Transaction: WebTransportTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

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

    async fn find_session_user_id(&self, session_token: &str)
        -> Result<Option<i64>, DatabaseError>;

    async fn find_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;
}

pub struct PgWebTransportTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl WebTransportTransaction for PgWebTransportTransaction {
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
        .fetch_optional(&mut *self.transaction)
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
        .fetch_optional(&mut *self.transaction)
        .await
        .map_err(DatabaseError::from)?;

        Ok(result)
    }
}

impl WebTransportRepository for Postgre {
    type Transaction = PgWebTransportTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgWebTransportTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

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

    async fn find_session_user_id(
        &self,
        session_token: &str,
    ) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT user_id FROM sessions WHERE session_token = $1"#,
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
}

pub struct Subscriber {
    id: String,
    user_id: i64,
    sender: mpsc::Sender<ObserverMessage>,
}

impl Subscriber {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn user_id(&self) -> i64 {
        self.user_id
    }

    async fn send(&self, msg: ObserverMessage) -> bool {
        self.sender.send(msg).await.is_ok()
    }
}

struct RealtimeServer {
    observers: HashMap<String, Subscriber>,
    repository: Postgre,
}

impl RealtimeServer {
    fn new(repository: Postgre) -> Self {
        Self {
            observers: HashMap::new(),
            repository,
        }
    }

    async fn register(&mut self, new_observer: Subscriber) {
        self.observers
            .insert(new_observer.id().to_string(), new_observer);
    }

    async fn unregister(&mut self, user_id: i64) {
        for observer in self.observers.values() {
            if observer.user_id() == user_id {
                let _ = observer.sender.send(ObserverMessage::Close).await;
            }
        }
        self.observers
            .retain(|_, observer| observer.user_id() != user_id);
    }

    async fn remove_user_active_connections(&mut self, user_id_to_remove: i64) {
        if let Ok(Some(participant)) = self.remove_voip_participant(user_id_to_remove).await {
            if let Some(channel_id) = participant.channel_id {
                self.notify_observers(
                    ControlPayload::VoipParticipantDeleted {
                        user_id: participant.user_id,
                    },
                    crate::managers::RecipientType::ChannelRights {
                        channel_id,
                        minimum_rights: 1,
                    },
                )
                .await;
            }
            if let Some(recipient_id) = participant.recipient_id {
                self.notify_observers(
                    ControlPayload::VoipParticipantDeleted {
                        user_id: participant.user_id,
                    },
                    crate::managers::RecipientType::User {
                        user_id: recipient_id,
                    },
                )
                .await;
            }
        }
    }

    async fn notify_observers(
        &self,
        event: ControlPayload,
        recipients: crate::managers::RecipientType,
    ) {
        for observer in self.observers.values() {
            let should_receive = match recipients {
                crate::managers::RecipientType::User { user_id } => observer.user_id() == user_id,
                crate::managers::RecipientType::Role { role_id } => {
                    match self.get_user_role(observer.user_id()).await {
                        Ok(user_role_id) => user_role_id == role_id,
                        Err(_) => false,
                    }
                }
                crate::managers::RecipientType::GroupRights {
                    group_id,
                    minimum_rights,
                } => {
                    match self
                        .get_user_group_rights(observer.user_id(), group_id)
                        .await
                    {
                        Ok(rights) => rights >= minimum_rights,
                        Err(_) => false,
                    }
                }
                crate::managers::RecipientType::ChannelRights {
                    channel_id,
                    minimum_rights,
                } => {
                    match self
                        .get_user_rights_in_channel(observer.user_id(), channel_id)
                        .await
                    {
                        Ok(rights) => rights >= minimum_rights,
                        Err(_) => false,
                    }
                }
                crate::managers::RecipientType::GroupMembers { group_id } => {
                    match self
                        .get_user_group_rights(observer.user_id(), group_id)
                        .await
                    {
                        Ok(rights) => rights > 0,
                        Err(_) => false,
                    }
                }
                crate::managers::RecipientType::ChannelRecipients {
                    channel_id,
                    sender_id,
                } => {
                    let rights = self
                        .get_user_rights_in_channel(observer.user_id(), channel_id)
                        .await
                        .unwrap_or(0);

                    let joined_participants = self
                        .get_channel_voip_participants(channel_id)
                        .await
                        .unwrap_or(vec![]);

                    rights > 0
                        && joined_participants
                            .iter()
                            .any(|p| p.user_id == observer.user_id)
                        && sender_id != observer.user_id()
                }
                crate::managers::RecipientType::Broadcast => true,
            };

            if should_receive {
                let _ = observer.send(ObserverMessage::Event(event.clone())).await;
            }
        }
    }

    async fn broadcast_voip(&self, user_id: i64, data: VoipPayload) {
        let sender_id = user_id;

        let sender_participant = self.get_voip_participant(sender_id).await.unwrap_or(None);

        if let Some(participant) = sender_participant {
            if let Some(channel_id) = participant.channel_id {
                let rights = self
                    .get_user_rights_in_channel(sender_id, channel_id)
                    .await
                    .unwrap_or(0);

                if rights > 2 {
                    let participants = self
                        .get_channel_voip_participants(channel_id)
                        .await
                        .unwrap_or_default();

                    for participant in &participants {
                        let should_send = match &data {
                            VoipPayload::Speech { .. } => true,
                            VoipPayload::MediaData { user_id, .. } => {
                                participant.user_id != (*user_id as i64)
                            }
                        };

                        if should_send {
                            if let Some(observer) = self
                                .observers
                                .values()
                                .find(|observer| observer.user_id() == participant.user_id)
                            {
                                let _ = observer.send(ObserverMessage::Voip(data.clone())).await;
                            }
                        }
                    }
                }
            } else if let Some(recipient_id) = participant.recipient_id {
                let recipient_participant = self
                    .get_voip_participant(recipient_id)
                    .await
                    .unwrap_or(None);

                if let Some(recipient_participant) = recipient_participant {
                    for observer in self.observers.values() {
                        if observer.user_id() == recipient_participant.user_id {
                            let _ = observer.send(ObserverMessage::Voip(data.clone())).await;
                            break;
                        }
                    }
                }
            }
        }
    }

    pub async fn run(
        mut self,
        mut receiver: mpsc::UnboundedReceiver<NotificationMessage>,
    ) -> Result<(), WebTransportError> {
        let cert_path = std::env::var("CERT_PATH").expect("Cert not found");
        let key_path = std::env::var("KEY_PATH").expect("Key not found");

        let mut server = Server::bind("[::]:4443", &cert_path, &key_path).await?;

        info!("WebTransport server started on port 4433");

        let (subject_tx, mut subject_rx) = mpsc::channel::<SubjectMessage>(1024);

        loop {
            tokio::select! {
                may_msg = receiver.recv() => {
                    if let Some(msg) = may_msg {
                        self.notify_observers(msg.event, msg.recipients).await;
                    }
                }

                may_msg = subject_rx.recv() => {
                    if let Some(msg) = may_msg {
                        match msg {
                            SubjectMessage::BroadcastVoip(user_id, voip_msg) => {
                                self.broadcast_voip(user_id, voip_msg).await;
                            }
                            SubjectMessage::ClientTimout { user_id } => {

                                if let Ok(Some(participant)) = self.remove_voip_participant(user_id).await {
                                    if let Some(channel_id) = participant.channel_id {
                                        self.notify_observers(
                                            ControlPayload::VoipParticipantDeleted {
                                                user_id: participant.user_id,
                                            },
                                            crate::managers::RecipientType::ChannelRights {
                                                channel_id,
                                                minimum_rights: 2
                                            }
                                        )
                                        .await;
                                    } else if let Some(recipient_id) = participant.recipient_id {
                                        self.notify_observers(
                                            ControlPayload::VoipParticipantDeleted {
                                                user_id: participant.user_id,
                                            },
                                            crate::managers::RecipientType::User {
                                                user_id: recipient_id,
                                            },
                                        )
                                        .await;
                                    }
                                }

                                self.unregister(user_id).await;
                                if let Ok(Some(user)) = self.update_user_status(user_id, UserStatusType::Offline).await {
                                    self.notify_observers(
                                        ControlPayload::UserUpdated {
                                            user,
                                        },
                                        crate::managers::RecipientType::Broadcast
                                    ).await;
                                }
                            }
                        }
                    }
                }
                may_request= server.get_request() => {
                    if let Some(request) = may_request{
                        if let Ok(user_id)= self.get_user_from_session(&request.url().query().unwrap_or_default()).await {
                            if let Some(connection) = server.accept_request(request).await{
                                // Accept new client connection
                                let (observer_tx, observer_rx) = mpsc::channel::<ObserverMessage>(1024);
                                let observer = Subscriber {
                                    id: connection.id(),
                                    user_id,
                                    sender: observer_tx,
                                };
                                self.unregister(user_id).await;
                                self.register(observer).await;
                                self.remove_user_active_connections(user_id).await;

                                if let Ok(Some(status)) = self
                                    .update_user_status(user_id, UserStatusType::Online)
                                    .await
                                {
                                    self.notify_observers(
                                        ControlPayload::UserUpdated { user: status },
                                        crate::managers::RecipientType::Broadcast,
                                    )
                                    .await;
                                }
                                tokio::spawn(handle_connection(
                                    connection,
                                    self.repository.clone(),
                                    subject_tx.clone(),
                                    observer_rx,
                                    user_id,
                                ));
                            };
                        }else{
                            request.close(status::StatusCode::FORBIDDEN).await.unwrap();
                        }
                    }
                }

            }
        }
    }

    // Repository methods moved from WebTransportService
    pub async fn get_user_role(&self, user_id: i64) -> Result<i64, WebTransportError> {
        self.repository
            .find_user_role(user_id)
            .await?
            .ok_or(WebTransportError::UserNotFound { user_id })
    }

    pub async fn get_user_rights_in_channel(
        &self,
        user_id: i64,
        channel_id: i64,
    ) -> Result<i64, WebTransportError> {
        Ok(self
            .repository
            .find_user_channel_rights(channel_id, user_id)
            .await?
            .unwrap_or(0))
    }

    pub async fn get_channel_voip_participants(
        &self,
        channel_id: i64,
    ) -> Result<Vec<VoipParticipant>, WebTransportError> {
        self.repository
            .find_voip_participants_for_channel(channel_id)
            .await
            .map_err(|e| WebTransportError::Database(e))
    }

    pub async fn get_dm_voip_participant(
        &self,
        user_id: i64,
        recipient_id: i64,
    ) -> Result<Option<VoipParticipant>, WebTransportError> {
        self.repository
            .find_voip_participant_for_dm(user_id, recipient_id)
            .await
            .map_err(|e| WebTransportError::Database(e))
    }

    pub async fn update_user_status(
        &self,
        user_id: i64,
        status: UserStatusType,
    ) -> Result<Option<User>, WebTransportError> {
        let mut tx = self.repository.begin().await?;

        let status = tx
            .update_user_status(user_id, status)
            .await
            .map_err(|e| WebTransportError::Database(e))?;

        self.repository.commit(tx).await?;

        Ok(status)
    }

    pub async fn get_user_from_session(
        &self,
        session_token: &str,
    ) -> Result<i64, WebTransportError> {
        let user_id = self
            .repository
            .find_session_user_id(session_token)
            .await
            .map_err(|e| WebTransportError::Database(e))?
            .ok_or_else(|| WebTransportError::Session("Invalid session token".to_string()))?;

        Ok(user_id)
    }

    pub async fn get_user_group_rights(
        &self,
        user_id: i64,
        group_id: i64,
    ) -> Result<i64, WebTransportError> {
        Ok(self
            .repository
            .find_user_group_rights(group_id, user_id)
            .await?
            .unwrap_or(0))
    }

    pub async fn remove_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, WebTransportError> {
        let mut tx = self.repository.begin().await?;

        let participant = tx
            .remove_voip_participant(user_id)
            .await
            .map_err(|e| WebTransportError::Database(e))?;

        self.repository.commit(tx).await?;

        Ok(participant)
    }

    pub async fn get_voip_participant(
        &self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, WebTransportError> {
        self.repository
            .find_voip_participant(user_id)
            .await
            .map_err(|e| WebTransportError::Database(e))
    }
}

pub async fn start_webtransport_server(
    repository: Postgre,
    receiver: mpsc::UnboundedReceiver<NotificationMessage>,
) -> Result<(), WebTransportError> {
    let subject = RealtimeServer::new(repository);
    subject.run(receiver).await
}

async fn handle_connection(
    mut connection: Connection,
    repository: Postgre,
    subject_tx: mpsc::Sender<SubjectMessage>,
    mut observer_rx: mpsc::Receiver<ObserverMessage>,
    user_id: i64,
) {
    info!(
        "Connection accepted: user={}, session={}",
        user_id,
        connection.id()
    );

    loop {
        tokio::select! {
            may_msg = observer_rx.recv() => {
                if let Some(msg) = may_msg {
                    match msg {
                        ObserverMessage::Event(event) => {
                            if let Ok(serialized_event)  = rmp_serde::to_vec_named(&event) {
                                connection.send_data_safe(serialized_event.into()).await;
                            }
                        }
                        ObserverMessage::Voip(event) => {
                            if let Ok(serialized_event) = rmp_serde::to_vec_named(&event) {
                                connection.send_data(serialized_event.into()).await;
                            }
                        }
                        ObserverMessage::Close => {
                            connection.disconnect_with_message(200, "New Connection").await;
                            break;
                        }
                    }
                }
            }
            may_msg = connection.read_message() => {
                if let Some(msg)=may_msg {
                    match msg {
                        Message::Unsafe(bytes) => {
                            if let Ok(voip_msg) = rmp_serde::from_slice::<VoipPayload>(&bytes) {
                                let _ = subject_tx.send(SubjectMessage::BroadcastVoip(user_id, voip_msg)).await;
                            }
                        }
                        _ => {}
                    }
                }else {
                    let _ = subject_tx.send(SubjectMessage::ClientTimout { user_id }).await;
                    break;
                }
            }
        }
    }
}

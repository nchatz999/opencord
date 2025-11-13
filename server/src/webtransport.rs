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

pub enum RoutingPolicy {
    GroupRights { group_id: i64, minimun_rights: i64 },
    ChannelRights { group_id: i64, minimun_rights: i64 },
    User { user_id: i64 },
    Role { role_id: i64 },
}

//These can come from endpoints or subscribers
pub enum CommandPayload {
    Connect(i64),    //comes from subscribers with token
    Timeout(i64),    //when a subscriber times out
    Disconnect(i64), // can come from endpoint  and subscriber
}
pub enum ServerMessage {
    Command(CommandPayload), //commands from endpoints or subscribers
    Control(ControlPayload, RoutingPolicy), //events from endpoints
    Voip(VoipPayload),       //voip data from subscribers, for voip routing policy is always same
                             //channel
}

pub enum SubscriberMessage {
    Voip(VoipPayload),
    Event(ControlPayload),
    Connect(String),
    Close(String),
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

impl Repository for Postgre {
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
    sender: mpsc::Sender<SubscriberMessage>,
}

impl Subscriber {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn user_id(&self) -> i64 {
        self.user_id
    }

    async fn send(&self, msg: SubscriberMessage) -> bool {
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
    async fn handle_timeout(&self, user_id: i64) {}
    async fn handle_connect(&self, user_id: i64) {}
    async fn handle_disconnect(&self, user_id: i64) {}

    async fn handle_media(&self, media: MediaPayload) {}
    async fn handle_speech(&self, speech: SpeechPayload) {}
    async fn handle_voip(&self, payload: VoipPayload) {}
    async fn handle_control(&self, payload: ControlPayload, policy: RoutingPolicy) {}
    async fn route_control(&self, payload: ControlPayload, policy: RoutingPolicy) {}
    async fn route_voip(&self, event: VoipPayload, recipients: crate::managers::RecipientType) {}

    pub async fn run(
        mut self,
        mut receiver: mpsc::UnboundedReceiver<ServerMessage>,
    ) -> Result<(), WebTransportError> {
        let cert_path = std::env::var("CERT_PATH").expect("Cert not found");
        let key_path = std::env::var("KEY_PATH").expect("Key not found");

        let mut server = Server::bind("[::]:4443", &cert_path, &key_path).await?;

        info!("WebTransport server started on port 4433");

        loop {
            tokio::select! {
                Some(msg)= receiver.recv() => {
                }
                Some(req)= server.get_request() => {
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

async fn manage_client_session(
    mut connection: Connection,
    repository: Postgre,
    mut observer_rx: mpsc::Receiver<SubscriberMessage>,
    mut subject_tx: &mpsc::Sender<ServerMessage>,
) {
    let mut user_id: Option<i64> = None;
    loop {
        tokio::select! {
            Some(msg) = observer_rx.recv() => {
                match msg {
                    SubscriberMessage::Event(payload) if  user_id.is_some() => {
                    }
                    SubscriberMessage::Voip(payload) if  user_id.is_some() => {
                        subject_tx.send(ServerMessage::Voip(payload)).await;
                    }
                    SubscriberMessage::Connect(token)=>{
                        if let Some(id) = repository.find_session_user_id(&token).await.unwrap_or(None){
                            user_id = Some(id);
                            subject_tx.send(ServerMessage::Command(CommandPayload::Connect(id))).await;
                        };
                    }
                    SubscriberMessage::Close(reason) if user_id.is_some() => {
                        subject_tx.send(ServerMessage::Command(CommandPayload::Disconnect(user_id.unwrap()))).await;
                    }
                    _ => {
                        break
                    }
                }
            }
            Some(msg) = connection.read_message() => {
                match msg {
                    Message::Unsafe(bytes)=>{}
                    Message::Safe(bytes) => {},
                }
            }
        }
    }
}

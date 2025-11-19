use crate::model::EventPayload;
use crate::webtransport::{ControlRoutingPolicy, ServerMessage};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use time::OffsetDateTime;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VoipParticipant {
    pub user_id: i64,
    pub channel_id: Option<i64>,
    pub recipient_id: Option<i64>,
    pub local_deafen: bool,
    pub local_mute: bool,
    pub publish_screen: bool,
    pub publish_camera: bool,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, ToSchema)]
#[sqlx(type_name = "media_type", rename_all = "lowercase")]
pub enum MediaType {
    Screen,
    Camera,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
    pub user_id: i64,
    pub publisher_id: i64,
    pub media_type: MediaType,
    pub created_at: OffsetDateTime,
}

use crate::{error::DatabaseError, middleware::AuthorizeService};

#[derive(Debug, thiserror::Error)]
pub enum DomainError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Internal error")]
    InternalError(#[from] DatabaseError),
}

pub trait VoipTransaction: Send + Sync {
    async fn create_channel_voip_participant(
        &mut self,
        user_id: i64,
        channel_id: i64,
        local_mute: bool,
        local_deafen: bool,
    ) -> Result<VoipParticipant, DatabaseError>;

    async fn create_private_voip_participant(
        &mut self,
        user_id: i64,
        recipient_id: i64,
        local_mute: bool,
        local_deafen: bool,
    ) -> Result<VoipParticipant, DatabaseError>;

    async fn subscribe_to_media(
        &mut self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<Option<Subscription>, DatabaseError>;

    async fn unsubscribe_from_media(
        &mut self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<Option<Subscription>, DatabaseError>;

    async fn local_mute(
        &mut self,
        user_id: i64,
        mute: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

    async fn local_deafen(
        &mut self,
        user_id: i64,
        deafen: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

    async fn remove_participant(
        &mut self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

    async fn set_publish_screen(
        &mut self,
        user_id: i64,
        publish: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

    async fn set_publish_camera(
        &mut self,
        user_id: i64,
        publish: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;
}

pub trait VoipRepository: Send + Sync + Clone {
    type Transaction: VoipTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_voip_participants(
        &self,
        requesting_user_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError>;

    async fn find_voip_subscriptions(
        &self,
        requesting_user_id: i64,
    ) -> Result<Vec<Subscription>, DatabaseError>;

    async fn find_user_channel_rights(
        &self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError>;
}

use crate::managers::NotifierManager;

#[derive(Clone)]
pub struct VoipService<R: VoipRepository, N: NotifierManager> {
    repository: R,
    notifier: N,
}

impl<R: VoipRepository, N: NotifierManager> VoipService<R, N> {
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
        }
    }

    pub async fn get_voip_participants(
        &self,
        requesting_user_id: i64,
    ) -> Result<Vec<VoipParticipant>, DomainError> {
        let participants = self
            .repository
            .find_voip_participants(requesting_user_id)
            .await?;

        Ok(participants)
    }

    pub async fn join_channel_voip(
        &self,
        user_id: i64,
        channel_id: i64,
        local_mute: bool,
        local_deafen: bool,
    ) -> Result<(), DomainError> {
        let rights = self
            .repository
            .find_user_channel_rights(channel_id, user_id)
            .await?
            .ok_or(DomainError::PermissionDenied(
                "No access to channel".to_string(),
            ))?;

        if rights < 2 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to join voice channel".to_string(),
            ));
        }

        let mut tx = self.repository.begin().await?;

        let _ = tx.remove_participant(user_id).await;

        let participant = tx
            .create_channel_voip_participant(user_id, channel_id, local_mute, local_deafen)
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "channel_id" => {
                        DomainError::BadRequest(format!("Channel {} not found", channel_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantUpdated { user: participant };

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::ChannelRights {
                    channel_id,
                    minimun_rights: 1,
                },
            ))
            .await;

        Ok(())
    }

    pub async fn join_private_voip(
        &self,
        user_id: i64,
        recipient_user_id: i64,
        local_mute: bool,
        local_deafen: bool,
    ) -> Result<(), DomainError> {
        let recipient_role = self.repository.find_user_role(recipient_user_id).await?;

        if recipient_role.is_none() {
            return Err(DomainError::BadRequest(format!(
                "User {} not found",
                recipient_user_id
            )));
        }

        let mut tx = self.repository.begin().await?;

        let _ = tx.remove_participant(user_id).await;

        let participant = tx
            .create_private_voip_participant(user_id, recipient_user_id, local_mute, local_deafen)
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "recipient_id" => {
                        DomainError::BadRequest(format!("User {} not found", recipient_user_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantUpdated { user: participant };

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event.clone(),
                ControlRoutingPolicy::User { user_id },
            ))
            .await;

        Ok(())
    }

    pub async fn leave_voip(&self, user_id: i64) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let _ = tx
            .remove_participant(user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Participant {} not found",
                user_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantDeleted { user_id };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        Ok(())
    }

    pub async fn set_local_mute(&self, user_id: i64, mute: bool) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let participant = tx
            .local_mute(user_id, mute)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Participant {} not found",
                user_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantUpdated { user: participant };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        Ok(())
    }

    pub async fn set_local_deafen(&self, user_id: i64, deafen: bool) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let participant =
            tx.local_deafen(user_id, deafen)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "Participant {} not found",
                    user_id
                )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantUpdated { user: participant };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        Ok(())
    }

    pub async fn set_publish_screen(&self, user_id: i64, publish: bool) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let participant =
            tx.set_publish_screen(user_id, publish)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "Participant {} not found",
                    user_id
                )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantUpdated { user: participant };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        Ok(())
    }

    pub async fn set_publish_camera(&self, user_id: i64, publish: bool) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let participant =
            tx.set_publish_camera(user_id, publish)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "Participant {} not found",
                    user_id
                )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantUpdated { user: participant };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        Ok(())
    }

    pub async fn subscribe_to_media(
        &self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let subscription = tx
            .subscribe_to_media(user_id, publisher_id, media_type)
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "user_id" => DomainError::BadRequest(format!("User {} not found", user_id)),
                    "publisher_id" => {
                        DomainError::BadRequest(format!("Publisher {} not found", publisher_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?
            .ok_or(DomainError::BadRequest(
                "Cannot subscribe to media - participants not in same session".to_string(),
            ))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::MediaSubscription { subscription };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event.clone(),
                ControlRoutingPolicy::User { user_id },
            ))
            .await;
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::User {
                    user_id: publisher_id,
                },
            ))
            .await;

        Ok(())
    }

    pub async fn unsubscribe_from_media(
        &self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let subscription = tx
            .unsubscribe_from_media(user_id, publisher_id, media_type)
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "user_id" => DomainError::BadRequest(format!("User {} not found", user_id)),
                    "publisher_id" => {
                        DomainError::BadRequest(format!("Publisher {} not found", publisher_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?
            .ok_or(DomainError::BadRequest(
                "Subscription not found".to_string(),
            ))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::MediaUnsubscription { subscription };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event.clone(),
                ControlRoutingPolicy::User { user_id },
            ))
            .await;
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::User {
                    user_id: publisher_id,
                },
            ))
            .await;

        Ok(())
    }
}

use crate::db::Postgre;

pub struct PgVoipTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl VoipTransaction for PgVoipTransaction {
    async fn create_channel_voip_participant(
        &mut self,
        user_id: i64,
        channel_id: i64,
        local_mute: bool,
        local_deafen: bool,
    ) -> Result<VoipParticipant, DatabaseError> {
        let participant = sqlx::query_as!(
            VoipParticipant,
            r#"INSERT INTO voip_participants (user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera)
               VALUES ($1, $2, NULL, $4, $3, FALSE, FALSE)
               RETURNING user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera, created_at"#,
            user_id,
            channel_id,
            local_mute,
            local_deafen
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(participant)
    }

    async fn create_private_voip_participant(
        &mut self,
        user_id: i64,
        recipient_id: i64,
        local_mute: bool,
        local_deafen: bool,
    ) -> Result<VoipParticipant, DatabaseError> {
        let participant = sqlx::query_as!(
            VoipParticipant,
            r#"INSERT INTO voip_participants (user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera)
               VALUES ($1, NULL, $2, $4, $3, FALSE, FALSE)
               RETURNING user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera, created_at"#,
            user_id,
            recipient_id,
            local_mute,
            local_deafen
        )
        .fetch_one(&mut *self.transaction)
        .await?;
        Ok(participant)
    }

    async fn subscribe_to_media(
        &mut self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<Option<Subscription>, DatabaseError> {
        let subscription = sqlx::query_as!(
            Subscription,
            r#"INSERT INTO subscriptions (user_id, publisher_id, media_type)
            SELECT $1, $2, $3
            WHERE EXISTS (
                SELECT 1 
                FROM voip_participants subscriber
                JOIN voip_participants publisher ON (
                    -- Same channel
                    (subscriber.channel_id = publisher.channel_id 
                     AND subscriber.channel_id IS NOT NULL)
                    OR
                    -- Private call (bidirectional)
                    (subscriber.recipient_id = publisher.user_id 
                     AND publisher.recipient_id = subscriber.user_id)
                )
                WHERE subscriber.user_id = $1 
                    AND publisher.user_id = $2
            )
            RETURNING user_id, publisher_id, media_type as "media_type: MediaType", created_at"#,
            user_id,
            publisher_id,
            media_type as MediaType
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(subscription)
    }

    async fn unsubscribe_from_media(
        &mut self,
        user_id: i64,
        publisher_id: i64,
        media_type: MediaType,
    ) -> Result<Option<Subscription>, DatabaseError> {
        let subscription = sqlx::query_as!(
            Subscription,
            r#"DELETE FROM subscriptions
            WHERE user_id = $1 AND publisher_id = $2 AND media_type = $3
            RETURNING user_id, publisher_id, media_type as "media_type: MediaType", created_at"#,
            user_id,
            publisher_id,
            media_type as MediaType
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(subscription)
    }

    async fn local_mute(
        &mut self,
        user_id: i64,
        mute: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError> {
        let participant = sqlx::query_as!(
            VoipParticipant,
            r#"UPDATE voip_participants
               SET local_mute = $1
               WHERE user_id = $2
               RETURNING user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera, created_at"#,
            mute,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;
        Ok(participant)
    }

    async fn local_deafen(
        &mut self,
        user_id: i64,
        deafen: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError> {
        let participant = sqlx::query_as!(
            VoipParticipant,
            r#"UPDATE voip_participants
               SET local_deafen = $1
               WHERE user_id = $2
               RETURNING user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera, created_at"#,
            deafen,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(participant)
    }

    async fn remove_participant(
        &mut self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError> {
        let participant = sqlx::query_as!(
            VoipParticipant,
            r#"DELETE FROM voip_participants
               WHERE user_id = $1
               RETURNING user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera, created_at"#,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(participant)
    }

    async fn set_publish_screen(
        &mut self,
        user_id: i64,
        publish: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError> {
        let participant = sqlx::query_as!(
            VoipParticipant,
            r#"UPDATE voip_participants
               SET publish_screen = $2
               WHERE user_id = $1
               RETURNING user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera, created_at"#,
            user_id,
            publish
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(participant)
    }

    async fn set_publish_camera(
        &mut self,
        user_id: i64,
        publish: bool,
    ) -> Result<Option<VoipParticipant>, DatabaseError> {
        let participant = sqlx::query_as!(
            VoipParticipant,
            r#"UPDATE voip_participants
               SET publish_camera = $2
               WHERE user_id = $1
               RETURNING user_id, channel_id, recipient_id, local_deafen, local_mute, publish_screen, publish_camera, created_at"#,
            user_id,
            publish
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(participant)
    }
}

impl VoipRepository for Postgre {
    type Transaction = PgVoipTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgVoipTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn find_voip_participants(
        &self,
        requesting_user_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError> {
        let results = sqlx::query_as!(
            VoipParticipant,
            r#"SELECT DISTINCT vp.user_id, vp.channel_id, vp.recipient_id, vp.local_deafen, vp.local_mute, vp.publish_screen, vp.publish_camera, vp.created_at
               FROM voip_participants vp
               LEFT JOIN channels c ON vp.channel_id = c.channel_id
               LEFT JOIN group_role_rights grr ON c.group_id = grr.group_id
               LEFT JOIN users u ON u.role_id = grr.role_id AND u.user_id = $1
               WHERE
                   (vp.channel_id IS NOT NULL AND grr.rights >= 1 AND u.user_id IS NOT NULL)
                   OR
                   (vp.recipient_id IS NOT NULL AND (vp.user_id = $1 OR vp.recipient_id = $1))"#,
            requesting_user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
    }

    async fn find_voip_subscriptions(
        &self,
        requesting_user_id: i64,
    ) -> Result<Vec<Subscription>, DatabaseError> {
        let results = sqlx::query_as!(
            Subscription,
            r#"SELECT user_id, publisher_id, media_type as "media_type: MediaType", created_at
            FROM subscriptions
            WHERE user_id = $1 OR publisher_id = $1"#,
            requesting_user_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(results)
    }

    async fn find_user_channel_rights(
        &self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT grr.rights 
            FROM group_role_rights grr
            INNER JOIN users u ON u.role_id = grr.role_id
            INNER JOIN channels c ON c.group_id = grr.group_id
            WHERE c.channel_id = $1 AND u.user_id = $2"#,
            channel_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!("SELECT role_id FROM users WHERE user_id = $1", user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(result)
    }
}

use crate::error::ApiError;
use crate::managers::DefaultNotifierManager;
use crate::middleware::authorize;
use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::middleware::from_fn_with_state;
use utoipa_axum::{router::OpenApiRouter, routes};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetMuteRequest {
    pub mute: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetDeafenRequest {
    pub deafen: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetPublishScreenRequest {
    pub publish: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetPublishCameraRequest {
    pub publish: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeToMediaRequest {
    pub publisher_id: i64,
    pub media_type: MediaType,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnsubscribeFromMediaRequest {
    pub publisher_id: i64,
    pub media_type: MediaType,
}

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        match err {
            DomainError::BadRequest(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::PermissionDenied(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::InternalError(db_err) => {
                tracing::error!("Database error: {}", db_err);
                ApiError::InternalServerError("Internal server error".to_string())
            }
        }
    }
}

pub fn voip_routes(
    voip_service: VoipService<Postgre, DefaultNotifierManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(get_voip_participants_handler))
        .routes(routes!(join_channel_voip_handler))
        .routes(routes!(join_private_voip_handler))
        .routes(routes!(leave_voip_handler))
        .routes(routes!(set_local_mute_handler))
        .routes(routes!(set_local_deafen_handler))
        .routes(routes!(set_publish_screen_handler))
        .routes(routes!(set_publish_camera_handler))
        .routes(routes!(subscribe_to_media_handler))
        .routes(routes!(unsubscribe_from_media_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(voip_service)
}

#[utoipa::path(
    get,
    tag = "voip",
    path = "/participants",
    responses(
        (status = 200, description = "Successfully retrieved VoIP participants", body = Vec<VoipParticipant>),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_voip_participants_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<VoipParticipant>>, ApiError> {
    let participants = service
        .get_voip_participants(user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(participants))
}

#[utoipa::path(
    post,
    tag = "voip",
    path = "/channel/{channel_id}/join/{local_mute}/{local_deafen}",
    params(
        ("channel_id", Path, description = "The ID of the channel to join"),
    ),
    responses(
        (status = 200, description = "Successfully joined channel VoIP"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn join_channel_voip_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Path((channel_id, local_mute, local_deafen)): Path<(i64, bool, bool)>,
) -> Result<(), ApiError> {
    service
        .join_channel_voip(user_id, channel_id, local_mute, local_deafen)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    post,
    tag = "voip",
    path = "/private/{recipient_user_id}/join/{local_mute}/{local_deafen}",
    params(
        ("recipient_user_id", Path, description = "The ID of the recipient user"),
    ),
    responses(
        (status = 200, description = "Successfully joined private VoIP"),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn join_private_voip_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Path((recipient_user_id, local_mute, local_deafen)): Path<(i64, bool, bool)>,
) -> Result<(), ApiError> {
    service
        .join_private_voip(user_id, recipient_user_id, local_mute, local_deafen)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    post,
    tag = "voip",
    path = "/leave",
    responses(
        (status = 200, description = "Successfully left VoIP"),
        (status = 404, description = "Participant not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn leave_voip_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
) -> Result<(), ApiError> {
    service.leave_voip(user_id).await.map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    put,
    tag = "voip",
    path = "/mute",
    request_body = SetMuteRequest,
    responses(
        (status = 200, description = "Successfully updated mute status"),
        (status = 404, description = "Participant not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn set_local_mute_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<SetMuteRequest>,
) -> Result<(), ApiError> {
    service
        .set_local_mute(user_id, payload.mute)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    put,
    tag = "voip",
    path = "/deafen",
    request_body = SetDeafenRequest,
    responses(
        (status = 200, description = "Successfully updated deafen status"),
        (status = 404, description = "Participant not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn set_local_deafen_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<SetDeafenRequest>,
) -> Result<(), ApiError> {
    service
        .set_local_deafen(user_id, payload.deafen)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    put,
    tag = "voip",
    path = "/screen/publish",
    request_body = SetPublishScreenRequest,
    responses(
        (status = 200, description = "Successfully updated screen publish status"),
        (status = 404, description = "Participant not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn set_publish_screen_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<SetPublishScreenRequest>,
) -> Result<(), ApiError> {
    service
        .set_publish_screen(user_id, payload.publish)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    put,
    tag = "voip",
    path = "/camera/publish",
    request_body = SetPublishCameraRequest,
    responses(
        (status = 200, description = "Successfully updated camera publish status"),
        (status = 404, description = "Participant not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn set_publish_camera_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<SetPublishCameraRequest>,
) -> Result<(), ApiError> {
    service
        .set_publish_camera(user_id, payload.publish)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    post,
    tag = "voip",
    path = "/subscribe",
    request_body = SubscribeToMediaRequest,
    responses(
        (status = 200, description = "Successfully subscribed to media"),
        (status = 400, description = "Bad request - cannot subscribe", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn subscribe_to_media_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<SubscribeToMediaRequest>,
) -> Result<(), ApiError> {
    service
        .subscribe_to_media(user_id, payload.publisher_id, payload.media_type)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    post,
    tag = "voip",
    path = "/unsubscribe",
    request_body = UnsubscribeFromMediaRequest,
    responses(
        (status = 200, description = "Successfully unsubscribed from media"),
        (status = 400, description = "Bad request - subscription not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn unsubscribe_from_media_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<UnsubscribeFromMediaRequest>,
) -> Result<(), ApiError> {
    service
        .unsubscribe_from_media(user_id, payload.publisher_id, payload.media_type)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

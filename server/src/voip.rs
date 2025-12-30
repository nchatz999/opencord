// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use sqlx::Type;
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::auth::Session;
use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::managers::{DefaultNotifierManager, LogManager, NotifierManager, TextLogManager};
use crate::middleware::{AuthorizeService, authorize};
use crate::model::EventPayload;
use crate::role::{ADMIN_ROLE_ID, OWNER_ROLE_ID};
use crate::webtransport::{ControlRoutingPolicy, ServerMessage};

use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::middleware::from_fn_with_state;
use utoipa_axum::{router::OpenApiRouter, routes};

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

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
#[serde(rename_all = "lowercase")]
pub enum MediaType {
    Screen,
    Camera,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub user_id: i64,
    pub publisher_id: i64,
    pub media_type: MediaType,
    pub created_at: OffsetDateTime,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, thiserror::Error)]
pub enum DomainError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Internal error")]
    InternalError(#[from] DatabaseError),
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

// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

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

    async fn remove_all_subscriptions(
        &mut self,
        user_id: i64,
    ) -> Result<Vec<Subscription>, DatabaseError>;

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
                    (subscriber.channel_id = publisher.channel_id
                     AND subscriber.channel_id IS NOT NULL)
                    OR
                    (subscriber.recipient_id = publisher.user_id
                     AND publisher.recipient_id = subscriber.user_id)
                )
                WHERE subscriber.user_id = $1
                    AND publisher.user_id = $2
            )
            ON CONFLICT (user_id, publisher_id, media_type) DO UPDATE SET created_at = subscriptions.created_at
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

    async fn remove_all_subscriptions(
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
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(subscriptions)
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

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct VoipService<R: VoipRepository, N: NotifierManager, G: LogManager> {
    repository: R,
    notifier: N,
    logger: G,
}

impl<R: VoipRepository, N: NotifierManager, G: LogManager> VoipService<R, N, G> {
    pub fn new(repository: R, notifier: N, logger: G) -> Self {
        Self {
            repository,
            notifier,
            logger,
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

    pub async fn get_voip_subscriptions(
        &self,
        requesting_user_id: i64,
    ) -> Result<Vec<Subscription>, DomainError> {
        let subscriptions = self
            .repository
            .find_voip_subscriptions(requesting_user_id)
            .await?;

        Ok(subscriptions)
    }

    pub async fn join_channel_voip(
        &self,
        user_id: i64,
        session_id: i64,
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

        let participant = tx
            .create_channel_voip_participant(user_id, channel_id, local_mute, local_deafen)
            .await
            .map_err(|e| match &e {
                DatabaseError::UniqueConstraintViolation { .. } => {
                    DomainError::BadRequest("Already in VoIP - leave first".to_string())
                }
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "channel_id" => {
                        DomainError::BadRequest(format!("Channel {} not found", channel_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantCreated { user: participant };

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

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Joined channel VoIP: user_id={}, session_id={}, channel_id={}",
                    user_id, session_id, channel_id
                ),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn join_private_voip(
        &self,
        user_id: i64,
        session_id: i64,
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

        let participant = tx
            .create_private_voip_participant(user_id, recipient_user_id, local_mute, local_deafen)
            .await
            .map_err(|e| match &e {
                DatabaseError::UniqueConstraintViolation { .. } => {
                    DomainError::BadRequest("Already in VoIP - leave first".to_string())
                }
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "recipient_id" => {
                        DomainError::BadRequest(format!("User {} not found", recipient_user_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::VoipParticipantCreated { user: participant };

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
                event.clone(),
                ControlRoutingPolicy::User {
                    user_id: recipient_user_id,
                },
            ))
            .await;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Joined private VoIP: user_id={}, session_id={}, recipient_id={}",
                    user_id, session_id, recipient_user_id
                ),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn leave_voip(&self, user_id: i64, session_id: i64) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let subscriptions = tx.remove_all_subscriptions(user_id).await?;
        let participant = tx.remove_participant(user_id).await?;

        self.repository.commit(tx).await?;

        if participant.is_none() {
            return Ok(());
        }

        for subscription in subscriptions {
            let event = EventPayload::MediaUnsubscription {
                subscription: subscription.clone(),
            };
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event.clone(),
                    ControlRoutingPolicy::User {
                        user_id: subscription.user_id,
                    },
                ))
                .await;
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event,
                    ControlRoutingPolicy::User {
                        user_id: subscription.publisher_id,
                    },
                ))
                .await;
        }

        let event = EventPayload::VoipParticipantDeleted { user_id };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        let _ = self
            .logger
            .log_entry(
                format!("Left VoIP: user_id={}, session_id={}", user_id, session_id),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn kick_participant(
        &self,
        requester_user_id: i64,
        session_id: i64,
        target_user_id: i64,
    ) -> Result<VoipParticipant, DomainError> {
        let mut tx = self.repository.begin().await?;

        let subscriptions = tx.remove_all_subscriptions(target_user_id).await?;
        let participant =
            tx.remove_participant(target_user_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "Participant {} not found",
                    target_user_id
                )))?;

        let channel_id = participant.channel_id.ok_or(DomainError::PermissionDenied(
            "Cannot kick from private VoIP".to_string(),
        ))?;

        let rights = self
            .repository
            .find_user_channel_rights(channel_id, requester_user_id)
            .await?
            .unwrap_or(0);

        if rights < 8 {
            self.repository.rollback(tx).await?;
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to kick".to_string(),
            ));
        }

        let requester_role = self
            .repository
            .find_user_role(requester_user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        let target_role = self
            .repository
            .find_user_role(target_user_id)
            .await?
            .ok_or(DomainError::BadRequest("Target user not found".to_string()))?;

        if target_role == OWNER_ROLE_ID && requester_role > OWNER_ROLE_ID {
            self.repository.rollback(tx).await?;
            return Err(DomainError::PermissionDenied(
                "Only owner can kick owner".to_string(),
            ));
        }
        if target_role == ADMIN_ROLE_ID && requester_role > ADMIN_ROLE_ID {
            self.repository.rollback(tx).await?;
            return Err(DomainError::PermissionDenied(
                "Only owner or admin can kick admin".to_string(),
            ));
        }

        self.repository.commit(tx).await?;

        for subscription in subscriptions {
            let event = EventPayload::MediaUnsubscription {
                subscription: subscription.clone(),
            };
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event.clone(),
                    ControlRoutingPolicy::User {
                        user_id: subscription.user_id,
                    },
                ))
                .await;
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event,
                    ControlRoutingPolicy::User {
                        user_id: subscription.publisher_id,
                    },
                ))
                .await;
        }

        let event = EventPayload::VoipParticipantDeleted {
            user_id: target_user_id,
        };

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

        let _ = self
            .logger
            .log_entry(
                format!(
                    "VoIP kick: requester_user_id={}, session_id={}, target_user_id={}",
                    requester_user_id, session_id, target_user_id
                ),
                "voip".to_string(),
            )
            .await;

        Ok(participant)
    }

    pub async fn set_local_mute(
        &self,
        user_id: i64,
        session_id: i64,
        mute: bool,
    ) -> Result<(), DomainError> {
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

        let _ = self
            .logger
            .log_entry(
                format!(
                    "VoIP mute changed: user_id={}, session_id={}, mute={}",
                    user_id, session_id, mute
                ),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn set_local_deafen(
        &self,
        user_id: i64,
        session_id: i64,
        deafen: bool,
    ) -> Result<(), DomainError> {
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

        let _ = self
            .logger
            .log_entry(
                format!(
                    "VoIP deafen changed: user_id={}, session_id={}, deafen={}",
                    user_id, session_id, deafen
                ),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn set_publish_screen(
        &self,
        user_id: i64,
        session_id: i64,
        publish: bool,
    ) -> Result<(), DomainError> {
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

        let _ = self
            .logger
            .log_entry(
                format!(
                    "VoIP screen publish changed: user_id={}, session_id={}, publish={}",
                    user_id, session_id, publish
                ),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn set_publish_camera(
        &self,
        user_id: i64,
        session_id: i64,
        publish: bool,
    ) -> Result<(), DomainError> {
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

        let _ = self
            .logger
            .log_entry(
                format!(
                    "VoIP camera publish changed: user_id={}, session_id={}, publish={}",
                    user_id, session_id, publish
                ),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn subscribe_to_media(
        &self,
        user_id: i64,
        session_id: i64,
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

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Media subscribed: user_id={}, session_id={}, publisher_id={}, media_type={:?}",
                    user_id, session_id, publisher_id, media_type
                ),
                "voip".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn unsubscribe_from_media(
        &self,
        user_id: i64,
        session_id: i64,
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

        let _ = self.logger.log_entry(
            format!("Media unsubscribed: user_id={}, session_id={}, publisher_id={}, media_type={:?}", user_id, session_id, publisher_id, media_type),
            "voip".to_string(),
        ).await;

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

pub fn voip_routes(
    voip_service: VoipService<Postgre, DefaultNotifierManager, TextLogManager>,
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
        .routes(routes!(get_voip_subscriptions_handler))
        .routes(routes!(kick_participant_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(voip_service)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
) -> Result<Json<Vec<VoipParticipant>>, ApiError> {
    let participants = service
        .get_voip_participants(session.user_id)
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path((channel_id, local_mute, local_deafen)): Path<(i64, bool, bool)>,
) -> Result<(), ApiError> {
    service
        .join_channel_voip(
            session.user_id,
            session.session_id,
            channel_id,
            local_mute,
            local_deafen,
        )
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path((recipient_user_id, local_mute, local_deafen)): Path<(i64, bool, bool)>,
) -> Result<(), ApiError> {
    service
        .join_private_voip(
            session.user_id,
            session.session_id,
            recipient_user_id,
            local_mute,
            local_deafen,
        )
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
) -> Result<(), ApiError> {
    service
        .leave_voip(session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<SetMuteRequest>,
) -> Result<(), ApiError> {
    service
        .set_local_mute(session.user_id, session.session_id, payload.mute)
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<SetDeafenRequest>,
) -> Result<(), ApiError> {
    service
        .set_local_deafen(session.user_id, session.session_id, payload.deafen)
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<SetPublishScreenRequest>,
) -> Result<(), ApiError> {
    service
        .set_publish_screen(session.user_id, session.session_id, payload.publish)
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<SetPublishCameraRequest>,
) -> Result<(), ApiError> {
    service
        .set_publish_camera(session.user_id, session.session_id, payload.publish)
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<SubscribeToMediaRequest>,
) -> Result<(), ApiError> {
    service
        .subscribe_to_media(
            session.user_id,
            session.session_id,
            payload.publisher_id,
            payload.media_type,
        )
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
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<UnsubscribeFromMediaRequest>,
) -> Result<(), ApiError> {
    service
        .unsubscribe_from_media(
            session.user_id,
            session.session_id,
            payload.publisher_id,
            payload.media_type,
        )
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    get,
    tag = "voip",
    path = "/subscriptions",
    responses(
        (status = 200, description = "Successfully retrieved VoIP subscriptions", body = Vec<Subscription>),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_voip_subscriptions_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
) -> Result<Json<Vec<Subscription>>, ApiError> {
    let subscriptions = service
        .get_voip_subscriptions(session.user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(subscriptions))
}

#[utoipa::path(
    post,
    tag = "voip",
    path = "/kick/{target_user_id}",
    params(
        ("target_user_id", Path, description = "The ID of the user to kick"),
    ),
    responses(
        (status = 200, description = "Successfully kicked participant", body = VoipParticipant),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Participant not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn kick_participant_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(target_user_id): Path<i64>,
) -> Result<Json<VoipParticipant>, ApiError> {
    let participant = service
        .kick_participant(session.user_id, session.session_id, target_user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(participant))
}

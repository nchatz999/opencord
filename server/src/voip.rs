// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::auth::Session;
use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::livekit::{LiveKitService, room_name_for_channel, room_name_for_private};
use crate::managers::{DefaultNotifierManager, LogManager, NotifierManager, TextLogManager};
use crate::middleware::{AuthorizeService, authorize};
use crate::model::EventPayload;
use crate::role::{ADMIN_ROLE_ID, OWNER_ROLE_ID};
use crate::transport::{ControlRoutingPolicy, ServerMessage};

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

    #[error("LiveKit error: {0}")]
    LiveKitError(String),
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
            DomainError::LiveKitError(msg) => {
                tracing::error!("LiveKit error: {}", msg);
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
    livekit: LiveKitService,
}

impl<R: VoipRepository, N: NotifierManager, G: LogManager> VoipService<R, N, G> {
    pub fn new(repository: R, notifier: N, logger: G, livekit: LiveKitService) -> Self {
        Self {
            repository,
            notifier,
            logger,
            livekit,
        }
    }

    pub fn ws_url(&self) -> &str {
        &self.livekit.ws_url
    }

    pub fn create_channel_token(&self, user_id: i64, channel_id: i64, can_publish: bool) -> Result<String, DomainError> {
        let room = room_name_for_channel(channel_id);
        self.livekit
            .create_join_token(user_id, &room, can_publish)
            .map_err(|e| DomainError::LiveKitError(e.to_string()))
    }

    pub fn create_private_token(&self, user_id: i64, recipient_id: i64) -> Result<String, DomainError> {
        let room = room_name_for_private(user_id, recipient_id);
        self.livekit
            .create_join_token(user_id, &room, true)
            .map_err(|e| DomainError::LiveKitError(e.to_string()))
    }

    pub async fn remove_from_room(&self, user_id: i64, channel_id: Option<i64>, recipient_id: Option<i64>) -> Result<(), DomainError> {
        let room = match (channel_id, recipient_id) {
            (Some(ch), _) => room_name_for_channel(ch),
            (_, Some(r)) => room_name_for_private(user_id, r),
            _ => return Ok(()),
        };
        self.livekit
            .remove_participant(&room, &user_id.to_string())
            .await
            .map_err(|e| DomainError::LiveKitError(e.to_string()))
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
        session_id: i64,
        channel_id: i64,
        local_mute: bool,
        local_deafen: bool,
    ) -> Result<bool, DomainError> {
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

        let can_publish = rights > 2;

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

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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

        Ok(can_publish)
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
                event,
                ControlRoutingPolicy::Users {
                    user_ids: vec![user_id, recipient_user_id],
                },
            ))
            .await;

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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

        let participant = tx.remove_participant(user_id).await?;

        self.repository.commit(tx).await?;

        if participant.is_none() {
            return Ok(());
        }

        let event = EventPayload::VoipParticipantDeleted { user_id };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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

        let _ = self.notifier.notify(ServerMessage::InvalidateVoip).await;

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
pub struct JoinVoipResponse {
    pub token: String,
    pub server_url: String,
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
        (status = 200, description = "Successfully joined channel VoIP", body = JoinVoipResponse),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn join_channel_voip_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path((channel_id, local_mute, local_deafen)): Path<(i64, bool, bool)>,
) -> Result<Json<JoinVoipResponse>, ApiError> {
    let can_publish = service
        .join_channel_voip(
            session.user_id,
            session.session_id,
            channel_id,
            local_mute,
            local_deafen,
        )
        .await
        .map_err(ApiError::from)?;
    let token = service
        .create_channel_token(session.user_id, channel_id, can_publish)
        .map_err(ApiError::from)?;

    Ok(Json(JoinVoipResponse {
        token,
        server_url: service.ws_url().to_string(),
    }))
}

#[utoipa::path(
    post,
    tag = "voip",
    path = "/private/{recipient_user_id}/join/{local_mute}/{local_deafen}",
    params(
        ("recipient_user_id", Path, description = "The ID of the recipient user"),
    ),
    responses(
        (status = 200, description = "Successfully joined private VoIP", body = JoinVoipResponse),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn join_private_voip_handler(
    State(service): State<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path((recipient_user_id, local_mute, local_deafen)): Path<(i64, bool, bool)>,
) -> Result<Json<JoinVoipResponse>, ApiError> {
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

    let token = service
        .create_private_token(session.user_id, recipient_user_id)
        .map_err(ApiError::from)?;

    Ok(Json(JoinVoipResponse {
        token,
        server_url: service.ws_url().to_string(),
    }))
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

    let _ = service
        .remove_from_room(target_user_id, participant.channel_id, participant.recipient_id)
        .await;

    Ok(Json(participant))
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::auth::Session;
use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::managers::{
    DefaultNotifierManager, FileError, FileManager, LocalFileManager, LogManager, NotifierManager,
    TextLogManager,
};
use crate::message::{File, Message};
use crate::middleware::{AuthorizeService, authorize};
use crate::model::EventPayload;
use crate::role::{ADMIN_ROLE_ID, OWNER_ROLE_ID};
use crate::voip::VoipParticipant;
use crate::webtransport::{CommandPayload, ControlRoutingPolicy, ServerMessage};

use base64::{Engine as _, engine::general_purpose};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::middleware::from_fn_with_state;
use axum::response::IntoResponse;
use utoipa_axum::{router::OpenApiRouter, routes};

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub user_id: i64,
    pub username: String,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
    pub avatar_file_id: Option<i64>,
    pub role_id: i64,
    pub status: UserStatusType,
    pub server_mute: bool,
    pub server_deafen: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvatarFile {
    pub file_id: i64,
    pub file_uuid: String,
    pub file_name: String,
    pub file_type: String,
    pub file_size: i64,
    pub file_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[sqlx(type_name = "user_status_type")]
#[serde(rename_all = "PascalCase")]
pub enum UserStatusType {
    Online,
    Away,
    DoNotDisturb,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserStatus {
    pub user_id: i64,
    pub status: UserStatusType,
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

    #[error("File manager error")]
    FileManagerError(#[from] FileError),

    #[error("File decode failed")]
    FileDecodeError,
}

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        match err {
            DomainError::BadRequest(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::PermissionDenied(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::InternalError(db_err) => {
                tracing::error!("Database error: {}", db_err);
                println!("Database error: {}", db_err);
                ApiError::InternalServerError("Internal server error".to_string())
            }
            DomainError::FileManagerError(file_err) => {
                tracing::error!("File manager error: {}", file_err);
                ApiError::InternalServerError("File system error".to_string())
            }
            DomainError::FileDecodeError => {
                ApiError::UnprocessableEntity("Invalid file data encoding".to_string())
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

pub trait UserTransaction: Send + Sync {
    async fn create_avatar(
        &mut self,
        file_uuid: &str,
        file_name: &str,
        file_type: &str,
        file_size: i64,
        file_hash: &str,
    ) -> Result<AvatarFile, DatabaseError>;

    async fn update_user_avatar(
        &mut self,
        user_id: i64,
        avatar_file_id: i64,
    ) -> Result<Option<User>, DatabaseError>;

    async fn update_manual_user_status(
        &mut self,
        user_id: i64,
        manual_status: UserStatusType,
    ) -> Result<Option<User>, DatabaseError>;

    async fn delete_all_files_by_user(&mut self, user_id: i64) -> Result<Vec<File>, DatabaseError>;

    async fn delete_all_messages_by_user(
        &mut self,
        user_id: i64,
    ) -> Result<Vec<Message>, DatabaseError>;

    async fn delete_voip_participant_by_user(
        &mut self,
        user_id: i64,
    ) -> Result<Option<VoipParticipant>, DatabaseError>;

    async fn delete_user(&mut self, user_id: i64) -> Result<Option<User>, DatabaseError>;
}

pub trait UserRepository: Send + Sync + Clone {
    type Transaction: UserTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_all_users(&self, requester_id: i64) -> Result<Vec<User>, DatabaseError>;

    async fn find_avatar_file(&self, avatar_id: i64) -> Result<Option<AvatarFile>, DatabaseError>;

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError>;
}

pub struct PgUserTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl UserTransaction for PgUserTransaction {
    async fn create_avatar(
        &mut self,
        file_uuid: &str,
        file_name: &str,
        file_type: &str,
        file_size: i64,
        file_hash: &str,
    ) -> Result<AvatarFile, DatabaseError> {
        let result = sqlx::query_as!(
            AvatarFile,
            r#"INSERT INTO avatar_files (
                   file_uuid,
                   file_name,
                   file_type,
                   file_size,
                   file_hash
               )
               VALUES ($1, $2, $3, $4, $5)
               RETURNING
                   file_id,
                   file_uuid,
                   file_name,
                   file_type,
                   file_size,
                   file_hash"#,
            file_uuid,
            file_name,
            file_type,
            file_size,
            file_hash
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn update_user_avatar(
        &mut self,
        user_id: i64,
        avatar_file_id: i64,
    ) -> Result<Option<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"UPDATE users
               SET avatar_file_id = $1
               WHERE user_id = $2
               RETURNING
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE(manual_status, status) END as "status!: UserStatusType",
                   server_mute,
                   server_deafen"#,
            avatar_file_id,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn update_manual_user_status(
        &mut self,
        user_id: i64,
        manual_status: UserStatusType,
    ) -> Result<Option<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"UPDATE users
               SET manual_status = $2
               WHERE user_id = $1
               RETURNING
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   server_deafen,
                   server_mute,
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE($2, status) END as "status!: UserStatusType""#,
            user_id,
            manual_status as UserStatusType
        )
        .fetch_optional(&mut *self.transaction)
        .await?;
        Ok(result)
    }

    async fn delete_all_files_by_user(&mut self, user_id: i64) -> Result<Vec<File>, DatabaseError> {
        let files = sqlx::query_as!(
            File,
            r#"DELETE FROM files
               USING messages m
               WHERE files.message_id = m.id
               AND m.sender_id = $1
               RETURNING files.file_id, files.file_uuid, files.message_id, files.file_name, files.file_type, files.file_size, files.file_hash, files.created_at"#,
            user_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;
        Ok(files)
    }

    async fn delete_all_messages_by_user(
        &mut self,
        user_id: i64,
    ) -> Result<Vec<Message>, DatabaseError> {
        let messages = sqlx::query_as!(
            Message,
            r#"DELETE FROM messages
               WHERE sender_id = $1
               RETURNING id, sender_id, channel_id, recipient_id, message_text, created_at, modified_at, reply_to_message_id"#,
            user_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;
        Ok(messages)
    }

    async fn delete_voip_participant_by_user(
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

    async fn delete_user(&mut self, user_id: i64) -> Result<Option<User>, DatabaseError> {
        let user = sqlx::query_as!(
            User,
            r#"DELETE FROM users
               WHERE user_id = $1
               RETURNING
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE(manual_status, status) END as "status!: UserStatusType",
                   server_mute,
                   server_deafen"#,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;
        Ok(user)
    }
}

impl UserRepository for Postgre {
    type Transaction = PgUserTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgUserTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn find_all_users(&self, requester_id: i64) -> Result<Vec<User>, DatabaseError> {
        let results = sqlx::query_as!(
            User,
            r#"SELECT
                   u.user_id,
                   u.username,
                   u.created_at,
                   u.avatar_file_id,
                   u.role_id,
                   CASE WHEN u.status = 'Offline' THEN u.status ELSE COALESCE(u.manual_status, u.status) END as "status!: UserStatusType",
                   u.server_mute,
                   u.server_deafen
               FROM users u
               LEFT JOIN LATERAL (
                   SELECT MAX(m.created_at) as last_activity
                   FROM messages m
                   WHERE m.recipient_id IS NOT NULL
                     AND ((m.sender_id = $1 AND m.recipient_id = u.user_id)
                       OR (m.sender_id = u.user_id AND m.recipient_id = $1))
               ) activity ON true
               ORDER BY activity.last_activity DESC NULLS LAST, u.username"#,
            requester_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
    }

    async fn find_avatar_file(&self, avatar_id: i64) -> Result<Option<AvatarFile>, DatabaseError> {
        let result = sqlx::query_as!(
            AvatarFile,
            r#"SELECT
                   file_id,
                   file_uuid,
                   file_name,
                   file_type,
                   file_size,
                   file_hash
               FROM avatar_files
               WHERE file_id = $1"#,
            avatar_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }
    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT role_id
               FROM users
               WHERE user_id = $1"#,
            user_id
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
pub struct UserService<
    R: UserRepository,
    F: FileManager + Clone + Send,
    N: NotifierManager,
    G: LogManager,
> {
    repository: R,
    file_manager: F,
    notifier: N,
    logger: G,
}

impl<R: UserRepository, F: FileManager + Clone + Send, N: NotifierManager, G: LogManager>
    UserService<R, F, N, G>
{
    pub fn new(repository: R, file_manager: F, notifier: N, logger: G) -> Self {
        Self {
            repository,
            file_manager,
            notifier,
            logger,
        }
    }

    pub async fn update_user_avatar(
        &self,
        user_id: i64,
        requester_id: i64,
        session_id: i64,
        avatar_data: NewAvatarRequest,
    ) -> Result<User, DomainError> {
        if user_id != requester_id {
            return Err(DomainError::PermissionDenied(
                "Can only update own avatar".to_string(),
            ));
        }

        let file_data = general_purpose::STANDARD
            .decode(&avatar_data.data)
            .map_err(|_| DomainError::FileDecodeError)?;

        let file_uuid = Uuid::new_v4().to_string();
        let file_hash = format!("{:x}", Sha256::digest(&file_data));

        let mut tx = self.repository.begin().await?;

        let avatar_file = tx
            .create_avatar(
                &file_uuid,
                &avatar_data.file_name,
                &avatar_data.content_type,
                file_data.len() as i64,
                &file_hash,
            )
            .await?;

        let updated_user = tx
            .update_user_avatar(user_id, avatar_file.file_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                user_id
            )))?;

        self.repository.commit(tx).await?;

        self.file_manager
            .upload_file(avatar_file.file_id, &file_data)?;

        let event = EventPayload::UserUpdated {
            user: updated_user.clone(),
        };
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
                    "User avatar updated: user_id={}, session_id={}, avatar_file_id={}",
                    requester_id, session_id, avatar_file.file_id
                ),
                "user".to_string(),
            )
            .await;

        Ok(updated_user)
    }

    pub async fn get_avatar_by_id(
        &self,
        avatar_id: i64,
    ) -> Result<(AvatarFile, Vec<u8>), DomainError> {
        let avatar_file =
            self.repository
                .find_avatar_file(avatar_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "Avatar {} not found",
                    avatar_id
                )))?;

        let file_data = self.file_manager.get_file(avatar_id).map_err(|e| match e {
            FileError::NotFound(_) => {
                DomainError::BadRequest(format!("Avatar {} not found", avatar_id))
            }
            _ => DomainError::FileManagerError(e),
        })?;

        Ok((avatar_file, file_data))
    }

    pub async fn update_manual_user_status(
        &self,
        user_id: i64,
        requester_user_id: i64,
        session_id: i64,
        manual_status: UserStatusType,
    ) -> Result<(), DomainError> {
        if user_id != requester_user_id {
            return Err(DomainError::PermissionDenied(
                "Can only update own status".to_string(),
            ));
        }

        let mut tx = self.repository.begin().await?;

        let updated_user = tx
            .update_manual_user_status(user_id, manual_status.clone())
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                user_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::UserUpdated {
            user: updated_user.clone(),
        };
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
                    "User status updated: user_id={}, session_id={}, status={:?}",
                    requester_user_id, session_id, manual_status
                ),
                "user".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn get_all_users(&self, requester_id: i64) -> Result<Vec<User>, DomainError> {
        let users = self.repository.find_all_users(requester_id).await?;
        Ok(users)
    }

    pub async fn delete_user(
        &self,
        target_user_id: i64,
        requester_user_id: i64,
        session_id: i64,
    ) -> Result<(), DomainError> {
        let mut repo = self.repository.clone();

        let requester_role = repo
            .find_user_role(requester_user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        let target_role =
            repo.find_user_role(target_user_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "User {} not found",
                    target_user_id
                )))?;

        if target_role == OWNER_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Cannot delete owner".to_string(),
            ));
        }

        if requester_role > ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to delete user".to_string(),
            ));
        }

        if requester_role != OWNER_ROLE_ID && target_role == ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Only owner can delete admin".to_string(),
            ));
        }

        let mut tx = self.repository.begin().await?;

        let deleted_files = tx.delete_all_files_by_user(target_user_id).await?;
        let deleted_messages = tx.delete_all_messages_by_user(target_user_id).await?;
        let deleted_voip = tx.delete_voip_participant_by_user(target_user_id).await?;
        let _deleted_user =
            tx.delete_user(target_user_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "User {} not found",
                    target_user_id
                )))?;

        self.repository.commit(tx).await?;

        for file in &deleted_files {
            let _ = self.file_manager.delete_file(file.file_id);
        }

        for message in &deleted_messages {
            let event = EventPayload::MessageDeleted {
                message_id: message.id,
            };

            if let Some(channel_id) = message.channel_id {
                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        event,
                        ControlRoutingPolicy::ChannelRights {
                            channel_id,
                            minimun_rights: 2,
                        },
                    ))
                    .await;
            } else if let Some(recipient_id) = message.recipient_id {
                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        event,
                        ControlRoutingPolicy::User {
                            user_id: recipient_id,
                        },
                    ))
                    .await;
            }
        }

        if let Some(voip) = deleted_voip {
            let event = EventPayload::VoipParticipantDeleted {
                user_id: target_user_id,
            };

            if let Some(channel_id) = voip.channel_id {
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
            } else if let Some(recipient_id) = voip.recipient_id {
                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        event,
                        ControlRoutingPolicy::User {
                            user_id: recipient_id,
                        },
                    ))
                    .await;
            }
        }

        let user_deleted_event = EventPayload::UserDeleted {
            user_id: target_user_id,
        };

        let _ = self
            .notifier
            .notify(ServerMessage::Command(CommandPayload::DisconnectUser(
                target_user_id,
            )))
            .await;

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                user_deleted_event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "User deleted: requester_user_id={}, session_id={}, target_user_id={}",
                    requester_user_id, session_id, target_user_id
                ),
                "user".to_string(),
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
pub struct NewAvatarRequest {
    pub file_name: String,
    pub content_type: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManualUserStatusRequest {
    pub manual_status: UserStatusType,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AllUsersResponse {
    pub users: Vec<User>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

pub fn user_routes(
    user_service: UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(update_user_avatar_handler))
        .routes(routes!(get_user_avatar_handler))
        .routes(routes!(update_manual_user_status_handler))
        .routes(routes!(get_all_users_handler))
        .routes(routes!(delete_user_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(user_service)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

#[utoipa::path(
    put,
    tag = "user",
    path = "/avatar",
    params(
        ("user_id", Path, description = "The ID of the user to update avatar for"),
    ),
    request_body = NewAvatarRequest,
    responses(
        (status = 200, description = "User avatar updated successfully", body = User),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "User not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn update_user_avatar_handler(
    State(service): State<
        UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>,
    >,
    Extension(session): Extension<Session>,
    Json(payload): Json<NewAvatarRequest>,
) -> Result<Json<User>, ApiError> {
    let updated_user = service
        .update_user_avatar(
            session.user_id,
            session.user_id,
            session.session_id,
            payload,
        )
        .await
        .map_err(ApiError::from)?;
    Ok(Json(updated_user))
}

#[utoipa::path(
    get,
    tag = "user",
    path = "/{avatar_id}/avatar",
    params(
        ("avatar_id", Path, description = "The ID of the avatar to retrieve"),
    ),
    responses(
        (status = 200, description = "Avatar retrieved successfully"),
        (status = 404, description = "Avatar not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_user_avatar_handler(
    State(service): State<
        UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>,
    >,
    Extension(_session): Extension<Session>,
    Path(avatar_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    let (avatar_file, file_data) = service
        .get_avatar_by_id(avatar_id)
        .await
        .map_err(ApiError::from)?;
    let headers = [
        ("Content-Type", avatar_file.file_type),
        (
            "Content-Disposition",
            format!("inline; filename=\"{}\"", avatar_file.file_name),
        ),
        ("Cache-Control", "public, max-age=3600".to_string()),
    ];

    Ok((headers, file_data))
}

#[utoipa::path(
    put,
    tag = "user",
    path = "/{user_id}/manual-status",
    params(
        ("user_id", Path, description = "The ID of the user to update manual status for"),
    ),
    request_body = UpdateManualUserStatusRequest,
    responses(
        (status = 200, description = "User manual status updated successfully", body = UserStatus),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "User not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn update_manual_user_status_handler(
    State(service): State<
        UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>,
    >,
    Extension(session): Extension<Session>,
    Path(user_id): Path<i64>,
    Json(payload): Json<UpdateManualUserStatusRequest>,
) -> Result<(), ApiError> {
    service
        .update_manual_user_status(
            user_id,
            session.user_id,
            session.session_id,
            payload.manual_status,
        )
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    get,
    tag = "user",
    path = "/",
    responses(
        (status = 200, description = "All users retrieved successfully", body = AllUsersResponse),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_all_users_handler(
    State(service): State<
        UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>,
    >,
    Extension(session): Extension<Session>,
) -> Result<Json<Vec<User>>, ApiError> {
    let users = service.get_all_users(session.user_id).await.map_err(ApiError::from)?;
    Ok(Json(users))
}

#[utoipa::path(
    delete,
    tag = "user",
    path = "/{user_id}",
    params(
        ("user_id", Path, description = "The ID of the user to delete"),
    ),
    responses(
        (status = 204, description = "User deleted successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "User not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn delete_user_handler(
    State(service): State<
        UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>,
    >,
    Extension(session): Extension<Session>,
    Path(target_user_id): Path<i64>,
) -> Result<(), ApiError> {
    service
        .delete_user(target_user_id, session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

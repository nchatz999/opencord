use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

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

use crate::auth::Session;
use crate::managers::{FileError, LocalFileManager};
use crate::middleware::{AuthorizeService, authorize};

use crate::{error::DatabaseError, managers::FileManager};

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

pub trait UserTransaction: Send + Sync {
    async fn update_user_role(
        &mut self,
        user_id: i64,
        role_id: i64,
    ) -> Result<Option<User>, DatabaseError>;

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
}

pub trait UserRepository: Send + Sync + Clone {
    type Transaction: UserTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_all_users(&self) -> Result<Vec<User>, DatabaseError>;

    async fn find_avatar_file(&self, avatar_id: i64) -> Result<Option<AvatarFile>, DatabaseError>;

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError>;
}

use crate::managers::{DefaultNotifierManager, LogManager, NotifierManager, TextLogManager};
use crate::model::EventPayload;
use crate::webtransport::{ControlRoutingPolicy, ServerMessage};
use base64::{Engine as _, engine::general_purpose};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Clone)]
pub struct UserService<R: UserRepository, F: FileManager + Clone + Send, N: NotifierManager, G: LogManager> {
    repository: R,
    file_manager: F,
    notifier: N,
    logger: G,
}

impl<R: UserRepository, F: FileManager + Clone + Send, N: NotifierManager, G: LogManager> UserService<R, F, N, G> {
    pub fn new(repository: R, file_manager: F, notifier: N, logger: G) -> Self {
        Self {
            repository,
            file_manager,
            notifier,
            logger,
        }
    }

    pub async fn update_user_role(
        &mut self,
        user_id: i64,
        new_role_id: i64,
        requester_user_id: i64,
        session_id: i64,
    ) -> Result<User, DomainError> {
        let mut tx = self.repository.begin().await?;

        let role_id = self
            .repository
            .find_user_role(requester_user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != 0 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to update user role".to_string(),
            ));
        }

        if new_role_id == 0 {
            return Err(DomainError::PermissionDenied(
                "There is only one owner".to_string(),
            ));
        }

        let updated_user = tx
            .update_user_role(user_id, new_role_id)
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "role_id" => DomainError::BadRequest(format!("Role {} not found", new_role_id)),
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?
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

        let _ = self.logger.log_entry(
            format!("User role updated: user_id={}, session_id={}, target_user_id={}, new_role_id={}", requester_user_id, session_id, user_id, new_role_id),
            "user".to_string(),
        ).await;

        Ok(updated_user)
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

        let _ = self.logger.log_entry(
            format!("User avatar updated: user_id={}, session_id={}, avatar_file_id={}", requester_id, session_id, avatar_file.file_id),
            "user".to_string(),
        ).await;

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

        let _ = self.logger.log_entry(
            format!("User status updated: user_id={}, session_id={}, status={:?}", requester_user_id, session_id, manual_status),
            "user".to_string(),
        ).await;

        Ok(())
    }

    pub async fn get_all_users(&self) -> Result<Vec<User>, DomainError> {
        let users = self.repository.find_all_users().await?;
        Ok(users)
    }
}

use crate::db::Postgre;

pub struct PgUserTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl UserTransaction for PgUserTransaction {
    async fn update_user_role(
        &mut self,
        user_id: i64,
        role_id: i64,
    ) -> Result<Option<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"UPDATE users
               SET role_id = $1
               WHERE user_id = $2
               RETURNING
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
                   server_mute,
                   server_deafen"#,
            role_id,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

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
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
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
                   COALESCE(
                       NULLIF($2, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType""#,
            user_id,
            manual_status as UserStatusType
        )
        .fetch_optional(&mut *self.transaction)
        .await?;
        Ok(result)
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

    async fn find_all_users(&self) -> Result<Vec<User>, DatabaseError> {
        let results = sqlx::query_as!(
            User,
            r#"SELECT
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
                   server_mute,
                   server_deafen
               FROM users
               ORDER BY username"#
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

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewAvatarRequest {
    pub file_name: String,
    pub content_type: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRoleRequest {
    pub role_id: i64,
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

use crate::error::ApiError;

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        match err {
            DomainError::BadRequest(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::PermissionDenied(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::InternalError(db_err) => {
                tracing::error!("Database error: {}", db_err);
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

use axum::{
    Json,
    extract::{Extension, Path, State},
    middleware::from_fn_with_state,
    response::IntoResponse,
};
use utoipa_axum::{router::OpenApiRouter, routes};

pub fn user_routes(
    user_service: UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(update_user_role_handler))
        .routes(routes!(update_user_avatar_handler))
        .routes(routes!(get_user_avatar_handler))
        .routes(routes!(update_manual_user_status_handler))
        .routes(routes!(get_all_users_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(user_service)
}

#[utoipa::path(
    put,
    tag = "user",
    path = "/{user_id}/role",
    params(
        ("user_id", Path, description = "The ID of the user to update"),
    ),
    request_body = UpdateUserRoleRequest,
    responses(
        (status = 200, description = "User role updated successfully", body = User),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "User not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn update_user_role_handler(
    State(mut service): State<UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(target_user_id): Path<i64>,
    Json(payload): Json<UpdateUserRoleRequest>,
) -> Result<Json<User>, ApiError> {
    let updated_user = service
        .update_user_role(target_user_id, payload.role_id, session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(updated_user))
}

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
    State(service): State<UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<NewAvatarRequest>,
) -> Result<Json<User>, ApiError> {
    let updated_user = service
        .update_user_avatar(session.user_id, session.user_id, session.session_id, payload)
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
    State(service): State<UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>>,
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
    State(service): State<UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(user_id): Path<i64>,
    Json(payload): Json<UpdateManualUserStatusRequest>,
) -> Result<(), ApiError> {
    service
        .update_manual_user_status(user_id, session.user_id, session.session_id, payload.manual_status)
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
    State(service): State<UserService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>>,
    Extension(_session): Extension<Session>,
) -> Result<Json<Vec<User>>, ApiError> {
    let users = service.get_all_users().await.map_err(ApiError::from)?;
    Ok(Json(users))
}

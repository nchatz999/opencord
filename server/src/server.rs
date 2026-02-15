use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::Session;
use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::managers::{
    DefaultNotifierManager, FileError, FileManager, LocalFileManager, LogManager, NotifierManager,
    TextLogManager,
};
use crate::middleware::{AuthorizeService, authorize};
use crate::model::{EventPayload, ServerConfig};
use crate::role::ADMIN_ROLE_ID;
use crate::user::AvatarFile;
use crate::transport::{ControlRoutingPolicy, ServerMessage};

use sha2::{Digest, Sha256};
use uuid::Uuid;

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

}

pub trait ServerTransaction: Send + Sync {
    async fn create_avatar(
        &mut self,
        file_uuid: &str,
        file_name: &str,
        file_type: &str,
        file_size: i64,
        file_hash: &str,
    ) -> Result<AvatarFile, DatabaseError>;

    async fn update_server_avatar(
        &mut self,
        avatar_file_id: i64,
    ) -> Result<Option<ServerConfig>, DatabaseError>;

    async fn update_server_name(
        &mut self,
        name: &str,
    ) -> Result<Option<ServerConfig>, DatabaseError>;

    async fn update_file_limits(
        &mut self,
        max_file_size_mb: i32,
        max_files_per_message: i32,
    ) -> Result<Option<ServerConfig>, DatabaseError>;
}

pub trait ServerRepository: Send + Sync + Clone {
    type Transaction: ServerTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn get_server_config(&self) -> Result<Option<ServerConfig>, DatabaseError>;

    async fn find_avatar_file(&self, avatar_id: i64) -> Result<Option<AvatarFile>, DatabaseError>;

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError>;
}

#[derive(Clone)]
pub struct ServerService<
    R: ServerRepository,
    F: FileManager + Clone + Send,
    N: NotifierManager,
    G: LogManager,
> {
    repository: R,
    file_manager: F,
    notifier: N,
    logger: G,
}

impl<R: ServerRepository, F: FileManager + Clone + Send, N: NotifierManager, G: LogManager>
    ServerService<R, F, N, G>
{
    pub fn new(repository: R, file_manager: F, notifier: N, logger: G) -> Self {
        Self {
            repository,
            file_manager,
            notifier,
            logger,
        }
    }

    pub async fn get_config(&self) -> Result<ServerConfig, DomainError> {
        let config = self
            .repository
            .get_server_config()
            .await?
            .ok_or(DomainError::BadRequest(
                "Server config not found".to_string(),
            ))?;
        Ok(config)
    }

    pub async fn update_name(
        &self,
        user_id: i64,
        session_id: i64,
        name: String,
    ) -> Result<ServerConfig, DomainError> {
        let mut repo = self.repository.clone();
        let role_id = repo
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::BadRequest("User not found".to_string()))?;

        if role_id > ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Only admins can update server settings".to_string(),
            ));
        }

        let mut tx = self.repository.begin().await?;

        let config = tx
            .update_server_name(&name)
            .await?
            .ok_or(DomainError::BadRequest(
                "Server config not found".to_string(),
            ))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::ServerUpdated {
            server: config.clone(),
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
                    "Server name updated: user_id={}, session_id={}, name={}",
                    user_id, session_id, name
                ),
                "server".to_string(),
            )
            .await;

        Ok(config)
    }

    pub async fn update_file_limits(
        &self,
        user_id: i64,
        session_id: i64,
        max_file_size_mb: i32,
        max_files_per_message: i32,
    ) -> Result<ServerConfig, DomainError> {
        let mut repo = self.repository.clone();
        let role_id = repo
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::BadRequest("User not found".to_string()))?;

        if role_id > ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Only admins can update server settings".to_string(),
            ));
        }

        let mut tx = self.repository.begin().await?;

        let config = tx
            .update_file_limits(max_file_size_mb, max_files_per_message)
            .await?
            .ok_or(DomainError::BadRequest(
                "Server config not found".to_string(),
            ))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::ServerUpdated {
            server: config.clone(),
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
                    "File limits updated: user_id={}, session_id={}, max_file_size_mb={}, max_files_per_message={}",
                    user_id, session_id, max_file_size_mb, max_files_per_message
                ),
                "server".to_string(),
            )
            .await;

        Ok(config)
    }

    pub async fn update_avatar(
        &self,
        user_id: i64,
        session_id: i64,
        file_name: String,
        file_data: Vec<u8>,
    ) -> Result<ServerConfig, DomainError> {
        let mut repo = self.repository.clone();
        let role_id = repo
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::BadRequest("User not found".to_string()))?;

        if role_id > ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Only admins can update server settings".to_string(),
            ));
        }

        if file_data.len() > 4 * 1024 * 1024 {
            return Err(DomainError::BadRequest(
                "Avatar exceeds 4 MB limit".to_string(),
            ));
        }

        let content_type = infer::get(&file_data)
            .filter(|kind| kind.mime_type().starts_with("image/"))
            .map(|kind| kind.mime_type().to_string())
            .ok_or(DomainError::BadRequest("Avatar must be an image".to_string()))?;

        let file_uuid = Uuid::new_v4().to_string();
        let file_hash = format!("{:x}", Sha256::digest(&file_data));

        let mut tx = self.repository.begin().await?;

        let avatar_file = tx
            .create_avatar(
                &file_uuid,
                &file_name,
                &content_type,
                file_data.len() as i64,
                &file_hash,
            )
            .await?;

        let config =
            tx.update_server_avatar(avatar_file.file_id)
                .await?
                .ok_or(DomainError::BadRequest(
                    "Server config not found".to_string(),
                ))?;

        self.repository.commit(tx).await?;

        self.file_manager
            .upload_file(avatar_file.file_id, &file_data)?;

        let event = EventPayload::ServerUpdated {
            server: config.clone(),
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
                    "Server avatar updated: user_id={}, session_id={}, avatar_file_id={}",
                    user_id, session_id, avatar_file.file_id
                ),
                "server".to_string(),
            )
            .await;

        Ok(config)
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
}

pub struct PgServerTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl ServerTransaction for PgServerTransaction {
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
            r#"INSERT INTO avatar_files (file_uuid, file_name, file_type, file_size, file_hash)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING file_id, file_uuid, file_name, file_type, file_size, file_hash"#,
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

    async fn update_server_avatar(
        &mut self,
        avatar_file_id: i64,
    ) -> Result<Option<ServerConfig>, DatabaseError> {
        let result = sqlx::query_as!(
            ServerConfig,
            r#"UPDATE server_config
               SET avatar_file_id = $1
               WHERE id = 1
               RETURNING id, server_name, avatar_file_id, max_file_size_mb, max_files_per_message"#,
            avatar_file_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn update_server_name(
        &mut self,
        name: &str,
    ) -> Result<Option<ServerConfig>, DatabaseError> {
        let result = sqlx::query_as!(
            ServerConfig,
            r#"UPDATE server_config
               SET server_name = $1
               WHERE id = 1
               RETURNING id, server_name, avatar_file_id, max_file_size_mb, max_files_per_message"#,
            name
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn update_file_limits(
        &mut self,
        max_file_size_mb: i32,
        max_files_per_message: i32,
    ) -> Result<Option<ServerConfig>, DatabaseError> {
        let result = sqlx::query_as!(
            ServerConfig,
            r#"UPDATE server_config
               SET max_file_size_mb = $1, max_files_per_message = $2
               WHERE id = 1
               RETURNING id, server_name, avatar_file_id, max_file_size_mb, max_files_per_message"#,
            max_file_size_mb,
            max_files_per_message
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }
}

impl ServerRepository for Postgre {
    type Transaction = PgServerTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let transaction = self.pool.begin().await?;
        Ok(PgServerTransaction { transaction })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn get_server_config(&self) -> Result<Option<ServerConfig>, DatabaseError> {
        let result = sqlx::query_as!(
            ServerConfig,
            r#"SELECT id, server_name, avatar_file_id, max_file_size_mb, max_files_per_message
               FROM server_config
               WHERE id = 1"#
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_avatar_file(&self, avatar_id: i64) -> Result<Option<AvatarFile>, DatabaseError> {
        let result = sqlx::query_as!(
            AvatarFile,
            r#"SELECT file_id, file_uuid, file_name, file_type, file_size, file_hash
               FROM avatar_files
               WHERE file_id = $1"#,
            avatar_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result: Option<(i64,)> = sqlx::query_as(
            r#"SELECT role_id
               FROM users
               WHERE user_id = $1"#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(result.map(|r| r.0))
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateServerNameRequest {
    pub server_name: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFileLimitsRequest {
    pub max_file_size_mb: i32,
    pub max_files_per_message: i32,
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
            DomainError::FileManagerError(file_err) => {
                tracing::error!("File manager error: {}", file_err);
                ApiError::InternalServerError("File system error".to_string())
            }
        }
    }
}

use axum::{
    Json,
    extract::{Extension, Multipart, Path, State},
    middleware::from_fn_with_state,
    response::IntoResponse,
};
use utoipa_axum::{router::OpenApiRouter, routes};

type AppServerService =
    ServerService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>;

pub fn server_routes(
    server_service: AppServerService,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(get_server_config_handler))
        .routes(routes!(get_server_avatar_handler))
        .routes(routes!(update_server_name_handler))
        .routes(routes!(update_server_avatar_handler))
        .routes(routes!(update_file_limits_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(server_service)
}

#[utoipa::path(
    get,
    tag = "server",
    path = "/config",
    responses(
        (status = 200, description = "Server config retrieved successfully", body = ServerConfig),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_server_config_handler(
    State(service): State<AppServerService>,
    Extension(_session): Extension<Session>,
) -> Result<Json<ServerConfig>, ApiError> {
    let config = service.get_config().await.map_err(ApiError::from)?;
    Ok(Json(config))
}

#[utoipa::path(
    put,
    tag = "server",
    path = "/name",
    request_body = UpdateServerNameRequest,
    responses(
        (status = 200, description = "Server name updated successfully", body = ServerConfig),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn update_server_name_handler(
    State(service): State<AppServerService>,
    Extension(session): Extension<Session>,
    Json(payload): Json<UpdateServerNameRequest>,
) -> Result<Json<ServerConfig>, ApiError> {
    let config = service
        .update_name(session.user_id, session.session_id, payload.server_name)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(config))
}

#[utoipa::path(
    post,
    tag = "server",
    path = "/avatar",
    request_body(content_type = "multipart/form-data"),
    responses(
        (status = 200, body = ServerConfig),
        (status = 422, body = ApiError),
        (status = 500, body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn update_server_avatar_handler(
    State(service): State<AppServerService>,
    Extension(session): Extension<Session>,
    mut multipart: Multipart,
) -> Result<Json<ServerConfig>, ApiError> {
    let field = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::UnprocessableEntity(format!("Invalid upload: {}", e)))?
        .ok_or(ApiError::UnprocessableEntity("No file provided".to_string()))?;

    let file_name = field.file_name().unwrap_or("avatar").to_string();
    let data = field
        .bytes()
        .await
        .map_err(|e| ApiError::UnprocessableEntity(format!("Failed to read file: {}", e)))?
        .to_vec();

    let config = service
        .update_avatar(
            session.user_id,
            session.session_id,
            file_name,
            data,
        )
        .await
        .map_err(ApiError::from)?;
    Ok(Json(config))
}

#[utoipa::path(
    put,
    tag = "server",
    path = "/file-limits",
    request_body = UpdateFileLimitsRequest,
    responses(
        (status = 200, description = "File limits updated successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn update_file_limits_handler(
    State(service): State<AppServerService>,
    Extension(session): Extension<Session>,
    Json(payload): Json<UpdateFileLimitsRequest>,
) -> Result<(), ApiError> {
    service
        .update_file_limits(
            session.user_id,
            session.session_id,
            payload.max_file_size_mb,
            payload.max_files_per_message,
        )
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    get,
    tag = "server",
    path = "/avatar/{avatar_id}",
    params(
        ("avatar_id", Path, description = "The ID of the server avatar to retrieve"),
    ),
    responses(
        (status = 200, description = "Avatar retrieved successfully"),
        (status = 404, description = "Avatar not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_server_avatar_handler(
    State(service): State<AppServerService>,
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

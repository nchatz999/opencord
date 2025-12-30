// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::Session;
use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::managers::{LogEntry, LogError, LogManager, TextLogManager};
use crate::middleware::{AuthorizeService, authorize};
use crate::role::{ADMIN_ROLE_ID, OWNER_ROLE_ID};

use axum::http::StatusCode;
use axum::Json;
use axum::extract::{Extension, Query, State};
use axum::middleware::from_fn_with_state;
use utoipa_axum::{router::OpenApiRouter, routes};

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, thiserror::Error)]
pub enum DomainError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Log error: {0}")]
    LogError(#[from] LogError),

    #[error("Internal error")]
    InternalError(#[from] DatabaseError),
}

impl From<DomainError> for ApiError {
    fn from(err: DomainError) -> Self {
        match err {
            DomainError::BadRequest(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::PermissionDenied(msg) => ApiError::UnprocessableEntity(msg),
            DomainError::LogError(e) => {
                tracing::error!("Log error: {}", e);
                ApiError::InternalServerError("Internal server error".to_string())
            }
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

pub trait LogRepository: Send + Sync + Clone {
    fn find_user_role(
        &self,
        user_id: i64,
    ) -> impl std::future::Future<Output = Result<Option<i64>, DatabaseError>> + Send;
}

impl LogRepository for Postgre {
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
pub struct LogService<R: LogRepository, M: LogManager> {
    repository: R,
    manager: M,
}

impl<R: LogRepository, M: LogManager> LogService<R, M> {
    pub fn new(manager: M, repository: R) -> Self {
        Self { repository, manager }
    }

    pub async fn create_log(
        &self,
        log: String,
        category: String,
        user_id: i64,
    ) -> Result<LogEntry, DomainError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID && role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to manage logs".to_string(),
            ));
        }

        if log.trim().is_empty() {
            return Err(DomainError::BadRequest(
                "Log message cannot be empty".to_string(),
            ));
        }

        if category.trim().is_empty() {
            return Err(DomainError::BadRequest(
                "Category cannot be empty".to_string(),
            ));
        }

        Ok(self.manager.log_entry(log, category).await?)
    }

    pub async fn get_logs(
        &self,
        category: Option<String>,
        user_id: i64,
    ) -> Result<Vec<LogEntry>, DomainError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID && role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to manage logs".to_string(),
            ));
        }
        Ok(self.manager.get_entries(category).await?)
    }

    pub async fn delete_logs(
        &self,
        category: Option<String>,
        user_id: i64,
    ) -> Result<u64, DomainError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID && role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to manage logs".to_string(),
            ));
        }

        Ok(self.manager.delete_entries(category).await?)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateLogRequest {
    pub log: String,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetLogsQuery {
    pub category: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLogsResponse {
    pub deleted_count: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

pub fn log_routes(
    log_service: LogService<Postgre, TextLogManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(create_log_handler))
        .routes(routes!(get_logs_handler))
        .routes(routes!(delete_logs_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(log_service)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

#[utoipa::path(
    post,
    tag = "log",
    path = "/",
    request_body = CreateLogRequest,
    responses(
        (status = 201, description = "Log entry created successfully", body = LogEntry),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn create_log_handler(
    State(service): State<LogService<Postgre, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<CreateLogRequest>,
) -> Result<(StatusCode, Json<LogEntry>), ApiError> {
    let entry = service
        .create_log(payload.log, payload.category, session.user_id)
        .await
        .map_err(ApiError::from)?;

    Ok((StatusCode::CREATED, Json(entry)))
}

#[utoipa::path(
    get,
    tag = "log",
    path = "/",
    params(
        ("category" = Option<String>, Query, description = "Filter by category"),
    ),
    responses(
        (status = 200, description = "Successfully retrieved log entries", body = Vec<LogEntry>),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_logs_handler(
    State(service): State<LogService<Postgre, TextLogManager>>,
    Extension(session): Extension<Session>,
    Query(query): Query<GetLogsQuery>,
) -> Result<Json<Vec<LogEntry>>, ApiError> {
    let entries = service
        .get_logs(query.category, session.user_id)
        .await
        .map_err(ApiError::from)?;

    Ok(Json(entries))
}

#[utoipa::path(
    delete,
    tag = "log",
    path = "/",
    params(
        ("category" = Option<String>, Query, description = "Delete only entries matching category"),
    ),
    responses(
        (status = 200, description = "Successfully deleted log entries", body = DeleteLogsResponse),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn delete_logs_handler(
    State(service): State<LogService<Postgre, TextLogManager>>,
    Extension(session): Extension<Session>,
    Query(query): Query<GetLogsQuery>,
) -> Result<Json<DeleteLogsResponse>, ApiError> {
    let deleted_count = service
        .delete_logs(query.category, session.user_id)
        .await
        .map_err(ApiError::from)?;

    Ok(Json(DeleteLogsResponse { deleted_count }))
}

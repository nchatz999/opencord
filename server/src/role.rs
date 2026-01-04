// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use utoipa::ToSchema;

use crate::auth::Session;
use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::managers::{DefaultNotifierManager, LogManager, NotifierManager, TextLogManager};
use crate::middleware::{AuthorizeService, authorize};
use crate::model::EventPayload;
use crate::transport::{ControlRoutingPolicy, ServerMessage};

use axum::http::StatusCode;
use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::middleware::from_fn_with_state;
use utoipa_axum::{router::OpenApiRouter, routes};

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

pub const OWNER_ROLE_ID: i64 = 1;
pub const ADMIN_ROLE_ID: i64 = 2;
pub const DEFAULT_ROLE_ID: i64 = 3;

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub role_id: i64,
    pub role_name: String,
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

pub trait RoleTransaction: Send + Sync {
    async fn create(&mut self, name: &str) -> Result<Role, DatabaseError>;

    async fn update_name(
        &mut self,
        role_id: i64,
        name: &str,
    ) -> Result<Option<Role>, DatabaseError>;

    async fn delete(&mut self, role_id: i64) -> Result<Option<Role>, DatabaseError>;
}

pub trait RoleRepository: Send + Sync + Clone {
    type Transaction: RoleTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_by_id(&self, role_id: i64) -> Result<Option<Role>, DatabaseError>;

    async fn list_all(&self) -> Result<Vec<Role>, DatabaseError>;

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError>;

    async fn count_users_with_role(&self, role_id: i64) -> Result<i64, DatabaseError>;
}

pub struct PgRoleTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl RoleTransaction for PgRoleTransaction {
    async fn create(&mut self, name: &str) -> Result<Role, DatabaseError> {
        let role_id = sqlx::query_scalar!(
            "INSERT INTO roles (role_name) VALUES ($1) RETURNING role_id",
            name
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(Role {
            role_id,
            role_name: name.to_string(),
        })
    }

    async fn update_name(
        &mut self,
        role_id: i64,
        name: &str,
    ) -> Result<Option<Role>, DatabaseError> {
        let role = sqlx::query_as!(
            Role,
            "UPDATE roles SET role_name = $1 WHERE role_id = $2 RETURNING role_id, role_name",
            name,
            role_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(role)
    }

    async fn delete(&mut self, role_id: i64) -> Result<Option<Role>, DatabaseError> {
        let result = sqlx::query_as!(
            Role,
            "DELETE FROM roles WHERE role_id = $1 RETURNING role_id, role_name",
            role_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;
        Ok(result)
    }
}

impl RoleRepository for Postgre {
    type Transaction = PgRoleTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgRoleTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn find_by_id(&self, role_id: i64) -> Result<Option<Role>, DatabaseError> {
        let result = sqlx::query_as!(
            Role,
            "SELECT role_id, role_name FROM roles WHERE role_id = $1",
            role_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_all(&self) -> Result<Vec<Role>, DatabaseError> {
        let results = sqlx::query_as!(
            Role,
            "SELECT role_id, role_name FROM roles ORDER BY role_id"
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
    }

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!("SELECT role_id FROM users WHERE user_id = $1", user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(result)
    }

    async fn count_users_with_role(&self, role_id: i64) -> Result<i64, DatabaseError> {
        let result = sqlx::query_scalar!(
            "SELECT COUNT(*) as count FROM users WHERE role_id = $1",
            role_id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result.unwrap_or(0))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct RoleService<R: RoleRepository, N: NotifierManager, G: LogManager> {
    repository: R,
    notifier: N,
    logger: G,
}

impl<R: RoleRepository, N: NotifierManager, G: LogManager> RoleService<R, N, G> {
    pub fn new(repository: R, notifier: N, logger: G) -> Self {
        Self {
            repository,
            notifier,
            logger,
        }
    }

    pub async fn create_role(
        &self,
        name: String,
        user_id: i64,
        session_id: i64,
    ) -> Result<Role, DomainError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID && role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to create role".to_string(),
            ));
        }

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(DomainError::BadRequest(
                "Role name cannot be empty".to_string(),
            ));
        }
        if trimmed_name.len() > 255 {
            return Err(DomainError::BadRequest("Role name too long".to_string()));
        }

        let mut tx = self.repository.begin().await?;

        let role = tx.create(trimmed_name).await.map_err(|e| match e {
            DatabaseError::UniqueConstraintViolation { .. } => {
                DomainError::BadRequest(format!("Role name '{}' is already taken", trimmed_name))
            }
            other => DomainError::InternalError(other),
        })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::RoleCreated { role: role.clone() };
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
                    "Role created: user_id={}, session_id={}, role_id={}",
                    user_id, session_id, role.role_id
                ),
                "role".to_string(),
            )
            .await;

        Ok(role)
    }

    pub async fn get_role(&self, role_id: i64) -> Result<Role, DomainError> {
        let role_data =
            self.repository
                .find_by_id(role_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "Role {} not found",
                    role_id
                )))?;

        Ok(role_data)
    }

    pub async fn list_all_roles(&self) -> Result<Vec<Role>, DomainError> {
        let roles = self.repository.list_all().await?;

        Ok(roles)
    }

    pub async fn update_role_name(
        &self,
        role_id: i64,
        new_name: String,
        user_id: i64,
        session_id: i64,
    ) -> Result<(), DomainError> {
        let user_role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if user_role_id > ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to update role".to_string(),
            ));
        }

        if role_id == OWNER_ROLE_ID && user_role_id != OWNER_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Only owner can rename owner role".to_string(),
            ));
        }

        if role_id == ADMIN_ROLE_ID && user_role_id != OWNER_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Only owner can rename admin role".to_string(),
            ));
        }

        let trimmed_name = new_name.trim();
        if trimmed_name.is_empty() {
            return Err(DomainError::BadRequest(
                "Role name cannot be empty".to_string(),
            ));
        }
        if trimmed_name.len() > 255 {
            return Err(DomainError::BadRequest("Role name too long".to_string()));
        }

        let mut tx = self.repository.begin().await?;

        let updated_role = tx
            .update_name(role_id, trimmed_name)
            .await
            .map_err(|e| match e {
                DatabaseError::UniqueConstraintViolation { .. } => DomainError::BadRequest(
                    format!("Role name '{}' is already taken", trimmed_name),
                ),
                other => DomainError::InternalError(other),
            })?
            .ok_or(DomainError::BadRequest(format!(
                "Role {} not found",
                role_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::RoleUpdated { role: updated_role };
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
                    "Role name updated: user_id={}, session_id={}, role_id={}",
                    user_id, session_id, role_id
                ),
                "role".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn delete_role(
        &self,
        role_id: i64,
        user_id: i64,
        session_id: i64,
    ) -> Result<Option<Role>, DomainError> {
        let user_role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if user_role_id != OWNER_ROLE_ID && user_role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to delete role".to_string(),
            ));
        }

        if role_id == OWNER_ROLE_ID || role_id == ADMIN_ROLE_ID || role_id == DEFAULT_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Cannot modify system role".to_string(),
            ));
        }

        let user_count = self.repository.count_users_with_role(role_id).await?;
        if user_count > 0 {
            return Err(DomainError::BadRequest(format!(
                "Cannot delete role with {} member(s). Reassign users first.",
                user_count
            )));
        }

        let mut tx = self.repository.begin().await?;

        let deleted = tx
            .delete(role_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Role {} not found",
                role_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::RoleDeleted {
            role_id: deleted.role_id,
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
                    "Role deleted: user_id={}, session_id={}, role_id={}",
                    user_id, session_id, role_id
                ),
                "role".to_string(),
            )
            .await;

        Ok(Some(deleted))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleRequest {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoleResponse {
    pub role_id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UpdateRoleRequest {
    pub name: String,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

pub fn role_routes(
    role_service: RoleService<Postgre, DefaultNotifierManager, TextLogManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(list_roles_handler))
        .routes(routes!(get_role_by_id_handler))
        .routes(routes!(create_role_handler))
        .routes(routes!(delete_role_handler))
        .routes(routes!(update_role_name_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(role_service)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

#[utoipa::path(
    get,
    tag = "role",
    path = "/",
    responses(
        (status = 200, description = "Successfully retrieved roles", body = Vec<Role>),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn list_roles_handler(
    State(service): State<RoleService<Postgre, DefaultNotifierManager, TextLogManager>>,
) -> Result<Json<Vec<Role>>, ApiError> {
    let roles = service.list_all_roles().await.map_err(ApiError::from)?;
    Ok(Json(roles))
}

#[utoipa::path(
    get,
    tag = "role",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the role to get details for"),
    ),
    responses(
        (status = 200, description = "Successfully retrieved role details", body = Role),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Role not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn get_role_by_id_handler(
    State(service): State<RoleService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Path(id): Path<i64>,
) -> Result<Json<Role>, ApiError> {
    let role_data = service.get_role(id).await.map_err(ApiError::from)?;
    Ok(Json(role_data))
}

#[utoipa::path(
    post,
    tag = "role",
    path = "/",
    request_body = CreateRoleRequest,
    responses(
        (status = 201, description = "Role created successfully", body = CreateRoleResponse),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 409, description = "Role name already taken", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn create_role_handler(
    State(service): State<RoleService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<CreateRoleRequest>,
) -> Result<(StatusCode, Json<CreateRoleResponse>), ApiError> {
    let role = service
        .create_role(payload.name.clone(), session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateRoleResponse {
            role_id: role.role_id,
        }),
    ))
}

#[utoipa::path(
    put,
    tag = "role",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the role to update"),
    ),
    request_body = UpdateRoleRequest,
    responses(
        (status = 204, description = "Role updated successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Role not found", body = ApiError),
        (status = 409, description = "Role name already taken", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn update_role_name_handler(
    State(service): State<RoleService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateRoleRequest>,
) -> Result<(), ApiError> {
    service
        .update_role_name(
            id,
            payload.name.clone(),
            session.user_id,
            session.session_id,
        )
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

#[utoipa::path(
    delete,
    tag = "role",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the role to delete"),
    ),
    responses(
        (status = 204, description = "Role deleted successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Role not found", body = ApiError),
        (status = 409, description = "Role has users", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn delete_role_handler(
    State(service): State<RoleService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(id): Path<i64>,
) -> Result<(), ApiError> {
    service
        .delete_role(id, session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

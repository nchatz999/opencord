use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use utoipa::ToSchema;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub role_id: i64,
    pub role_name: String,
}

#[derive(Debug, thiserror::Error)]
pub enum RoleError {
    #[error("Role not found: {role_id}")]
    RoleNotFound { role_id: i64 },

    #[error("Role name '{name}' is already taken")]
    NameTaken { name: String },

    #[error("Role name '{name}' is invalid")]
    InvalidName { name: String },

    #[error("Permission denied")]
    PermissionDenied,

    #[error("Cannot modify system role")]
    SystemRole,

    #[error("Internal server error")]
    ServerError,

    #[error(transparent)]
    DatabaseError(#[from] DatabaseError),
}

use crate::error::{ApiError, DatabaseError};

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
}

use crate::middleware::{AuthorizeService, authorize};

use crate::managers::{DefaultNotifierManager, NotifierManager};
use crate::model::EventPayload;
use crate::webtransport::{ControlRoutingPolicy, ServerMessage};

#[derive(Clone)]
pub struct RoleService<R: RoleRepository, N: NotifierManager> {
    repository: R,
    notifier: N,
}

impl<R: RoleRepository, N: NotifierManager> RoleService<R, N> {
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
        }
    }

    pub async fn create_role(&self, name: String, user_id: i64) -> Result<Role, RoleError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(RoleError::PermissionDenied)?;

        if role_id != 0 && role_id != 1 {
            return Err(RoleError::PermissionDenied);
        }

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(RoleError::InvalidName { name });
        }
        if trimmed_name.len() > 255 {
            return Err(RoleError::InvalidName { name });
        }

        let mut tx = self.repository.begin().await?;

        let role = tx.create(trimmed_name).await.map_err(|e| match e {
            DatabaseError::UniqueConstraintViolation { .. } => {
                return RoleError::NameTaken {
                    name: trimmed_name.to_string(),
                };
            }
            other => RoleError::DatabaseError(other),
        })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::RoleUpdated { role: role.clone() };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        Ok(role)
    }

    pub async fn get_role(&self, role_id: i64) -> Result<Role, RoleError> {
        let role_data = self
            .repository
            .find_by_id(role_id)
            .await
            .map_err(|_| RoleError::ServerError)?
            .ok_or(RoleError::RoleNotFound { role_id })?;

        Ok(role_data)
    }

    pub async fn list_all_roles(&self) -> Result<Vec<Role>, RoleError> {
        let roles = self.repository.list_all().await?;

        Ok(roles)
    }

    pub async fn update_role_name(
        &self,
        role_id: i64,
        new_name: String,
        user_role_id: i64,
    ) -> Result<(), RoleError> {
        if user_role_id != 0 && user_role_id != 1 {
            return Err(RoleError::PermissionDenied);
        }

        if role_id == 0 || (role_id == 1 && user_role_id != 0) {
            return Err(RoleError::SystemRole);
        }

        let trimmed_name = new_name.trim();
        if trimmed_name.is_empty() {
            return Err(RoleError::InvalidName { name: new_name });
        }
        if trimmed_name.len() > 255 {
            return Err(RoleError::InvalidName { name: new_name });
        }

        let mut tx = self.repository.begin().await?;

        let updated_role = tx
            .update_name(role_id, trimmed_name)
            .await?
            .ok_or(RoleError::RoleNotFound { role_id })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::RoleUpdated { role: updated_role };
        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        Ok(())
    }

    pub async fn delete_role(
        &self,
        role_id: i64,
        user_role_id: i64,
    ) -> Result<Option<Role>, RoleError> {
        if user_role_id != 0 && user_role_id != 1 {
            return Err(RoleError::PermissionDenied);
        }

        if role_id == 0 || role_id == 1 {
            return Err(RoleError::SystemRole);
        }

        let mut tx = self.repository.begin().await?;

        let deleted = tx
            .delete(role_id)
            .await?
            .ok_or(RoleError::RoleNotFound { role_id })?;

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

        Ok(Some(deleted))
    }
}

use crate::db::Postgre;

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
}

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

#[derive(Debug, Clone)]
pub struct UsersSQL {
    pub role_id: i64,
}

use axum::Json;
use axum::http::StatusCode;

impl From<RoleError> for ApiError {
    fn from(err: RoleError) -> Self {
        match err {
            RoleError::RoleNotFound { role_id } => {
                ApiError::UnprocessableEntity(format!("Role {} not found", role_id))
            }
            RoleError::NameTaken { name } => {
                ApiError::UnprocessableEntity(format!("Role name '{}' is already taken", name))
            }
            RoleError::InvalidName { name } => {
                ApiError::UnprocessableEntity(format!("Invalid role name: '{}'", name))
            }
            RoleError::PermissionDenied => {
                ApiError::UnprocessableEntity("Permission denied".to_string())
            }
            RoleError::SystemRole => {
                ApiError::UnprocessableEntity("Cannot modify system role".to_string())
            }
            RoleError::DatabaseError(e) => ApiError::InternalServerError(e.to_string()),
            RoleError::ServerError => {
                ApiError::InternalServerError("Internal server error".to_string())
            }
        }
    }
}

use axum::{
    extract::{Extension, Path, State},
    middleware::from_fn_with_state,
};
use utoipa_axum::{router::OpenApiRouter, routes};

pub fn role_routes(
    role_service: RoleService<Postgre, DefaultNotifierManager>,
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
    State(service): State<RoleService<Postgre, DefaultNotifierManager>>,
) -> Result<Json<Vec<Role>>, ApiError> {
    let roles = service.list_all_roles().await?;
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
    State(service): State<RoleService<Postgre, DefaultNotifierManager>>,
    Path(id): Path<i64>,
) -> Result<Json<Role>, ApiError> {
    let role_data = service.get_role(id).await?;
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
    State(service): State<RoleService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<CreateRoleRequest>,
) -> Result<(StatusCode, Json<CreateRoleResponse>), ApiError> {
    let role = service.create_role(payload.name.clone(), user_id).await?;

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
    State(service): State<RoleService<Postgre, DefaultNotifierManager>>,
    Extension(user): Extension<UsersSQL>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateRoleRequest>,
) -> Result<StatusCode, ApiError> {
    service
        .update_role_name(id, payload.name.clone(), user.role_id)
        .await?;

    Ok(StatusCode::NO_CONTENT)
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
    State(service): State<RoleService<Postgre, DefaultNotifierManager>>,
    Extension(user): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    service.delete_role(id, user).await?;

    Ok(StatusCode::NO_CONTENT)
}

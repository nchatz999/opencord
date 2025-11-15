use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use utoipa::ToSchema;

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub group_id: i64,
    pub group_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupRoleRights {
    pub group_id: i64,
    pub role_id: i64,
    pub rights: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum DomainError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Internal error")]
    InternalError(#[from] DatabaseError),
}

use crate::error::{ApiError, DatabaseError};

pub trait GroupTransaction: Send + Sync {
    async fn create(&mut self, name: &str) -> Result<Group, DatabaseError>;

    async fn update_name(
        &mut self,
        group_id: i64,
        name: &str,
    ) -> Result<Option<Group>, DatabaseError>;

    async fn delete(&mut self, group_id: i64) -> Result<Option<Group>, DatabaseError>;
}

pub trait GroupRepository: Send + Sync + Clone {
    type Transaction: GroupTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_by_id(&self, group_id: i64) -> Result<Option<Group>, DatabaseError>;

    async fn list_by_user_role(&self, user_id: i64) -> Result<Vec<Group>, DatabaseError>;

    async fn find_user_group_rights(
        &self,
        group_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError>;
}

use crate::managers::{DefaultNotifierManager, NotifierManager, RecipientType};

use crate::model::EventPayload;

#[derive(Clone)]
pub struct GroupService<R: GroupRepository, N: NotifierManager> {
    repository: R,
    notifier: N,
}

impl<R: GroupRepository, N: NotifierManager> GroupService<R, N> {
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
        }
    }

    async fn verify_user_permission(
        &self,
        group_id: i64,
        user_id: i64,
        minimum_rights_level: i64,
    ) -> Result<bool, DomainError> {
        let rights = self
            .repository
            .find_user_group_rights(group_id, user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Group {} not found",
                group_id
            )))?;
        Ok(rights >= minimum_rights_level)
    }

    pub async fn create_group(&self, name: String, user_id: i64) -> Result<Group, DomainError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != 0 && role_id != 1 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to create group".to_string(),
            ));
        }

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(DomainError::BadRequest(
                "Group name cannot be empty".to_string(),
            ));
        }
        if trimmed_name.len() > 100 {
            return Err(DomainError::BadRequest("Group name too long".to_string()));
        }

        let mut tx = self.repository.begin().await?;

        let group = tx.create(trimmed_name).await.map_err(|e| match e {
            DatabaseError::UniqueConstraintViolation { .. } => {
                DomainError::BadRequest(format!("Group name '{}' is already taken", trimmed_name))
            }
            other => DomainError::InternalError(other),
        })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::GroupUpdated {
            group: group.clone(),
        };
        let _ = self
            .notifier
            .notify(
                event,
                RecipientType::GroupRights {
                    group_id: group.group_id,
                    minimum_rights: 1,
                },
            )
            .await;

        Ok(group)
    }

    pub async fn get_group(&self, group_id: i64, user_id: i64) -> Result<Group, DomainError> {
        if !self.verify_user_permission(group_id, user_id, 1).await? {
            return Err(DomainError::PermissionDenied(
                "No access to group".to_string(),
            ));
        }
        let group_data =
            self.repository
                .find_by_id(group_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "Group {} not found",
                    group_id
                )))?;

        Ok(group_data)
    }

    pub async fn list_user_groups(&self, user_id: i64) -> Result<Vec<Group>, DomainError> {
        let groups = self.repository.list_by_user_role(user_id).await?;

        Ok(groups)
    }

    pub async fn update_group_name(
        &self,
        group_id: i64,
        new_name: String,
        user_id: i64,
    ) -> Result<(), DomainError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != 0 && role_id != 1 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to update group".to_string(),
            ));
        }

        let trimmed_name = new_name.trim();
        if trimmed_name.is_empty() {
            return Err(DomainError::BadRequest(
                "Group name cannot be empty".to_string(),
            ));
        }
        if trimmed_name.len() > 100 {
            return Err(DomainError::BadRequest("Group name too long".to_string()));
        }

        let mut tx = self.repository.begin().await?;

        let updated_group = tx
            .update_name(group_id, trimmed_name)
            .await
            .map_err(|e| match e {
                DatabaseError::UniqueConstraintViolation { .. } => DomainError::BadRequest(
                    format!("Group name '{}' is already taken", trimmed_name),
                ),
                other => DomainError::InternalError(other),
            })?
            .ok_or(DomainError::BadRequest(format!(
                "Group {} not found",
                group_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::GroupUpdated {
            group: updated_group.clone(),
        };
        let _ = self
            .notifier
            .notify(
                event,
                RecipientType::GroupRights {
                    group_id,
                    minimum_rights: 1,
                },
            )
            .await;

        Ok(())
    }

    pub async fn delete_group(
        &self,
        group_id: i64,
        user_id: i64,
    ) -> Result<Option<Group>, DomainError> {
        let role_id = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != 0 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to delete group".to_string(),
            ));
        }

        let mut tx = self.repository.begin().await?;

        let deleted = tx
            .delete(group_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Group {} not found",
                group_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::GroupDeleted { group_id };
        let _ = self.notifier.notify(event, RecipientType::Broadcast).await;

        Ok(Some(deleted))
    }
}

use crate::db::Postgre;

pub struct PgGroupTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl GroupTransaction for PgGroupTransaction {
    async fn create(&mut self, name: &str) -> Result<Group, DatabaseError> {
        let group_id = sqlx::query_scalar!(
            "INSERT INTO groups (group_name) VALUES ($1) RETURNING group_id",
            name
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(Group {
            group_id,
            group_name: name.to_string(),
        })
    }

    async fn update_name(
        &mut self,
        group_id: i64,
        name: &str,
    ) -> Result<Option<Group>, DatabaseError> {
        let group = sqlx::query_as!(
            Group,
            "UPDATE groups SET group_name = $1 WHERE group_id = $2 RETURNING group_id, group_name",
            name,
            group_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(group)
    }

    async fn delete(&mut self, group_id: i64) -> Result<Option<Group>, DatabaseError> {
        let result = sqlx::query_as!(
            Group,
            "DELETE FROM groups WHERE group_id = $1 RETURNING group_id, group_name",
            group_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;
        Ok(result)
    }
}

impl GroupRepository for Postgre {
    type Transaction = PgGroupTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgGroupTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn find_by_id(&self, group_id: i64) -> Result<Option<Group>, DatabaseError> {
        let result = sqlx::query_as!(
            Group,
            "SELECT group_id, group_name FROM groups WHERE group_id = $1",
            group_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn list_by_user_role(&self, user_id: i64) -> Result<Vec<Group>, DatabaseError> {
        let results = sqlx::query_as!(
            Group,
            r#"SELECT DISTINCT
                g.group_id, 
                g.group_name
            FROM groups g
            INNER JOIN group_role_rights grr ON g.group_id = grr.group_id
            INNER JOIN users u ON u.role_id = grr.role_id
            WHERE u.user_id = $1 AND grr.rights >= 1"#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
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

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!("SELECT role_id FROM users WHERE user_id = $1", user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(result)
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupRequest {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupResponse {
    pub group_id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UpdateGroupRequest {
    pub name: String,
}

use axum::http::StatusCode;
use axum::Json;

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

use crate::middleware::{authorize, AuthorizeService};
use axum::{
    extract::{Extension, Path, State},
    middleware::from_fn_with_state,
};
use utoipa_axum::{router::OpenApiRouter, routes};

pub fn group_routes(
    group_service: GroupService<Postgre, DefaultNotifierManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(list_groups_handler))
        .routes(routes!(get_group_by_id_handler))
        .routes(routes!(create_group_handler))
        .routes(routes!(delete_group_handler))
        .routes(routes!(update_group_name_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(group_service)
}

#[utoipa::path(
    get,
    tag = "group",
    path = "/",
    responses(
        (status = 200, description = "Successfully retrieved groups", body = Vec<Group>),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn list_groups_handler(
    State(service): State<GroupService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<Group>>, ApiError> {
    let groups = service
        .list_user_groups(user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(groups))
}

#[utoipa::path(
    get,
    tag = "group",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the group to get details for"),
    ),
    responses(
        (status = 200, description = "Successfully retrieved group details", body = Group),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Group not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn get_group_by_id_handler(
    State(service): State<GroupService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<Json<Group>, ApiError> {
    let group_data = service
        .get_group(id, user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(group_data))
}

#[utoipa::path(
    post,
    tag = "group",
    path = "/",
    request_body = CreateGroupRequest,
    responses(
        (status = 201, description = "Group created successfully", body = CreateGroupResponse),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 409, description = "Group name already taken", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn create_group_handler(
    State(service): State<GroupService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<CreateGroupRequest>,
) -> Result<(StatusCode, Json<CreateGroupResponse>), ApiError> {
    let group = service
        .create_group(payload.name, user_id)
        .await
        .map_err(ApiError::from)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateGroupResponse {
            group_id: group.group_id,
        }),
    ))
}

#[utoipa::path(
    delete,
    tag = "group",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the group to delete"),
    ),
    responses(
        (status = 204, description = "Group deleted successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Group not found", body = ApiError),
        (status = 409, description = "Group has channels", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn delete_group_handler(
    State(service): State<GroupService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    service
        .delete_group(id, user_id)
        .await
        .map_err(ApiError::from)?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    tag = "group",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the group to update"),
    ),
    request_body = UpdateGroupRequest,
    responses(
        (status = 204, description = "Group updated successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Group not found", body = ApiError),
        (status = 409, description = "Group name already taken", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn update_group_name_handler(
    State(service): State<GroupService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateGroupRequest>,
) -> Result<StatusCode, ApiError> {
    service
        .update_group_name(id, payload.name.clone(), user_id)
        .await
        .map_err(ApiError::from)?;

    Ok(StatusCode::NO_CONTENT)
}

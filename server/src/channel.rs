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
use crate::role::{ADMIN_ROLE_ID, OWNER_ROLE_ID};
use crate::webtransport::{ControlRoutingPolicy, ServerMessage};

use axum::Json;
use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::middleware::from_fn_with_state;
use utoipa_axum::{router::OpenApiRouter, routes};

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type, ToSchema)]
#[sqlx(type_name = "channel_type", rename_all = "PascalCase")]
pub enum ChannelType {
    Text,
    #[sqlx(rename = "VoIP")]
    VoIP,
}

impl From<String> for ChannelType {
    fn from(s: String) -> Self {
        match s.as_str() {
            "Text" => ChannelType::Text,
            "VoIP" => ChannelType::VoIP,
            _ => ChannelType::Text,
        }
    }
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub channel_id: i64,
    pub channel_name: String,
    pub group_id: i64,
    pub channel_type: ChannelType,
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

pub trait ChannelTransaction: Send + Sync {
    async fn create(
        &mut self,
        name: &str,
        channel_type: &ChannelType,
        group_id: i64,
    ) -> Result<Channel, DatabaseError>;

    async fn update_name(
        &mut self,
        channel_id: i64,
        name: &str,
    ) -> Result<Option<Channel>, DatabaseError>;

    async fn update_group(
        &mut self,
        channel_id: i64,
        group_id: i64,
    ) -> Result<Option<Channel>, DatabaseError>;

    async fn delete(&mut self, channel_id: i64) -> Result<Option<Channel>, DatabaseError>;

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError>;
}

pub trait ChannelRepository: Send + Sync + Clone {
    type Transaction: ChannelTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn list_by_user_role(&self, user_id: i64) -> Result<Vec<Channel>, DatabaseError>;
}

pub struct PgChannelTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl ChannelTransaction for PgChannelTransaction {
    async fn create(
        &mut self,
        name: &str,
        channel_type: &ChannelType,
        group_id: i64,
    ) -> Result<Channel, DatabaseError> {
        let channel_id = sqlx::query_scalar!(
            "INSERT INTO channels (channel_name, channel_type, group_id) VALUES ($1, $2, $3) RETURNING channel_id",
            name,
            channel_type as _,
            group_id
        )
        .fetch_one(&mut *self.transaction)
        .await
        ?;

        Ok(Channel {
            channel_id,
            channel_name: name.to_string(),
            group_id,
            channel_type: channel_type.clone(),
        })
    }

    async fn update_name(
        &mut self,
        channel_id: i64,
        name: &str,
    ) -> Result<Option<Channel>, DatabaseError> {
        let channel = sqlx::query_as!(
            Channel,
            r#"UPDATE channels
            SET channel_name = $1
            WHERE channel_id = $2
            RETURNING
                channel_id,
                channel_name,
                group_id,
                channel_type as "channel_type: ChannelType""#,
            name,
            channel_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(channel)
    }

    async fn update_group(
        &mut self,
        channel_id: i64,
        group_id: i64,
    ) -> Result<Option<Channel>, DatabaseError> {
        let channel = sqlx::query_as!(
            Channel,
            r#"UPDATE channels
            SET group_id = $1
            WHERE channel_id = $2
            RETURNING
                channel_id,
                channel_name,
                group_id,
                channel_type as "channel_type: ChannelType""#,
            group_id,
            channel_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(channel)
    }

    async fn delete(&mut self, channel_id: i64) -> Result<Option<Channel>, DatabaseError> {
        let result = sqlx::query_as!(
            Channel,
            r#"DELETE FROM channels WHERE channel_id = $1
            RETURNING channel_id, channel_name, group_id, channel_type as "channel_type: ChannelType""#,
            channel_id
        )
        .fetch_optional(&mut *self.transaction)
        .await
        ?;
        Ok(result)
    }

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!("SELECT role_id FROM users WHERE user_id = $1", user_id)
            .fetch_optional(&mut *self.transaction)
            .await?;
        Ok(result)
    }
}

impl ChannelRepository for Postgre {
    type Transaction = PgChannelTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgChannelTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn list_by_user_role(&self, user_id: i64) -> Result<Vec<Channel>, DatabaseError> {
        let results = sqlx::query_as!(
            Channel,
            r#"SELECT DISTINCT
                c.channel_id,
                c.channel_name,
                c.group_id,
                c.channel_type as "channel_type: ChannelType"
            FROM channels c
            INNER JOIN group_role_rights grr ON c.group_id = grr.group_id
            INNER JOIN users u ON u.role_id = grr.role_id
            WHERE u.user_id = $1 AND grr.rights >= 1"#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(results)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct ChannelService<R: ChannelRepository, N: NotifierManager, G: LogManager> {
    repository: R,
    notifier: N,
    logger: G,
}

impl<R: ChannelRepository, N: NotifierManager, G: LogManager> ChannelService<R, N, G> {
    pub fn new(repository: R, notifier: N, logger: G) -> Self {
        Self {
            repository,
            notifier,
            logger,
        }
    }

    pub async fn create_channel(
        &self,
        name: String,
        channel_type: ChannelType,
        group_id: i64,
        user_id: i64,
        session_id: i64,
    ) -> Result<Channel, DomainError> {
        let mut tx = self.repository.begin().await?;

        let role_id = tx
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID && role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to create channel".to_string(),
            ));
        }

        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err(DomainError::BadRequest(
                "Channel name cannot be empty".to_string(),
            ));
        }
        if trimmed_name.len() > 100 {
            return Err(DomainError::BadRequest("Channel name too long".to_string()));
        }

        let channel = tx
            .create(trimmed_name, &channel_type, group_id)
            .await
            .map_err(|e| match &e {
                DatabaseError::UniqueConstraintViolation { .. } => DomainError::BadRequest(
                    format!("Channel name '{}' is already taken", trimmed_name),
                ),
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "group_id" => DomainError::BadRequest(format!("Group {} not found", group_id)),
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        self.repository.commit(tx).await?;

        let event = EventPayload::ChannelCreated {
            channel: channel.clone(),
        };

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::GroupRights {
                    group_id: channel.group_id,
                    minimun_rights: 1,
                },
            ))
            .await;

        let _ = self.notifier.notify(ServerMessage::InvalidateAcl).await;

        let _ = self.logger.log_entry(
            format!("Channel created: user_id={}, session_id={}, channel_id={}, group_id={}, type={:?}", user_id, session_id, channel.channel_id, group_id, channel_type),
            "channel".to_string(),
        ).await;

        Ok(channel)
    }

    pub async fn list_user_channels(&self, user_id: i64) -> Result<Vec<Channel>, DomainError> {
        let channels = self.repository.list_by_user_role(user_id).await?;
        Ok(channels)
    }

    pub async fn update_channel_name(
        &self,
        channel_id: i64,
        new_name: String,
        user_id: i64,
        session_id: i64,
    ) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let role_id = tx
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID && role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to update channel".to_string(),
            ));
        }

        let trimmed_name = new_name.trim();
        if trimmed_name.is_empty() {
            return Err(DomainError::BadRequest(
                "Channel name cannot be empty".to_string(),
            ));
        }
        if trimmed_name.len() > 100 {
            return Err(DomainError::BadRequest("Channel name too long".to_string()));
        }

        let updated_channel = tx
            .update_name(channel_id, trimmed_name)
            .await
            .map_err(|e| match e {
                DatabaseError::UniqueConstraintViolation { .. } => DomainError::BadRequest(
                    format!("Channel name '{}' is already taken", trimmed_name),
                ),
                other => DomainError::InternalError(other),
            })?
            .ok_or(DomainError::BadRequest(format!(
                "Channel {} not found",
                channel_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::ChannelUpdated {
            channel: updated_channel.clone(),
        };

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::ChannelRights {
                    channel_id: updated_channel.channel_id,
                    minimun_rights: 1,
                },
            ))
            .await;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Channel name updated: user_id={}, session_id={}, channel_id={}",
                    user_id, session_id, channel_id
                ),
                "channel".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn update_channel_group(
        &self,
        channel_id: i64,
        new_group_id: i64,
        user_id: i64,
        session_id: i64,
    ) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let role_id = tx
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID && role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to update channel".to_string(),
            ));
        }

        let updated_channel = tx
            .update_group(channel_id, new_group_id)
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "group_id" => {
                        DomainError::BadRequest(format!("Group {} not found", new_group_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?
            .ok_or(DomainError::BadRequest(format!(
                "Channel {} not found",
                channel_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::ChannelUpdated {
            channel: updated_channel,
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

        let _ = self.logger.log_entry(
            format!("Channel group updated: user_id={}, session_id={}, channel_id={}, new_group_id={}", user_id, session_id, channel_id, new_group_id),
            "channel".to_string(),
        ).await;

        Ok(())
    }

    pub async fn delete_channel(
        &self,
        channel_id: i64,
        user_id: i64,
        session_id: i64,
    ) -> Result<Option<Channel>, DomainError> {
        let mut tx = self.repository.begin().await?;

        let role_id = tx
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        if role_id != OWNER_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to delete channel".to_string(),
            ));
        }

        let deleted = tx
            .delete(channel_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Channel {} not found",
                channel_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::ChannelDeleted { channel_id };

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::GroupRights {
                    group_id: deleted.group_id,
                    minimun_rights: 1,
                },
            ))
            .await;

        let _ = self.notifier.notify(ServerMessage::InvalidateAcl).await;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Channel deleted: user_id={}, session_id={}, channel_id={}",
                    user_id, session_id, channel_id
                ),
                "channel".to_string(),
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
pub struct CreateChannelRequest {
    pub name: String,
    pub group_id: i64,
    pub r#type: ChannelType,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChannelResponse {
    pub channel_id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UpdateChannelRequest {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateChannelGroupRequest {
    pub group_id: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

pub fn channel_routes(
    channel_service: ChannelService<Postgre, DefaultNotifierManager, TextLogManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(list_channels_handler))
        .routes(routes!(create_channel_handler))
        .routes(routes!(delete_channel_handler))
        .routes(routes!(update_channel_name_handler))
        .routes(routes!(update_channel_group_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(channel_service)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

#[utoipa::path(
    get,
    tag = "channel",
    path = "/",
    responses(
        (status = 200, description = "Successfully retrieved channels", body = Vec<Channel>),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn list_channels_handler(
    State(service): State<ChannelService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
) -> Result<Json<Vec<Channel>>, ApiError> {
    let user = session.user_id;
    let channels = service
        .list_user_channels(user)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(channels))
}

#[utoipa::path(
    post,
    tag = "channel",
    path = "/",
    request_body = CreateChannelRequest,
    responses(
        (status = 201, description = "Channel created successfully", body = CreateChannelResponse),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 409, description = "Channel name already taken", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn create_channel_handler(
    State(service): State<ChannelService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Json(payload): Json<CreateChannelRequest>,
) -> Result<(StatusCode, Json<CreateChannelResponse>), ApiError> {
    let channel = service
        .create_channel(
            payload.name.clone(),
            payload.r#type.clone(),
            payload.group_id,
            session.user_id,
            session.session_id,
        )
        .await
        .map_err(ApiError::from)?;

    Ok((
        StatusCode::CREATED,
        Json(CreateChannelResponse {
            channel_id: channel.channel_id,
        }),
    ))
}

#[utoipa::path(
    delete,
    tag = "channel",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the channel to delete"),
    ),
    responses(
        (status = 204, description = "Channel deleted successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Channel not found", body = ApiError),
        (status = 409, description = "Channel has messages", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn delete_channel_handler(
    State(service): State<ChannelService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(id): Path<i64>,
) -> Result<(), ApiError> {
    service
        .delete_channel(id, session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

#[utoipa::path(
    put,
    tag = "channel",
    path = "/{id}",
    params(
        ("id", Path, description = "The ID of the channel to update"),
    ),
    request_body = UpdateChannelRequest,
    responses(
        (status = 204, description = "Channel updated successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Channel not found", body = ApiError),
        (status = 409, description = "Channel name already taken", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn update_channel_name_handler(
    State(service): State<ChannelService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateChannelRequest>,
) -> Result<(), ApiError> {
    service
        .update_channel_name(
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
    put,
    tag = "channel",
    path = "/{id}/group",
    params(
        ("id", Path, description = "The ID of the channel to update"),
    ),
    request_body = UpdateChannelGroupRequest,
    responses(
        (status = 204, description = "Channel group updated successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Channel not found", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn update_channel_group_handler(
    State(service): State<ChannelService<Postgre, DefaultNotifierManager, TextLogManager>>,
    Extension(session): Extension<Session>,
    Path(id): Path<i64>,
    Json(payload): Json<UpdateChannelGroupRequest>,
) -> Result<(), ApiError> {
    service
        .update_channel_group(id, payload.group_id, session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

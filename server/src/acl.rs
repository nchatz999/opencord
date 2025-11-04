use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::channel::{Channel, ChannelType};

use crate::group::{Group, GroupRoleRights};

#[derive(Debug, thiserror::Error)]
pub enum AclError {
    #[error("Group not found: {group_id}")]
    GroupNotFound { group_id: i64 },

    #[error("Role not found: {role_id}")]
    RoleNotFound { role_id: i64 },

    #[error("Permission denied {reason}")]
    PermissionDenied { reason: String },

    #[error("Invalid rights value: {rights}")]
    InvalidRights { rights: i64 },

    #[error(transparent)]
    DatabaseError(#[from] DatabaseError),
}

use crate::error::{ApiError, DatabaseError};

pub trait AclTransaction: Send + Sync {
    async fn find_group_role_rights(
        &mut self,
        user_id: i64,
    ) -> Result<Vec<GroupRoleRights>, DatabaseError>;

    async fn set_group_role_rights(
        &mut self,
        group_id: i64,
        role_id: i64,
        rights: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_group(&mut self, group_id: i64) -> Result<Group, DatabaseError>;

    async fn find_channels_by_group(
        &mut self,
        group_id: i64,
    ) -> Result<Vec<Channel>, DatabaseError>;

    async fn find_voip_participants_by_group(
        &mut self,
        group_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError>;

    async fn delete_voip_participants_by_role(&mut self, role_id: i64)
        -> Result<(), DatabaseError>;

    async fn delete_messages_by_role(&mut self, role_id: i64) -> Result<(), DatabaseError>;
}

pub trait AclRepository: Send + Sync + Clone {
    type Transaction: AclTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_group_role_rights(
        &self,
        user_id: i64,
    ) -> Result<Vec<GroupRoleRights>, DatabaseError>;

    async fn find_user_group_rights(
        &self,
        group_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError>;
}

use crate::managers::{DefaultNotifierManager, NotifierManager, RecipientType};
use crate::model::Event;

#[derive(Clone)]
pub struct AclService<R: AclRepository, N: NotifierManager> {
    repository: R,
    notifier: N,
}

impl<R: AclRepository, N: NotifierManager> AclService<R, N> {
    pub fn new(repository: R, notifier: N) -> Self {
        Self {
            repository,
            notifier,
        }
    }

    pub fn validate_permission_assignment(
        assigner: i64,
        assigner_rights: i64,
        assigne: i64,
        assigne_rights: i64,
    ) -> Result<(), AclError> {
        if assigne_rights < 0 || assigne_rights > 16 {
            return Err(AclError::InvalidRights {
                rights: assigne_rights,
            });
        }

        if (assigne == 0 || assigne == 1) && assigne_rights != 16 {
            return Err(AclError::PermissionDenied {
                reason: "Cant change admins rights".to_string(),
            });
        }
        if assigner == 0 || assigner == 1 {
            return Ok(());
        }
        if assigne_rights == 16 && assigner > 1 {
            return Err(AclError::PermissionDenied {
                reason: "Only an admin can create another admin for group".to_string(),
            });
        }
        if assigner_rights < 16 {
            return Err(AclError::PermissionDenied {
                reason: "Only can update acl".to_string(),
            });
        }
        Ok(())
    }

    pub async fn get_all_accessible_group_role_rights(
        &self,
        user_id: i64,
    ) -> Result<Vec<GroupRoleRights>, AclError> {
        let rights = self.repository.find_group_role_rights(user_id).await?;

        Ok(rights)
    }

    pub async fn set_group_role_rights(
        &self,
        acls: Vec<GroupRoleRights>,
        user_id: i64,
    ) -> Result<(), AclError> {
        let mut tx = self.repository.begin().await?;

        for acl in acls {
            let assigner = self.repository.find_user_role(user_id).await?.ok_or(
                AclError::PermissionDenied {
                    reason: "User doesnt exist".to_string(),
                },
            )?;

            let assigner_rights = self
                .repository
                .find_user_group_rights(acl.group_id, user_id)
                .await?
                .ok_or(AclError::PermissionDenied {
                    reason: "User doesnt exist".to_string(),
                })?;

            Self::validate_permission_assignment(
                assigner,
                assigner_rights,
                acl.role_id,
                acl.rights,
            )?;

            let new_right = tx
                .set_group_role_rights(acl.group_id, acl.role_id, acl.rights)
                .await
                .map_err(|e| match e {
                    DatabaseError::ForeignKeyViolation { column, .. } if column == "group_id" => {
                        AclError::GroupNotFound {
                            group_id: acl.group_id,
                        }
                    }
                    DatabaseError::ForeignKeyViolation { column, .. } if column == "role_id" => {
                        AclError::RoleNotFound {
                            role_id: acl.role_id,
                        }
                    }
                    other => AclError::DatabaseError(other),
                })?
                .unwrap_or(0);

            let event = Event::GroupRoleRightUpdated {
                group_id: acl.group_id,
                role_id: acl.role_id,
                rights: acl.rights,
            };
            let _ = self
                .notifier
                .notify(
                    event,
                    RecipientType::GroupRights {
                        group_id: acl.group_id,
                        minimum_rights: 1,
                    },
                )
                .await;

            if new_right > 0 && acl.rights == 0 {
                let hide_event = Event::GroupHide {
                    group_id: acl.group_id,
                };
                let _ = self
                    .notifier
                    .notify(
                        hide_event,
                        RecipientType::Role {
                            role_id: acl.role_id,
                        },
                    )
                    .await;
            }

            if new_right == 0 && acl.rights > 0 {
                let group = tx.find_group(acl.group_id).await?;
                let channels = tx.find_channels_by_group(acl.group_id).await?;
                let voip_participants = tx.find_voip_participants_by_group(acl.group_id).await?;

                let reveal_event = Event::GroupReveal {
                    group_id: acl.group_id,
                    group_name: group.group_name,
                    channels,
                    voip_participants,
                };
                let _ = self
                    .notifier
                    .notify(
                        reveal_event,
                        RecipientType::Role {
                            role_id: acl.role_id,
                        },
                    )
                    .await;
            }
        }

        self.repository.commit(tx).await?;

        Ok(())
    }
}

use crate::db::Postgre;
use crate::voip::VoipParticipant;

pub struct PgAclTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl AclTransaction for PgAclTransaction {
    async fn find_group_role_rights(
        &mut self,
        user_id: i64,
    ) -> Result<Vec<GroupRoleRights>, DatabaseError> {
        let results = sqlx::query_as!(
            GroupRoleRights,
            r#"SELECT DISTINCT
                grr.group_id,
                grr.role_id,
                grr.rights
            FROM group_role_rights grr
            INNER JOIN groups g ON g.group_id = grr.group_id
            INNER JOIN group_role_rights user_grr ON user_grr.group_id = grr.group_id
            INNER JOIN users u ON u.role_id = user_grr.role_id
            WHERE u.user_id = $1 AND user_grr.rights >= 1
            ORDER BY grr.group_id, grr.role_id"#,
            user_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(results)
    }
    async fn set_group_role_rights(
        &mut self,
        group_id: i64,
        role_id: i64,
        rights: i64,
    ) -> Result<Option<i64>, DatabaseError> {
        let row = sqlx::query_scalar!(
            r#"WITH old_value AS (
            SELECT rights FROM group_role_rights 
            WHERE group_id = $1 AND role_id = $2
        )
        INSERT INTO group_role_rights (group_id, role_id, rights)
            VALUES ($1, $2, $3)
        ON CONFLICT (group_id, role_id) 
        DO UPDATE SET rights = EXCLUDED.rights
        RETURNING (SELECT rights FROM old_value)"#,
            group_id,
            role_id,
            rights
        )
        .fetch_one(&mut *self.transaction)
        .await?;
        Ok(row)
    }

    async fn find_group(&mut self, group_id: i64) -> Result<Group, DatabaseError> {
        let result = sqlx::query_as!(
            Group,
            "SELECT group_id, group_name FROM groups WHERE group_id = $1",
            group_id
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn find_channels_by_group(
        &mut self,
        group_id: i64,
    ) -> Result<Vec<Channel>, DatabaseError> {
        let results = sqlx::query_as!(
            Channel,
            r#"SELECT 
                channel_id, 
                channel_name, 
                group_id, 
                channel_type as "channel_type: ChannelType"
            FROM channels 
            WHERE group_id = $1"#,
            group_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(results)
    }

    async fn find_voip_participants_by_group(
        &mut self,
        group_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError> {
        let voip_participants = sqlx::query_as!(
            VoipParticipant,
            r#"SELECT
                vp.user_id,
                vp.channel_id,
                vp.recipient_id,
                vp.local_deafen,
                vp.local_mute,
                vp.publish_screen,
                vp.publish_camera,
                vp.created_at
            FROM voip_participants vp
            LEFT JOIN channels c ON vp.channel_id = c.channel_id
            WHERE c.group_id = $1"#,
            group_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(voip_participants)
    }

    async fn delete_voip_participants_by_role(
        &mut self,
        role_id: i64,
    ) -> Result<(), DatabaseError> {
        sqlx::query!(
            r#"DELETE FROM voip_participants 
            USING users u 
            WHERE voip_participants.user_id = u.user_id AND u.role_id = $1"#,
            role_id
        )
        .execute(&mut *self.transaction)
        .await?;

        Ok(())
    }

    async fn delete_messages_by_role(&mut self, role_id: i64) -> Result<(), DatabaseError> {
        sqlx::query!(
            r#"DELETE FROM messages 
            USING users u 
            WHERE messages.sender_id = u.user_id AND u.role_id = $1"#,
            role_id
        )
        .execute(&mut *self.transaction)
        .await?;

        Ok(())
    }
}

impl AclRepository for Postgre {
    type Transaction = PgAclTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgAclTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn find_group_role_rights(
        &self,
        user_id: i64,
    ) -> Result<Vec<GroupRoleRights>, DatabaseError> {
        let results = sqlx::query_as!(
            GroupRoleRights,
            r#"SELECT DISTINCT
                grr.group_id,
                grr.role_id,
                grr.rights
            FROM group_role_rights grr
            INNER JOIN groups g ON g.group_id = grr.group_id
            INNER JOIN group_role_rights user_grr ON user_grr.group_id = grr.group_id
            INNER JOIN users u ON u.role_id = user_grr.role_id
            WHERE u.user_id = $1 AND user_grr.rights >= 1
            ORDER BY grr.group_id, grr.role_id"#,
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
pub struct SetGroupRoleRightsRequest {
    pub group_id: i64,
    pub role_id: i64,
    pub rights: i64,
}

use axum::http::StatusCode;
use axum::Json;

impl From<AclError> for ApiError {
    fn from(err: AclError) -> Self {
        match err {
            AclError::GroupNotFound { group_id } => {
                ApiError::UnprocessableEntity(format!("Group {} not found", group_id))
            }
            AclError::RoleNotFound { role_id } => {
                ApiError::UnprocessableEntity(format!("Role {} not found", role_id))
            }
            AclError::PermissionDenied { reason } => ApiError::UnprocessableEntity(reason),
            AclError::InvalidRights { rights } => {
                ApiError::UnprocessableEntity(format!("Invalid rights value: {}", rights))
            }
            AclError::DatabaseError(e) => ApiError::InternalServerError(e.to_string()),
        }
    }
}

use crate::middleware::{authorize, AuthorizeService};
use axum::{
    extract::{Extension, State},
    middleware::from_fn_with_state,
};
use utoipa_axum::{router::OpenApiRouter, routes};

pub fn acl_routes(
    acl_service: AclService<Postgre, DefaultNotifierManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(get_all_group_role_rights_handler))
        .routes(routes!(set_group_role_rights_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(acl_service)
}

#[utoipa::path(
    get,
    tag = "acl",
    path = "/group-role-rights",
    responses(
        (status = 200, description = "Successfully retrieved all accessible group role rights", body = Vec<GroupRoleRights>),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn get_all_group_role_rights_handler(
    State(service): State<AclService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<GroupRoleRights>>, ApiError> {
    let rights = service
        .get_all_accessible_group_role_rights(user_id)
        .await?;
    Ok(Json(rights))
}

#[utoipa::path(
    put,
    tag = "acl",
    path = "/group-role-rights",
    request_body = SetGroupRoleRightsRequest,
    responses(
        (status = 204, description = "Group role rights updated successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Group or role not found", body = ApiError),
        (status = 422, description = "Invalid input", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
async fn set_group_role_rights_handler(
    State(service): State<AclService<Postgre, DefaultNotifierManager>>,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<Vec<GroupRoleRights>>,
) -> Result<StatusCode, ApiError> {
    println!("asf");
    service.set_group_role_rights(payload, user_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

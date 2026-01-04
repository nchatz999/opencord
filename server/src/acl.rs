// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::auth::Session;
use crate::channel::{Channel, ChannelType};
use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::group::{Group, GroupRoleRights};
use crate::managers::{
    DefaultNotifierManager, FileError, FileManager, LocalFileManager, LogManager, NotifierManager,
    TextLogManager,
};
use crate::message::File;
use crate::middleware::{AuthorizeService, authorize};
use crate::model::EventPayload;
use crate::role::{ADMIN_ROLE_ID, OWNER_ROLE_ID};
use crate::user::User;
use crate::voip::VoipParticipant;
use crate::transport::{ControlRoutingPolicy, ServerMessage};

use axum::Json;
use axum::extract::{Extension, Path, State};
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

    #[error("Internal error")]
    InternalError(#[from] DatabaseError),

    #[error("File manager error")]
    FileManagerError(#[from] FileError),
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

// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

pub trait AclTransaction: Send + Sync {
    async fn set_group_role_rights(
        &mut self,
        group_id: i64,
        role_id: i64,
        rights: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn delete_voip_participants_by_role(
        &mut self,
        role_id: i64,
        group_id: i64,
    ) -> Result<Vec<i64>, DatabaseError>;

    async fn delete_messages_by_role(
        &mut self,
        role_id: i64,
        group_id: i64,
    ) -> Result<Vec<i64>, DatabaseError>;

    async fn delete_files_by_role(
        &mut self,
        role_id: i64,
        group_id: i64,
    ) -> Result<Vec<File>, DatabaseError>;

    async fn delete_files_by_user(
        &mut self,
        user_id: i64,
        group_id: i64,
    ) -> Result<Vec<File>, DatabaseError>;

    async fn delete_voip_participant_by_user(
        &mut self,
        user_id: i64,
        group_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn delete_messages_by_user(
        &mut self,
        user_id: i64,
        group_id: i64,
    ) -> Result<Vec<i64>, DatabaseError>;

    async fn set_user_role(
        &mut self,
        user_id: i64,
        new_role_id: i64,
    ) -> Result<Option<User>, DatabaseError>;
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

    async fn find_user_role(&self, user_id: i64) -> Result<Option<i64>, DatabaseError>;

    async fn find_group(&self, group_id: i64) -> Result<Group, DatabaseError>;

    async fn find_group_role_rights_by_group(
        &self,
        group_id: i64,
        role_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_channels_by_group(&self, group_id: i64) -> Result<Vec<Channel>, DatabaseError>;

    async fn find_voip_participants_by_group(
        &self,
        group_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError>;

    async fn find_rights_by_role(
        &self,
        role_id: i64,
    ) -> Result<Vec<GroupRoleRights>, DatabaseError>;
}

pub struct PgAclTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl AclTransaction for PgAclTransaction {
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

    async fn delete_voip_participants_by_role(
        &mut self,
        role_id: i64,
        group_id: i64,
    ) -> Result<Vec<i64>, DatabaseError> {
        let deleted = sqlx::query_scalar!(
            r#"DELETE FROM voip_participants
            USING users u, channels c
            WHERE voip_participants.user_id = u.user_id
            AND voip_participants.channel_id = c.channel_id
            AND u.role_id = $1
            AND c.group_id = $2
            RETURNING voip_participants.user_id"#,
            role_id,
            group_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(deleted)
    }

    async fn delete_messages_by_role(
        &mut self,
        role_id: i64,
        group_id: i64,
    ) -> Result<Vec<i64>, DatabaseError> {
        let deleted = sqlx::query_scalar!(
            r#"DELETE FROM messages
            USING users u, channels c
            WHERE messages.sender_id = u.user_id
            AND messages.channel_id = c.channel_id
            AND u.role_id = $1
            AND c.group_id = $2
            RETURNING messages.id"#,
            role_id,
            group_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(deleted)
    }

    async fn delete_files_by_role(
        &mut self,
        role_id: i64,
        group_id: i64,
    ) -> Result<Vec<File>, DatabaseError> {
        let files = sqlx::query_as!(
            File,
            r#"DELETE FROM files
               USING messages m, users u, channels c
               WHERE files.message_id = m.id
               AND m.sender_id = u.user_id
               AND m.channel_id = c.channel_id
               AND u.role_id = $1
               AND c.group_id = $2
               RETURNING files.file_id, files.file_uuid, files.message_id, files.file_name, files.file_type, files.file_size, files.file_hash, files.created_at"#,
            role_id,
            group_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;
        Ok(files)
    }

    async fn delete_files_by_user(
        &mut self,
        user_id: i64,
        group_id: i64,
    ) -> Result<Vec<File>, DatabaseError> {
        let files = sqlx::query_as!(
            File,
            r#"DELETE FROM files
               USING messages m, channels c
               WHERE files.message_id = m.id
               AND m.channel_id = c.channel_id
               AND m.sender_id = $1
               AND c.group_id = $2
               RETURNING files.file_id, files.file_uuid, files.message_id, files.file_name, files.file_type, files.file_size, files.file_hash, files.created_at"#,
            user_id,
            group_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;
        Ok(files)
    }

    async fn delete_voip_participant_by_user(
        &mut self,
        user_id: i64,
        group_id: i64,
    ) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"DELETE FROM voip_participants
               USING channels c
               WHERE voip_participants.channel_id = c.channel_id
               AND voip_participants.user_id = $1
               AND c.group_id = $2
               RETURNING voip_participants.user_id"#,
            user_id,
            group_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;
        Ok(result)
    }

    async fn delete_messages_by_user(
        &mut self,
        user_id: i64,
        group_id: i64,
    ) -> Result<Vec<i64>, DatabaseError> {
        let results = sqlx::query_scalar!(
            r#"DELETE FROM messages
               USING channels c
               WHERE messages.channel_id = c.channel_id
               AND messages.sender_id = $1
               AND c.group_id = $2
               RETURNING messages.id"#,
            user_id,
            group_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;
        Ok(results)
    }

    async fn set_user_role(
        &mut self,
        user_id: i64,
        new_role_id: i64,
    ) -> Result<Option<User>, DatabaseError> {
        use crate::user::UserStatusType;

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
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE(manual_status, status) END as "status!: UserStatusType",
                   server_mute,
                   server_deafen"#,
            new_role_id,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
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

    async fn find_group_role_rights_by_group(
        &self,
        group_id: i64,
        role_id: i64,
    ) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT rights FROM group_role_rights
            WHERE group_id = $1 AND role_id = $2"#,
            group_id,
            role_id
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

    async fn find_group(&self, group_id: i64) -> Result<Group, DatabaseError> {
        let result = sqlx::query_as!(
            Group,
            "SELECT group_id, group_name FROM groups WHERE group_id = $1",
            group_id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(result)
    }

    async fn find_channels_by_group(&self, group_id: i64) -> Result<Vec<Channel>, DatabaseError> {
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
        .fetch_all(&self.pool)
        .await?;
        Ok(results)
    }

    async fn find_voip_participants_by_group(
        &self,
        group_id: i64,
    ) -> Result<Vec<VoipParticipant>, DatabaseError> {
        let results = sqlx::query_as!(
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
        .fetch_all(&self.pool)
        .await?;
        Ok(results)
    }

    async fn find_rights_by_role(
        &self,
        role_id: i64,
    ) -> Result<Vec<GroupRoleRights>, DatabaseError> {
        let results = sqlx::query_as!(
            GroupRoleRights,
            r#"SELECT group_id, role_id, rights
               FROM group_role_rights
               WHERE role_id = $1"#,
            role_id
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
pub struct AclService<R: AclRepository, N: NotifierManager, G: LogManager, F: FileManager> {
    repository: R,
    notifier: N,
    logger: G,
    file_manager: F,
}

impl<R: AclRepository, N: NotifierManager, G: LogManager, F: FileManager> AclService<R, N, G, F> {
    pub fn new(repository: R, notifier: N, logger: G, file_manager: F) -> Self {
        Self {
            repository,
            notifier,
            logger,
            file_manager,
        }
    }

    pub fn validate_permission_assignment(
        assigner_role: i64,
        assigner_rights: i64,
        target_role: i64,
        new_rights: i64,
        previous_rights: i64,
    ) -> Result<(), DomainError> {
        if new_rights < 0 || new_rights > 8 {
            return Err(DomainError::BadRequest(format!(
                "Invalid rights value: {} (must be 0-8)",
                new_rights
            )));
        }

        if (target_role == OWNER_ROLE_ID || target_role == ADMIN_ROLE_ID) && new_rights != 8 {
            return Err(DomainError::PermissionDenied(
                "Cannot change owner/admin rights".to_string(),
            ));
        }

        if assigner_role == OWNER_ROLE_ID || assigner_role == ADMIN_ROLE_ID {
            return Ok(());
        }

        let acl_changing = (previous_rights >= 8) != (new_rights >= 8);
        if acl_changing {
            return Err(DomainError::PermissionDenied(
                "Only owner or admin can grant/remove ACL rights".to_string(),
            ));
        }

        if assigner_rights < 8 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to update ACL".to_string(),
            ));
        }

        Ok(())
    }

    pub async fn get_all_accessible_group_role_rights(
        &self,
        user_id: i64,
    ) -> Result<Vec<GroupRoleRights>, DomainError> {
        let rights = self.repository.find_group_role_rights(user_id).await?;

        Ok(rights)
    }

    pub async fn set_group_role_rights(
        &self,
        acls: Vec<GroupRoleRights>,
        user_id: i64,
        session_id: i64,
    ) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let assigner_role = self
            .repository
            .find_user_role(user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        for acl in acls {
            let assigner_rights = self
                .repository
                .find_group_role_rights_by_group(acl.group_id, assigner_role)
                .await?
                .ok_or(DomainError::PermissionDenied(
                    "No access to group".to_string(),
                ))?;

            let mut previous_rights = self
                .repository
                .find_group_role_rights_by_group(acl.group_id, acl.role_id)
                .await?
                .unwrap_or(0);

            Self::validate_permission_assignment(
                assigner_role,
                assigner_rights,
                acl.role_id,
                acl.rights,
                previous_rights,
            )?;

            previous_rights = tx
                .set_group_role_rights(acl.group_id, acl.role_id, acl.rights)
                .await
                .map_err(|e| match e {
                    DatabaseError::ForeignKeyViolation { column, .. } if column == "group_id" => {
                        DomainError::BadRequest(format!("Group {} not found", acl.group_id))
                    }
                    DatabaseError::ForeignKeyViolation { column, .. } if column == "role_id" => {
                        DomainError::BadRequest(format!("Role {} not found", acl.role_id))
                    }
                    other => DomainError::InternalError(other),
                })?
                .unwrap_or(0);

            let event = EventPayload::GroupRoleRightUpdated {
                right: GroupRoleRights {
                    group_id: acl.group_id,
                    role_id: acl.role_id,
                    rights: acl.rights,
                },
            };
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event,
                    ControlRoutingPolicy::GroupRights {
                        group_id: acl.group_id,
                        minimun_rights: 1,
                    },
                ))
                .await;

            if previous_rights > 0 && acl.rights == 0 {
                let deleted_participants = tx
                    .delete_voip_participants_by_role(acl.role_id, acl.group_id)
                    .await?;
                let deleted_files = tx.delete_files_by_role(acl.role_id, acl.group_id).await?;
                let deleted_messages = tx
                    .delete_messages_by_role(acl.role_id, acl.group_id)
                    .await?;

                for file in &deleted_files {
                    self.file_manager.delete_file(file.file_id)?;
                }

                let routing = ControlRoutingPolicy::GroupRights {
                    group_id: acl.group_id,
                    minimun_rights: 1,
                };

                for user_id in deleted_participants {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::VoipParticipantDeleted { user_id },
                            routing.clone(),
                        ))
                        .await;
                }

                for message_id in deleted_messages {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::MessageDeleted { message_id },
                            routing.clone(),
                        ))
                        .await;
                }

                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        EventPayload::GroupDeleted {
                            group_id: acl.group_id,
                        },
                        ControlRoutingPolicy::Role {
                            role_id: acl.role_id,
                        },
                    ))
                    .await;
            }

            if previous_rights == 0 && acl.rights > 0 {
                let group = self.repository.find_group(acl.group_id).await?;
                let channels = self.repository.find_channels_by_group(acl.group_id).await?;
                let voip_participants = self
                    .repository
                    .find_voip_participants_by_group(acl.group_id)
                    .await?;
                let routing = ControlRoutingPolicy::Role {
                    role_id: acl.role_id,
                };

                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        EventPayload::GroupCreated {
                            group: Group {
                                group_id: acl.group_id,
                                group_name: group.group_name,
                            },
                        },
                        routing.clone(),
                    ))
                    .await;

                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        EventPayload::GroupRoleRightUpdated {
                            right: GroupRoleRights {
                                group_id: acl.group_id,
                                role_id: acl.role_id,
                                rights: acl.rights,
                            },
                        },
                        routing.clone(),
                    ))
                    .await;

                for channel in channels {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::ChannelCreated { channel },
                            routing.clone(),
                        ))
                        .await;
                }

                for participant in voip_participants {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::VoipParticipantCreated { user: participant },
                            routing.clone(),
                        ))
                        .await;
                }
            }
        }

        self.repository.commit(tx).await?;

        let _ = self.notifier.notify(ServerMessage::InvalidateAcl).await;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Group role rights updated: user_id={}, session_id={}",
                    user_id, session_id
                ),
                "acl".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn update_user_role(
        &self,
        target_user_id: i64,
        new_role_id: i64,
        requester_user_id: i64,
        session_id: i64,
    ) -> Result<User, DomainError> {
        let requester_role = self
            .repository
            .find_user_role(requester_user_id)
            .await?
            .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;

        let target_role = self
            .repository
            .find_user_role(target_user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                target_user_id
            )))?;

        if requester_role > ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to update user role".to_string(),
            ));
        }

        if target_role == OWNER_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Cannot modify owner's role".to_string(),
            ));
        }

        if new_role_id == OWNER_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "There is only one owner".to_string(),
            ));
        }

        if requester_role != OWNER_ROLE_ID
            && (new_role_id == ADMIN_ROLE_ID || target_role == ADMIN_ROLE_ID)
        {
            return Err(DomainError::PermissionDenied(
                "Only owner can manage admin roles".to_string(),
            ));
        }

        let mut tx = self.repository.begin().await?;

        let updated_user =
            tx.set_user_role(target_user_id, new_role_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "User {} not found",
                    target_user_id
                )))?;

        let old_rights = self.repository.find_rights_by_role(target_role).await?;
        let new_rights = self.repository.find_rights_by_role(new_role_id).await?;

        for old in &old_rights {
            let new = new_rights.iter().find(|r| r.group_id == old.group_id);
            let new_right = new.map(|r| r.rights).unwrap_or(0);

            if old.rights > 0 && new_right == 0 {
                let deleted_participant = tx
                    .delete_voip_participant_by_user(target_user_id, old.group_id)
                    .await?;
                let deleted_files = tx
                    .delete_files_by_user(target_user_id, old.group_id)
                    .await?;
                let deleted_messages = tx
                    .delete_messages_by_user(target_user_id, old.group_id)
                    .await?;

                for file in &deleted_files {
                    self.file_manager.delete_file(file.file_id)?;
                }

                let routing = ControlRoutingPolicy::GroupRights {
                    group_id: old.group_id,
                    minimun_rights: 1,
                };

                if deleted_participant.is_some() {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::VoipParticipantDeleted {
                                user_id: target_user_id,
                            },
                            routing.clone(),
                        ))
                        .await;
                }

                for message_id in deleted_messages {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::MessageDeleted { message_id },
                            routing.clone(),
                        ))
                        .await;
                }

                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        EventPayload::GroupDeleted {
                            group_id: old.group_id,
                        },
                        ControlRoutingPolicy::User {
                            user_id: target_user_id,
                        },
                    ))
                    .await;
            }
        }

        for new in &new_rights {
            let old = old_rights.iter().find(|r| r.group_id == new.group_id);
            let old_right = old.map(|r| r.rights).unwrap_or(0);

            if old_right == 0 && new.rights > 0 {
                let group = self.repository.find_group(new.group_id).await?;
                let channels = self.repository.find_channels_by_group(new.group_id).await?;
                let voip_participants = self
                    .repository
                    .find_voip_participants_by_group(new.group_id)
                    .await?;
                let routing = ControlRoutingPolicy::User {
                    user_id: target_user_id,
                };

                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        EventPayload::GroupCreated { group },
                        routing.clone(),
                    ))
                    .await;

                let _ = self
                    .notifier
                    .notify(ServerMessage::Control(
                        EventPayload::GroupRoleRightUpdated { right: new.clone() },
                        routing.clone(),
                    ))
                    .await;

                for channel in channels {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::ChannelCreated { channel },
                            routing.clone(),
                        ))
                        .await;
                }

                for participant in voip_participants {
                    let _ = self
                        .notifier
                        .notify(ServerMessage::Control(
                            EventPayload::VoipParticipantCreated { user: participant },
                            routing.clone(),
                        ))
                        .await;
                }
            }
        }

        self.repository.commit(tx).await?;

        let _ = self.notifier.notify(ServerMessage::InvalidateAcl).await;

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                EventPayload::UserUpdated {
                    user: updated_user.clone(),
                },
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "User role updated: user_id={}, session_id={}, target_user_id={}, new_role_id={}",
                    requester_user_id, session_id, target_user_id, new_role_id
                ),
                "acl".to_string(),
            )
            .await;

        Ok(updated_user)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetGroupRoleRightsRequest {
    pub group_id: i64,
    pub role_id: i64,
    pub rights: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRoleRequest {
    pub role_id: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

pub fn acl_routes(
    acl_service: AclService<Postgre, DefaultNotifierManager, TextLogManager, LocalFileManager>,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(get_all_group_role_rights_handler))
        .routes(routes!(set_group_role_rights_handler))
        .routes(routes!(update_user_role_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(acl_service)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

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
async fn get_all_group_role_rights_handler(
    State(service): State<
        AclService<Postgre, DefaultNotifierManager, TextLogManager, LocalFileManager>,
    >,
    Extension(session): Extension<Session>,
) -> Result<Json<Vec<GroupRoleRights>>, ApiError> {
    let user_id = session.user_id;
    let rights = service
        .get_all_accessible_group_role_rights(user_id)
        .await
        .map_err(ApiError::from)?;
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
    State(service): State<
        AclService<Postgre, DefaultNotifierManager, TextLogManager, LocalFileManager>,
    >,
    Extension(session): Extension<Session>,
    Json(payload): Json<Vec<GroupRoleRights>>,
) -> Result<(), ApiError> {
    service
        .set_group_role_rights(payload, session.user_id, session.session_id)
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

#[utoipa::path(
    put,
    tag = "acl",
    path = "/user/{user_id}/role",
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
    State(service): State<
        AclService<Postgre, DefaultNotifierManager, TextLogManager, LocalFileManager>,
    >,
    Extension(session): Extension<Session>,
    Path(target_user_id): Path<i64>,
    Json(payload): Json<UpdateUserRoleRequest>,
) -> Result<Json<User>, ApiError> {
    let updated_user = service
        .update_user_role(
            target_user_id,
            payload.role_id,
            session.user_id,
            session.session_id,
        )
        .await
        .map_err(ApiError::from)?;
    Ok(Json(updated_user))
}

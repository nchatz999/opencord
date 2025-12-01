use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub sender_id: i64,
    pub channel_id: Option<i64>,
    pub recipient_id: Option<i64>,
    pub message_text: String,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::iso8601::option")]
    pub modified_at: Option<OffsetDateTime>,
    pub reply_to_message_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub file_id: i64,
    pub file_uuid: String,
    pub message_id: i64,
    pub file_name: String,
    pub file_type: String,
    pub file_size: i64,
    pub file_hash: String,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "PascalCase")]
#[serde(tag = "type")]
pub enum MessageType {
    Channel { channel_id: i64 },
    Direct { recipient_id: i64 },
}

use crate::{
    managers::{FileError, FileManager, FileTransaction, LocalFileManager},
    middleware::{AuthorizeService, authorize},
    webtransport::{ControlRoutingPolicy, ServerMessage},
};
use base64::{Engine as _, engine::general_purpose};
use uuid::Uuid;

use crate::error::DatabaseError;

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

pub trait MessageTransaction: Send + Sync {
    async fn create_channel_message(
        &mut self,
        sender_id: i64,
        channel_id: i64,
        message_text: Option<String>,
        reply_to_message_id: Option<i64>,
    ) -> Result<Message, DatabaseError>;

    async fn create_dm_message(
        &mut self,
        sender_id: i64,
        recipient_id: i64,
        message_text: Option<String>,
        reply_to_message_id: Option<i64>,
    ) -> Result<Message, DatabaseError>;

    async fn create_file(
        &mut self,
        message_id: i64,
        file_name: &str,
        file_size: i64,
        content_type: &str,
        file_hash: &str,
    ) -> Result<File, DatabaseError>;

    async fn delete_message_files(&mut self, message_id: i64) -> Result<Vec<File>, DatabaseError>;

    async fn edit_message(
        &mut self,
        message_id: i64,
        new_text: &str,
        user_id: i64,
    ) -> Result<Option<Message>, DatabaseError>;

    async fn delete_message(&mut self, message_id: i64) -> Result<Option<Message>, DatabaseError>;
}

pub trait MessageRepository: Send + Sync + Clone {
    type Transaction: MessageTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_channel_messages_with_pagination(
        &self,
        channel_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<Message>, DatabaseError>;

    async fn find_dm_messages_with_pagination(
        &self,
        user_id: i64,
        other_user_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<Message>, DatabaseError>;

    async fn find_file_by_id(&self, file_id: i64) -> Result<Option<FileAttachment>, DatabaseError>;

    async fn find_user_channel_rights(
        &mut self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError>;

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError>;

    async fn find_message_by_id(&self, message_id: i64) -> Result<Option<Message>, DatabaseError>;

    async fn find_channel_files(
        &self,
        channel_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<File>, DatabaseError>;

    async fn find_dm_files(
        &self,
        user_id: i64,
        other_user_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<File>, DatabaseError>;
}

use crate::auth::Session;
use crate::managers::{DefaultNotifierManager, LogManager, NotifierManager, TextLogManager};
use crate::model::EventPayload;
use tracing::{error, warn};

#[derive(Clone)]
pub struct MessageService<R: MessageRepository, F: FileManager + Clone + Send, N: NotifierManager, G: LogManager> {
    repository: R,
    file_manager: F,
    notifier: N,
    logger: G,
}

impl<R: MessageRepository, F: FileManager + Clone + Send, N: NotifierManager, G: LogManager>
    MessageService<R, F, N, G>
{
    pub fn new(repository: R, file_manager: F, notifier: N, logger: G) -> Self {
        Self {
            repository,
            file_manager,
            notifier,
            logger,
        }
    }

    pub async fn create_channel_message(
        &mut self,
        sender_id: i64,
        session_id: i64,
        channel_id: i64,
        message_text: Option<String>,
        reply_to_message_id: Option<i64>,
        files: Vec<NewFileAttachment>,
    ) -> Result<(Message, Vec<File>), DomainError> {
        let rights = self
            .repository
            .find_user_channel_rights(channel_id, sender_id)
            .await?
            .ok_or(DomainError::PermissionDenied(
                "No access to channel".to_string(),
            ))?;

        if rights < 4 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to send messages".to_string(),
            ));
        }

        let mut db_tx = self.repository.begin().await?;

        let message = db_tx
            .create_channel_message(
                sender_id,
                channel_id,
                message_text.clone(),
                reply_to_message_id,
            )
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "reply_to_message_id" => DomainError::BadRequest(format!(
                        "Reply message {} not found",
                        reply_to_message_id.unwrap_or(-1)
                    )),
                    "channel_id" => {
                        DomainError::BadRequest(format!("Channel {} not found", channel_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        let file_attachments = self.process_files(&mut db_tx, message.id, files).await?;

        self.repository.commit(db_tx).await?;

        let event = EventPayload::MessageCreated {
            message_id: message.id,
            sender_id: message.sender_id,
            message_type: MessageType::Channel { channel_id },
            message_text: message.message_text.clone(),
            reply_to_message_id: message.reply_to_message_id,
            timestamp: message.created_at,
            files: file_attachments.clone(),
        };

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

        let _ = self.logger.log_entry(
            format!("Channel message created: user_id={}, session_id={}, message_id={}, channel_id={}", sender_id, session_id, message.id, channel_id),
            "message".to_string(),
        ).await;

        Ok((message, file_attachments))
    }

    pub async fn create_dm_message(
        &mut self,
        sender_id: i64,
        session_id: i64,
        recipient_id: i64,
        message_text: Option<String>,
        reply_to_message_id: Option<i64>,
        files: Vec<NewFileAttachment>,
    ) -> Result<(Message, Vec<File>), DomainError> {
        let recipient_role = self.repository.find_user_role(recipient_id).await?;

        if recipient_role.is_none() {
            return Err(DomainError::BadRequest(format!(
                "Recipient {} not found",
                recipient_id
            )));
        }

        let mut db_tx = self.repository.begin().await?;

        let message = db_tx
            .create_dm_message(
                sender_id,
                recipient_id,
                message_text.clone(),
                reply_to_message_id,
            )
            .await
            .map_err(|e| match &e {
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "reply_to_message_id" => DomainError::BadRequest(format!(
                        "Reply message {} not found",
                        reply_to_message_id.unwrap_or(-1)
                    )),
                    "recipient_id" => {
                        DomainError::BadRequest(format!("Recipient {} not found", recipient_id))
                    }
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        let file_attachments = self.process_files(&mut db_tx, message.id, files).await?;

        self.repository.commit(db_tx).await?;

        let event = EventPayload::MessageCreated {
            message_id: message.id,
            sender_id: message.sender_id,
            message_type: MessageType::Direct { recipient_id },
            message_text: message.message_text.clone(),
            reply_to_message_id: message.reply_to_message_id,
            timestamp: message.created_at,
            files: file_attachments.clone(),
        };

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event.clone(),
                ControlRoutingPolicy::User { user_id: sender_id },
            ))
            .await;
        if sender_id != recipient_id {
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

        let _ = self.logger.log_entry(
            format!("DM message created: user_id={}, session_id={}, message_id={}, recipient_id={}", sender_id, session_id, message.id, recipient_id),
            "message".to_string(),
        ).await;

        Ok((message, file_attachments))
    }

    async fn process_files(
        &self,
        db_tx: &mut <R as MessageRepository>::Transaction,
        message_id: i64,
        files: Vec<NewFileAttachment>,
    ) -> Result<Vec<File>, DomainError> {
        let mut file_tx = self.file_manager.begin()?;
        let mut file_attachments = Vec::new();

        for f in &files {
            let file_data = general_purpose::STANDARD
                .decode(&f.data)
                .map_err(|_| DomainError::BadRequest("Invalid file data encoding".to_string()))?;

            let file_hash = format!("{:x}", Sha256::digest(&file_data));
            let file_size = file_data.len() as i64;

            let file_attachment = db_tx
                .create_file(
                    message_id,
                    &f.file_name,
                    file_size,
                    &f.content_type,
                    &file_hash,
                )
                .await?;

            file_tx.stage_upload(file_attachment.file_id, &file_data)?;

            file_attachments.push(file_attachment);
        }

        file_tx.commit()?;

        Ok(file_attachments)
    }

    pub async fn get_channel_messages(
        &self,
        user_id: i64,
        channel_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<Message>, DomainError> {
        let mut repo = self.repository.clone();
        let rights = repo
            .find_user_channel_rights(channel_id, user_id)
            .await?
            .ok_or(DomainError::PermissionDenied(
                "No access to channel".to_string(),
            ))?;

        if rights < 2 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to read messages".to_string(),
            ));
        }

        let result = self
            .repository
            .find_channel_messages_with_pagination(channel_id, timestamp, limit)
            .await?;

        Ok(result)
    }

    pub async fn get_dm_messages(
        &self,
        user_id: i64,
        other_user_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<Message>, DomainError> {
        let result = self
            .repository
            .find_dm_messages_with_pagination(user_id, other_user_id, timestamp, limit)
            .await?;

        Ok(result)
    }

    pub async fn get_channel_files(
        &self,
        user_id: i64,
        channel_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<File>, DomainError> {
        let mut repo = self.repository.clone();
        let rights = repo
            .find_user_channel_rights(channel_id, user_id)
            .await?
            .ok_or(DomainError::PermissionDenied(
                "No access to channel".to_string(),
            ))?;

        if rights < 2 {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to read files".to_string(),
            ));
        }

        let result = self
            .repository
            .find_channel_files(channel_id, timestamp, limit)
            .await?;

        Ok(result)
    }

    pub async fn get_dm_files(
        &self,
        user_id: i64,
        other_user_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<File>, DomainError> {
        let result = self
            .repository
            .find_dm_files(user_id, other_user_id, timestamp, limit)
            .await?;

        Ok(result)
    }

    pub async fn edit_message(
        &self,
        user_id: i64,
        session_id: i64,
        message_id: i64,
        new_text: String,
    ) -> Result<Message, DomainError> {
        let mut tx = self.repository.begin().await?;

        let message = tx
            .edit_message(message_id, &new_text, user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Message {} not found or not owned by user",
                message_id
            )))?;

        self.repository.commit(tx).await?;

        let event = EventPayload::MessageUpdated {
            message_id: message.id,
            message_text: new_text.clone(),
        };

        if let Some(channel_id) = message.channel_id {
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event.clone(),
                    ControlRoutingPolicy::ChannelRights {
                        channel_id,
                        minimun_rights: 2,
                    },
                ))
                .await;
        }
        if let Some(recipient_id) = message.recipient_id {
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event.clone(),
                    ControlRoutingPolicy::User { user_id },
                ))
                .await;
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

        let _ = self.logger.log_entry(
            format!("Message edited: user_id={}, session_id={}, message_id={}", user_id, session_id, message_id),
            "message".to_string(),
        ).await;

        Ok(message)
    }

    pub async fn delete_message(
        &self,
        user_id: i64,
        session_id: i64,
        message_id: i64,
    ) -> Result<Message, DomainError> {
        let mut tx = self.repository.begin().await?;

        let files = tx.delete_message_files(message_id).await?;

        let message = tx
            .delete_message(message_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Message {} not found",
                message_id
            )))?;

        if message.sender_id != user_id {
            if let Some(channel_id) = message.channel_id {
                let mut repo = self.repository.clone();
                let rights = repo
                    .find_user_channel_rights(channel_id, user_id)
                    .await?
                    .unwrap_or(0);

                if rights >= 8 {
                    let user_role = repo
                        .find_user_role(user_id)
                        .await?
                        .ok_or(DomainError::PermissionDenied("User not found".to_string()))?;
                    let sender_role = repo.find_user_role(message.sender_id).await?.ok_or(
                        DomainError::PermissionDenied("Sender not found".to_string()),
                    )?;

                    if sender_role < 2 && user_role != 1 {
                        return Err(DomainError::PermissionDenied(
                            "Cannot delete messages from higher role users".to_string(),
                        ));
                    }
                }
            }
        }

        self.repository.commit(tx).await?;

        for file in &files {
            if let Err(e) = self.file_manager.delete_file(file.file_id) {
                warn!("Failed to delete file {} from storage: {}", file.file_id, e);
            }
        }

        let event = EventPayload::MessageDeleted { message_id };

        if let Some(channel_id) = message.channel_id {
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event.clone(),
                    ControlRoutingPolicy::ChannelRights {
                        channel_id,
                        minimun_rights: 2,
                    },
                ))
                .await;
        }
        if let Some(recipient_id) = message.recipient_id {
            let _ = self
                .notifier
                .notify(ServerMessage::Control(
                    event.clone(),
                    ControlRoutingPolicy::User { user_id },
                ))
                .await;
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

        let _ = self.logger.log_entry(
            format!("Message deleted: user_id={}, session_id={}, message_id={}", user_id, session_id, message_id),
            "message".to_string(),
        ).await;

        Ok(message)
    }

    pub async fn get_file(
        &self,
        user_id: i64,
        file_id: i64,
    ) -> Result<(FileAttachment, Vec<u8>), DomainError> {
        let file =
            self.repository
                .find_file_by_id(file_id)
                .await?
                .ok_or(DomainError::BadRequest(format!(
                    "File {} not found",
                    file_id
                )))?;

        let message = self
            .repository
            .find_message_by_id(file.message_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Message {} not found",
                file.message_id
            )))?;

        if let Some(channel_id) = message.channel_id {
            let mut repo = self.repository.clone();
            let rights = repo
                .find_user_channel_rights(channel_id, user_id)
                .await?
                .ok_or(DomainError::PermissionDenied(
                    "No access to channel".to_string(),
                ))?;

            if rights < 2 {
                return Err(DomainError::PermissionDenied(
                    "Insufficient permissions to access files".to_string(),
                ));
            }
        } else if let Some(recipient_id) = message.recipient_id {
            if message.sender_id != user_id && recipient_id != user_id {
                return Err(DomainError::PermissionDenied(
                    "No access to this direct message".to_string(),
                ));
            }
        } else {
            return Err(DomainError::PermissionDenied(
                "Invalid message type".to_string(),
            ));
        }

        let raw_data = self.file_manager.get_file(file_id).map_err(|e| match e {
            FileError::NotFound(_) => {
                DomainError::BadRequest(format!("File {} not found", file_id))
            }
            _ => DomainError::FileManagerError(e),
        })?;

        Ok((file, raw_data))
    }
}

use crate::db::Postgre;
use sha2::{Digest, Sha256};

pub struct PgMessageTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl MessageTransaction for PgMessageTransaction {
    async fn create_channel_message(
        &mut self,
        sender_id: i64,
        channel_id: i64,
        message_text: Option<String>,
        reply_to_message_id: Option<i64>,
    ) -> Result<Message, DatabaseError> {
        let created_message = sqlx::query_as!(
            Message,
            r#"INSERT INTO messages (sender_id, channel_id, recipient_id, message_text, reply_to_message_id)
               VALUES ($1, $2, NULL, $3, $4)
               RETURNING id, sender_id, channel_id, recipient_id, message_text, created_at, modified_at, reply_to_message_id"#,
            sender_id,
            channel_id,
            message_text,
            reply_to_message_id
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(created_message)
    }

    async fn create_dm_message(
        &mut self,
        sender_id: i64,
        recipient_id: i64,
        message_text: Option<String>,
        reply_to_message_id: Option<i64>,
    ) -> Result<Message, DatabaseError> {
        let created_message = sqlx::query_as!(
            Message,
            r#"INSERT INTO messages (sender_id, channel_id, recipient_id, message_text, reply_to_message_id)
               VALUES ($1, NULL, $2, $3, $4)
               RETURNING id, sender_id, channel_id, recipient_id, message_text, created_at, modified_at, reply_to_message_id"#,
            sender_id,
            recipient_id,
            message_text,
            reply_to_message_id
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(created_message)
    }

    async fn edit_message(
        &mut self,
        message_id: i64,
        new_text: &str,
        user_id: i64,
    ) -> Result<Option<Message>, DatabaseError> {
        let result = sqlx::query_as!(
            Message,
            r#"UPDATE messages 
               SET message_text = $1, modified_at = CURRENT_TIMESTAMP
               WHERE id = $2 AND sender_id = $3
               RETURNING id, sender_id, channel_id, recipient_id, message_text, created_at, modified_at, reply_to_message_id"#,
            new_text,
            message_id,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn delete_message(&mut self, message_id: i64) -> Result<Option<Message>, DatabaseError> {
        let deleted_message = sqlx::query_as!(
            Message,
            r#"DELETE FROM messages
               WHERE id = $1
               RETURNING id, sender_id, channel_id, recipient_id, message_text, created_at, modified_at, reply_to_message_id"#,
            message_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(deleted_message)
    }

    async fn create_file(
        &mut self,
        message_id: i64,
        file_name: &str,
        file_size: i64,
        content_type: &str,
        file_hash: &str,
    ) -> Result<File, DatabaseError> {
        let file_uuid = Uuid::new_v4().to_string();

        let created_file = sqlx::query_as!(
            File,
            r#"INSERT INTO files (file_uuid, message_id, file_name, file_type, file_size, file_hash)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING file_id, file_uuid, message_id, file_name, file_type, file_size, file_hash, created_at"#,
            file_uuid,
            message_id,
            file_name,
            content_type,
            file_size,
            file_hash
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(created_file)
    }

    async fn delete_message_files(&mut self, message_id: i64) -> Result<Vec<File>, DatabaseError> {
        let deleted_files = sqlx::query_as!(
            File,
            r#"DELETE FROM files
               WHERE message_id = $1
               RETURNING file_id, file_uuid, message_id, file_name, file_type, file_size, file_hash, created_at"#,
            message_id
        )
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(deleted_files)
    }
}

impl MessageRepository for Postgre {
    type Transaction = PgMessageTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgMessageTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn find_channel_messages_with_pagination(
        &self,
        channel_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<Message>, DatabaseError> {
        let messages = sqlx::query_as!(
            Message,
            r#"SELECT
                id,
                sender_id,
                channel_id,
                recipient_id,
                message_text,
                created_at,
                modified_at,
                reply_to_message_id
            FROM messages
            WHERE channel_id = $1
            AND created_at < $2
            ORDER BY created_at DESC
            LIMIT $3"#,
            channel_id,
            timestamp,
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(messages)
    }

    async fn find_dm_messages_with_pagination(
        &self,
        user_id: i64,
        other_user_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<Message>, DatabaseError> {
        let messages = sqlx::query_as!(
            Message,
            r#"SELECT
                id,
                sender_id,
                channel_id,
                recipient_id,
                message_text,
                created_at,
                modified_at,
                reply_to_message_id
            FROM messages
            WHERE recipient_id IS NOT NULL
            AND created_at < $1
            AND (
                (sender_id = $2 AND recipient_id = $3)
                OR (sender_id = $3 AND recipient_id = $2)
            )
            ORDER BY created_at DESC
            LIMIT $4"#,
            timestamp,
            user_id,
            other_user_id,
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(messages)
    }

    async fn find_file_by_id(&self, file_id: i64) -> Result<Option<FileAttachment>, DatabaseError> {
        let result = sqlx::query_as!(
            FileAttachment,
            r#"SELECT f.file_id, f.file_uuid, f.message_id, f.file_name, f.file_type, f.file_size, f.file_hash, f.created_at
               FROM files f
               WHERE f.file_id = $1"#,
            file_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_user_channel_rights(
        &mut self,
        channel_id: i64,
        user_id: i64,
    ) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!(
            r#"SELECT grr.rights 
            FROM group_role_rights grr
            INNER JOIN channels c ON c.group_id = grr.group_id    
            INNER JOIN users u ON u.role_id = grr.role_id
            WHERE c.channel_id = $1 AND u.user_id = $2"#,
            channel_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(result)
    }

    async fn find_user_role(&mut self, user_id: i64) -> Result<Option<i64>, DatabaseError> {
        let result = sqlx::query_scalar!("SELECT role_id FROM users WHERE user_id = $1", user_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(result)
    }

    async fn find_message_by_id(&self, message_id: i64) -> Result<Option<Message>, DatabaseError> {
        let result = sqlx::query_as!(
            Message,
            r#"SELECT id, sender_id, channel_id, recipient_id, message_text, created_at, modified_at, reply_to_message_id
               FROM messages WHERE id = $1"#,
            message_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_channel_files(
        &self,
        channel_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<File>, DatabaseError> {
        let files = sqlx::query_as!(
            File,
            r#"WITH limited_messages AS (
                SELECT id as message_id
                FROM messages
                WHERE channel_id = $1
                AND created_at < $2
                ORDER BY created_at DESC
                LIMIT $3
            )
            SELECT
                f.file_id,
                f.file_uuid,
                f.message_id,
                f.file_name,
                f.file_type,
                f.file_size,
                f.file_hash,
                f.created_at
            FROM files f
            WHERE f.message_id IN (SELECT message_id FROM limited_messages)
            ORDER BY f.message_id, f.file_id"#,
            channel_id,
            timestamp,
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(files)
    }

    async fn find_dm_files(
        &self,
        user_id: i64,
        other_user_id: i64,
        timestamp: OffsetDateTime,
        limit: i64,
    ) -> Result<Vec<File>, DatabaseError> {
        let files = sqlx::query_as!(
            File,
            r#"WITH limited_messages AS (
                SELECT id as message_id
                FROM messages
                WHERE recipient_id IS NOT NULL
                AND created_at < $1
                AND (
                    (sender_id = $2 AND recipient_id = $3)
                    OR (sender_id = $3 AND recipient_id = $2)
                )
                ORDER BY created_at DESC
                LIMIT $4
            )
            SELECT
                f.file_id,
                f.file_uuid,
                f.message_id,
                f.file_name,
                f.file_type,
                f.file_size,
                f.file_hash,
                f.created_at
            FROM files f
            WHERE f.message_id IN (SELECT message_id FROM limited_messages)
            ORDER BY f.message_id, f.file_id"#,
            timestamp,
            user_id,
            other_user_id,
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(files)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileAttachment {
    pub file_id: i64,
    pub file_uuid: String,
    pub message_id: i64,
    pub file_name: String,
    pub file_type: String,
    pub file_size: i64,
    pub file_hash: String,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewFileAttachment {
    pub file_name: String,
    pub content_type: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMessageRequest {
    pub message_text: Option<String>,
    pub reply_to_message_id: Option<i64>,
    pub files: Vec<FileUpload>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileUpload {
    pub file_name: String,
    pub content_type: String,
    pub data: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EditMessageRequest {
    pub message_text: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MessageQuery {
    pub limit: Option<i64>,
    #[serde(with = "time::serde::iso8601")]
    pub timestamp: OffsetDateTime,
}

use crate::error::ApiError;
use axum::Json;
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};

type AppMessageService = MessageService<Postgre, LocalFileManager, DefaultNotifierManager, TextLogManager>;

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
    extract::{Extension, Path, Query, State},
    middleware::from_fn_with_state,
    response::IntoResponse,
};
use utoipa_axum::{router::OpenApiRouter, routes};

pub fn message_routes(
    message_service: AppMessageService,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    OpenApiRouter::new()
        .routes(routes!(create_channel_message_handler))
        .routes(routes!(create_dm_message_handler))
        .routes(routes!(get_channel_messages_handler))
        .routes(routes!(get_dm_messages_handler))
        .routes(routes!(get_channel_files_handler))
        .routes(routes!(get_dm_files_handler))
        .routes(routes!(edit_message_handler))
        .routes(routes!(delete_message_handler))
        .routes(routes!(get_file_handler))
        .layer(from_fn_with_state(authorize_service, authorize))
        .with_state(message_service)
}

#[utoipa::path(
    post,
    tag = "message",
    path = "/channel/{channel_id}/messages",
    params(
        ("channel_id", Path, description = "The ID of the channel to send message to"),
    ),
    request_body = CreateMessageRequest,
    responses(
        (status = 201, description = "Message created successfully"),
        (status = 400, description = "Bad request", body = ApiError),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 413, description = "File too large", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
#[axum::debug_handler]
async fn create_channel_message_handler(
    State(mut service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(channel_id): Path<i64>,
    Json(payload): Json<CreateMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let files: Vec<NewFileAttachment> = payload
        .files
        .into_iter()
        .map(|f| NewFileAttachment {
            file_name: f.file_name,
            content_type: f.content_type,
            data: f.data,
        })
        .collect();

    service
        .create_channel_message(
            session.user_id,
            session.session_id,
            channel_id,
            payload.message_text,
            payload.reply_to_message_id,
            files,
        )
        .await
        .map_err(ApiError::from)?;

    Ok(StatusCode::CREATED)
}

#[utoipa::path(
    post,
    tag = "message",
    path = "/dm/{user_id}/messages",
    params(
        ("user_id", Path, description = "The ID of the user to send DM to"),
    ),
    request_body = CreateMessageRequest,
    responses(
        (status = 201, description = "Message created successfully"),
        (status = 400, description = "Bad request", body = ApiError),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 413, description = "File too large", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
#[axum::debug_handler]
async fn create_dm_message_handler(
    State(mut service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(recipient_id): Path<i64>,
    Json(payload): Json<CreateMessageRequest>,
) -> Result<StatusCode, ApiError> {
    let files: Vec<NewFileAttachment> = payload
        .files
        .into_iter()
        .map(|f| NewFileAttachment {
            file_name: f.file_name,
            content_type: f.content_type,
            data: f.data,
        })
        .collect();

    service
        .create_dm_message(
            session.user_id,
            session.session_id,
            recipient_id,
            payload.message_text,
            payload.reply_to_message_id,
            files,
        )
        .await
        .map_err(ApiError::from)?;

    Ok(StatusCode::CREATED)
}

#[utoipa::path(
   get,
   tag = "message",
   path = "/channel/{channel_id}/messages",
   params(
       ("channel_id", Path, description = "The ID of the channel to get messages from"),
       ("limit", Query, description = "Number of messages to retrieve (default: 50)"),
       ("timestamp", Query, description = "Get messages before this timestamp")
   ),
   responses(
       (status = 200, description = "Successfully retrieved channel messages", body = Vec<Message>),
       (status = 403, description = "Permission denied", body = ApiError),
       (status = 500, description = "Internal Server Error", body = ApiError),
   ),
   security(
       ("api_key" = [])
   )
)]
#[axum::debug_handler]
async fn get_channel_messages_handler(
    State(service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(channel_id): Path<i64>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<Message>>, ApiError> {
    let user_id = session.user_id;
    let limit = query.limit.unwrap_or(50);

    let response = service
        .get_channel_messages(user_id, channel_id, query.timestamp, limit)
        .await
        .map_err(ApiError::from)?;

    Ok(Json(response))
}

#[utoipa::path(
   get,
   tag = "message",
   path = "/dm/{user_id}/messages",
   params(
       ("user_id", Path, description = "The ID of the user to get DM messages with"),
       ("limit", Query, description = "Number of messages to retrieve (default: 50)"),
       ("timestamp", Query, description = "Get messages before this timestamp")
   ),
   responses(
       (status = 200, description = "Successfully retrieved DM messages", body = Vec<Message>),
       (status = 403, description = "Permission denied", body = ApiError),
       (status = 500, description = "Internal Server Error", body = ApiError),
   ),
   security(
       ("api_key" = [])
   )
)]
#[axum::debug_handler]
async fn get_dm_messages_handler(
    State(service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(other_user_id): Path<i64>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<Message>>, ApiError> {
    let user_id = session.user_id;
    let limit = query.limit.unwrap_or(50);

    let response = service
        .get_dm_messages(user_id, other_user_id, query.timestamp, limit)
        .await
        .map_err(ApiError::from)?;

    Ok(Json(response))
}

#[utoipa::path(
    put,
    tag = "message",
    path = "/{message_id}",
    params(
        ("message_id", Path, description = "The ID of the message to edit"),
    ),
    request_body = EditMessageRequest,
    responses(
        (status = 204, description = "Message updated successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Message not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn edit_message_handler(
    State(service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(message_id): Path<i64>,
    Json(payload): Json<EditMessageRequest>,
) -> Result<StatusCode, ApiError> {
    service
        .edit_message(session.user_id, session.session_id, message_id, payload.message_text)
        .await
        .map_err(ApiError::from)?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    tag = "message",
    path = "/{message_id}",
    params(
        ("message_id", Path, description = "The ID of the message to delete"),
    ),
    responses(
        (status = 204, description = "Message deleted successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "Message not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn delete_message_handler(
    State(service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(message_id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    service
        .delete_message(session.user_id, session.session_id, message_id)
        .await
        .map_err(ApiError::from)?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    tag = "message",
    path = "/files/{file_id}",
    params(
        ("file_id", Path, description = "The ID of the file to download"),
    ),
    responses(
        (status = 200, description = "File content retrieved successfully"),
        (status = 403, description = "Permission denied", body = ApiError),
        (status = 404, description = "File not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(
        ("api_key" = [])
    )
)]
#[axum::debug_handler]
async fn get_file_handler(
    State(service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(file_id): Path<i64>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = session.user_id;
    let file = service
        .get_file(user_id, file_id)
        .await
        .map_err(ApiError::from)?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&file.0.file_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("inline; filename=\"{}\"", file.0.file_name))
            .unwrap_or_else(|_| HeaderValue::from_static("inline")),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );

    Ok((headers, file.1))
}

#[utoipa::path(
   get,
   tag = "message",
   path = "/channel/{channel_id}/files",
   params(
       ("channel_id", Path, description = "The ID of the channel to get files from"),
       ("limit", Query, description = "Number of messages to retrieve files from (default: 50)"),
       ("timestamp", Query, description = "Get files from messages before this timestamp")
   ),
   responses(
       (status = 200, description = "Successfully retrieved channel files", body = Vec<File>),
       (status = 403, description = "Permission denied", body = ApiError),
       (status = 500, description = "Internal Server Error", body = ApiError),
   ),
   security(
       ("api_key" = [])
   )
)]
#[axum::debug_handler]
async fn get_channel_files_handler(
    State(service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(channel_id): Path<i64>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<File>>, ApiError> {
    let user_id = session.user_id;
    let limit = query.limit.unwrap_or(50);

    let response = service
        .get_channel_files(user_id, channel_id, query.timestamp, limit)
        .await
        .map_err(ApiError::from)?;

    Ok(Json(response))
}

#[utoipa::path(
   get,
   tag = "message",
   path = "/dm/{user_id}/files",
   params(
       ("user_id", Path, description = "The ID of the user to get DM files with"),
       ("limit", Query, description = "Number of messages to retrieve files from (default: 50)"),
       ("timestamp", Query, description = "Get files from messages before this timestamp")
   ),
   responses(
       (status = 200, description = "Successfully retrieved DM files", body = Vec<File>),
       (status = 403, description = "Permission denied", body = ApiError),
       (status = 500, description = "Internal Server Error", body = ApiError),
   ),
   security(
       ("api_key" = [])
   )
)]
#[axum::debug_handler]
async fn get_dm_files_handler(
    State(service): State<AppMessageService>,
    Extension(session): Extension<Session>,
    Path(other_user_id): Path<i64>,
    Query(query): Query<MessageQuery>,
) -> Result<Json<Vec<File>>, ApiError> {
    let user_id = session.user_id;
    let limit = query.limit.unwrap_or(50);

    let response = service
        .get_dm_files(user_id, other_user_id, query.timestamp, limit)
        .await
        .map_err(ApiError::from)?;

    Ok(Json(response))
}

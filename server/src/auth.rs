// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::db::Postgre;
use crate::error::{ApiError, DatabaseError};
use crate::managers::{
    DefaultLockoutManager, DefaultNotifierManager, DefaultPasswordValidator, LockoutManager,
    LogManager, NotifierManager, PasswordValidator, TextLogManager,
};
use crate::middleware::{AuthorizeService, authorize};
use crate::model::EventPayload;
use crate::role::{ADMIN_ROLE_ID, OWNER_ROLE_ID};
use crate::user::{User, UserStatusType};
use crate::transport::{ControlRoutingPolicy, ServerMessage};

use bcrypt::{DEFAULT_COST, hash, verify};
use time::Duration;
use uuid::Uuid;

use axum::Json;
use axum::extract::{Extension, State};
use axum::middleware::from_fn_with_state;
use utoipa_axum::{router::OpenApiRouter, routes};

// ═══════════════════════════════════════════════════════════════════════════════
// MODELS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Auth {
    pub user_id: i64,
    pub password_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: i64,
    pub session_token: String,
    pub user_id: i64,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::iso8601::option")]
    pub expires_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub invite_id: i64,
    pub code: String,
    pub available_registrations: i32,
    pub role_id: i64,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
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

    #[error("Password hashing failed")]
    PasswordHashingError,

    #[error("Password verification failed")]
    PasswordVerificationError,
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
            DomainError::PasswordHashingError => {
                tracing::error!("Password hashing failed");
                ApiError::InternalServerError("Password processing error".to_string())
            }
            DomainError::PasswordVerificationError => {
                tracing::error!("Password verification failed");
                ApiError::InternalServerError("Password processing error".to_string())
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY
// ═══════════════════════════════════════════════════════════════════════════════

pub trait AuthTransaction: Send + Sync {
    async fn create_auth(
        &mut self,
        user_id: i64,
        password_hash: &str,
    ) -> Result<Auth, DatabaseError>;

    async fn create_session(
        &mut self,
        session_token: &str,
        user_id: i64,
        expires_at: Option<OffsetDateTime>,
    ) -> Result<Session, DatabaseError>;

    async fn create_user_with_role(
        &mut self,
        username: &str,
        role_id: i64,
    ) -> Result<User, DatabaseError>;

    async fn update_password(
        &mut self,
        user_id: i64,
        password_hash: &str,
    ) -> Result<Option<Auth>, DatabaseError>;

    async fn remove_user_session(
        &mut self,
        session_token: &str,
        user_id: i64,
    ) -> Result<Option<Session>, DatabaseError>;

    async fn create_invite(
        &mut self,
        code: &str,
        available_registrations: i32,
        role_id: i64,
    ) -> Result<Invite, DatabaseError>;

    async fn update_invite_registrations(
        &mut self,
        invite_id: i64,
        available_registrations: i32,
    ) -> Result<Option<Invite>, DatabaseError>;

    async fn delete_invite(&mut self, invite_id: i64) -> Result<Option<Invite>, DatabaseError>;
}

pub trait AuthRepository: Send + Sync + Clone {
    type Transaction: AuthTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_auth(&self, user_id: i64) -> Result<Option<Auth>, DatabaseError>;

    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError>;

    async fn find_user_by_username(&self, username: &str) -> Result<Option<User>, DatabaseError>;

    async fn find_all_invites(&self) -> Result<Vec<Invite>, DatabaseError>;

    async fn find_user(&self, user_id: i64) -> Result<Option<User>, DatabaseError>;

    async fn find_invite(&self, code: &str) -> Result<Option<Invite>, DatabaseError>;

    async fn find_sessions(&self, user_id: i64) -> Result<Vec<Session>, DatabaseError>;
}

pub struct PgAuthTransaction {
    transaction: sqlx::Transaction<'static, sqlx::Postgres>,
}

impl AuthTransaction for PgAuthTransaction {
    async fn create_auth(
        &mut self,
        user_id: i64,
        password_hash: &str,
    ) -> Result<Auth, DatabaseError> {
        let result = sqlx::query_as!(
            Auth,
            r#"INSERT INTO auth (user_id, password_hash)
               VALUES ($1, $2)
               RETURNING
                   user_id,
                   password_hash"#,
            user_id,
            password_hash
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn create_session(
        &mut self,
        session_token: &str,
        user_id: i64,
        expires_at: Option<OffsetDateTime>,
    ) -> Result<Session, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"INSERT INTO sessions (session_token, user_id, expires_at)
               VALUES ($1, $2, $3)
               RETURNING
                   session_id,
                   session_token,
                   user_id,
                   created_at,
                   expires_at"#,
            session_token,
            user_id,
            expires_at
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn create_user_with_role(
        &mut self,
        username: &str,
        role_id: i64,
    ) -> Result<User, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"INSERT INTO users (username, avatar_file_id, role_id)
               VALUES ($1, NULL, $2)
               RETURNING
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE(manual_status, status) END as "status!: UserStatusType",
                   server_deafen,
                   server_mute"#,
            username,
            role_id
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn update_password(
        &mut self,
        user_id: i64,
        password_hash: &str,
    ) -> Result<Option<Auth>, DatabaseError> {
        let result = sqlx::query_as!(
            Auth,
            r#"UPDATE auth
               SET password_hash = $1
               WHERE user_id = $2
               RETURNING
                   user_id,
                   password_hash"#,
            password_hash,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn remove_user_session(
        &mut self,
        session_token: &str,
        user_id: i64,
    ) -> Result<Option<Session>, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"DELETE FROM sessions
               WHERE session_token = $1 AND user_id = $2
               RETURNING
                   session_id,
                   session_token,
                   user_id,
                   created_at,
                   expires_at"#,
            session_token,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn create_invite(
        &mut self,
        code: &str,
        available_registrations: i32,
        role_id: i64,
    ) -> Result<Invite, DatabaseError> {
        let result = sqlx::query_as!(
            Invite,
            r#"INSERT INTO invites (code, available_registrations, role_id)
               VALUES ($1, $2, $3)
               RETURNING
                   invite_id,
                   code,
                   available_registrations,
                   role_id,
                   created_at"#,
            code,
            available_registrations,
            role_id
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn update_invite_registrations(
        &mut self,
        invite_id: i64,
        available_registrations: i32,
    ) -> Result<Option<Invite>, DatabaseError> {
        let result = sqlx::query_as!(
            Invite,
            r#"UPDATE invites
               SET available_registrations = $1
               WHERE invite_id = $2
               RETURNING
                   invite_id,
                   code,
                   available_registrations,
                   role_id,
                   created_at"#,
            available_registrations,
            invite_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn delete_invite(&mut self, invite_id: i64) -> Result<Option<Invite>, DatabaseError> {
        let result = sqlx::query_as!(
            Invite,
            r#"DELETE FROM invites
               WHERE invite_id = $1
               RETURNING
                   invite_id,
                   code,
                   available_registrations,
                   role_id,
                   created_at"#,
            invite_id
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }
}

impl AuthRepository for Postgre {
    type Transaction = PgAuthTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError> {
        let tx = self.pool.begin().await?;
        Ok(PgAuthTransaction { transaction: tx })
    }

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.commit().await?;
        Ok(())
    }

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError> {
        transaction.transaction.rollback().await?;
        Ok(())
    }

    async fn find_auth(&self, user_id: i64) -> Result<Option<Auth>, DatabaseError> {
        let result = sqlx::query_as!(
            Auth,
            r#"SELECT
                   user_id,
                   password_hash
               FROM auth
               WHERE user_id = $1"#,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"SELECT
                   session_id,
                   session_token,
                   user_id,
                   created_at,
                   expires_at
               FROM sessions
               WHERE session_token = $1"#,
            session_token
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_user_by_username(&self, username: &str) -> Result<Option<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"SELECT
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE(manual_status, status) END as "status!: UserStatusType",
                   server_deafen,
                   server_mute
               FROM users
               WHERE username = $1"#,
            username
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_all_invites(&self) -> Result<Vec<Invite>, DatabaseError> {
        let result = sqlx::query_as!(
            Invite,
            r#"SELECT
                   invite_id,
                   code,
                   available_registrations,
                   role_id,
                   created_at
               FROM invites
               ORDER BY created_at DESC"#
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_user(&self, user_id: i64) -> Result<Option<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"SELECT
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   CASE WHEN status = 'Offline' THEN status ELSE COALESCE(manual_status, status) END as "status!: UserStatusType",
                   server_deafen,
                   server_mute
               FROM users
               WHERE user_id = $1"#,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_invite(&self, code: &str) -> Result<Option<Invite>, DatabaseError> {
        let result = sqlx::query_as!(
            Invite,
            r#"SELECT
                   invite_id,
                   code,
                   available_registrations,
                   role_id,
                   created_at
               FROM invites
               WHERE code = $1"#,
            code
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result)
    }

    async fn find_sessions(&self, user_id: i64) -> Result<Vec<Session>, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"SELECT
                   session_id,
                   session_token,
                   user_id,
                   created_at,
                   expires_at
               FROM sessions
               WHERE user_id = $1
               ORDER BY created_at DESC"#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(result)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct AuthService<
    R: AuthRepository,
    L: LockoutManager,
    P: PasswordValidator,
    N: NotifierManager,
    G: LogManager,
> {
    repository: R,
    lockout_manager: L,
    password_validator: P,
    notifier: N,
    logger: G,
}

impl<R: AuthRepository, L: LockoutManager, P: PasswordValidator, N: NotifierManager, G: LogManager>
    AuthService<R, L, P, N, G>
{
    pub fn new(
        repository: R,
        lockout_manager: L,
        password_validator: P,
        notifier: N,
        logger: G,
    ) -> Self {
        Self {
            repository,
            lockout_manager,
            password_validator,
            notifier,
            logger,
        }
    }

    pub async fn register_user(
        &mut self,
        username: &str,
        password: &str,
        invite_code: &str,
    ) -> Result<User, DomainError> {
        self.password_validator
            .validate_password(password)
            .map_err(|e| DomainError::BadRequest(format!("Password validation failed: {}", e)))?;

        let password_hash =
            hash(password, DEFAULT_COST).map_err(|_| DomainError::PasswordHashingError)?;

        let mut tx = self.repository.begin().await?;

        let invite = self
            .repository
            .find_invite(invite_code)
            .await?
            .ok_or(DomainError::BadRequest("Invalid invite code".to_string()))?;

        if invite.available_registrations <= 0 {
            return Err(DomainError::BadRequest(
                "Invite code has no remaining registrations".to_string(),
            ));
        }

        let user = tx
            .create_user_with_role(username, invite.role_id)
            .await
            .map_err(|e| match e {
                DatabaseError::UniqueConstraintViolation { .. } => {
                    DomainError::BadRequest(format!("Username {} already exists", username))
                }
                e => DomainError::InternalError(e),
            })?;

        tx.create_auth(user.user_id, &password_hash).await?;

        tx.update_invite_registrations(invite.invite_id, invite.available_registrations - 1)
            .await?;

        self.repository.commit(tx).await?;

        let event = EventPayload::UserCreated { user: user.clone() };

        let _ = self
            .notifier
            .notify(ServerMessage::Control(
                event,
                ControlRoutingPolicy::Broadcast,
            ))
            .await;

        let _ = self.notifier.notify(ServerMessage::InvalidateUsers).await;

        let _ = self
            .logger
            .log_entry(
                format!("User registered: user_id={}", user.user_id),
                "auth".to_string(),
            )
            .await;

        Ok(user)
    }

    pub async fn login(&mut self, username: &str, password: &str) -> Result<Session, DomainError> {
        if let Some(remaining_seconds) = self.lockout_manager.is_locked_out(username) {
            return Err(DomainError::BadRequest(format!(
                "Account locked for {} seconds",
                remaining_seconds
            )));
        }

        let mut tx = self.repository.begin().await?;

        let user = self
            .repository
            .find_user_by_username(username)
            .await?
            .ok_or_else(|| {
                self.lockout_manager.record_failed_attempt(username);
                DomainError::BadRequest("Invalid credentials".to_string())
            })?;

        let auth = self
            .repository
            .find_auth(user.user_id)
            .await?
            .ok_or(DomainError::BadRequest("Invalid credentials".to_string()))?;

        if !verify(password, &auth.password_hash)
            .map_err(|_| DomainError::PasswordVerificationError)?
        {
            self.lockout_manager.record_failed_attempt(username);
            return Err(DomainError::BadRequest("Invalid credentials".to_string()));
        }

        self.lockout_manager.record_successful_login(username);

        let session_token = Uuid::new_v4().to_string();
        let expires_at = Some(OffsetDateTime::now_utc() + Duration::days(30));

        let session = tx
            .create_session(&session_token, auth.user_id, expires_at)
            .await?;

        self.repository.commit(tx).await?;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "User logged in: user_id={}, session_id={}",
                    session.user_id, session.session_id
                ),
                "auth".to_string(),
            )
            .await;

        Ok(session)
    }

    pub async fn change_password(
        &mut self,
        user_id: i64,
        session_id: i64,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), DomainError> {
        self.password_validator
            .validate_password(new_password)
            .map_err(|e| DomainError::BadRequest(format!("Password validation failed: {}", e)))?;

        let mut tx = self.repository.begin().await?;

        let auth = self
            .repository
            .find_auth(user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                user_id
            )))?;

        if !verify(current_password, &auth.password_hash)
            .map_err(|_| DomainError::PasswordVerificationError)?
        {
            return Err(DomainError::BadRequest(
                "Invalid current password".to_string(),
            ));
        }

        let new_password_hash =
            hash(new_password, DEFAULT_COST).map_err(|_| DomainError::PasswordHashingError)?;

        tx.update_password(user_id, &new_password_hash)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                user_id
            )))?;

        self.repository.commit(tx).await?;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Password changed: user_id={}, session_id={}",
                    user_id, session_id
                ),
                "auth".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn logout(&self, user_id: i64, session_token: &str) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let session = tx
            .remove_user_session(session_token, user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Session {} not found",
                session_token
            )))?;

        let _ = self
            .notifier
            .notify(ServerMessage::Command(
                crate::transport::CommandPayload::Disconnect(user_id, session_token.to_string()),
            ))
            .await;

        self.repository.commit(tx).await?;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "User logged out: user_id={}, session_id={}",
                    user_id, session.session_id
                ),
                "auth".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn get_user_sessions(&mut self, user_id: i64) -> Result<Vec<Session>, DomainError> {
        let sessions = self.repository.find_sessions(user_id).await?;
        Ok(sessions)
    }

    pub async fn create_invite(
        &mut self,
        user_id: i64,
        session_id: i64,
        code: &str,
        available_registrations: i32,
        role_id: i64,
    ) -> Result<Invite, DomainError> {
        let mut tx = self.repository.begin().await?;

        let user = self
            .repository
            .find_user(user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                user_id
            )))?;

        if user.role_id != OWNER_ROLE_ID && user.role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to create invite".to_string(),
            ));
        }

        if role_id == OWNER_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "You can't create invite for Owner role".to_string(),
            ));
        }

        let invite = tx
            .create_invite(code, available_registrations, role_id)
            .await
            .map_err(|e| match &e {
                DatabaseError::UniqueConstraintViolation { .. } => {
                    DomainError::BadRequest("Invite code already exists".to_string())
                }
                DatabaseError::ForeignKeyViolation { column } => match column.as_str() {
                    "role_id" => DomainError::BadRequest(format!("Role {} not found", role_id)),
                    _ => DomainError::InternalError(e),
                },
                _ => DomainError::InternalError(e),
            })?;

        self.repository.commit(tx).await?;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Invite created: user_id={}, session_id={}, invite_id={}, role_id={}",
                    user_id, session_id, invite.invite_id, role_id
                ),
                "auth".to_string(),
            )
            .await;

        Ok(invite)
    }

    pub async fn delete_invite(
        &mut self,
        user_id: i64,
        session_id: i64,
        invite_id: i64,
    ) -> Result<(), DomainError> {
        let mut tx = self.repository.begin().await?;

        let user = self
            .repository
            .find_user(user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                user_id
            )))?;

        if user.role_id != OWNER_ROLE_ID && user.role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to delete invite".to_string(),
            ));
        }

        tx.delete_invite(invite_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "Invite {} not found",
                invite_id
            )))?;

        self.repository.commit(tx).await?;

        let _ = self
            .logger
            .log_entry(
                format!(
                    "Invite deleted: user_id={}, session_id={}, invite_id={}",
                    user_id, session_id, invite_id
                ),
                "auth".to_string(),
            )
            .await;

        Ok(())
    }

    pub async fn get_all_invites(&mut self, user_id: i64) -> Result<Vec<Invite>, DomainError> {
        let user = self
            .repository
            .find_user(user_id)
            .await?
            .ok_or(DomainError::BadRequest(format!(
                "User {} not found",
                user_id
            )))?;

        if user.role_id != OWNER_ROLE_ID && user.role_id != ADMIN_ROLE_ID {
            return Err(DomainError::PermissionDenied(
                "Insufficient permissions to view invites".to_string(),
            ));
        }

        let invites = self.repository.find_all_invites().await?;

        Ok(invites)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub invite_code: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct RegisterResponse {
    pub user: User,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LoginResponse {
    pub session_token: String,
    #[serde(with = "time::serde::iso8601::option")]
    pub expires_at: Option<OffsetDateTime>,
    pub user_id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct LogoutRequest {
    pub session_token: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateInviteRequest {
    pub code: String,
    pub available_registrations: i32,
    pub role_id: i64,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct DeleteInviteRequest {
    pub invite_id: i64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

pub fn auth_routes(
    auth_service: AuthService<
        Postgre,
        DefaultLockoutManager,
        DefaultPasswordValidator,
        DefaultNotifierManager,
        TextLogManager,
    >,
    authorize_service: AuthorizeService<Postgre>,
) -> OpenApiRouter<Postgre> {
    let public_routes = OpenApiRouter::new()
        .routes(routes!(register_handler))
        .routes(routes!(login_handler));

    let protected_routes = OpenApiRouter::new()
        .routes(routes!(change_password_handler))
        .routes(routes!(logout_handler))
        .routes(routes!(get_sessions_handler))
        .routes(routes!(create_invite_handler))
        .routes(routes!(delete_invite_handler))
        .routes(routes!(get_invites_handler))
        .layer(from_fn_with_state(authorize_service, authorize));

    public_routes
        .merge(protected_routes)
        .with_state(auth_service)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

#[utoipa::path(
    post,
    tag = "auth",
    path = "/register",
    description = "Register new user",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "Created", body = RegisterResponse),
        (status = 422, body = ApiError),
        (status = 500, body = ApiError),
    )
)]
async fn register_handler(
    State(mut service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, ApiError> {
    let user = service
        .register_user(&payload.username, &payload.password, &payload.invite_code)
        .await
        .map_err(ApiError::from)?;

    let response = RegisterResponse { user };

    Ok(Json(response))
}

#[utoipa::path(
    post,
    tag = "auth",
    path = "/login",
    description = "Login user",
    request_body = LoginRequest,
    responses(
        (status = 200, body = LoginResponse),
        (status = 422, body = ApiError),
        (status = 500, body = ApiError),
    )
)]
async fn login_handler(
    State(mut service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let session = service
        .login(&payload.username, &payload.password)
        .await
        .map_err(ApiError::from)?;

    let response = LoginResponse {
        session_token: session.session_token,
        expires_at: session.expires_at,
        user_id: session.user_id,
    };

    Ok(Json(response))
}

#[utoipa::path(
    put,
    tag = "auth",
    path = "/password",
    description = "Change password",
    request_body = ChangePasswordRequest,
    responses(
        (status = 204, description = "Updated"),
        (status = 422, body = ApiError),
        (status = 500, body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn change_password_handler(
    State(mut service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Extension(session): Extension<Session>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<(), ApiError> {
    service
        .change_password(
            session.user_id,
            session.session_id,
            &payload.current_password,
            &payload.new_password,
        )
        .await
        .map_err(ApiError::from)?;

    Ok(())
}

#[utoipa::path(
    post,
    tag = "auth",
    path = "/logout",
    description = "Logout user",
    request_body = LogoutRequest,
    responses(
        (status = 204, description = "Logged out"),
        (status = 422, body = ApiError),
        (status = 500, body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn logout_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Extension(session): Extension<Session>,
    Json(payload): Json<LogoutRequest>,
) -> Result<(), ApiError> {
    service
        .logout(session.user_id, &payload.session_token)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    get,
    tag = "auth",
    path = "/sessions",
    description = "Get user sessions",
    responses(
        (status = 200, body = Vec<Session>),
        (status = 500, body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_sessions_handler(
    State(mut service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Extension(session): Extension<Session>,
) -> Result<Json<Vec<Session>>, ApiError> {
    let sessions = service
        .get_user_sessions(session.user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(sessions))
}

#[utoipa::path(
    post,
    tag = "auth",
    path = "/invites",
    description = "Create invite",
    request_body = CreateInviteRequest,
    responses(
        (status = 201, description = "Created", body = Invite),
        (status = 422, body = ApiError),
        (status = 500, body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn create_invite_handler(
    State(mut service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Extension(session): Extension<Session>,
    Json(payload): Json<CreateInviteRequest>,
) -> Result<Json<Invite>, ApiError> {
    let invite = service
        .create_invite(
            session.user_id,
            session.session_id,
            &payload.code,
            payload.available_registrations,
            payload.role_id,
        )
        .await
        .map_err(ApiError::from)?;

    Ok(Json(invite))
}

#[utoipa::path(
    delete,
    tag = "auth",
    path = "/invites",
    description = "Delete invite",
    request_body = DeleteInviteRequest,
    responses(
        (status = 204, description = "Deleted"),
        (status = 422, body = ApiError),
        (status = 500, body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn delete_invite_handler(
    State(mut service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Extension(session): Extension<Session>,
    Json(payload): Json<DeleteInviteRequest>,
) -> Result<(), ApiError> {
    service
        .delete_invite(session.user_id, session.session_id, payload.invite_id)
        .await
        .map_err(ApiError::from)?;
    Ok(())
}

#[utoipa::path(
    get,
    tag = "auth",
    path = "/invites",
    description = "Get invites",
    responses(
        (status = 200, body = Vec<Invite>),
        (status = 500, body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_invites_handler(
    State(mut service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
            TextLogManager,
        >,
    >,
    Extension(session): Extension<Session>,
) -> Result<Json<Vec<Invite>>, ApiError> {
    let invites = service
        .get_all_invites(session.user_id)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(invites))
}

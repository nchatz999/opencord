



use crate::user::UserStatusType;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

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

use crate::managers::{LockoutManager, PasswordValidationError, PasswordValidator};

use crate::error::DatabaseError;

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("User not found: {user_id}")]
    UserNotFound { user_id: i64 },

    #[error("Session not found: {session_token}")]
    SessionNotFound { session_token: String },

    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("Account locked for {remaining_seconds} seconds")]
    AccountLocked { remaining_seconds: u64 },

    #[error("Password is too weak")]
    WeakPassword(#[from] PasswordValidationError),

    #[error("Username already exists: {username}")]
    UsernameExists { username: String },

    #[error("Invalid invite code")]
    InvalidInviteCode,

    #[error("Invite code has no remaining registrations")]
    InviteExhausted,

    #[error("Insufficient permissions")]
    InsufficientPermissions,

    #[error("Internal server error")]
    ServerError,

    #[error(transparent)]
    DatabaseError(#[from] DatabaseError),
}




pub trait AuthTransaction: Send + Sync {
    async fn create_auth(
        &mut self,
        user_id: i64,
        password_hash: &str,
    ) -> Result<Auth, DatabaseError>;

    async fn find_auth(&mut self, user_id: i64) -> Result<Option<Auth>, DatabaseError>;

    async fn create_session(
        &mut self,
        session_token: &str,
        user_id: i64,
        expires_at: Option<OffsetDateTime>,
    ) -> Result<Session, DatabaseError>;

    async fn create_user(&mut self, username: &str) -> Result<User, DatabaseError>;

    async fn create_user_with_role(&mut self, username: &str, role_id: i64) -> Result<User, DatabaseError>;

    async fn update_password(
        &mut self,
        user_id: i64,
        password_hash: &str,
    ) -> Result<Option<Auth>, DatabaseError>;

    async fn remove_session(
        &mut self,
        session_token: &str,
    ) -> Result<Option<Session>, DatabaseError>;

    async fn remove_user_session(
        &mut self,
        session_token: &str,
        user_id: i64,
    ) -> Result<Option<Session>, DatabaseError>;

    async fn find_sessions(&mut self, user_id: i64) -> Result<Vec<Session>, DatabaseError>;

    async fn create_invite(
        &mut self,
        code: &str,
        available_registrations: i32,
        role_id: i64,
    ) -> Result<Invite, DatabaseError>;

    async fn find_invite(&mut self, code: &str) -> Result<Option<Invite>, DatabaseError>;

    async fn update_invite_registrations(
        &mut self,
        invite_id: i64,
        available_registrations: i32,
    ) -> Result<Option<Invite>, DatabaseError>;

    async fn delete_invite(&mut self, invite_id: i64) -> Result<Option<Invite>, DatabaseError>;

    async fn find_all_invites(&mut self) -> Result<Vec<Invite>, DatabaseError>;

    async fn find_user(&mut self, user_id: i64) -> Result<Option<User>, DatabaseError>;
}


pub trait AuthRepository: Send + Sync + Clone {
    type Transaction: AuthTransaction;

    async fn begin(&self) -> Result<Self::Transaction, DatabaseError>;

    async fn commit(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn rollback(&self, transaction: Self::Transaction) -> Result<(), DatabaseError>;

    async fn find_session(&self, session_token: &str) -> Result<Option<Session>, DatabaseError>;

    async fn find_user_by_username(&self, username: &str) -> Result<Option<User>, DatabaseError>;
}


use crate::managers::{DefaultNotifierManager, NotifierManager, RecipientType};
use crate::model::Event;
use crate::user::User;
use bcrypt::{hash, verify, DEFAULT_COST};
use time::Duration;
use uuid::Uuid;

#[derive(Clone)]
pub struct AuthService<
    R: AuthRepository,
    L: LockoutManager,
    P: PasswordValidator,
    N: NotifierManager,
> {
    repository: R,
    lockout_manager: L,
    password_validator: P,
    notifier: N,
}

impl<R: AuthRepository, L: LockoutManager, P: PasswordValidator, N: NotifierManager>
    AuthService<R, L, P, N>
{
    pub fn new(repository: R, lockout_manager: L, password_validator: P, notifier: N) -> Self {
        Self {
            repository,
            lockout_manager,
            password_validator,
            notifier,
        }
    }

    pub async fn register_user(
        &self,
        username: &str,
        password: &str,
        invite_code: &str,
    ) -> Result<User, AuthError> {
        
        self.password_validator.validate_password(password)?;

        
        let password_hash = hash(password, DEFAULT_COST).map_err(|_| AuthError::ServerError)?;

        let mut tx = self.repository.begin().await?;

        
        let invite = tx
            .find_invite(invite_code)
            .await?
            .ok_or(AuthError::InvalidInviteCode)?;

        if invite.available_registrations <= 0 {
            return Err(AuthError::InviteExhausted);
        }

        
        let user = tx.create_user_with_role(username, invite.role_id).await.map_err(|e| match e {
            DatabaseError::UniqueConstraintViolation { .. } => AuthError::UsernameExists {
                username: username.to_string(),
            },
            e => AuthError::DatabaseError(e),
        })?;

        
        tx.create_auth(user.user_id, &password_hash).await?;

        
        tx.update_invite_registrations(invite.invite_id, invite.available_registrations - 1)
            .await?;

        self.repository.commit(tx).await?;

        
        let event = Event::UserUpdated { user: user.clone() };

        let _ = self.notifier.notify(event, RecipientType::Broadcast).await;

        Ok(user)
    }

    pub async fn login(&self, username: &str, password: &str) -> Result<Session, AuthError> {
        
        if let Some(remaining_seconds) = self.lockout_manager.is_locked_out(username) {
            return Err(AuthError::AccountLocked { remaining_seconds });
        }

        let mut tx = self.repository.begin().await?;

        
        let user = self
            .repository
            .find_user_by_username(username)
            .await?
            .ok_or_else(|| {
                
                self.lockout_manager.record_failed_attempt(username);
                AuthError::InvalidCredentials
            })?;

        
        let auth = tx
            .find_auth(user.user_id)
            .await?
            .ok_or(AuthError::InvalidCredentials)?;

        
        if !verify(password, &auth.password_hash).map_err(|_| AuthError::ServerError)? {
            self.lockout_manager.record_failed_attempt(username);
            return Err(AuthError::InvalidCredentials);
        }

        
        self.lockout_manager.record_successful_login(username);

        
        let session_token = Uuid::new_v4().to_string();
        let expires_at = Some(OffsetDateTime::now_utc() + Duration::days(30));

        let session = tx
            .create_session(&session_token, auth.user_id, expires_at)
            .await?;

        self.repository.commit(tx).await?;

        Ok(session)
    }

    pub async fn change_password(
        &self,
        user_id: i64,
        current_password: &str,
        new_password: &str,
    ) -> Result<(), AuthError> {
        
        self.password_validator.validate_password(new_password)?;

        let mut tx = self.repository.begin().await?;

        
        let auth = tx
            .find_auth(user_id)
            .await?
            .ok_or(AuthError::UserNotFound { user_id })?;

        
        if !verify(current_password, &auth.password_hash).map_err(|_| AuthError::ServerError)? {
            return Err(AuthError::InvalidCredentials);
        }

        
        let new_password_hash =
            hash(new_password, DEFAULT_COST).map_err(|_| AuthError::ServerError)?;

        
        tx.update_password(user_id, &new_password_hash)
            .await?
            .ok_or(AuthError::UserNotFound { user_id })?;

        self.repository.commit(tx).await?;

        Ok(())
    }

    pub async fn logout(&self, user_id: i64, session_token: &str) -> Result<(), AuthError> {
        let mut tx = self.repository.begin().await?;

        tx.remove_user_session(session_token, user_id)
            .await?
            .ok_or(AuthError::SessionNotFound {
                session_token: session_token.to_string(),
            })?;

        self.repository.commit(tx).await?;

        Ok(())
    }

    pub async fn get_user_sessions(&self, user_id: i64) -> Result<Vec<Session>, AuthError> {
        let mut tx = self.repository.begin().await?;

        let sessions = tx.find_sessions(user_id).await?;

        self.repository.commit(tx).await?;

        Ok(sessions)
    }

    pub async fn create_invite(
        &self,
        user_id: i64,
        code: &str,
        available_registrations: i32,
        role_id: i64,
    ) -> Result<Invite, AuthError> {
        let mut tx = self.repository.begin().await?;

        
        let user = tx
            .find_user(user_id)
            .await?
            .ok_or(AuthError::UserNotFound { user_id })?;

        if user.role_id != 0 && user.role_id != 1 {
            return Err(AuthError::InsufficientPermissions);
        }

        let invite = tx
            .create_invite(code, available_registrations, role_id)
            .await
            .map_err(|e| match e {
                DatabaseError::UniqueConstraintViolation { .. } => AuthError::InvalidInviteCode,
                e => AuthError::DatabaseError(e),
            })?;

        self.repository.commit(tx).await?;

        Ok(invite)
    }

    pub async fn delete_invite(&self, user_id: i64, invite_id: i64) -> Result<(), AuthError> {
        let mut tx = self.repository.begin().await?;

        
        let user = tx
            .find_user(user_id)
            .await?
            .ok_or(AuthError::UserNotFound { user_id })?;

        if user.role_id != 0 && user.role_id != 1 {
            return Err(AuthError::InsufficientPermissions);
        }

        tx.delete_invite(invite_id)
            .await?
            .ok_or(AuthError::InvalidInviteCode)?;

        self.repository.commit(tx).await?;

        Ok(())
    }

    pub async fn get_all_invites(&self, user_id: i64) -> Result<Vec<Invite>, AuthError> {
        let mut tx = self.repository.begin().await?;

        
        let user = tx
            .find_user(user_id)
            .await?
            .ok_or(AuthError::UserNotFound { user_id })?;

        if user.role_id != 0 && user.role_id != 1 {
            return Err(AuthError::InsufficientPermissions);
        }

        let invites = tx.find_all_invites().await?;

        self.repository.commit(tx).await?;

        Ok(invites)
    }
}




use crate::db::Postgre;


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

    async fn find_auth(&mut self, user_id: i64) -> Result<Option<Auth>, DatabaseError> {
        let result = sqlx::query_as!(
            Auth,
            r#"SELECT
                   user_id,
                   password_hash
               FROM auth
               WHERE user_id = $1"#,
            user_id
        )
        .fetch_optional(&mut *self.transaction)
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

    async fn create_user(&mut self, username: &str) -> Result<User, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"INSERT INTO users (username, avatar_file_id, role_id)
               VALUES ($1, 1, 2)
               RETURNING
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
                   server_deafen,
                   server_mute"#,
            username
        )
        .fetch_one(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn create_user_with_role(&mut self, username: &str, role_id: i64) -> Result<User, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"INSERT INTO users (username, avatar_file_id, role_id)
               VALUES ($1, 1, $2)
               RETURNING
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
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

    async fn remove_session(
        &mut self,
        session_token: &str,
    ) -> Result<Option<Session>, DatabaseError> {
        let result = sqlx::query_as!(
            Session,
            r#"DELETE FROM sessions
               WHERE session_token = $1
               RETURNING
                   session_id,
                   session_token,
                   user_id,
                   created_at,
                   expires_at"#,
            session_token
        )
        .fetch_optional(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn find_sessions(&mut self, user_id: i64) -> Result<Vec<Session>, DatabaseError> {
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
        .fetch_all(&mut *self.transaction)
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

    async fn find_invite(&mut self, code: &str) -> Result<Option<Invite>, DatabaseError> {
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
        .fetch_optional(&mut *self.transaction)
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

    async fn find_all_invites(&mut self) -> Result<Vec<Invite>, DatabaseError> {
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
        .fetch_all(&mut *self.transaction)
        .await?;

        Ok(result)
    }

    async fn find_user(&mut self, user_id: i64) -> Result<Option<User>, DatabaseError> {
        let result = sqlx::query_as!(
            User,
            r#"SELECT
                   user_id,
                   username,
                   created_at,
                   avatar_file_id,
                   role_id,
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
                   server_deafen,
                   server_mute
               FROM users
               WHERE user_id = $1"#,
            user_id
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
                   COALESCE(
                       NULLIF(manual_status, 'Offline'::user_status_type),
                       status
                   ) as "status!: UserStatusType",
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
}





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





use crate::error::ApiError;
use axum::http::StatusCode;

impl From<AuthError> for ApiError {
    fn from(err: AuthError) -> Self {
        match err {
            AuthError::UserNotFound { user_id } => {
                ApiError::UnprocessableEntity(format!("User {} not found", user_id))
            }
            AuthError::SessionNotFound { session_token } => {
                ApiError::UnprocessableEntity(format!("Session {} not found", session_token))
            }
            AuthError::InvalidCredentials => {
                ApiError::UnprocessableEntity("Invalid credentials".to_string())
            }
            AuthError::AccountLocked { remaining_seconds } => ApiError::UnprocessableEntity(
                format!("Account locked for {} seconds", remaining_seconds),
            ),
            AuthError::WeakPassword(err) => {
                ApiError::UnprocessableEntity(format!("Password is too weak: {}", err))
            }
            AuthError::UsernameExists { username } => {
                ApiError::UnprocessableEntity(format!("Username {} already exists", username))
            }
            AuthError::InvalidInviteCode => {
                ApiError::UnprocessableEntity("Invalid invite code".to_string())
            }
            AuthError::InviteExhausted => ApiError::UnprocessableEntity(
                "Invite code has no remaining registrations".to_string(),
            ),
            AuthError::InsufficientPermissions => {
                ApiError::UnprocessableEntity("Insufficient permissions".to_string())
            }
            AuthError::DatabaseError(e) => ApiError::InternalServerError(e.to_string()),
            AuthError::ServerError => {
                ApiError::InternalServerError("Internal server error".to_string())
            }
        }
    }
}


use crate::managers::{DefaultLockoutManager, DefaultPasswordValidator};
use crate::middleware::{authorize, AuthorizeService};
use axum::{
    extract::{Extension, State},
    middleware::from_fn_with_state,
    Json,
};
use utoipa_axum::{router::OpenApiRouter, routes};

pub fn auth_routes(
    auth_service: AuthService<
        Postgre,
        DefaultLockoutManager,
        DefaultPasswordValidator,
        DefaultNotifierManager,
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



#[utoipa::path(
    post,
    tag = "auth",
    path = "/register",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "User registered successfully", body = RegisterResponse),
        (status = 400, description = "Username already exists", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    )
)]
async fn register_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
        >,
    >,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<RegisterResponse>, ApiError> {
    let user = service
        .register_user(&payload.username, &payload.password, &payload.invite_code)
        .await?;

    let response = RegisterResponse { user };

    Ok(Json(response))
}

#[utoipa::path(
    post,
    tag = "auth",
    path = "/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Login successful", body = LoginResponse),
        (status = 401, description = "Invalid credentials", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    )
)]
async fn login_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
        >,
    >,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let session = service.login(&payload.username, &payload.password).await?;

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
    request_body = ChangePasswordRequest,
    responses(
        (status = 204, description = "Password changed successfully"),
        (status = 401, description = "Invalid credentials", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn change_password_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
        >,
    >,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<StatusCode, ApiError> {
    service
        .change_password(user_id, &payload.current_password, &payload.new_password)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    tag = "auth",
    path = "/logout",
    request_body = LogoutRequest,
    responses(
        (status = 204, description = "Logout successful"),
        (status = 404, description = "Session not found", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
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
        >,
    >,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<LogoutRequest>,
) -> Result<StatusCode, ApiError> {
    service.logout(user_id, &payload.session_token).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    tag = "auth",
    path = "/sessions",
    responses(
        (status = 200, description = "Sessions retrieved successfully", body = Vec<Session>),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_sessions_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
        >,
    >,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<Session>>, ApiError> {
    let sessions = service.get_user_sessions(user_id).await?;
    Ok(Json(sessions))
}

#[utoipa::path(
    post,
    tag = "auth",
    path = "/invites",
    request_body = CreateInviteRequest,
    responses(
        (status = 201, description = "Invite created successfully", body = Invite),
        (status = 422, description = "Invalid invite code", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn create_invite_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
        >,
    >,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<CreateInviteRequest>,
) -> Result<Json<Invite>, ApiError> {
    let invite = service
        .create_invite(user_id, &payload.code, payload.available_registrations, payload.role_id)
        .await?;

    Ok(Json(invite))
}

#[utoipa::path(
    delete,
    tag = "auth",
    path = "/invites",
    request_body = DeleteInviteRequest,
    responses(
        (status = 204, description = "Invite deleted successfully"),
        (status = 422, description = "Invalid invite ID", body = ApiError),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn delete_invite_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
        >,
    >,
    Extension(user_id): Extension<i64>,
    Json(payload): Json<DeleteInviteRequest>,
) -> Result<StatusCode, ApiError> {
    service.delete_invite(user_id, payload.invite_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    tag = "auth",
    path = "/invites",
    responses(
        (status = 200, description = "Invites retrieved successfully", body = Vec<Invite>),
        (status = 500, description = "Internal Server Error", body = ApiError),
    ),
    security(("api_key" = []))
)]
async fn get_invites_handler(
    State(service): State<
        AuthService<
            Postgre,
            DefaultLockoutManager,
            DefaultPasswordValidator,
            DefaultNotifierManager,
        >,
    >,
    Extension(user_id): Extension<i64>,
) -> Result<Json<Vec<Invite>>, ApiError> {
    let invites = service.get_all_invites(user_id).await?;
    Ok(Json(invites))
}

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base32;
use rand::Rng;
use totp_rs::{Algorithm, TOTP};

#[derive(Debug)]
pub enum FileError {
    Io(io::Error),
    NotFound(i64),
    TransactionFailed(String),
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        FileError::Io(error)
    }
}

impl std::fmt::Display for FileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileError::Io(err) => write!(f, "IO error: {}", err),
            FileError::NotFound(id) => write!(f, "File not found: {}", id),
            FileError::TransactionFailed(msg) => write!(f, "Transaction failed: {}", msg),
        }
    }
}

impl std::error::Error for FileError {}

pub trait FileTransaction: Send + Sync {
    fn stage_upload(&mut self, id: i64, data: &[u8]) -> Result<(), FileError>;

    fn commit(self) -> Result<(), FileError>;

    fn rollback(self) -> Result<(), FileError>;
}

pub trait FileManager: Send + Sync {
    type Transaction: FileTransaction;

    fn begin(&self) -> Result<Self::Transaction, FileError>;

    fn upload_file(&self, id: i64, data: &[u8]) -> Result<(), FileError>;

    fn get_file(&self, id: i64) -> Result<Vec<u8>, FileError>;

    fn delete_file(&self, id: i64) -> Result<(), FileError>;
}

#[derive(Clone)]
pub struct LocalFileManager {
    pub base_directory: PathBuf,
}

impl LocalFileManager {
    pub fn new<P: AsRef<Path>>(base_directory: P) -> Self {
        Self {
            base_directory: base_directory.as_ref().to_path_buf(),
        }
    }

    pub fn default() -> Self {
        Self::new("./files")
    }

    fn get_file_path(&self, id: i64) -> PathBuf {
        self.base_directory.join(id.to_string())
    }

    fn get_temp_file_path(&self, id: i64) -> PathBuf {
        self.base_directory.join(format!("{}.tmp", id))
    }
}

pub struct LocalFileTransaction {
    base_directory: PathBuf,
    staged_files: Vec<i64>,
    committed: bool,
}

impl FileTransaction for LocalFileTransaction {
    fn stage_upload(&mut self, id: i64, data: &[u8]) -> Result<(), FileError> {
        fs::create_dir_all(&self.base_directory)?;

        let temp_path = self.base_directory.join(format!("{}.tmp", id));
        fs::write(&temp_path, data)?;
        self.staged_files.push(id);
        Ok(())
    }

    fn commit(mut self) -> Result<(), FileError> {
        for id in &self.staged_files {
            let temp_path = self.base_directory.join(format!("{}.tmp", id));
            let final_path = self.base_directory.join(id.to_string());

            if let Err(e) = fs::rename(&temp_path, &final_path) {
                for cleanup_id in &self.staged_files {
                    let _ =
                        fs::remove_file(self.base_directory.join(format!("{}.tmp", cleanup_id)));
                }
                return Err(FileError::TransactionFailed(format!(
                    "Failed to commit file {}: {}",
                    id, e
                )));
            }
        }

        self.committed = true;
        Ok(())
    }

    fn rollback(mut self) -> Result<(), FileError> {
        for id in &self.staged_files {
            let temp_path = self.base_directory.join(format!("{}.tmp", id));
            let _ = fs::remove_file(temp_path);
        }

        self.committed = true;
        Ok(())
    }
}

impl Drop for LocalFileTransaction {
    fn drop(&mut self) {
        if !self.committed {
            for id in &self.staged_files {
                let temp_path = self.base_directory.join(format!("{}.tmp", id));
                let _ = fs::remove_file(temp_path);
            }
        }
    }
}

impl FileManager for LocalFileManager {
    type Transaction = LocalFileTransaction;

    fn begin(&self) -> Result<Self::Transaction, FileError> {
        Ok(LocalFileTransaction {
            base_directory: self.base_directory.clone(),
            staged_files: Vec::new(),
            committed: false,
        })
    }

    fn upload_file(&self, id: i64, data: &[u8]) -> Result<(), FileError> {
        fs::create_dir_all(&self.base_directory)?;

        let file_path = self.get_file_path(id);
        fs::write(file_path, data)?;
        Ok(())
    }

    fn get_file(&self, id: i64) -> Result<Vec<u8>, FileError> {
        let file_path = self.get_file_path(id);

        if !file_path.exists() {
            return Err(FileError::NotFound(id));
        }

        let data = fs::read(file_path)?;
        Ok(data)
    }

    fn delete_file(&self, id: i64) -> Result<(), FileError> {
        let file_path = self.get_file_path(id);

        if !file_path.exists() {
            return Err(FileError::NotFound(id));
        }

        fs::remove_file(file_path)?;
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TotpError {
    #[error("Failed to generate TOTP secret")]
    SecretGenerationFailed,

    #[error("Failed to verify TOTP code")]
    VerificationFailed,

    #[error("Invalid TOTP configuration")]
    InvalidConfiguration,
}

pub trait TotpManager: Send + Sync + Clone {
    fn generate_secret(&self) -> Result<String, TotpError>;

    fn verify_code(&self, secret: &str, code: &str) -> Result<bool, TotpError>;
}

#[derive(Clone)]
pub struct DefaultTotpManager;

impl DefaultTotpManager {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DefaultTotpManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TotpManager for DefaultTotpManager {
    fn generate_secret(&self) -> Result<String, TotpError> {
        let mut rng = rand::thread_rng();
        let secret: [u8; 20] = rng.r#gen();
        Ok(base32::encode(
            base32::Alphabet::Rfc4648 { padding: false },
            &secret,
        ))
    }

    fn verify_code(&self, secret: &str, code: &str) -> Result<bool, TotpError> {
        let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, secret.as_bytes().to_vec())
            .map_err(|_| TotpError::InvalidConfiguration)?;

        totp.check_current(code)
            .map_err(|_| TotpError::VerificationFailed)
    }
}

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone)]
pub struct LockoutAttempt {
    pub attempts: u32,
    pub last_attempt: Instant,
    pub locked_until: Option<Instant>,
}

pub trait LockoutManager: Send + Sync + Clone {
    fn record_failed_attempt(&self, identifier: &str);

    fn record_successful_login(&self, identifier: &str);

    fn is_locked_out(&self, identifier: &str) -> Option<u64>;

    fn unlock_account(&self, identifier: &str);
}

#[derive(Clone)]
pub struct DefaultLockoutManager {
    attempts: Arc<Mutex<HashMap<String, LockoutAttempt>>>,
    max_attempts: u32,
    lockout_duration: Duration,
    attempt_window: Duration,
}

impl DefaultLockoutManager {
    pub fn new(
        max_attempts: u32,
        lockout_duration_minutes: u64,
        attempt_window_minutes: u64,
    ) -> Self {
        Self {
            attempts: Arc::new(Mutex::new(HashMap::new())),
            max_attempts,
            lockout_duration: Duration::from_secs(lockout_duration_minutes * 60),
            attempt_window: Duration::from_secs(attempt_window_minutes * 60),
        }
    }

    pub fn default() -> Self {
        Self::new(5, 15, 5)
    }
}

impl LockoutManager for DefaultLockoutManager {
    fn record_failed_attempt(&self, identifier: &str) {
        let mut attempts = self.attempts.lock().unwrap();
        let now = Instant::now();

        let entry = attempts
            .entry(identifier.to_string())
            .or_insert(LockoutAttempt {
                attempts: 0,
                last_attempt: now,
                locked_until: None,
            });

        if let Some(locked_until) = entry.locked_until {
            if now < locked_until {
                return;
            } else {
                entry.attempts = 0;
                entry.locked_until = None;
            }
        }

        if now.duration_since(entry.last_attempt) > self.attempt_window {
            entry.attempts = 0;
        }

        entry.attempts += 1;
        entry.last_attempt = now;

        if entry.attempts >= self.max_attempts {
            entry.locked_until = Some(now + self.lockout_duration);
        }
    }

    fn record_successful_login(&self, identifier: &str) {
        let mut attempts = self.attempts.lock().unwrap();
        attempts.remove(identifier);
    }

    fn is_locked_out(&self, identifier: &str) -> Option<u64> {
        let mut attempts = self.attempts.lock().unwrap();
        let now = Instant::now();

        if let Some(entry) = attempts.get_mut(identifier) {
            if let Some(locked_until) = entry.locked_until {
                if now < locked_until {
                    return Some(locked_until.duration_since(now).as_secs());
                } else {
                    entry.attempts = 0;
                    entry.locked_until = None;
                }
            }
        }

        None
    }

    fn unlock_account(&self, identifier: &str) {
        let mut attempts = self.attempts.lock().unwrap();
        attempts.remove(identifier);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RateLimitError {
    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Invalid rate limit configuration")]
    InvalidConfiguration,
}

#[derive(Clone)]
pub struct RateLimitEntry {
    pub requests: u32,
    pub window_start: Instant,
}

pub trait RateLimiter: Send + Sync + Clone {
    fn is_allowed(&self, identifier: &str) -> Result<(), RateLimitError>;

    fn reset(&self, identifier: &str);

    fn get_remaining(&self, identifier: &str) -> u32;
}

#[derive(Clone)]
pub struct DefaultRateLimiter {
    entries: Arc<Mutex<HashMap<String, RateLimitEntry>>>,
    max_requests: u32,
    window_duration: Duration,
}

impl DefaultRateLimiter {
    pub fn new(max_requests: u32, window_duration_seconds: u64) -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            max_requests,
            window_duration: Duration::from_secs(window_duration_seconds),
        }
    }

    pub fn default() -> Self {
        Self::new(100, 60)
    }

    pub fn per_minute(max_requests: u32) -> Self {
        Self::new(max_requests, 60)
    }

    pub fn per_hour(max_requests: u32) -> Self {
        Self::new(max_requests, 3600)
    }
}

impl RateLimiter for DefaultRateLimiter {
    fn is_allowed(&self, identifier: &str) -> Result<(), RateLimitError> {
        let mut entries = self.entries.lock().unwrap();
        let now = Instant::now();

        let entry = entries
            .entry(identifier.to_string())
            .or_insert(RateLimitEntry {
                requests: 0,
                window_start: now,
            });

        if now.duration_since(entry.window_start) >= self.window_duration {
            entry.requests = 0;
            entry.window_start = now;
        }

        if entry.requests >= self.max_requests {
            return Err(RateLimitError::RateLimitExceeded);
        }

        entry.requests += 1;

        Ok(())
    }

    fn reset(&self, identifier: &str) {
        let mut entries = self.entries.lock().unwrap();
        entries.remove(identifier);
    }

    fn get_remaining(&self, identifier: &str) -> u32 {
        let mut entries = self.entries.lock().unwrap();
        let now = Instant::now();

        if let Some(entry) = entries.get_mut(identifier) {
            if now.duration_since(entry.window_start) >= self.window_duration {
                entry.requests = 0;
                entry.window_start = now;
            }

            self.max_requests.saturating_sub(entry.requests)
        } else {
            self.max_requests
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PasswordValidationError {
    #[error("Password is too short (minimum {min} characters)")]
    TooShort { min: usize },

    #[error("Password is too long (maximum {max} characters)")]
    TooLong { max: usize },

    #[error("Password must contain at least one uppercase letter")]
    NoUppercase,

    #[error("Password must contain at least one lowercase letter")]
    NoLowercase,

    #[error("Password must contain at least one digit")]
    NoDigit,

    #[error("Password must contain at least one special character")]
    NoSpecialChar,

    #[error("Password contains forbidden characters")]
    ForbiddenChars,

    #[error("Password is too common")]
    TooCommon,
}

#[derive(Clone)]
pub struct PasswordRequirements {
    pub min_length: usize,
    pub max_length: usize,
    pub require_uppercase: bool,
    pub require_lowercase: bool,
    pub require_digit: bool,
    pub require_special_char: bool,
    pub allowed_special_chars: String,
    pub forbidden_passwords: Vec<String>,
}

impl Default for PasswordRequirements {
    fn default() -> Self {
        Self {
            min_length: 14,
            max_length: 128,
            require_uppercase: true,
            require_lowercase: true,
            require_digit: true,
            require_special_char: true,
            allowed_special_chars: "!@#$%^&*()_+-=[]{}|;:,.<>?".to_string(),
            forbidden_passwords: vec![
                "password".to_string(),
                "123456".to_string(),
                "password123".to_string(),
                "admin".to_string(),
                "qwerty".to_string(),
            ],
        }
    }
}

pub trait PasswordValidator: Send + Sync + Clone {
    fn validate_password(&self, password: &str) -> Result<(), PasswordValidationError>;

    fn get_password_strength(&self, password: &str) -> u8;
}

#[derive(Clone)]
pub struct DefaultPasswordValidator {
    requirements: PasswordRequirements,
}

impl DefaultPasswordValidator {
    pub fn new(requirements: PasswordRequirements) -> Self {
        Self { requirements }
    }

    pub fn default() -> Self {
        Self::new(PasswordRequirements::default())
    }
}

impl PasswordValidator for DefaultPasswordValidator {
    fn validate_password(&self, password: &str) -> Result<(), PasswordValidationError> {
        if password.len() < self.requirements.min_length {
            return Err(PasswordValidationError::TooShort {
                min: self.requirements.min_length,
            });
        }

        if password.len() > self.requirements.max_length {
            return Err(PasswordValidationError::TooLong {
                max: self.requirements.max_length,
            });
        }

        if self.requirements.require_uppercase && !password.chars().any(|c| c.is_uppercase()) {
            return Err(PasswordValidationError::NoUppercase);
        }

        if self.requirements.require_lowercase && !password.chars().any(|c| c.is_lowercase()) {
            return Err(PasswordValidationError::NoLowercase);
        }

        if self.requirements.require_digit && !password.chars().any(|c| c.is_ascii_digit()) {
            return Err(PasswordValidationError::NoDigit);
        }

        if self.requirements.require_special_char {
            let has_special = password.chars().any(|c| {
                !c.is_alphanumeric() && self.requirements.allowed_special_chars.contains(c)
            });
            if !has_special {
                return Err(PasswordValidationError::NoSpecialChar);
            }
        }

        let has_forbidden = password
            .chars()
            .any(|c| !c.is_alphanumeric() && !self.requirements.allowed_special_chars.contains(c));
        if has_forbidden {
            return Err(PasswordValidationError::ForbiddenChars);
        }

        let password_lower = password.to_lowercase();
        if self
            .requirements
            .forbidden_passwords
            .iter()
            .any(|p| p == &password_lower)
        {
            return Err(PasswordValidationError::TooCommon);
        }

        Ok(())
    }

    fn get_password_strength(&self, password: &str) -> u8 {
        let mut score = 0u8;

        let length_score = ((password.len() as f32 / 20.0) * 30.0).min(30.0) as u8;
        score += length_score;

        let mut variety_score = 0;
        if password.chars().any(|c| c.is_lowercase()) {
            variety_score += 10;
        }
        if password.chars().any(|c| c.is_uppercase()) {
            variety_score += 10;
        }
        if password.chars().any(|c| c.is_ascii_digit()) {
            variety_score += 10;
        }
        if password.chars().any(|c| !c.is_alphanumeric()) {
            variety_score += 10;
        }
        score += variety_score;

        let mut complexity_score = 0;

        let unique_chars = password.chars().collect::<std::collections::HashSet<_>>();
        if unique_chars.len() == password.len() {
            complexity_score += 10;
        }

        let has_sequence = password.chars().collect::<Vec<_>>().windows(3).any(|w| {
            let a = w[0] as u8;
            let b = w[1] as u8;
            let c = w[2] as u8;
            (a + 1 == b && b + 1 == c) || (a == b + 1 && b == c + 1)
        });
        if !has_sequence {
            complexity_score += 10;
        }

        if !self
            .requirements
            .forbidden_passwords
            .iter()
            .any(|p| password.to_lowercase().contains(p))
        {
            complexity_score += 10;
        }

        score += complexity_score;

        score.min(100)
    }
}

use crate::webtransport::ServerMessage;
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum NotifierError {
    #[error("Failed to send notification")]
    SendFailed,

    #[error("Notification service unavailable")]
    ServiceUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RecipientType {
    User {
        user_id: i64,
    },

    Role {
        role_id: i64,
    },

    GroupRights {
        group_id: i64,
        minimum_rights: i64,
    },

    ChannelRights {
        channel_id: i64,
        minimum_rights: i64,
    },

    ChannelRecipients {
        channel_id: i64,
        sender_id: i64,
    },

    Broadcast,
}

pub trait NotifierManager: Send + Sync + Clone {
    async fn notify(&self, event: ServerMessage) -> Result<(), NotifierError>;
}

use tokio::sync::mpsc;

#[derive(Clone)]
pub struct DefaultNotifierManager {
    sender: mpsc::Sender<ServerMessage>,
}

impl DefaultNotifierManager {
    pub fn new(sender: mpsc::Sender<ServerMessage>) -> Self {
        Self { sender }
    }
}

impl NotifierManager for DefaultNotifierManager {
    async fn notify(&self, event: ServerMessage) -> Result<(), NotifierError> {
        self.sender
            .send(event)
            .await
            .map_err(|_| NotifierError::SendFailed)?;

        Ok(())
    }
}

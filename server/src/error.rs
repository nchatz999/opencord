use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use serde_json::json;
use std::{error::Error, fmt};
use utoipa::ToSchema;

#[derive(Debug, ToSchema, Clone, PartialEq, Eq)]
pub enum ApiError {
    InternalServerError(String),
    UnprocessableEntity(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::InternalServerError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
            ApiError::UnprocessableEntity(msg) => (StatusCode::UNPROCESSABLE_ENTITY, msg),
        };

        let body = Json(json!({
            "reason": message,
            "code": 1
        }));

        (status, body).into_response()
    }
}

use sqlx::Error as SqlxError;

#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub enum DatabaseError {
    PrimaryKeyViolation { key: String, value: String },

    UniqueConstraintViolation { column: String },

    ForeignKeyViolation { column: String },

    CheckConstraintViolation { constraint_name: String },

    InternalServerError { message: String },

    RowNotFound,

    TransactionAlreadyStarted,

    NoActiveTransaction,
}

impl From<SqlxError> for DatabaseError {
    fn from(error: SqlxError) -> Self {
        match error {
            SqlxError::RowNotFound => DatabaseError::RowNotFound,

            SqlxError::Database(db_error) => {
                let error_code = db_error.code().unwrap_or_default();
                let message = db_error.message();

                match error_code.as_ref() {
                    "23505" => {
                        if let Some(constraint) = db_error.constraint() {
                            let column = constraint
                                .strip_prefix("unique_")
                                .or_else(|| constraint.strip_suffix("_key"))
                                .unwrap_or(constraint)
                                .to_string();

                            DatabaseError::UniqueConstraintViolation { column }
                        } else {
                            DatabaseError::InternalServerError {
                                message: format!("Unique constraint violation: {}", message),
                            }
                        }
                    }

                    "23503" => {
                        if let Some(constraint) = db_error.constraint() {
                            let column = constraint
                                .strip_prefix("fk_")
                                .or_else(|| constraint.strip_suffix("_fkey"))
                                .unwrap_or(constraint)
                                .to_string();

                            DatabaseError::ForeignKeyViolation { column }
                        } else {
                            DatabaseError::InternalServerError {
                                message: format!("Foreign key constraint violation: {}", message),
                            }
                        }
                    }

                    "23514" => {
                        let constraint_name = db_error
                            .constraint()
                            .unwrap_or("unknown_constraint")
                            .to_string();

                        DatabaseError::CheckConstraintViolation { constraint_name }
                    }

                    "23000" => {
                        if message.contains("duplicate key") && message.contains("primary key") {
                            let key = "primary_key".to_string();
                            let value = "duplicate".to_string();

                            DatabaseError::PrimaryKeyViolation { key, value }
                        } else {
                            DatabaseError::InternalServerError {
                                message: format!("Integrity constraint violation: {}", message),
                            }
                        }
                    }

                    _ => DatabaseError::InternalServerError {
                        message: format!("Database error ({}): {}", error_code, message),
                    },
                }
            }

            _ => DatabaseError::InternalServerError {
                message: error.to_string(),
            },
        }
    }
}

impl fmt::Display for DatabaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DatabaseError::PrimaryKeyViolation { key, value } => {
                write!(
                    f,
                    "Primary key violation: duplicate value '{}' for key '{}'",
                    value, key
                )
            }
            DatabaseError::UniqueConstraintViolation { column } => {
                write!(
                    f,
                    "Unique constraint violation: duplicate value in column '{}'",
                    column
                )
            }
            DatabaseError::ForeignKeyViolation { column } => {
                write!(
                    f,
                    "Foreign key violation: invalid reference in column '{}'",
                    column
                )
            }
            DatabaseError::CheckConstraintViolation { constraint_name } => {
                write!(
                    f,
                    "Check constraint violation: constraint '{}' failed",
                    constraint_name
                )
            }
            DatabaseError::InternalServerError { message } => {
                write!(f, "Database error: {}", message)
            }
            DatabaseError::RowNotFound => {
                write!(f, "No matching row found")
            }
            DatabaseError::TransactionAlreadyStarted => {
                write!(f, "Transaction already started")
            }
            DatabaseError::NoActiveTransaction => {
                write!(f, "No active transaction")
            }
        }
    }
}

impl Error for DatabaseError {}

impl DatabaseError {
    #[deprecated(since = "0.1.0", note = "Use From trait implementation instead")]
    pub fn from_sqlx_error(error: SqlxError) -> Self {
        error.into()
    }
}

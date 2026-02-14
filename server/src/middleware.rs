use crate::auth::{AuthRepository, Session};
use crate::managers::RateLimiter;
use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use time::OffsetDateTime;

#[derive(Clone)]
pub struct AuthorizeService<T: AuthRepository> {
    auth_repo: T,
}

impl<T: AuthRepository> AuthorizeService<T> {
    pub fn new(auth_repo: T) -> Self {
        Self { auth_repo }
    }

    pub async fn validate_session(&self, session_token: &str) -> Result<Session, StatusCode> {
        let result = self
            .auth_repo
            .find_session(session_token)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        match result {
            Some(session) => {
                if session.expires_at < OffsetDateTime::now_utc() {
                    return Err(StatusCode::UNAUTHORIZED);
                }
                Ok(session)
            }
            None => Err(StatusCode::UNAUTHORIZED),
        }
    }

    pub fn extract_session_from_headers(&self, headers: &HeaderMap) -> Option<String> {
        headers
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .map(|t| t.to_string())
    }
}

#[derive(Clone)]
pub struct RateLimitService<R: RateLimiter> {
    rate_limiter: R,
}

impl<R: RateLimiter> RateLimitService<R> {
    pub fn new(rate_limiter: R) -> Self {
        Self { rate_limiter }
    }

    pub fn check_rate_limit(&self, identifier: &str) -> Result<(), StatusCode> {
        self.rate_limiter
            .is_allowed(identifier)
            .map_err(|_| StatusCode::TOO_MANY_REQUESTS)
    }

    pub fn get_remaining_requests(&self, identifier: &str) -> u32 {
        self.rate_limiter.get_remaining(identifier)
    }
}

pub async fn authorize<T: AuthRepository + Clone + Send + Sync + 'static>(
    State(auth_service): State<AuthorizeService<T>>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let headers = request.headers();

    let session_token = auth_service
        .extract_session_from_headers(headers)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let session = auth_service.validate_session(&session_token).await?;

    request.extensions_mut().insert(session);

    Ok(next.run(request).await)
}

pub async fn rate_limit<R: RateLimiter + Clone + Send + Sync + 'static>(
    State(rate_limit_service): State<RateLimitService<R>>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    
    let client_ip = request
        .headers()
        .get("x-forwarded-for")
        .and_then(|hv| hv.to_str().ok())
        .or_else(|| {
            request
                .headers()
                .get("x-real-ip")
                .and_then(|hv| hv.to_str().ok())
        })
        .unwrap_or("unknown");

    
    rate_limit_service.check_rate_limit(client_ip)?;

    Ok(next.run(request).await)
}


#[derive(Clone, Copy)]
pub struct UserId(pub i64);


pub trait RequestExt {
    fn user_id(&self) -> Option<i64>;
}

impl RequestExt for Request {
    fn user_id(&self) -> Option<i64> {
        self.extensions().get::<UserId>().map(|id| id.0)
    }
}

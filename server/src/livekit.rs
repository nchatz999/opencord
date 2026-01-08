// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════════════════════

use livekit_api::access_token::{AccessToken, AccessTokenError, TokenVerifier, VideoGrants};
use livekit_api::services::room::{RoomClient, UpdateParticipantOptions};
use livekit_api::services::ServiceError;
use livekit_api::webhooks::{WebhookError, WebhookReceiver};
use livekit_protocol::ParticipantPermission;
use std::sync::Arc;
use std::time::Duration;

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, thiserror::Error)]
pub enum LiveKitError {
    #[error("Token generation failed: {0}")]
    TokenError(#[from] AccessTokenError),

    #[error("Room service error: {0}")]
    ServiceError(#[from] ServiceError),

    #[error("Webhook verification failed: {0}")]
    WebhookError(#[from] WebhookError),

    #[error("Invalid participant identity: {0}")]
    InvalidIdentity(String),
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Clone)]
pub struct LiveKitService {
    client: Arc<RoomClient>,
    webhook_receiver: Arc<WebhookReceiver>,
    api_key: String,
    api_secret: String,
    pub ws_url: String,
}

impl LiveKitService {
    pub fn new(url: &str, api_key: &str, api_secret: &str) -> Self {
        let client = Arc::new(RoomClient::with_api_key(&format!("https://{}", url), api_key, api_secret));
        let verifier = TokenVerifier::with_api_key(api_key, api_secret);
        let webhook_receiver = Arc::new(WebhookReceiver::new(verifier));

        Self {
            client,
            webhook_receiver,
            api_key: api_key.to_string(),
            api_secret: api_secret.to_string(),
            ws_url: format!("wss://{}", url),
        }
    }

    pub fn create_join_token(
        &self,
        user_id: i64,
        room: &str,
        can_publish: bool,
    ) -> Result<String, LiveKitError> {
        let token = AccessToken::with_api_key(&self.api_key, &self.api_secret)
            .with_identity(&user_id.to_string())
            .with_ttl(Duration::from_secs(3600))
            .with_grants(VideoGrants {
                room_join: true,
                room: room.to_string(),
                can_publish,
                can_subscribe: true,
                ..Default::default()
            })
            .to_jwt()?;

        Ok(token)
    }

    pub async fn remove_participant(&self, room: &str, identity: &str) -> Result<(), LiveKitError> {
        self.client.remove_participant(room, identity).await?;
        Ok(())
    }

    pub async fn update_permissions(
        &self,
        room: &str,
        identity: &str,
        can_publish: bool,
        can_subscribe: bool,
    ) -> Result<(), LiveKitError> {
        self.client
            .update_participant(
                room,
                identity,
                UpdateParticipantOptions {
                    permission: Some(ParticipantPermission {
                        can_publish,
                        can_subscribe,
                        can_publish_data: true,
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    pub async fn delete_room(&self, room: &str) -> Result<(), LiveKitError> {
        self.client.delete_room(room).await?;
        Ok(())
    }

    pub fn parse_event(&self, body: &str, auth_header: &str) -> Result<LiveKitEvent, LiveKitError> {
        let event = self.webhook_receiver.receive(body, auth_header)?;

        let parse_user_id = |identity: &str| -> Result<i64, LiveKitError> {
            identity
                .parse::<i64>()
                .map_err(|_| LiveKitError::InvalidIdentity(identity.to_string()))
        };

        match event.event.as_str() {
            "participant_joined" => {
                let p = event.participant.ok_or_else(|| {
                    LiveKitError::InvalidIdentity("Missing participant".to_string())
                })?;
                Ok(LiveKitEvent::ParticipantJoined {
                    user_id: parse_user_id(&p.identity)?,
                    room: event.room.map(|r| r.name).unwrap_or_default(),
                })
            }
            "participant_left" => {
                let p = event.participant.ok_or_else(|| {
                    LiveKitError::InvalidIdentity("Missing participant".to_string())
                })?;
                Ok(LiveKitEvent::ParticipantLeft {
                    user_id: parse_user_id(&p.identity)?,
                    room: event.room.map(|r| r.name).unwrap_or_default(),
                })
            }
            "track_published" => {
                let p = event.participant.ok_or_else(|| {
                    LiveKitError::InvalidIdentity("Missing participant".to_string())
                })?;
                let track = event.track.ok_or_else(|| {
                    LiveKitError::InvalidIdentity("Missing track".to_string())
                })?;
                Ok(LiveKitEvent::TrackPublished {
                    user_id: parse_user_id(&p.identity)?,
                    room: event.room.map(|r| r.name).unwrap_or_default(),
                    track_type: TrackType::from_livekit(track.r#type()),
                })
            }
            "track_unpublished" => {
                let p = event.participant.ok_or_else(|| {
                    LiveKitError::InvalidIdentity("Missing participant".to_string())
                })?;
                let track = event.track.ok_or_else(|| {
                    LiveKitError::InvalidIdentity("Missing track".to_string())
                })?;
                Ok(LiveKitEvent::TrackUnpublished {
                    user_id: parse_user_id(&p.identity)?,
                    room: event.room.map(|r| r.name).unwrap_or_default(),
                    track_type: TrackType::from_livekit(track.r#type()),
                })
            }
            _ => Ok(LiveKitEvent::Unknown),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum TrackType {
    Audio,
    Video,
    Unknown,
}

impl TrackType {
    fn from_livekit(t: livekit_protocol::TrackType) -> Self {
        match t {
            livekit_protocol::TrackType::Audio => TrackType::Audio,
            livekit_protocol::TrackType::Video => TrackType::Video,
            _ => TrackType::Unknown,
        }
    }
}

#[derive(Debug, Clone)]
pub enum LiveKitEvent {
    ParticipantJoined { user_id: i64, room: String },
    ParticipantLeft { user_id: i64, room: String },
    TrackPublished { user_id: i64, room: String, track_type: TrackType },
    TrackUnpublished { user_id: i64, room: String, track_type: TrackType },
    Unknown,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOM NAMING
// ═══════════════════════════════════════════════════════════════════════════════

pub fn room_name_for_channel(channel_id: i64) -> String {
    format!("channel-{}", channel_id)
}

pub fn room_name_for_private(user_a: i64, user_b: i64) -> String {
    let (min, max) = if user_a < user_b {
        (user_a, user_b)
    } else {
        (user_b, user_a)
    };
    format!("private-{}-{}", min, max)
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════════

use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Extension, Json, Router};
use serde::{Deserialize, Serialize};

use crate::db::Postgre;
use crate::error::ApiError;
use crate::managers::{DefaultNotifierManager, TextLogManager};
use crate::voip::VoipService;

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookResponse {
    pub processed: bool,
}

impl From<LiveKitError> for ApiError {
    fn from(err: LiveKitError) -> Self {
        match err {
            LiveKitError::WebhookError(_) => ApiError::UnprocessableEntity("Invalid webhook signature".to_string()),
            LiveKitError::InvalidIdentity(id) => ApiError::UnprocessableEntity(format!("Invalid identity: {}", id)),
            _ => ApiError::InternalServerError(err.to_string()),
        }
    }
}

pub fn livekit_webhook_routes(
    livekit_service: LiveKitService,
    voip_service: VoipService<Postgre, DefaultNotifierManager, TextLogManager>,
) -> Router {
    Router::new()
        .route("/webhook", post(webhook_handler))
        .layer(Extension(livekit_service))
        .layer(Extension(voip_service))
}

async fn webhook_handler(
    Extension(livekit): Extension<LiveKitService>,
    Extension(voip): Extension<VoipService<Postgre, DefaultNotifierManager, TextLogManager>>,
    headers: HeaderMap,
    body: String,
) -> Result<Json<WebhookResponse>, ApiError> {
    let auth_header = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let event = livekit.parse_event(&body, auth_header)?;

    match event {
        LiveKitEvent::ParticipantLeft { user_id, .. } => {
            let _ = voip.leave_voip(user_id, 0).await;
        }
        LiveKitEvent::ParticipantJoined { .. } => {}
        LiveKitEvent::TrackPublished { .. } => {}
        LiveKitEvent::TrackUnpublished { .. } => {}
        LiveKitEvent::Unknown => {}
    }

    Ok(Json(WebhookResponse { processed: true }))
}

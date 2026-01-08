use crate::error::DatabaseError;
use crate::model::EventPayload;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, thiserror::Error)]
pub enum DomainError {
    #[error("Internal error: {0}")]
    InternalError(#[from] DatabaseError),
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTING
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
pub enum ControlRoutingPolicy {
    GroupRights {
        group_id: i64,
        minimun_rights: i64,
    },
    ChannelRights {
        channel_id: i64,
        minimun_rights: i64,
    },
    User {
        user_id: i64,
    },
    Role {
        role_id: i64,
    },
    Broadcast,
}

// ═══════════════════════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
pub enum CommandPayload {
    Connect(i64, i64, mpsc::Sender<SubscriberMessage>, String, String),
    Timeout(i64, String),
    Disconnect(i64, String),
    DisconnectUser(i64),
}

pub enum ServerMessage {
    Command(CommandPayload),
    Control(EventPayload, ControlRoutingPolicy),
    InvalidateVoip,
    InvalidateAcl,
    InvalidateUsers,
}

pub enum SubscriberMessage {
    Event(EventPayload),
    Error(String),
    Close,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "camelCase")]
pub enum ConnectionMessage {
    Ping { timestamp: u64 },
    Pong { timestamp: u64 },
    Event { payload: EventPayload },
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBSCRIBER HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

pub struct SubscriberHandler {
    pub user_id: i64,
    pub session_id: i64,
    pub sender: mpsc::Sender<SubscriberMessage>,
    pub session_token: String,
    pub identifier: String,
}

impl SubscriberHandler {
    pub fn user_id(&self) -> i64 {
        self.user_id
    }

    pub async fn send(&self, msg: SubscriberMessage) -> bool {
        self.sender.send(msg).await.is_ok()
    }

    pub async fn send_error(&self, reason: String) {
        let _ = self.sender.send(SubscriberMessage::Error(reason)).await;
    }
}

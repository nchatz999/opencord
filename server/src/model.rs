use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::{
    channel::{Channel, ChannelType},
    group::Group,
    message::{File, MessageType},
    role::Role,
    user::{User, UserStatusType},
    voip::VoipParticipant,
    webtransport::VoipDataType,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub file_uuid: String,
    pub message_id: i64,
    pub file_name: String,
    pub file_type: String,
    pub file_size: i64,
    pub file_hash: String,
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum VoipType {
    Channel { channel_id: i64 },
    Direct { recipient_id: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
#[serde(tag = "type")]
pub enum Event {
    
    ChannelUpdated {
        channel: Channel,
    },
    ChannelDeleted {
        channel_id: i64,
    },

    
    GroupUpdated {
        group: Group,
    },
    GroupDeleted {
        group_id: i64,
    },

    RoleUpdated {
        role: Role,
    },
    RoleDeleted {
        role_id: i64,
    },

    
    UserUpdated {
        user: User,
    },
    UserDeleted {
        user_id: i64,
    },

    GroupRoleRightUpdated {
        group_id: i64,
        role_id: i64,
        rights: i64,
    },

    
    VoipParticipantUpdated {
        user: VoipParticipant,
    },
    VoipParticipantDeleted {
        user_id: i64,
    },

    
    MessageCreated {
        message_id: i64,
        sender_id: i64,
        message_type: MessageType,
        message_text: String,
        reply_to_message_id: Option<i64>,
        #[serde(with = "time::serde::iso8601")]
        timestamp: OffsetDateTime,
        files: Vec<File>,
    },
    MessageUpdated {
        message_id: i64,
        message_text: String,
    },
    MessageDeleted {
        message_id: i64,
    },

    GroupReveal {
        group_id: i64,
        group_name: String,
        channels: Vec<Channel>,
        voip_participants: Vec<VoipParticipant>,
    },

    GroupHide {
        group_id: i64,
    },

    VoIPData {
        channel_id: i64,         
        user_id: i64,            
        data_type: VoipDataType, 
        data: Vec<u8>,           
        timestamp: u64,
        key: String, 
    },
}

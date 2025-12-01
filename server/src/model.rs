use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::{
    channel::{Channel, ChannelType},
    group::{Group, GroupRoleRights},
    message::{File, MessageType},
    role::Role,
    user::{User, UserStatusType},
    voip::{Subscription, VoipParticipant},
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
#[serde(tag = "type")]
pub enum EventPayload {
    #[serde(rename = "channelUpdated")]
    #[serde(rename_all = "camelCase")]
    ChannelUpdated { channel: Channel },
    #[serde(rename = "channelDeleted")]
    #[serde(rename_all = "camelCase")]
    ChannelDeleted { channel_id: i64 },
    #[serde(rename = "groupUpdated")]
    #[serde(rename_all = "camelCase")]
    GroupUpdated { group: Group },
    #[serde(rename = "groupDeleted")]
    #[serde(rename_all = "camelCase")]
    GroupDeleted { group_id: i64 },
    #[serde(rename = "roleUpdated")]
    #[serde(rename_all = "camelCase")]
    RoleUpdated { role: Role },
    #[serde(rename = "roleDeleted")]
    #[serde(rename_all = "camelCase")]
    RoleDeleted { role_id: i64 },
    #[serde(rename = "userUpdated")]
    #[serde(rename_all = "camelCase")]
    UserUpdated { user: User },
    #[serde(rename = "userDeleted")]
    #[serde(rename_all = "camelCase")]
    UserDeleted { user_id: i64 },
    #[serde(rename = "groupRoleRightUpdated")]
    #[serde(rename_all = "camelCase")]
    GroupRoleRightUpdated { right: GroupRoleRights },
    #[serde(rename = "voipParticipantUpdated")]
    #[serde(rename_all = "camelCase")]
    VoipParticipantUpdated { user: VoipParticipant },
    #[serde(rename = "voipParticipantDeleted")]
    #[serde(rename_all = "camelCase")]
    VoipParticipantDeleted { user_id: i64 },
    #[serde(rename = "messageCreated")]
    #[serde(rename_all = "camelCase")]
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
    #[serde(rename = "messageUpdated")]
    #[serde(rename_all = "camelCase")]
    MessageUpdated {
        message_id: i64,
        message_text: String,
    },
    #[serde(rename = "messageDeleted")]
    #[serde(rename_all = "camelCase")]
    MessageDeleted { message_id: i64 },
    #[serde(rename = "groupReveal")]
    #[serde(rename_all = "camelCase")]
    GroupReveal {
        group_id: i64,
        group_name: String,
        channels: Vec<Channel>,
        voip_participants: Vec<VoipParticipant>,
        right: GroupRoleRights,
    },
    #[serde(rename = "groupHide")]
    #[serde(rename_all = "camelCase")]
    GroupHide { group_id: i64 },

    #[serde(rename = "mediaSubscription")]
    #[serde(rename_all = "camelCase")]
    MediaSubscription { subscription: Subscription },

    #[serde(rename = "mediaUnsubscription")]
    #[serde(rename_all = "camelCase")]
    MediaUnsubscription { subscription: Subscription },

    #[serde(rename = "voipData")]
    #[serde(rename_all = "camelCase")]
    VoIPData {
        channel_id: i64,
        user_id: i64,
        data_type: VoipDataType,
        data: Vec<u8>,
        timestamp: u64,
        key: String,
    },
}

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

use crate::{
    channel::Channel,
    group::{Group, GroupRoleRights},
    message::{File, MessageType, Reaction},
    role::Role,
    user::User,
    voip::{Subscription, VoipParticipant},
    transport::VoipDataType,
};

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub id: i64,
    pub server_name: String,
    pub avatar_file_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EventPayload {
    #[serde(rename = "channelCreated")]
    #[serde(rename_all = "camelCase")]
    ChannelCreated { channel: Channel },
    #[serde(rename = "channelUpdated")]
    #[serde(rename_all = "camelCase")]
    ChannelUpdated { channel: Channel },
    #[serde(rename = "channelDeleted")]
    #[serde(rename_all = "camelCase")]
    ChannelDeleted { channel_id: i64 },
    #[serde(rename = "groupCreated")]
    #[serde(rename_all = "camelCase")]
    GroupCreated { group: Group },
    #[serde(rename = "groupUpdated")]
    #[serde(rename_all = "camelCase")]
    GroupUpdated { group: Group },
    #[serde(rename = "groupDeleted")]
    #[serde(rename_all = "camelCase")]
    GroupDeleted { group_id: i64 },
    #[serde(rename = "roleCreated")]
    #[serde(rename_all = "camelCase")]
    RoleCreated { role: Role },
    #[serde(rename = "roleUpdated")]
    #[serde(rename_all = "camelCase")]
    RoleUpdated { role: Role },
    #[serde(rename = "roleDeleted")]
    #[serde(rename_all = "camelCase")]
    RoleDeleted { role_id: i64 },
    #[serde(rename = "userCreated")]
    #[serde(rename_all = "camelCase")]
    UserCreated { user: User },
    #[serde(rename = "userUpdated")]
    #[serde(rename_all = "camelCase")]
    UserUpdated { user: User },
    #[serde(rename = "userDeleted")]
    #[serde(rename_all = "camelCase")]
    UserDeleted { user_id: i64 },
    #[serde(rename = "serverUpdated")]
    #[serde(rename_all = "camelCase")]
    ServerUpdated { server: ServerConfig },
    #[serde(rename = "groupRoleRightUpdated")]
    #[serde(rename_all = "camelCase")]
    GroupRoleRightUpdated { right: GroupRoleRights },
    #[serde(rename = "voipParticipantCreated")]
    #[serde(rename_all = "camelCase")]
    VoipParticipantCreated { user: VoipParticipant },
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
        message_text: Option<String>,
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
    #[serde(rename = "reactionAdded")]
    #[serde(rename_all = "camelCase")]
    ReactionAdded {
        reaction: Reaction,
        message_type: MessageType,
    },
    #[serde(rename = "reactionRemoved")]
    #[serde(rename_all = "camelCase")]
    ReactionRemoved {
        message_id: i64,
        user_id: i64,
        emoji: String,
        message_type: MessageType,
    },

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

export const RIGHTS = {
  Ack: 1,
  Read: 2,
  Write: 4,
  ACL: 8,
};

export enum ChannelType {
  VoIP = "VoIP",
  Text = "Text",
}

export enum VoipDataType {
  Voice = "Voice",
  Camera = "Camera",
  Screen = "Screen",
  ScreenSound = "ScreenSound"
}

export enum MediaType {
  Camera = "camera",
  Microphone = "microphone",
  Screen = "screen_share",
  ScreenAudio = "screen_share_audio",
}


export interface Channel {
  channelId: number;
  channelName: string;
  groupId: number;
  channelType: ChannelType;
}


export type FileMetadata =
  | { type: "image"; mime: string; width: number; height: number }
  | { type: "video"; mime: string; width: number; height: number }
  | { type: "audio"; mime: string }
  | { type: "file"; mime: string };

export interface File {
  fileId: number;
  fileUuid: string;
  messageId: number;
  fileName: string;
  metadata: FileMetadata;
  fileSize: number;
  fileHash: string;
  createdAt: string;
}

export interface Reaction {
  reactionId: number;
  messageId: number;
  userId: number;
  emoji: string;
  createdAt: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  userIds: number[];
  hasReacted: boolean;
}

export interface Message {
  id: number;
  senderId: number;
  channelId: number | undefined;
  recipientId: number | undefined;
  messageText: string | undefined;
  createdAt: string;
  modifiedAt: string | undefined;
  replyToMessageId: number | undefined;
}

export interface MessagesResponse {
  messages: Message[];
  files: File[];
  reactions: Reaction[];
}


export interface Group {
  groupId: number;
  groupName: string;
}


export interface User {
  userId: number;
  username: string;
  createdAt: string;
  avatarFileId: number | undefined;
  roleId: number;
  status: UserStatusType,
}


export interface Role {
  roleId: number;
  roleName: string;
}


export enum UserStatusType {
  Online = "Online",
  Away = "Away",
  DoNotDisturb = "DoNotDisturb",
  Offline = "Offline",
}

export interface UserStatus {
  userId: number;
  status: UserStatusType;
}


export interface VoipParticipant {
  userId: number;
  channelId: number | undefined;
  recipientId: number | undefined;
  localDeafen: boolean;
  localMute: boolean;
  publishScreen: boolean;
  publishCamera: boolean;
  createdAt: string;
}

export interface GroupRoleRights {
  groupId: number;
  roleId: number;
  rights: number;
}

export interface MessageWithFiles {
  message: Message;
  files: File[];
}

export interface Session {
  sessionId: number;
  sessionToken: string;
  createdAt: string;
  expiresAt: string;
}

export interface RegisterResponse {
  user: User;
}

export interface ServerConfig {
  id: number;
  serverName: string;
  avatarFileId: number | undefined;
  maxFileSizeMb: number;
  maxFilesPerMessage: number;
}

export type QualityPreset = "720p" | "1080p" | "1440p" | "4k";

export interface PresetConfig {
  label: string;
  width: number;
  height: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, PresetConfig> = {
  "720p": {
    label: "720p (HD)",
    width: 1280,
    height: 720,
  },
  "1080p": {
    label: "1080p (Full HD)",
    width: 1920,
    height: 1080,
  },
  "1440p": {
    label: "1440p (QHD)",
    width: 2560,
    height: 1440,
  },
  "4k": {
    label: "4K (Ultra HD)",
    width: 3840,
    height: 2160,
  },
};

export const DEFAULT_PRESET: QualityPreset = "1080p";

export function getPresetOptions() {
  return Object.entries(QUALITY_PRESETS).map(([value, config]) => ({
    value,
    label: config.label,
  }));
}

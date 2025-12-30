import type { AudioPlayback } from "./lib/AudioPlayback";
import type { VideoPlayback } from "./lib/VideoPlayback";

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
  Screen = "screen",
  Camera = "camera",
  Audio = "audio",
}


export interface Channel {
  channelId: number;
  channelName: string;
  groupId: number;
  channelType: ChannelType;
}


export interface File {
  fileId: number;
  fileUuid: string;
  messageId: number;
  fileName: string;
  fileType: string;
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
  channelId: number | null;
  recipientId: number | null;
  messageText: string | null;
  createdAt: string;
  modifiedAt: string | null;
  replyToMessageId: number | null;
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
  avatarFileId: number | null;
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
  channelId: number | null;
  recipientId: number | null;
  localDeafen: boolean;
  localMute: boolean;
  publishScreen: boolean;
  publishCamera: boolean;
  createdAt: string;
  playback?: AudioPlayback
  cameraPlayback?: VideoPlayback,
  screenPlayback?: VideoPlayback,
  screenSoundPlayback?: AudioPlayback
}

export interface GroupRoleRights {
  groupId: number;
  roleId: number;
  rights: number;
}

export interface Subscription {
  userId: number;
  publisherId: number;
  mediaType: MediaType;
  createdAt: string;
}

export type VoipDataMessage =
  | {
    type: "speech"
    userId: number
    isSpeaking: boolean
  }
  | {
    type: "mediaData"
    userId: number
    mediaType: "voice" | "camera" | "screen" | "screenSound"
    data: ArrayBuffer
    timestamp: number
    realTimestamp: number
    key: "key" | "delta"
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
  avatarFileId: number | null;
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

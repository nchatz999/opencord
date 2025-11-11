import type { AudioPlayback } from "./contexts/AudioPlayback";
import type { VideoPlayback } from "./contexts/VideoPlayback";

export const RIGHTS = {
  Ack: 1,
  Listen: 2,
  Speak: 4,
  KickMute: 8,
  ACLBlacklist: 16,
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


export interface Message {
  id: number;
  senderId: number;
  channelId: number | null;
  recipientId: number | null;
  messageText: string;
  createdAt: string;
  modifiedAt: string | null;
  replyToMessageId: number | null;
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
  Invisible = "Invisible",
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


//composites
export interface VoipParticipantWithUser {
  user: User;
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

export interface MessageWithFiles {
  message: Message;
  files: File[];
}

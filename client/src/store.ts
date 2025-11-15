import { createStore, produce } from 'solid-js/store'
import {
  type Channel,
  type File,
  type Group,
  type Message,
  type Role,
  type User,
  type VoipParticipant,
  UserStatusType,
  type GroupRoleRights,
  type VoipDataMessage,
  type VoipParticipantWithUser,
} from './model'
import { decode, encode } from '@msgpack/msgpack'
import { fetchApi } from './utils'
import { Microphone } from './contexts/MicrophoneProvider'
import { AudioPlayback, createSharedAudioContext } from './contexts/AudioPlayback'
import { ScreenShare } from './contexts/ScreenShareProvider'
import { Camera } from './contexts/CameraProvider'
import { VideoPlayback } from './contexts/VideoPlayback'
import { OutputManager } from './contexts/OutputProvider'
import { RTCPProtocol } from 'opencord-transport'

export type AppState =
  | { type: 'loading' }
  | { type: 'unauthenticated' }
  | { type: 'connecting' }
  | { type: 'authenticated' }
  | { type: 'connectionError' }


export type ModalType =
  | { type: 'groupSettings'; id: number }
  | { type: 'createGroup'; id: number }
  | { type: 'channelSettings'; id: number }
  | { type: 'roleSettings'; id: number }
  | { type: 'userSettings'; id: number }
  | { type: 'createRole'; id: number }
  | { type: 'createChannel'; id: number }
  | { type: 'serverSettings'; id: number }
  | { type: 'close'; id: number }

export interface EventLogEntry {
  id: number;
  timestamp: string;
  type: string;
  data: any;
}

export interface State {
  appState: AppState
  modal: ModalType
  sessionId: string | null
  roles: Role[]
  users: User[]
  channels: Channel[]
  groups: Group[]
  messages: Message[]
  files: File[]
  currentUser: number | null

  voipState: VoipParticipant[]
  speakingStates: Record<number, boolean>
  audio: AudioContext
  subscribedStreams: number[]
  groupRoleRights: GroupRoleRights[]

  eventLog: EventLogEntry[]
  notification: Record<number, boolean>
  context: { type: 'channel' | 'dm'; id: number } | undefined
  voipContext: { type: 'channel' | 'dm'; id: number } | undefined
  activeContext: 'channel' | 'dm'
  channelsVisited: number[]
  dmsVisited: number[]
}

const initialState: State = {
  appState: { type: 'loading' },
  modal: { type: 'close', id: 0 },
  sessionId: null,
  activeContext: 'channel',
  roles: [],
  users: [],
  channels: [],
  groups: [],
  messages: [],
  currentUser: null,
  groupRoleRights: [],
  voipState: [],
  speakingStates: {},
  audio: createSharedAudioContext(),
  files: [],
  eventLog: [],
  notification: {},
  context: undefined,
  voipContext: undefined,
  channelsVisited: [],
  dmsVisited: [],
  subscribedStreams: [],
}


export type VoipType =
  | { type: 'Channel'; channel_id: number }
  | { type: 'Direct'; recipient_id: number }

export type MessageType =
  | { type: 'Channel'; channel_id: number }
  | { type: 'Direct'; recipient_id: number }

// VoIP Data Types
export enum VoipDataType {
  Voice = 'voice',
  Camera = 'camera',
  Screen = 'screen',
  ScreenSound = 'screenSound',
}

export enum KeyType {
  Key = 'key',
  Delta = 'delta',
}

export interface SpeechPayload {
  type: 'speech';
  userId: number;
  isSpeaking: boolean;
}

export interface MediaPayload {
  type: 'media';
  userId: number;
  mediaType: VoipDataType;
  data: number[];
  timestamp: number;
  realTimestamp: number;
  key: KeyType;
}

export type VoipPayload = SpeechPayload | MediaPayload;

// Control Message Types
export enum AnswerType {
  Accept = 'accept',
  Decline = 'decline',
}

export interface AcceptAnswer {
  type: AnswerType.Accept;
}

export interface DeclineAnswer {
  type: AnswerType.Decline;
  reason: string;
}

export type AnswerPayload = AcceptAnswer | DeclineAnswer;

export interface ConnectControl {
  type: 'connect';
  token: string;
}

export interface AnswerControl {
  type: 'answer';
  payload: AnswerPayload;
}

export interface CloseControl {
  type: 'close';
  reason: string;
}

export type ControlPayload = ConnectControl | AnswerControl | CloseControl;

// Connection Message Types
export interface VoipConnectionMessage {
  type: 'voip';
  payload: VoipPayload;
}

export interface EventConnectionMessage {
  type: 'event';
  payload: ServerEvent;
}

export interface ControlConnectionMessage {
  type: 'control';
  payload: ControlPayload;
}

export type ConnectionMessage = VoipConnectionMessage | EventConnectionMessage | ControlConnectionMessage;

export type ServerEvent =
  | { type: 'ChannelUpdated'; channel: Channel }
  | { type: 'ChannelDeleted'; channel_id: number }
  | { type: 'GroupUpdated'; group: Group }
  | { type: 'GroupDeleted'; group_id: number }
  | { type: 'RoleUpdated'; role: Role }
  | { type: 'RoleDeleted'; role_id: number }
  | { type: 'UserUpdated'; user: User }
  | { type: 'UserDeleted'; user_id: number }
  | { type: 'GroupRoleRightUpdated'; group_id: number; role_id: number; rights: number }
  | { type: 'VoipParticipantUpdated'; user: VoipParticipant }
  | { type: 'VoipParticipantDeleted'; user_id: number }
  | { type: 'MessageCreated'; message_id: number; sender_id: number; message_type: MessageType; message_text: string; reply_to_message_id: number | null; timestamp: string; files: File[] }
  | { type: 'MessageUpdated'; message_id: number; message_text: string }
  | { type: 'MessageDeleted'; message_id: number }
  | { type: 'GroupReveal'; group_id: number; group_name: string; channels: Channel[]; voip_participants: VoipParticipant[] }
  | { type: 'GroupHide'; group_id: number }

export const [state, setState] = createStore(initialState)

export class UserDomain {
  constructor() { }

  list(): User[] {
    return state.users;
  }

  getAppState(): AppState {
    return state.appState
  }

  getUserColorStatusById(id: number) {
    let user = this.findById(id)
    const statusColors = {
      online: 'bg-green-500',
      idle: 'bg-yellow-500',
      dnd: 'bg-red-500',
      offline: 'bg-gray-500',
    } as const
    if (!user) return statusColors.offline
    switch (user.status) {
      case UserStatusType.Online:
        return statusColors.online
      case UserStatusType.Away:
        return statusColors.idle
      case UserStatusType.DoNotDisturb:
        return statusColors.dnd
      default:
        return statusColors.offline
    }
  }

  getCurrent(): User {
    let user = state.users.find(u => u.userId === state.currentUser);
    if (!user) throw new Error('Issue')
    return user;
  }

  findById(id: number): User | undefined {
    return state.users.find(u => u.userId === id);
  }


  replaceAll(users: User[]): void {
    setState('users', users);
  }

  setAppState(appState: AppState) {
    setState('appState', appState);
  }

  setCurrentUser(userId: number | null): void {
    setState('currentUser', userId);
  }

  update(id: number, updates: Partial<User>): void {
    setState(
      'users',
      produce(users => {
        const index = users.findIndex(u => u.userId === id);
        if (index !== -1) {
          users[index] = { ...users[index], ...updates };
        } else {
          users.push({ userId: id, ...updates } as User);
        }
      })
    );
  }

  remove(id: number): void {
    setState(
      'users',
      produce(users => {
        const index = users.findIndex(u => u.userId === id);
        if (index !== -1) {
          users.splice(index, 1);
        }
      })
    );
  }
}

export class GroupDomain {
  constructor() { }

  list(): Group[] {
    return state.groups;
  }

  findById(id: number): Group | undefined {
    return state.groups.find(g => g.groupId === id);
  }

  getChannels(groupId: number): Channel[] {
    return state.channels.filter(c => c.groupId === groupId);
  }

  replaceAll(groups: Group[]): void {
    setState('groups', groups);
  }

  add(group: Group): void {
    setState(
      'groups',
      produce(groups => {
        groups.push(group);
      })
    );
  }

  update(id: number, updates: Partial<Group>): void {
    setState(
      'groups',
      produce(groups => {
        const index = groups.findIndex(g => g.groupId === id);
        if (index !== -1) {
          groups[index] = { ...groups[index], ...updates };
        } else {
          groups.push({ groupId: id, ...updates } as Group);
        }
      })
    );
  }

  delete(id: number): void {
    setState(
      'groups',
      produce(groups => {
        const index = groups.findIndex(g => g.groupId === id);
        if (index !== -1) {
          groups.splice(index, 1);
        }
      })
    );

    const channelsToDelete = state.channels.filter(c => c.groupId === id);
    channelsToDelete.forEach(channel => {
      channelDomain.delete(channel.channelId);
    });

    channelsToDelete.forEach(channel => {
      const participantsToRemove = state.voipState.filter(p => p.channelId === channel.channelId);
      participantsToRemove.forEach(participant => {
        voipDomain.delete(participant.userId);
      });
    });
  }

}

export class ChannelDomain {
  constructor() { }

  list(): Channel[] {
    return state.channels;
  }

  findById(id: number): Channel | undefined {
    return state.channels.find(c => c.channelId === id);
  }

  replaceAll(channels: Channel[]): void {
    setState('channels', channels);
  }

  add(channel: Channel): void {
    setState(
      'channels',
      produce(channels => {
        channels.push(channel);
      })
    );
  }

  update(id: number, updates: Partial<Channel>): void {
    setState(
      'channels',
      produce(channels => {
        const index = channels.findIndex(c => c.channelId === id);
        if (index !== -1) {
          channels[index] = { ...channels[index], ...updates };
        } else {
          channels.push({ channelId: id, ...updates } as Channel);
        }
      })
    );
  }

  delete(id: number): void {
    setState(
      'channels',
      produce(channels => {
        const index = channels.findIndex(c => c.channelId === id);
        if (index !== -1) {
          channels.splice(index, 1);
        }
      })
    );

    const participantsToRemove = state.voipState.filter(p => p.channelId === id);
    participantsToRemove.forEach(participant => {
      voipDomain.delete(participant.userId);
    });
  }

}

export class MessageDomain {
  constructor() { }

  list(): Message[] {
    return state.messages;
  }
  findByChannel(channelId: number): Message[] {

    return state.messages
      .filter(m => m.channelId === channelId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  findByRecipient(recipientId: number): Message[] {
    const currentUserId = state.currentUser;
    if (!currentUserId) return [];
    return state.messages.filter(
      m =>
        m.channelId === null &&
        ((m.senderId === currentUserId && m.recipientId === recipientId) ||
          (m.senderId === recipientId && m.recipientId === currentUserId))
    );
  }
  getContext() {
    return state.context
  }

  findById(id: number): Message | undefined {
    return state.messages.find(m => m.id === id);
  }

  getAttachments(messageId: number): File[] {
    return state.files.filter(f => f.messageId === messageId);
  }


  setContext(ctx: { type: "channel" | "dm", id: number }): void {
    setState("context", ctx)
  }

  insert(newMessage: Message) {
    setState(
      'messages',
      produce(messages => {
        const newMessageTime = new Date(newMessage.createdAt).getTime();

        if (!messages || messages.length === 0) {
          messages.push(newMessage);
          return;
        }

        const lastMessageTime = new Date(messages[messages.length - 1].createdAt).getTime();
        if (newMessageTime >= lastMessageTime) {
          messages.push(newMessage);
          return;
        }

        const firstMessageTime = new Date(messages[0].createdAt).getTime();
        if (newMessageTime <= firstMessageTime) {
          messages.unshift(newMessage);
          return;
        }

        let left = 0;
        let right = messages.length - 1;

        while (left <= right) {
          const mid = Math.floor((left + right) / 2);
          const midMessageTime = new Date(messages[mid].createdAt).getTime();

          if (midMessageTime <= newMessageTime) {
            left = mid + 1;
          } else {
            right = mid - 1;
          }
        }

        messages.splice(left, 0, newMessage);
      })
    );
  }

  insertMany(newMessages: Message[]): void {
    setState(
      'messages',
      produce(messages => {
        newMessages.forEach((message) => {
          this.insert(message)
        })
      })
    );
  }

  update(id: number, updates: Partial<Message>): void {
    setState(
      'messages',
      produce(messages => {
        const index = messages.findIndex(m => m.id === id);
        if (index !== -1) {
          messages[index] = { ...messages[index], ...updates };
        }
      })
    );
  }

  delete(id: number): void {
    setState(
      'messages',
      produce(messages => {
        const index = messages.findIndex(m => m.id === id);
        if (index !== -1) {
          messages.splice(index, 1);
        }
      })
    );
  }

}

export class RoleDomain {
  constructor() { }

  list(): Role[] {
    return state.roles;
  }

  findById(id: number): Role | undefined {
    return state.roles.find(r => r.roleId === id)
  }


  add(roleId: number, roleName: string): void {
    setState(
      'roles',
      produce(roles => {
        roles.push({ roleId, roleName })
      })
    );
  }

  update(id: number, updates: Partial<Role>): void {
    setState(
      'roles',
      produce(roles => {
        const index = roles.findIndex(r => r.roleId === id);
        if (index !== -1) {
          roles[index] = { ...roles[index], ...updates };
        } else {
          roles.push({ roleId: id, ...updates } as Role);
        }
      })
    );
  }

  replaceAll(roles: Role[]): void {
    setState('roles', roles);
  }

  delete(roleId: number): void {
    setState(
      'roles',
      produce(roles => {
        roles = roles.filter((role) => role.roleId != roleId)
      })
    );
  }

}



export class AclDomain {
  constructor() { }

  list(): GroupRoleRights[] {
    return state.groupRoleRights;
  }

  findByGroup(groupId: number): GroupRoleRights[] {
    return state.groupRoleRights.filter(r => r.groupId === groupId);
  }

  getChannelRights(channelId: number, roleId: number): number {
    let channel = channelDomain.findById(channelId)
    if (!channel) return 0
    let group = groupDomain.findById(channel.groupId)
    if (!group) return 0
    return this.getGroupRights(group.groupId, roleId) || 0
  }
  getGroupRights(groupId: number, roleId: number): number | undefined {
    if ([0, 1].includes(roleId)) return 16
    let groupRoleRight = state.groupRoleRights.find(r => r.groupId === groupId && r.roleId === roleId)
    if (!groupRoleRight) return undefined
    return groupRoleRight.rights;
  }

  replaceAll(rights: GroupRoleRights[]): void {
    setState('groupRoleRights', rights);
  }

  grant(groupId: number, roleId: number, rights: number): void {
    setState(
      'groupRoleRights',
      produce(currentRights => {
        const index = currentRights.findIndex(
          r => r.groupId === groupId && r.roleId === roleId
        );
        if (index !== -1) {
          currentRights[index].rights = rights;
        } else {
          currentRights.push({ groupId, roleId, rights });
        }
      })
    );

    if (rights === 0) {

      const messagesToRemove = messageDomain.list().filter(message => {
        if (message.channelId === null) return false;
        const channel = channelDomain.findById(message.channelId);
        if (!channel || channel.groupId !== groupId) return false;
        const sender = userDomain.findById(message.senderId);
        return sender && sender.roleId === roleId;
      });
      messagesToRemove.forEach(message => {
        messageDomain.delete(message.id);
      });

      const participantsToRemove = voipDomain.list().filter(participant => {
        if (participant.channelId === null) return false;
        const channel = channelDomain.findById(participant.channelId);
        if (!channel || channel.groupId !== groupId) return false;
        return participant.user.roleId === roleId;
      });
      participantsToRemove.forEach(participant => {
        voipDomain.delete(participant.user.userId);
      });
    }
  }

}

export class VoipDomain {
  constructor() { }


  getAudioContext(): AudioContext {
    return state.audio
  }

  getCurrentContext(): { type: 'channel' | 'dm'; id: number } | undefined {
    return state.voipContext
  }


  list(): VoipParticipantWithUser[] {
    return state.voipState.flatMap((participant) => {
      const user = userDomain.findById(participant.userId);
      return user ? [{ ...participant, user }] : [];
    });
  }

  findByChannel(channelId: number): VoipParticipantWithUser[] {
    return state.voipState
      .filter((participant) => participant.channelId == channelId)
      .flatMap((participant) => {
        const user = userDomain.findById(participant.userId);
        return user ? [{ ...participant, user }] : [];
      });
  }


  findById(userId: number): VoipParticipantWithUser | undefined {
    let user = userDomain.findById(userId)
    if (!user) return undefined
    let participant = state.voipState.find(p => p.userId === userId)
    if (participant) {
      return { ...participant, user: user }
    }
    return undefined
  }

  getCurrentParticipant(): VoipParticipant | undefined {
    return state.voipState.find(p => p.userId === userDomain.getCurrent().userId);
  }

  replaceAll(participants: VoipParticipant[]): void {
    setState('voipState', participants.map((part) => {
      part.playback = new AudioPlayback(voipDomain.getAudioContext(), 200)
      part.screenPlayback = new VideoPlayback(200)
      part.cameraPlayback = new VideoPlayback(200)
      part.screenSoundPlayback = new AudioPlayback(voipDomain.getAudioContext(), 200)
      part.screenSoundPlayback.setVolume(0)
      return part
    }));
  }



  update(userId: number, updates: Partial<VoipParticipant>): void {
    setState(
      'voipState',
      produce(voipState => {
        const index = voipState.findIndex(p => p.userId === userId);
        updates.playback = new AudioPlayback(voipDomain.getAudioContext(), 200)
        updates.screenPlayback = new VideoPlayback(200)
        updates.cameraPlayback = new VideoPlayback(200)
        updates.screenSoundPlayback = new AudioPlayback(voipDomain.getAudioContext(), 200)
        updates.screenSoundPlayback.setVolume(0)
        if (index !== -1) {
          voipState[index] = { ...voipState[index], ...updates };
        } else {
          voipState.push({ userId, ...updates } as VoipParticipant);
        }
      })
    );
  }

  streamMedia(userId: number, mediaType: 'voice' | 'screen' | 'camera' | 'screenSound', packet: EncodedAudioChunk | EncodedVideoChunk, timestamp: number) {
    const voipUser = voipDomain.findById(userId);
    if (!voipUser) return;

    switch (mediaType) {
      case 'voice':
        if (voipUser.playback) {
          voipUser.playback.pushChunk(packet as EncodedAudioChunk, timestamp);
        }
        break;

      case 'screen':
        if (voipUser.screenPlayback) {
          voipUser.screenPlayback.pushFrame(packet as EncodedVideoChunk, timestamp);
        }
        break;

      case 'camera':
        if (voipUser.cameraPlayback) {
          voipUser.cameraPlayback.pushFrame(packet as EncodedVideoChunk, timestamp);
        }
        break;

      case 'screenSound':
        if (voipUser.screenSoundPlayback) {
          voipUser.screenSoundPlayback.pushChunk(packet as EncodedAudioChunk, timestamp);
        }
        break;
    }
  }


  updateSpeakingState(userId: number, isSpeaking: boolean) {
    setState('speakingStates', userId, isSpeaking);
  }

  getSpeakingState(userId: number): boolean {
    return state.speakingStates[userId] || false;
  }

  clearSpeakingState(userId: number): void {
    setState('speakingStates', produce(states => {
      delete states[userId];
    }));
  }


  delete(userId: number): void {
    setState(
      'voipState',
      produce(voipState => {
        console.log(voipState)
        const index = voipState.findIndex(p => p.userId === userId);
        if (index !== -1) {
          voipState.splice(index, 1);
        }
      })
    );
    this.clearSpeakingState(userId);
  }


  switchContext(ctx: { type: 'channel' | 'dm'; id: number } | undefined) {
    setState("voipContext", ctx)
  }

  async resume() {
    await state.audio.resume()
  }

  adjustVolume(userId: number, volume: number): void {
    const participant = this.findById(userId);
    if (participant && participant.playback) {
      participant.playback.setVolume(volume);
    }
  }

  getVolume(userId: number): number {
    const participant = this.findById(userId);
    if (participant && participant.playback) {
      return participant.playback.volume();
    }
    return 100;
  }

  adjustScreenAudio(userId: number, volume: number): void {
    const participant = this.findById(userId);
    if (participant && participant.screenSoundPlayback) {
      participant.screenSoundPlayback.setVolume(volume);
    }
  }

  getScreenAudioVolume(userId: number): number {
    const participant = this.findById(userId);
    if (participant && participant.screenSoundPlayback) {
      return participant.screenSoundPlayback.volume();
    }
    return 100;
  }

  unpublishAll(userId: number): void {
    setState(
      'voipState',
      produce(streams => {
        for (let i = streams.length - 1; i >= 0; i--) {
          if (streams[i].userId === userId) {
            streams.splice(i, 1);
          }
        }
      })
    );
  }
}

export class FileDomain {
  constructor() { }

  list(): File[] {
    return state.files;
  }

  findByid(id: number): File | undefined {
    return state.files.find(f => f.fileId === id);
  }

  replaceAll(files: File[]): void {
    setState('files', files);
  }

  add(file: File): void {
    setState(
      'files',
      produce(files => {
        files.push(file);
      })
    );
  }

  addMany(newFiles: File[]): void {
    setState(
      'files',
      produce(files => {
        files.push(...newFiles);
      })
    );
  }
}


export class ModalDomain {
  constructor() { }

  getCurrent() {
    return state.modal;
  }

  open(modal: ModalType): void {
    setState('modal', modal);
  }
}



export const modalDomain = new ModalDomain();
export const userDomain = new UserDomain();
export const groupDomain = new GroupDomain();
export const channelDomain = new ChannelDomain();
export const messageDomain = new MessageDomain();
export const roleDomain = new RoleDomain();
export const aclDomain = new AclDomain();
export const voipDomain = new VoipDomain();
export const fileDomain = new FileDomain();

let eventIdCounter = 0;

function logEvent(type: string, data: any): void {
  const logEntry: EventLogEntry = {
    id: ++eventIdCounter,
    timestamp: new Date().toISOString(),
    type,
    data: structuredClone(data)
  };

  setState('eventLog', produce(log => {
    log.push(logEntry);
    if (log.length > 1000) {
      log.splice(0, log.length - 1000);
    }
  }));
}

export function handleServerEvent(event: ServerEvent): void {
  logEvent(event.type, event);

  switch (event.type) {
    case 'ChannelUpdated':
      channelDomain.update(event.channel.channelId, event.channel);
      break;

    case 'ChannelDeleted':
      channelDomain.delete(event.channel_id);
      break;

    case 'GroupUpdated':
      groupDomain.update(event.group.groupId, event.group);
      break;

    case 'GroupDeleted':
      groupDomain.delete(event.group_id);
      break;

    case 'RoleUpdated':
      roleDomain.update(event.role.roleId, event.role);
      break;

    case 'RoleDeleted':
      roleDomain.delete(event.role_id);
      break;

    case 'UserUpdated':
      userDomain.update(event.user.userId, event.user);
      break;

    case 'UserDeleted':
      userDomain.remove(event.user_id);
      break;

    case 'GroupRoleRightUpdated':
      aclDomain.grant(event.group_id, event.role_id, event.rights);
      break;

    case 'VoipParticipantUpdated':
      voipDomain.update(event.user.userId, event.user);
      break;

    case 'VoipParticipantDeleted':
      voipDomain.delete(event.user_id);
      break;

    case 'MessageCreated':
      const messageType = event.message_type;
      const message: Message = {
        id: event.message_id,
        senderId: event.sender_id,
        channelId: messageType.type === 'Channel' ? messageType.channel_id : null,
        recipientId: messageType.type === 'Direct' ? messageType.recipient_id : null,
        messageText: event.message_text,
        replyToMessageId: event.reply_to_message_id,
        modifiedAt: event.timestamp,
        createdAt: event.timestamp
      };
      messageDomain.insertMany([message]);

      event.files.forEach(fileInfo => {
        fileDomain.add(fileInfo);
      });

      break;

    case 'MessageUpdated':
      messageDomain.update(event.message_id, {
        messageText: event.message_text,
      });
      break;

    case 'MessageDeleted':
      messageDomain.delete(event.message_id);
      break;

    case 'GroupReveal':
      if (!groupDomain.findById(event.group_id)) {
        groupDomain.add({
          groupId: event.group_id,
          groupName: event.group_name,
        });
      }

      event.channels.forEach(channel => {
        if (!channelDomain.findById(channel.channelId)) {
          channelDomain.add(channel);
        }
      });

      event.voip_participants.forEach(participant => {
        voipDomain.update(participant.userId, participant);
      });
      break;

    case 'GroupHide':
      groupDomain.delete(event.group_id);

      const channelsToRemove = channelDomain.list().filter((channel) => channel.groupId == event.group_id);
      channelsToRemove.forEach(channel => {
        channelDomain.delete(channel.channelId);
      });

      const messagesToRemove = messageDomain.list().filter((message) => {
        if (message.channelId === null) return false;
        const channel = channelDomain.findById(message.channelId);
        return channel && channel.groupId === event.group_id;
      });
      messagesToRemove.forEach(message => {
        messageDomain.delete(message.id);
      });

      const participantsToRemove = voipDomain.list().filter((participant) => {
        if (participant.channelId === null) return false;
        const channel = channelDomain.findById(participant.channelId);
        return channel && channel.groupId === event.group_id;
      });
      participantsToRemove.forEach(participant => {
        voipDomain.delete(participant.user.userId);
      });

      break;

    default:
      break;
  }
}



export const getInitialData = async () => {

  try {
    const [
      groupsResult,
      channelsResult,
      rolesResult,
      groupRightsResult,
      usersResult,
      voipStatusResult,
    ] = await Promise.all([
      fetchApi<Group[]>('/group', { method: 'GET' }),
      fetchApi<Channel[]>('/channel', { method: 'GET' }),
      fetchApi<Role[]>('/role', { method: 'GET' }),
      fetchApi<GroupRoleRights[]>('/acl/group-role-rights', { method: 'GET' }),
      fetchApi<User[]>('/user', { method: 'GET' }),
      fetchApi<VoipParticipant[]>('/voip/participants', { method: 'GET' }),
    ])

    if (!groupsResult.ok || !channelsResult.ok || !rolesResult.ok || !usersResult.ok || !groupRightsResult.ok || !voipStatusResult.ok) {
      userDomain.setAppState({ type: 'unauthenticated' });
      return;
    }

    groupDomain.replaceAll(groupsResult.value)
    channelDomain.replaceAll(channelsResult.value)
    roleDomain.replaceAll(rolesResult.value)
    userDomain.replaceAll(usersResult.value)
    aclDomain.replaceAll(groupRightsResult.value)
    voipDomain.replaceAll(voipStatusResult.value)
  } catch (error) {
    userDomain.setAppState({ type: 'unauthenticated' });
  }
}

function hexToUint8Array(hexString: any) {
  const cleanHex = hexString.replace(/[^0-9A-Fa-f]/g, '');
  return new Uint8Array(
    cleanHex.match(/.{1,2}/g).map((byte: any) => parseInt(byte, 16))
  );
}

const certificateHash = {
  algorithm: 'sha-256',
  value: hexToUint8Array(import.meta.env.VITE_CERT_HASH)
};

export let connection = new RTCPProtocol(`https://${window.location.hostname}:4443/session`,
  certificateHash,
  (data: any) => {
    let frame = decode(data) as VoipPayload
    if (frame.type === "media") {
      switch (frame.mediaType) {
        case VoipDataType.Voice: {
          let packet = new EncodedAudioChunk({
            type: frame.key,
            timestamp: frame.realTimestamp,
            duration: undefined,
            data: new Uint8Array(frame.data)
          })
          voipDomain.streamMedia(frame.userId, 'voice', packet, frame.timestamp)
          break
        }
        case VoipDataType.Camera: {
          let videoPacket = new EncodedVideoChunk({
            type: frame.key as EncodedVideoChunkType,
            timestamp: frame.realTimestamp,
            duration: undefined,
            data: new Uint8Array(frame.data)
          })
          voipDomain.streamMedia(frame.userId, 'camera', videoPacket, frame.timestamp)
          break
        }
        case VoipDataType.Screen: {
          let videoPacket = new EncodedVideoChunk({
            type: frame.key as EncodedVideoChunkType,
            timestamp: frame.realTimestamp,
            duration: undefined,
            data: new Uint8Array(frame.data)
          })
          voipDomain.streamMedia(frame.userId, 'screen', videoPacket, frame.timestamp)
          break
        }
        case VoipDataType.ScreenSound: {
          let videoPacket = new EncodedAudioChunk({
            type: frame.key as EncodedAudioChunkType,
            timestamp: frame.realTimestamp,
            duration: undefined,
            data: new Uint8Array(frame.data)
          })
          voipDomain.streamMedia(frame.userId, 'screenSound', videoPacket, frame.timestamp)
        }
      }
    } else if (frame.type === "speech") {
      voipDomain.updateSpeakingState(frame.userId, frame.isSpeaking)
    }
  },
  (data) => {
    let maybeEvent = decode(data) as ServerEvent
    if (maybeEvent) {
      handleServerEvent(maybeEvent)
    }
  },
  () => { },
  () => { console.log("on disconnect"); userDomain.setAppState({ type: "connectionError" }) },
)



export let microphone = new Microphone();
microphone.onEncodedData((data) => {
  let user = voipDomain.getCurrentParticipant()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.send(encode({
    type: "media",
    userId: user.userId,
    mediaType: VoipDataType.Voice,
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as MediaPayload))
})

microphone.onSpeech((speech) => {
  let user = voipDomain.getCurrentParticipant()
  if (!user) return
  connection.send(encode({
    type: "speech",
    userId: user.userId,
    isSpeaking: speech
  } as SpeechPayload))

})

export let screenShare = new ScreenShare();
screenShare.onEncodedVideoData((data) => {
  let user = voipDomain.getCurrentParticipant()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.send(encode({
    type: "media",
    userId: user.userId,
    mediaType: VoipDataType.Screen,
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as MediaPayload))
})

screenShare.onEncodedAudioData((data) => {
  let user = voipDomain.getCurrentParticipant()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.send(encode({
    type: "media",
    userId: user.userId,
    mediaType: VoipDataType.ScreenSound,
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as MediaPayload))
})

export let camera = new Camera();
camera.onEncodedData((data) => {
  let user = voipDomain.getCurrentParticipant()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.send(encode({
    type: "media",
    userId: user.userId,
    mediaType: VoipDataType.Camera,
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as MediaPayload))

})

export const outputManager = new OutputManager();

export function resetStore(): void {
  setState(() => ({
    appState: { type: 'loading' },
    modal: { type: 'close', id: 0 },
    status: "disconnected",
    sessionId: null,
    activeContext: undefined,
    roles: [],
    users: [],
    channels: [],
    groups: [],
    messages: [],
    currentUser: null,
    groupRoleRights: [],
    voipState: [],
    speakingStates: {},
    audio: createSharedAudioContext(),
    files: [],
    eventLog: [],
    notification: {},
    context: undefined,
    voipContext: undefined,
    channelsVisited: [],
    dmsVisited: [],
    subscribedStreams: [],
  }));
}







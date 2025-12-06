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
  type VoipParticipantWithUser,
  type Subscription,
  type MediaType,
} from './model'
import { fetchApi } from './utils'
import { Microphone } from './contexts/MicrophoneProvider'
import { AudioPlayback, createSharedAudioContext } from './contexts/AudioPlayback'
import { ScreenShare } from './contexts/ScreenShareProvider'
import { Camera } from './contexts/CameraProvider'
import { VideoPlayback } from './contexts/VideoPlayback'
import { OutputManager } from './contexts/OutputProvider'
import { TransportProvider } from './contexts/TransportProvider'
import { getServerUrlOrDefault } from './contexts/ServerConfig'

export type AppState =
  | { type: 'loading' }
  | { type: 'unauthenticated' }
  | { type: 'connecting' }
  | { type: 'authenticated' }
  | { type: 'connectionError'; reason: string }


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
  data: unknown;
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
  subscriptions: Subscription[]
  groupRoleRights: GroupRoleRights[]

  eventLog: EventLogEntry[]
  notification: Record<number, boolean>
  context: { type: 'channel' | 'dm'; id: number } | undefined
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
  channelsVisited: [],
  dmsVisited: [],
  subscribedStreams: [],
  subscriptions: [],
}

export type VoipType =
  | { type: 'Channel'; channel_id: number }
  | { type: 'Direct'; recipient_id: number }

export type MessageType =
  | { type: 'Channel'; channel_id: number }
  | { type: 'Direct'; recipient_id: number }

export type AnswerPayload =
  | {
    type: "accept";
  }
  | {
    type: "decline";
    reason: string;
  };

export type ControlPayload =
  | {
    type: "connect";
    token: string;
  }
  | {
    type: "answer";
    answer: AnswerPayload;
  }
  | {
    type: "close";
    reason: string;
  };

export type ConnectionMessage =
  | {
    type: "voip";
    payload: VoipPayload;
  }
  | {
    type: "event";
    payload: EventPayload;
  }
  | {
    type: "control";
    payload: ControlPayload;
  };

export type EventPayload =
  | {
    type: "channelUpdated";
    channel: Channel;
  }
  | {
    type: "channelDeleted";
    channelId: number;
  }
  | {
    type: "groupUpdated";
    group: Group;
  }
  | {
    type: "groupDeleted";
    groupId: number;
  }
  | {
    type: "roleUpdated";
    role: Role;
  }
  | {
    type: "roleDeleted";
    roleId: number;
  }
  | {
    type: "userUpdated";
    user: User;
  }
  | {
    type: "userDeleted";
    userId: number;
  }
  | {
    type: "groupRoleRightUpdated";
    right: GroupRoleRights;
  }
  | {
    type: "voipParticipantUpdated";
    user: VoipParticipant;
  }
  | {
    type: "voipParticipantDeleted";
    userId: number;
  }
  | {
    type: "messageCreated";
    messageId: number;
    senderId: number;
    messageType: MessageType;
    messageText: string;
    replyToMessageId: number | null;
    timestamp: string;
    files: File[];
  }
  | {
    type: "messageUpdated";
    messageId: number;
    messageText: string;
  }
  | {
    type: "messageDeleted";
    messageId: number;
  }
  | {
    type: "groupReveal";
    groupId: number;
    groupName: string;
    channels: Channel[];
    voipParticipants: VoipParticipant[];
    right: GroupRoleRights;
  }
  | {
    type: "groupHide";
    groupId: number;
  } |
  {
    type: "mediaSubscription"
    subscription: Subscription
  }
  | {
    type: "mediaUnsubscription"
    subscription: Subscription
  }
  | {
    type: "voIPData";
    channelId: number;
    userId: number;
    dataType: VoipDataType;
    data: number[];
    timestamp: number;
    key: string;
  };

type VoipDataType = "voice" | "camera" | "screen" | "screenSound";

type KeyType = "key" | "delta";

export type VoipPayload =
  | {
    type: "speech";
    userId: number;
    isSpeaking: boolean;
  }
  | {
    type: "media";
    userId: number;
    mediaType: VoipDataType;
    data: number[];
    timestamp: number;
    realTimestamp: number;
    key: KeyType;
  };

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
    newMessages.forEach((message) => {
      this.insert(message)
    })
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

  isSubscribedToMedia(publisherId: number, mediaType: MediaType): boolean {
    const currentUserId = userDomain.getCurrent().userId;
    return state.subscriptions?.some(
      sub => sub.userId === currentUserId &&
        sub.publisherId === publisherId &&
        sub.mediaType === mediaType
    ) || false;
  }

  addSubscription(subscription: Subscription): void {
    setState(
      'subscriptions',
      produce(subscriptions => {
        const exists = subscriptions.some(
          sub => sub.userId === subscription.userId &&
            sub.publisherId === subscription.publisherId &&
            sub.mediaType === subscription.mediaType
        );
        if (!exists) {
          subscriptions.push(subscription);
        }
      })
    );
  }

  removeSubscription(userId: number, publisherId: number, mediaType: MediaType): void {
    setState(
      'subscriptions',
      produce(subscriptions => {
        const index = subscriptions.findIndex(
          sub => sub.userId === userId &&
            sub.publisherId === publisherId &&
            sub.mediaType === mediaType
        );
        if (index !== -1) {
          subscriptions.splice(index, 1);
        }
      })
    );
  }

  replaceAllSubscriptions(subscriptions: Subscription[]): void {
    setState('subscriptions', subscriptions);
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

  getCurrent(): VoipParticipant | undefined {
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
        const index = voipState.findIndex(p => p.userId === userId);
        if (index !== -1) {
          voipState.splice(index, 1);
        }
      })
    );
    this.clearSpeakingState(userId);
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

function logEvent(type: string, data: unknown): void {
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

export function handleServerEvent(event: EventPayload): void {
  logEvent(event.type, event);

  switch (event.type) {
    case 'mediaSubscription':
      voipDomain.addSubscription(event.subscription);
      break;

    case 'mediaUnsubscription':
      voipDomain.removeSubscription(
        event.subscription.userId,
        event.subscription.publisherId,
        event.subscription.mediaType
      );
      break;
    case 'channelUpdated':
      channelDomain.update(event.channel.channelId, event.channel);
      break;

    case 'channelDeleted':
      channelDomain.delete(event.channelId);
      break;

    case 'groupUpdated':
      groupDomain.update(event.group.groupId, event.group);
      break;

    case 'groupDeleted':
      groupDomain.delete(event.groupId);
      break;

    case 'roleUpdated':
      roleDomain.update(event.role.roleId, event.role);
      break;

    case 'roleDeleted':
      roleDomain.delete(event.roleId);
      break;

    case 'userUpdated':
      userDomain.update(event.user.userId, event.user);
      break;

    case 'userDeleted':
      userDomain.remove(event.userId);
      break;

    case 'groupRoleRightUpdated':
      aclDomain.grant(event.right.groupId, event.right.roleId, event.right.rights);
      break;

    case 'voipParticipantUpdated':
      voipDomain.update(event.user.userId, event.user);
      break;

    case 'voipParticipantDeleted':
      voipDomain.delete(event.userId);
      break;

    case 'messageCreated':
      const messageType = event.messageType;
      const message: Message = {
        id: event.messageId,
        senderId: event.senderId,
        channelId: messageType.type === 'Channel' ? messageType.channel_id : null,
        recipientId: messageType.type === 'Direct' ? messageType.recipient_id : null,
        messageText: event.messageText,
        replyToMessageId: event.replyToMessageId,
        modifiedAt: event.timestamp,
        createdAt: event.timestamp
      };
      messageDomain.insertMany([message]);

      event.files.forEach(fileInfo => {
        fileDomain.add(fileInfo);
      });

      break;

    case 'messageUpdated':
      messageDomain.update(event.messageId, {
        messageText: event.messageText,
      });
      break;

    case 'messageDeleted':
      messageDomain.delete(event.messageId);
      break;

    case 'groupReveal':
      if (!groupDomain.findById(event.groupId)) {
        groupDomain.add({
          groupId: event.groupId,
          groupName: event.groupName,
        });
      }

      event.channels.forEach(channel => {
        if (!channelDomain.findById(channel.channelId)) {
          channelDomain.add(channel);
        }
      });

      event.voipParticipants.forEach(participant => {
        voipDomain.update(participant.userId, participant);
      });
      aclDomain.grant(event.right.groupId, event.right.roleId, event.right.rights)
      break;

    case 'groupHide':
      groupDomain.delete(event.groupId);

      const channelsToRemove = channelDomain.list().filter((channel) => channel.groupId == event.groupId);
      channelsToRemove.forEach(channel => {
        channelDomain.delete(channel.channelId);
      });

      const messagesToRemove = messageDomain.list().filter((message) => {
        if (message.channelId === null) return false;
        const channel = channelDomain.findById(message.channelId);
        return channel && channel.groupId === event.groupId;
      });
      messagesToRemove.forEach(message => {
        messageDomain.delete(message.id);
      });

      const participantsToRemove = voipDomain.list().filter((participant) => {
        if (participant.channelId === null) return false;
        const channel = channelDomain.findById(participant.channelId);
        return channel && channel.groupId === event.groupId;
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
      subscriptionsResult,
    ] = await Promise.all([
      fetchApi<Group[]>('/group', { method: 'GET' }),
      fetchApi<Channel[]>('/channel', { method: 'GET' }),
      fetchApi<Role[]>('/role', { method: 'GET' }),
      fetchApi<GroupRoleRights[]>('/acl/group-role-rights', { method: 'GET' }),
      fetchApi<User[]>('/user', { method: 'GET' }),
      fetchApi<VoipParticipant[]>('/voip/participants', { method: 'GET' }),
      fetchApi<Subscription[]>('/voip/subscriptions', { method: 'GET' }),
    ])

    if (groupsResult.isErr() || channelsResult.isErr() || rolesResult.isErr() || usersResult.isErr() || groupRightsResult.isErr() || voipStatusResult.isErr() || subscriptionsResult.isErr()) {
      userDomain.setAppState({ type: 'unauthenticated' });
      return;
    }

    groupDomain.replaceAll(groupsResult.value)
    channelDomain.replaceAll(channelsResult.value)
    roleDomain.replaceAll(rolesResult.value)
    userDomain.replaceAll(usersResult.value)
    aclDomain.replaceAll(groupRightsResult.value)
    voipDomain.replaceAll(voipStatusResult.value)
    voipDomain.replaceAllSubscriptions(subscriptionsResult.value)
  } catch (error) {
    userDomain.setAppState({ type: 'unauthenticated' });
  }
}

function hexToUint8Array(hexString: string): Uint8Array {
  const cleanHex = hexString.replace(/[^0-9A-Fa-f]/g, '');
  const matches = cleanHex.match(/.{1,2}/g);
  if (!matches) return new Uint8Array();
  return new Uint8Array(
    matches.map((byte) => parseInt(byte, 16))
  );
}

function getCertificateHash(): { algorithm: string; value: Uint8Array } | undefined {
  const certHash = import.meta.env.VITE_CERT_HASH;
  if (!certHash) return undefined;
  return {
    algorithm: 'sha-256',
    value: hexToUint8Array(certHash)
  };
}

export function getWebTransportUrl(): string {
  const serverUrl = getServerUrlOrDefault();
  const url = new URL(serverUrl);
  return `${url.protocol}//${url.hostname}:4443/session`;
}

export const connection = new TransportProvider({
  certificateHash: getCertificateHash()
});

connection.onVoipDataReceived((frame: VoipPayload) => {
  if (frame.type === "media") {
    switch (frame.mediaType) {
      case "voice": {
        let packet = new EncodedAudioChunk({
          type: frame.key,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        voipDomain.streamMedia(frame.userId, 'voice', packet, frame.timestamp)
        break
      }
      case "camera": {
        let videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        voipDomain.streamMedia(frame.userId, 'camera', videoPacket, frame.timestamp)
        break
      }
      case "screen": {
        let videoPacket = new EncodedVideoChunk({
          type: frame.key as EncodedVideoChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        voipDomain.streamMedia(frame.userId, 'screen', videoPacket, frame.timestamp)
        break
      }
      case "screenSound": {
        let videoPacket = new EncodedAudioChunk({
          type: frame.key as EncodedAudioChunkType,
          timestamp: frame.realTimestamp,
          duration: undefined,
          data: new Uint8Array(frame.data)
        })
        voipDomain.streamMedia(frame.userId, 'screenSound', videoPacket, frame.timestamp)
        break
      }
    }
  } else if (frame.type === "speech") {
    voipDomain.updateSpeakingState(frame.userId, frame.isSpeaking)
  }
});

connection.onServerEventReceived((event: EventPayload) => {
  handleServerEvent(event);
});

connection.onConnectionLost((reason) => {
  userDomain.setAppState({ type: "connectionError", reason });
});

connection.onAuthenticationRejected(() => {
  userDomain.setAppState({ type: "unauthenticated" });
});



export let microphone = new Microphone();
microphone.onEncodedData((data) => {
  let user = voipDomain.getCurrent()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.sendVoip({
    type: "media",
    userId: user.userId,
    mediaType: "voice",
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as VoipPayload)
})

microphone.onSpeech((speech) => {
  let user = voipDomain.getCurrent()
  if (!user) return
  connection.sendVoip({
    type: "speech",
    userId: user.userId,
    isSpeaking: speech
  } as VoipPayload)
})

export let screenShare = new ScreenShare();
screenShare.onEncodedVideoData((data) => {
  let user = voipDomain.getCurrent()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.sendVoip({
    type: "media",
    userId: user.userId,
    mediaType: "screen",
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as VoipPayload)
})

screenShare.onEncodedAudioData((data) => {
  let user = voipDomain.getCurrent()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.sendVoip({
    type: "media",
    userId: user.userId,
    mediaType: "screenSound",
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as VoipPayload)
})

export let camera = new Camera();
camera.onEncodedData((data) => {
  let user = voipDomain.getCurrent()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);
  if (!user) return
  connection.sendVoip({
    type: "media",
    userId: user.userId,
    mediaType: "camera",
    data: Array.from(new Uint8Array(buffer)),
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  } as VoipPayload)
})

export const outputManager = new OutputManager();

export async function resetStore() {
  await microphone.stop()
  await camera.stop()
  await screenShare.stop()
  setState(() => ({
    modal: { type: 'close', id: 0 },
    activeContext: undefined,
  }));
}







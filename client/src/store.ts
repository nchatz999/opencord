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

export interface VideoStream {
  userId: number
  type: 'video' | 'audio' | 'screen'
  username: string
  avatar: string
  isActive: boolean
  stream?: MediaStream
  lastDataTimestamp: number
  videoElement?: HTMLVideoElement
}

export interface AudioStream {
  userId: number
  audioElement: HTMLAudioElement
}
export type AppState =
  | { type: 'loading' }
  | { type: 'unauthenticated' }
  | { type: 'connecting' }
  | { type: 'authenticated' }
  | { type: 'connectionError' }

export type ConnectionStatus = "connected" | "disconnected";

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
  status: ConnectionStatus
  sessionId: string | null
  roles: Role[]
  users: User[]
  channels: Channel[]
  groups: Group[]
  messages: Message[]
  files: File[]
  currentUser: number | null

  voipState: VoipParticipant[]
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
  status: "disconnected",
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

  getAllUsers(): User[] {
    return state.users;
  }

  getCurrentUserId(): number | null {
    return state.currentUser;
  }

  getAppState(): AppState {
    return state.appState
  }

  getConnectionStatus(): ConnectionStatus {
    return state.status
  }

  getUserColorStatusById(id: number) {
    let user = this.getUserById(id)
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

  getCurrentUser(): User {
    let user = state.users.find(u => u.userId === state.currentUser);
    if (!user) throw new Error('Issue')
    return user;
  }

  getUserById(id: number): User | undefined {
    return state.users.find(u => u.userId === id);
  }


  setUsers(users: User[]): void {
    setState('users', users);
  }

  setAppState(appState: AppState) {
    setState('appState', appState);
  }


  setConnectionStatus(value: ConnectionStatus) {
    setState('status', value)
  }

  setCurrentUser(userId: number | null): void {
    setState('currentUser', userId);
  }

  addUser(user: User): void {
    setState(
      'users',
      produce(users => {
        users.push(user);
      })
    );
  }

  updateUser(id: number, updates: Partial<User>): void {
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

  deleteUser(id: number): void {
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

  getAllGroups(): Group[] {
    return state.groups;
  }

  getGroupById(id: number): Group | undefined {
    return state.groups.find(g => g.groupId === id);
  }

  getChannelsInGroup(groupId: number): Channel[] {
    return state.channels.filter(c => c.groupId === groupId);
  }

  setGroups(groups: Group[]): void {
    setState('groups', groups);
  }

  addGroup(group: Group): void {
    setState(
      'groups',
      produce(groups => {
        groups.push(group);
      })
    );
  }

  updateGroup(id: number, updates: Partial<Group>): void {
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

  deleteGroup(id: number): void {
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
      channelDomain.deleteChannel(channel.channelId);
    });

    channelsToDelete.forEach(channel => {
      const participantsToRemove = state.voipState.filter(p => p.channelId === channel.channelId);
      participantsToRemove.forEach(participant => {
        voipDomain.removeParticipant(participant.userId);
      });
    });
  }

}

export class ChannelDomain {
  constructor() { }

  getAllChannels(): Channel[] {
    return state.channels;
  }

  getChannelById(id: number): Channel | undefined {
    return state.channels.find(c => c.channelId === id);
  }

  setChannels(channels: Channel[]): void {
    setState('channels', channels);
  }

  addChannel(channel: Channel): void {
    setState(
      'channels',
      produce(channels => {
        channels.push(channel);
      })
    );
  }

  updateChannel(id: number, updates: Partial<Channel>): void {
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

  deleteChannel(id: number): void {
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
      voipDomain.removeParticipant(participant.userId);
    });
  }

}

export class MessageDomain {
  constructor() { }

  getAllMessages(): Message[] {
    return state.messages;
  }
  getMessagesForChannel(channelId: number): Message[] {
    return state.messages
      .filter(m => m.channelId === channelId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }


  getMessagesForDM(recipientId: number): Message[] {
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

  getMessageById(id: number): Message | undefined {
    return state.messages.find(m => m.id === id);
  }

  getFilesForMessage(messageId: number): File[] {
    return state.files.filter(f => f.messageId === messageId);
  }

  setMessages(messages: Message[]): void {
    setState('messages', messages);
  }

  setContext(ctx: { type: "channel" | "dm", id: number }): void {
    setState("context", ctx)
  }

  addMessage(message: Message): void {
    setState(
      'messages',
      produce(messages => {
        messages.push(...[message]);
      })
    );
  }

  addMessages(newMessages: Message[]): void {
    setState(
      'messages',
      produce(messages => {
        messages.push(...newMessages);
      })
    );
  }

  updateMessage(id: number, updates: Partial<Message>): void {
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

  deleteMessage(id: number): void {
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

  getAllRoles(): Role[] {
    return state.roles;
  }

  getRoleById(id: number): Role | undefined {
    return state.roles.find(r => r.roleId === id)
  }


  addRole(roleId: number, roleName: string): void {
    setState(
      'roles',
      produce(roles => {
        roles.push({ roleId, roleName })
      })
    );
  }

  updateRole(id: number, updates: Partial<Role>): void {
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

  setRoles(roles: Role[]): void {
    setState('roles', roles);
  }

  removeRole(roleId: number): void {
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

  getAllRights(): GroupRoleRights[] {
    return state.groupRoleRights;
  }

  getRightsForGroup(groupId: number): GroupRoleRights[] {
    return state.groupRoleRights.filter(r => r.groupId === groupId);
  }
  getRightsForChannelRole(channelId: number, roleId: number): number {
    let channel = channelDomain.getChannelById(channelId)
    if (!channel) return 0
    let group = groupDomain.getGroupById(channel.groupId)
    if (!group) return 0
    return this.getRightsForGroupRole(group.groupId, roleId) || 0
  }
  getRightsForGroupRole(groupId: number, roleId: number): number | undefined {
    if ([0, 1].includes(roleId)) return 16
    let groupRoleRight = state.groupRoleRights.find(r => r.groupId === groupId && r.roleId === roleId)
    if (!groupRoleRight) return undefined
    return groupRoleRight.rights;
  }

  setRights(rights: GroupRoleRights[]): void {
    setState('groupRoleRights', rights);
  }

  updateRights(groupId: number, roleId: number, rights: number): void {
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

      const messagesToRemove = messageDomain.getAllMessages().filter(message => {
        if (message.channelId === null) return false;
        const channel = channelDomain.getChannelById(message.channelId);
        if (!channel || channel.groupId !== groupId) return false;
        const sender = userDomain.getUserById(message.senderId);
        return sender && sender.roleId === roleId;
      });
      messagesToRemove.forEach(message => {
        messageDomain.deleteMessage(message.id);
      });

      const participantsToRemove = voipDomain.getParticipants().filter(participant => {
        if (participant.channelId === null) return false;
        const channel = channelDomain.getChannelById(participant.channelId);
        if (!channel || channel.groupId !== groupId) return false;
        return participant.user.roleId === roleId;
      });
      participantsToRemove.forEach(participant => {
        voipDomain.removeParticipant(participant.user.userId);
      });
    }
  }

}

export class VoipDomain {
  constructor() { }


  getAudio(): AudioContext {
    return state.audio
  }

  getVoipContext(): { type: 'channel' | 'dm'; id: number } | undefined {
    return state.voipContext
  }


  getParticipants(): VoipParticipantWithUser[] {
    return state.voipState.flatMap((participant) => {
      const user = userDomain.getUserById(participant.userId);
      return user ? [{ ...participant, user }] : [];
    });
  }

  getParticipantsByChannelId(channelId: number): VoipParticipantWithUser[] {
    return state.voipState
      .filter((participant) => participant.channelId == channelId)
      .flatMap((participant) => {
        const user = userDomain.getUserById(participant.userId);
        return user ? [{ ...participant, user }] : [];
      });
  }


  getParticipant(userId: number): VoipParticipantWithUser | undefined {
    let user = userDomain.getUserById(userId)
    if (!user) return undefined
    let participant = state.voipState.find(p => p.userId === userId)
    if (participant) {
      return { ...participant, user: user }
    }
    return undefined
  }

  getCurrentUserParticipant(): VoipParticipant | undefined {
    return state.voipState.find(p => p.userId === userDomain.getCurrentUser().userId);
  }

  setParticipants(participants: VoipParticipant[]): void {
    setState('voipState', participants.map((part) => {
      part.playback = new AudioPlayback(voipDomain.getAudio(), 200)
      part.screenPlayback = new VideoPlayback(200)
      part.cameraPlayback = new VideoPlayback(200)
      part.screenSoundPlayback = new AudioPlayback(voipDomain.getAudio(), 200)
      part.screenSoundPlayback.setVolume(0)
      return part
    }));
  }



  updateParticipant(userId: number, updates: Partial<VoipParticipant>): void {
    setState(
      'voipState',
      produce(voipState => {
        const index = voipState.findIndex(p => p.userId === userId);
        updates.playback = new AudioPlayback(voipDomain.getAudio(), 200)
        updates.screenPlayback = new VideoPlayback(200)
        updates.cameraPlayback = new VideoPlayback(200)
        updates.screenSoundPlayback = new AudioPlayback(voipDomain.getAudio(), 200)
        updates.screenSoundPlayback.setVolume(0)
        if (index !== -1) {
          voipState[index] = { ...voipState[index], ...updates };
        } else {
          voipState.push({ userId, ...updates } as VoipParticipant);
        }
      })
    );
  }

  pushAudioToParticipant(userId: number, packet: EncodedAudioChunk, timestamp: number) {
    let voipUser = voipDomain.getParticipant(userId)
    if (voipUser && voipUser.playback) {
      voipUser.playback.pushChunk(packet, timestamp)
    }
  }

  pushScreenToParticipant(userId: number, packet: EncodedVideoChunk, timestamp: number) {
    let voipUser = voipDomain.getParticipant(userId)
    if (voipUser && voipUser.screenPlayback)
      voipUser.screenPlayback.pushFrame(packet, timestamp)

  }
  pushCameraToParticipant(userId: number, packet: EncodedVideoChunk, timestamp: number) {
    let voipUser = voipDomain.getParticipant(userId)
    if (voipUser && voipUser.cameraPlayback)
      voipUser.cameraPlayback.pushFrame(packet, timestamp)

  }

  pushScreenSoundToParticipant(userId: number, packet: EncodedVideoChunk, timestamp: number) {
    let voipUser = voipDomain.getParticipant(userId)
    if (voipUser && voipUser.screenSoundPlayback)
      voipUser.screenSoundPlayback.pushChunk(packet, timestamp)

  }


  removeParticipant(userId: number): void {
    setState(
      'voipState',
      produce(voipState => {
        const index = voipState.findIndex(p => p.userId === userId);
        if (index !== -1) {
          voipState.splice(index, 1);
        }
      })
    );
  }



  resetChannelPlayback(channelId: number) {
    state.voipState.filter((voip) => {
      voip.channelId == channelId
    }).forEach((voip) => {
      if (voip.playback)
        voip.playback.resetTimestamps()
    })

  }

  setVoipContext(ctx: { type: 'channel' | 'dm'; id: number } | undefined) {
    setState("voipContext", ctx)
  }

  async resumeContext() {
    await state.audio.resume()
  }

  setUserVolume(userId: number, volume: number): void {
    const participant = this.getParticipant(userId);
    if (participant && participant.playback) {
      participant.playback.setVolume(volume);
    }
  }

  getUserVolume(userId: number): number {
    const participant = this.getParticipant(userId);
    if (participant && participant.playback) {
      return participant.playback.volume();
    }
    return 100;
  }

  setUserScreenSoundVolume(userId: number, volume: number): void {
    const participant = this.getParticipant(userId);
    if (participant && participant.screenSoundPlayback) {
      participant.screenSoundPlayback.setVolume(volume);
    }
  }

  getUserScreenSoundVolume(userId: number): number {
    const participant = this.getParticipant(userId);
    if (participant && participant.screenSoundPlayback) {
      return participant.screenSoundPlayback.volume();
    }
    return 100;
  }

  removeUserPublishedStreams(userId: number): void {
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

  getAllFiles(): File[] {
    return state.files;
  }

  getFileById(id: number): File | undefined {
    return state.files.find(f => f.fileId === id);
  }

  setFiles(files: File[]): void {
    setState('files', files);
  }

  addFile(file: File): void {
    setState(
      'files',
      produce(files => {
        files.push(file);
      })
    );
  }

  addFiles(newFiles: File[]): void {
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

  getModal() {
    return state.modal;
  }

  setModal(modal: ModalType): void {
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
      channelDomain.updateChannel(event.channel.channelId, {
        channelName: event.channel.channelName,
        channelType: event.channel.channelType,
        groupId: event.channel.groupId,
      });
      break;

    case 'ChannelDeleted':
      channelDomain.deleteChannel(event.channel_id);
      break;

    case 'GroupUpdated':
      groupDomain.updateGroup(event.group.groupId, {
        groupName: event.group.groupName,
      });
      break;

    case 'GroupDeleted':
      groupDomain.deleteGroup(event.group_id);
      break;

    case 'RoleUpdated':
      roleDomain.updateRole(event.role.roleId, {
        roleName: event.role.roleName,
      });
      break;

    case 'RoleDeleted':
      roleDomain.removeRole(event.role_id);
      break;

    case 'UserUpdated':
      userDomain.updateUser(event.user.userId, {
        username: event.user.username,
        roleId: event.user.roleId,
        avatarFileId: event.user.avatarFileId,
        status: event.user.status,
      });
      break;

    case 'UserDeleted':
      userDomain.deleteUser(event.user_id);
      break;

    case 'GroupRoleRightUpdated':
      aclDomain.updateRights(event.group_id, event.role_id, event.rights);
      break;

    case 'VoipParticipantUpdated':
      voipDomain.updateParticipant(event.user.userId, {
        channelId: event.user.channelId,
        recipientId: event.user.recipientId,
        localDeafen: event.user.localDeafen,
        localMute: event.user.localMute,
        publishCamera: event.user.publishCamera,
        publishScreen: event.user.publishScreen,
      });
      break;

    case 'VoipParticipantDeleted':
      voipDomain.removeParticipant(event.user_id);
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
      messageDomain.addMessage(message);

      event.files.forEach(fileInfo => {
        console.log(fileInfo)
        fileDomain.addFile({
          fileId: fileInfo.fileId,
          fileName: fileInfo.fileName,
          fileHash: fileInfo.fileHash,
          fileUuid: fileInfo.fileUuid,
          fileType: fileInfo.fileType,
          fileSize: fileInfo.fileSize,
          messageId: fileInfo.messageId,
          createdAt: fileInfo.createdAt,
        });
      });

      break;

    case 'MessageUpdated':
      messageDomain.updateMessage(event.message_id, {
        messageText: event.message_text,
      });
      break;

    case 'MessageDeleted':
      messageDomain.deleteMessage(event.message_id);
      break;

    case 'GroupReveal':
      if (!groupDomain.getGroupById(event.group_id)) {
        groupDomain.addGroup({
          groupId: event.group_id,
          groupName: event.group_name,
        });
      }

      event.channels.forEach(channel => {
        if (!channelDomain.getChannelById(channel.channelId)) {
          channelDomain.addChannel(channel);
        }
      });

      event.voip_participants.forEach(participant => {
        voipDomain.updateParticipant(participant.userId, participant);
      });
      break;

    case 'GroupHide':
      groupDomain.deleteGroup(event.group_id);

      const channelsToRemove = channelDomain.getAllChannels().filter((channel) => channel.groupId == event.group_id);
      channelsToRemove.forEach(channel => {
        channelDomain.deleteChannel(channel.channelId);
      });

      const messagesToRemove = messageDomain.getAllMessages().filter((message) => {
        if (message.channelId === null) return false;
        const channel = channelDomain.getChannelById(message.channelId);
        return channel && channel.groupId === event.group_id;
      });
      messagesToRemove.forEach(message => {
        messageDomain.deleteMessage(message.id);
      });

      const participantsToRemove = voipDomain.getParticipants().filter((participant) => {
        if (participant.channelId === null) return false;
        const channel = channelDomain.getChannelById(participant.channelId);
        return channel && channel.groupId === event.group_id;
      });
      participantsToRemove.forEach(participant => {
        voipDomain.removeParticipant(participant.user.userId);
      });

      break;

    default:
      console.warn('Unhandled server event:', event);
      break;
  }
}



export const handleConnect = async () => {
  console.log('WebTransport connected successfully')

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
      console.error('Failed to load initial data');
      userDomain.setAppState({ type: 'unauthenticated' });
      return;
    }

    groupDomain.setGroups(groupsResult.value)
    channelDomain.setChannels(channelsResult.value)
    roleDomain.setRoles(rolesResult.value)
    userDomain.setUsers(usersResult.value)
    aclDomain.setRights(groupRightsResult.value)
    voipDomain.setParticipants(voipStatusResult.value)
    console.log(voipStatusResult.value)

    userDomain.setConnectionStatus("connected")
    console.log('Initial data loaded successfully')
  } catch (error) {
    console.error('Error loading initial data:', error)
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
let i = 0
export let connection = new RTCPProtocol(`https://${window.location.hostname}:4443/session`,
  certificateHash,
  (data: any) => {
    let frame = decode(data) as VoipDataMessage
    if (frame.type === "voice") {
      let packet = new EncodedAudioChunk({
        type: frame.key,
        timestamp: frame.realTimestamp,
        duration: undefined,
        data: new Uint8Array(frame.data)
      })
      i++
      voipDomain.pushAudioToParticipant(frame.userId, packet, frame.timestamp)
    } else if (frame.type === 'screen') {
      let videoPacket = new EncodedVideoChunk({
        type: frame.key as EncodedVideoChunkType,
        timestamp: frame.realTimestamp,
        duration: undefined,
        data: new Uint8Array(frame.data)
      })
      i++
      voipDomain.pushScreenToParticipant(frame.userId, videoPacket, frame.timestamp)
    } else if (frame.type === 'camera') {
      let videoPacket = new EncodedVideoChunk({
        type: frame.key as EncodedVideoChunkType,
        timestamp: frame.realTimestamp,
        duration: undefined,
        data: new Uint8Array(frame.data)
      })
      i++
      voipDomain.pushCameraToParticipant(frame.userId, videoPacket, frame.timestamp)
    } else if (frame.type === "screenSound") {
      let videoPacket = new EncodedAudioChunk({
        type: frame.key as EncodedAudioChunkType,
        timestamp: frame.realTimestamp,
        duration: undefined,
        data: new Uint8Array(frame.data)
      })
      i++
      voipDomain.pushScreenSoundToParticipant(frame.userId, videoPacket, frame.timestamp)

    }
  },
  (data) => {
    let maybeEvent = decode(data) as ServerEvent
    if (maybeEvent) {
      console.log(maybeEvent)
      handleServerEvent(maybeEvent)
    }
  },
  () => { },
  () => { console.log("on disconnect"); userDomain.setAppState({ type: "connectionError" }) },
)



export let microphone = new Microphone();
microphone.onEncodedData((data) => {
  let user = voipDomain.getCurrentUserParticipant()

  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);

  if (!user) return
  let voipMessage: VoipDataMessage = {
    type: "voice",
    userId: user.userId,
    data: buffer,
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  }
  connection.send(encode([
    voipMessage.type,
    voipMessage.userId,
    new Uint8Array(voipMessage.data),
    voipMessage.timestamp,
    voipMessage.realTimestamp,
    voipMessage.key
  ]))
})

export let screenShare = new ScreenShare();
screenShare.onEncodedVideoData((data) => {
  let user = voipDomain.getCurrentUserParticipant()
  const buffer = new ArrayBuffer(data.byteLength);

  data.copyTo(buffer);
  if (!user) return
  let voipMessage: VoipDataMessage = {
    type: "screen",
    userId: user.userId,
    data: buffer,
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  }

  connection.send(
    encode([
      voipMessage.type,
      voipMessage.userId,
      new Uint8Array(voipMessage.data),
      voipMessage.timestamp,
      voipMessage.realTimestamp,
      voipMessage.key
    ])
  )
})

screenShare.onEncodedAudioData((data) => {
  let user = voipDomain.getCurrentUserParticipant()
  const buffer = new ArrayBuffer(data.byteLength);

  data.copyTo(buffer);
  if (!user) return
  let voipMessage: VoipDataMessage = {
    type: "screenSound",
    userId: user.userId,
    data: buffer,
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  }

  connection.send(
    encode([
      voipMessage.type,
      voipMessage.userId,
      new Uint8Array(voipMessage.data),
      voipMessage.timestamp,
      voipMessage.realTimestamp,
      voipMessage.key
    ])
  )
})

export let camera = new Camera();
camera.onEncodedData((data) => {
  let user = voipDomain.getCurrentUserParticipant()
  const buffer = new ArrayBuffer(data.byteLength);
  data.copyTo(buffer);

  if (!user) return

  let voipMessage: VoipDataMessage = {
    type: "camera",
    userId: user.userId,
    data: buffer,
    timestamp: Date.now(),
    realTimestamp: data.timestamp,
    key: data.type
  }

  connection.send(encode([
    voipMessage.type,
    voipMessage.userId,
    new Uint8Array(voipMessage.data),
    voipMessage.timestamp,
    voipMessage.realTimestamp,
    voipMessage.key
  ]))
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







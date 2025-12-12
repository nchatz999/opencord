import type { Result } from "opencord-utils";
import { ok } from "opencord-utils";
import { createEntityStore, api, type BaseActions } from "./factory";
import type {
  User,
  Role,
  Group,
  Channel,
  ChannelType,
  Message,
  File,
  VoipParticipant,
  GroupRoleRights,
  Subscription,
  MediaType,
  UserStatusType,
} from "../model";
import { useAuth } from "./auth";

// ============================================================================
// User Store
// ============================================================================

interface UserCustomActions {
  updateStatus: (userId: number, status: UserStatusType) => Promise<Result<void, string>>;
  updateAvatar: (fileName: string, contentType: string, base64Data: string) => Promise<Result<void, string>>;
  updateRole: (userId: number, roleId: number) => Promise<Result<void, string>>;
}

export const useUser = createEntityStore<User, "userId", UserCustomActions>({
  name: "user",
  endpoint: "/user",
  stateKey: "users",
  key: "userId",

  events: {
    update: "userUpdated",
    delete: "userDeleted",
  },

  custom: (_getState, _baseActions, api) => ({
    updateStatus: (userId, status) =>
      api.put(`/user/${userId}/manual-status`, { manualStatus: status }),

    updateAvatar: (fileName, contentType, base64Data) =>
      api.put("/user/avatar", { fileName, contentType, data: base64Data }),

    updateRole: (userId, roleId) =>
      api.put(`/user/${userId}/role`, { roleId }),
  }),
});

export type UserStore = ReturnType<typeof useUser>;

// ============================================================================
// Role Store
// ============================================================================

interface RoleCustomActions {
  create: (name: string) => Promise<Result<number, string>>;
  delete: (roleId: number) => Promise<Result<void, string>>;
}

export const useRole = createEntityStore<Role, "roleId", RoleCustomActions>({
  name: "role",
  endpoint: "/role",
  stateKey: "roles",
  key: "roleId",

  events: {
    update: "roleUpdated",
    delete: "roleDeleted",
  },

  custom: (_getState, _baseActions, api) => ({
    create: async (name) => {
      const result = await api.post<{ roleId: number }>("/role", { name });
      if (result.isErr()) return result;
      return ok(result.value.roleId);
    },

    delete: (roleId) => api.del(`/role/${roleId}`),
  }),
});

export type RoleStore = ReturnType<typeof useRole>;

// ============================================================================
// Group Store
// ============================================================================

interface GroupCustomActions {
  create: (name: string) => Promise<Result<number, string>>;
  delete: (groupId: number) => Promise<Result<void, string>>;
}

export const useGroup = createEntityStore<Group, "groupId", GroupCustomActions>({
  name: "group",
  endpoint: "/group",
  stateKey: "groups",
  key: "groupId",

  events: {
    update: "groupUpdated",
    delete: "groupDeleted",
  },

  custom: (_getState, _baseActions, api) => ({
    create: async (name) => {
      const result = await api.post<{ groupId: number }>("/group", { name });
      if (result.isErr()) return result;
      return ok(result.value.groupId);
    },

    delete: (groupId) => api.del(`/group/${groupId}`),
  }),
});

export type GroupStore = ReturnType<typeof useGroup>;

// ============================================================================
// Channel Store
// ============================================================================

interface ChannelCustomActions {
  findByGroup: (groupId: number) => Channel[];
  create: (groupId: number, name: string, type: ChannelType) => Promise<Result<number, string>>;
  updateChannel: (channelId: number, name: string, type: ChannelType) => Promise<Result<void, string>>;
  delete: (channelId: number) => Promise<Result<void, string>>;
}

export const useChannel = createEntityStore<Channel, "channelId", ChannelCustomActions>({
  name: "channel",
  endpoint: "/channel",
  stateKey: "channels",
  key: "channelId",

  events: {
    update: "channelUpdated",
    delete: "channelDeleted",
  },

  custom: (getState, _baseActions, api) => ({
    findByGroup: (groupId) => getState().filter((c) => c.groupId === groupId),

    create: async (groupId, name, type) => {
      const result = await api.post<{ channelId: number }>("/channel", {
        groupId,
        channelName: name,
        channelType: type,
      });
      if (result.isErr()) return result;
      return ok(result.value.channelId);
    },

    updateChannel: (channelId, name, type) =>
      api.put(`/channel/${channelId}`, { channelName: name, channelType: type }),

    delete: (channelId) => api.del(`/channel/${channelId}`),
  }),
});

export type ChannelStore = ReturnType<typeof useChannel>;

// ============================================================================
// Message Store
// ============================================================================

interface MessageCustomActions {
  findByChannel: (channelId: number) => Message[];
  findByRecipient: (recipientId: number) => Message[];
  getAttachments: (messageId: number) => File[];
  insert: (message: Message) => void;
  fetchMessages: (
    contextType: "channel" | "dm",
    contextId: number,
    limit: number,
    timestamp: string
  ) => Promise<Result<Message[], string>>;
  send: (
    contextType: "channel" | "dm",
    contextId: number,
    text: string | undefined,
    files?: { fileName: string; contentType: string; data: string }[],
    replyToMessageId?: number | null
  ) => Promise<Result<void, string>>;
  updateMessage: (messageId: number, text: string) => Promise<Result<void, string>>;
  delete: (messageId: number) => Promise<Result<void, string>>;
}

export const useMessage = createEntityStore<Message, "id", MessageCustomActions>({
  name: "message",
  endpoint: "/message",
  stateKey: "messages",
  key: "id",
  skipInit: true,

  events: {
    delete: "messageDeleted",
    custom: {
      messageCreated: (event, actions) => {
        const data = event as {
          messageId: number;
          senderId: number;
          messageType: { type: "Channel"; channel_id: number } | { type: "Direct"; recipient_id: number };
          messageText: string;
          timestamp: string;
          replyToMessageId: number | null;
          files: File[];
        };

        const message: Message = {
          id: data.messageId,
          senderId: data.senderId,
          channelId: data.messageType.type === "Channel" ? data.messageType.channel_id : null,
          recipientId: data.messageType.type === "Direct" ? data.messageType.recipient_id : null,
          messageText: data.messageText,
          createdAt: data.timestamp,
          modifiedAt: null,
          replyToMessageId: data.replyToMessageId,
        };

        // Use custom insert for sorted insertion
        const customActions = actions as unknown as MessageCustomActions;
        customActions.insert(message);

        // Add files to file store
        const [, fileActions] = useFile();
        for (const file of data.files) {
          fileActions.add(file);
        }
      },
      messageUpdated: (event, actions) => {
        const data = event as { messageId: number; messageText: string };
        const existing = actions.findById(data.messageId);
        if (existing) {
          actions.update({
            ...existing,
            messageText: data.messageText,
            modifiedAt: new Date().toISOString(),
          });
        }
      },
    },
  },

  custom: (getState, baseActions, api) => {
    // Custom insert with binary search for timestamp ordering
    const insert = (newMessage: Message) => {
      const messages = getState();
      const newMessageTime = new Date(newMessage.createdAt).getTime();

      if (messages.length === 0) {
        baseActions.add(newMessage);
        return;
      }

      const lastMessageTime = new Date(messages[messages.length - 1].createdAt).getTime();
      if (newMessageTime >= lastMessageTime) {
        baseActions.add(newMessage);
        return;
      }

      // Binary search insertion handled by replaceAll with sorted array
      const newMessages = [...messages, newMessage].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      baseActions.replaceAll(newMessages);
    };

    return {
      findByChannel: (channelId) =>
        getState()
          .filter((m) => m.channelId === channelId)
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),

      findByRecipient: (recipientId) => {
        const [authState] = useAuth();
        const currentUserId = authState.session?.userId;
        if (!currentUserId) return [];

        return getState()
          .filter(
            (m) =>
              m.channelId === null &&
              ((m.senderId === currentUserId && m.recipientId === recipientId) ||
                (m.senderId === recipientId && m.recipientId === currentUserId))
          )
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      },

      getAttachments: (messageId) => {
        const [fileState] = useFile();
        return fileState.items.filter((f) => f.messageId === messageId);
      },

      insert,

      fetchMessages: async (contextType, contextId, limit, timestamp) => {
        const endpoint =
          contextType === "dm"
            ? `/message/dm/${contextId}/messages`
            : `/message/channel/${contextId}/messages`;

        const result = await api.get<Message[]>(endpoint, { limit, timestamp });
        if (result.isErr()) return result;

        for (const message of result.value) {
          insert(message);
        }

        return ok(result.value);
      },

      send: async (contextType, contextId, text, files = [], replyToMessageId = null) => {
        const endpoint =
          contextType === "dm"
            ? `/message/dm/${contextId}/messages`
            : `/message/channel/${contextId}/messages`;

        return api.post(endpoint, { messageText: text, files, replyToMessageId });
      },

      updateMessage: (messageId, text) =>
        api.put(`/message/${messageId}`, { message_text: text }),

      delete: (messageId) => api.del(`/message/${messageId}`),
    };
  },
});

export type MessageStore = ReturnType<typeof useMessage>;

// ============================================================================
// File Store
// ============================================================================

interface FileCustomActions {
  fetchFiles: (
    contextType: "channel" | "dm",
    contextId: number,
    limit: number,
    timestamp: string
  ) => Promise<Result<File[], string>>;
  downloadFile: (fileId: number) => Promise<Result<Blob, string>>;
}

export const useFile = createEntityStore<File, "fileId", FileCustomActions>({
  name: "file",
  endpoint: "/file",
  stateKey: "files",
  key: "fileId",
  skipInit: true,

  custom: (getState, baseActions, api) => ({
    fetchFiles: async (contextType, contextId, limit, timestamp) => {
      const endpoint =
        contextType === "dm"
          ? `/message/dm/${contextId}/files`
          : `/message/channel/${contextId}/files`;

      const result = await api.get<File[]>(endpoint, { limit, timestamp });
      if (result.isErr()) return result;

      for (const file of result.value) {
        baseActions.add(file);
      }

      return ok(result.value);
    },

    downloadFile: async (fileId) => {
      const result = await api.get<Blob>(`/message/files/${fileId}`);
      if (result.isErr()) return result;
      return ok(result.value);
    },
  }),
});

export type FileStore = ReturnType<typeof useFile>;

// ============================================================================
// VoIP Store
// ============================================================================

interface VoipCustomActions {
  findByChannel: (channelId: number) => VoipParticipant[];
  unpublishAll: (userId: number) => void;
  joinChannel: (channelId: number, muted: boolean, deafened: boolean) => Promise<Result<void, string>>;
  joinPrivate: (userId: number, muted: boolean, deafened: boolean) => Promise<Result<void, string>>;
  leave: () => Promise<Result<void, string>>;
  setMuted: (muted: boolean) => Promise<Result<void, string>>;
  setDeafened: (deafened: boolean) => Promise<Result<void, string>>;
  publishScreen: (publish: boolean) => Promise<Result<void, string>>;
  publishCamera: (publish: boolean) => Promise<Result<void, string>>;
}

export const useVoip = createEntityStore<VoipParticipant, "userId", VoipCustomActions>({
  name: "voip",
  endpoint: "/voip/participants",
  stateKey: "voipState",
  key: "userId",

  events: {
    update: "voipParticipantUpdated",
    delete: "voipParticipantDeleted",
  },

  custom: (getState, baseActions, api) => ({
    findByChannel: (channelId) => getState().filter((p) => p.channelId === channelId),

    unpublishAll: (userId) => {
      const participants = getState().filter((p) => p.userId === userId);
      for (const p of participants) {
        baseActions.remove(p.userId);
      }
    },

    joinChannel: (channelId, muted, deafened) =>
      api.post(`/voip/channel/${channelId}/join/${muted}/${deafened}`),

    joinPrivate: (userId, muted, deafened) =>
      api.post(`/voip/private/${userId}/join/${muted}/${deafened}`),

    leave: () => api.post("/voip/leave"),

    setMuted: (muted) => api.put("/voip/mute", { mute: muted }),

    setDeafened: (deafened) => api.put("/voip/deafen", { deafen: deafened }),

    publishScreen: (publish) => api.put("/voip/screen/publish", { publish }),

    publishCamera: (publish) => api.put("/voip/camera/publish", { publish }),
  }),
});

export type VoipStore = ReturnType<typeof useVoip>;

// ============================================================================
// ACL Store (Composite Key)
// ============================================================================

type AclKey = ["groupId", "roleId"];

interface AclCustomActions {
  findByGroup: (groupId: number) => GroupRoleRights[];
  getGroupRights: (groupId: number, roleId: number) => number | undefined;
  getChannelRights: (channelId: number, roleId: number) => number;
  grant: (right: GroupRoleRights) => Promise<Result<void, string>>;
  grantMany: (rights: GroupRoleRights[]) => Promise<Result<void, string>>;
}

export const useAcl = createEntityStore<GroupRoleRights, AclKey, AclCustomActions>({
  name: "acl",
  endpoint: "/acl/group-role-rights",
  stateKey: "groupRoleRights",
  key: ["groupId", "roleId"],

  events: {
    update: "groupRoleRightUpdated",
  },

  custom: (getState, baseActions, api) => ({
    findByGroup: (groupId) => getState().filter((r) => r.groupId === groupId),

    getGroupRights: (groupId, roleId) => {
      if ([0, 1].includes(roleId)) return 16;
      const right = getState().find((r) => r.groupId === groupId && r.roleId === roleId);
      return right?.rights;
    },

    getChannelRights: (channelId, roleId) => {
      const [, channelActions] = useChannel();
      const [, groupActions] = useGroup();

      const channel = channelActions.findById(channelId);
      if (!channel) return 0;
      const group = groupActions.findById(channel.groupId);
      if (!group) return 0;

      const rights = getState().find(
        (r) => r.groupId === group.groupId && r.roleId === roleId
      );
      return rights?.rights || 0;
    },

    grant: async (right) => {
      const result = await api.put("/acl/group-role-rights", [right]);
      if (result.isErr()) return result;
      baseActions.update(right);
      return ok(undefined);
    },

    grantMany: async (rights) => {
      if (rights.length === 0) return ok(undefined);

      const result = await api.put("/acl/group-role-rights", rights);
      if (result.isErr()) return result;

      for (const right of rights) {
        baseActions.update(right);
      }
      return ok(undefined);
    },
  }),
});

export type AclStore = ReturnType<typeof useAcl>;

// ============================================================================
// Subscription Store (Composite Key)
// ============================================================================

type SubscriptionKey = ["userId", "publisherId", "mediaType"];

interface SubscriptionCustomActions {
  isSubscribedToMedia: (publisherId: number, mediaType: MediaType) => boolean;
  subscribe: (publisherId: number, mediaType: MediaType) => Promise<Result<void, string>>;
  unsubscribe: (publisherId: number, mediaType: MediaType) => Promise<Result<void, string>>;
}

export const useSubscription = createEntityStore<Subscription, SubscriptionKey, SubscriptionCustomActions>({
  name: "subscription",
  endpoint: "/voip/subscriptions",
  stateKey: "subscriptions",
  key: ["userId", "publisherId", "mediaType"],

  events: {
    custom: {
      mediaSubscription: (event, actions) => {
        const data = event as { subscription: Subscription };
        actions.add(data.subscription);
      },
      mediaUnsubscription: (event, actions) => {
        const data = event as { subscription: Subscription };
        actions.remove({
          userId: data.subscription.userId,
          publisherId: data.subscription.publisherId,
          mediaType: data.subscription.mediaType,
        });
      },
    },
  },

  custom: (getState, _baseActions, api) => ({
    isSubscribedToMedia: (publisherId, mediaType) => {
      const [authState] = useAuth();
      const currentUserId = authState.session?.userId;
      if (!currentUserId) return false;

      return getState().some(
        (sub) =>
          sub.userId === currentUserId &&
          sub.publisherId === publisherId &&
          sub.mediaType === mediaType
      );
    },

    subscribe: (publisherId, mediaType) =>
      api.post("/voip/subscribe", { publisherId, mediaType }),

    unsubscribe: (publisherId, mediaType) =>
      api.post("/voip/unsubscribe", { publisherId, mediaType }),
  }),
});

export type SubscriptionStore = ReturnType<typeof useSubscription>;

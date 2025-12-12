import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Message, File, MessageType } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { useConnection } from "./connection";
import { useFile } from "./file";
import { useAuth } from "./auth";

interface MessageState {
  messages: Message[];
}

interface MessageActions {
  init: () => Promise<Result<void, string>>;
  list: () => Message[];
  findById: (id: number) => Message | undefined;
  findByChannel: (channelId: number) => Message[];
  findByRecipient: (recipientId: number) => Message[];
  getAttachments: (messageId: number) => File[];
  insert: (message: Message) => void;
  update: (message: Message) => void;
  remove: (id: number) => void;
  removeByChannel: (channelId: number) => void;
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

export type MessageStore = [MessageState, MessageActions];

function createMessageStore(): MessageStore {
  const [state, setState] = createStore<MessageState>({
    messages: [],
  });

  const connection = useConnection();

  const actions: MessageActions = {
    async init() {
      const [, fileActions] = useFile();

      connection.onServerEvent((event) => {
        if (event.type === "messageCreated") {
          const data = event as unknown as {
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

          actions.insert(message);

          for (const file of data.files) {
            fileActions.add(file);
          }
        } else if (event.type === "messageUpdated") {
          const data = event as unknown as {
            messageId: number;
            messageText: string;
          };
          const existing = actions.findById(data.messageId);
          if (existing) {
            actions.update({
              ...existing,
              messageText: data.messageText,
              modifiedAt: new Date().toISOString(),
            });
          }
        } else if (event.type === "messageDeleted") {
          actions.remove(event.messageId as number);
        }
      });

      return ok(undefined);
    },

    list() {
      return state.messages;
    },

    findById(id) {
      return state.messages.find((m) => m.id === id);
    },

    findByChannel(channelId) {
      return state.messages
        .filter((m) => m.channelId === channelId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },

    findByRecipient(recipientId) {
      const [authState] = useAuth();
      const currentUserId = authState.session?.userId;
      if (!currentUserId) return [];

      return state.messages
        .filter(
          (m) =>
            m.channelId === null &&
            ((m.senderId === currentUserId && m.recipientId === recipientId) ||
              (m.senderId === recipientId && m.recipientId === currentUserId))
        )
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },

    getAttachments(messageId) {
      const [fileState] = useFile();
      return fileState.files.filter((f) => f.messageId === messageId);
    },

    insert(newMessage) {
      setState(
        "messages",
        produce((messages) => {
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
    },

    update(message) {
      setState(
        "messages",
        produce((messages) => {
          const index = messages.findIndex((m) => m.id === message.id);
          if (index !== -1) {
            messages[index] = message;
          }
        })
      );
    },

    remove(id) {
      setState(
        "messages",
        produce((messages) => {
          const index = messages.findIndex((m) => m.id === id);
          if (index !== -1) {
            messages.splice(index, 1);
          }
        })
      );
    },

    removeByChannel(channelId) {
      setState(
        "messages",
        produce((messages) => {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].channelId === channelId) {
              messages.splice(i, 1);
            }
          }
        })
      );
    },

    async fetchMessages(contextType, contextId, limit, timestamp) {
      const endpoint =
        contextType === "dm"
          ? `/message/dm/${contextId}/messages`
          : `/message/channel/${contextId}/messages`;

      const result = await fetchApi<Message[]>(endpoint, {
        method: "GET",
        query: { limit, timestamp },
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }

      for (const message of result.value) {
        actions.insert(message);
      }
      console.log("kalestika")

      return ok(result.value);
    },

    async send(contextType, contextId, text, files = [], replyToMessageId = null) {
      const endpoint =
        contextType === "dm"
          ? `/message/dm/${contextId}/messages`
          : `/message/channel/${contextId}/messages`;

      const result = await fetchApi(endpoint, {
        method: "POST",
        body: { messageText: text, files, replyToMessageId },
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async updateMessage(messageId, text) {
      const result = await fetchApi(`/message/${messageId}`, {
        method: "PUT",
        body: { message_text: text },
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async delete(messageId) {
      const result = await fetchApi(`/message/${messageId}`, {
        method: "DELETE",
      });

      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },
  };

  return [state, actions];
}

let instance: MessageStore | null = null;

export function useMessage(): MessageStore {
  if (!instance) {
    createRoot(() => {
      instance = createMessageStore();
    });
  }
  return instance!;
}

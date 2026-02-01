import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Message, File as StoredFile, MessagesResponse } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request, upload } from "../utils";
import { useConnection } from "./connection";
import { useFile } from "./file";
import { useReaction } from "./reaction";
import { useAuth } from "./auth";
import { useContext } from "./context";
import { useNotification } from "./notification";

interface MessageState {
    messages: Message[];
}

interface MessageActions {
    init: () => Promise<Result<void, string>>;
    cleanup: () => void;
    list: () => Message[];
    findById: (id: number) => Message | undefined;
    findByChannel: (channelId: number) => Message[];
    findByRecipient: (recipientId: number) => Message[];
    getAttachments: (messageId: number) => StoredFile[];
    add: (message: Message) => void;
    update: (message: Message) => void;
    remove: (id: number) => void;
    removeByChannel: (channelId: number) => void;
    markRepliesDeleted: (deletedMessageId: number) => void;
    fetchMessages: (
        contextType: "channel" | "dm",
        contextId: number,
        limit: number,
        timestamp: string
    ) => Promise<Result<Message[], string>>;
    fetchMessagesRange: (
        contextType: "channel" | "dm",
        contextId: number,
        fromMessageId: number,
        upToMessageId: number
    ) => Promise<Result<Message[], string>>;
    send: (
        contextType: "channel" | "dm",
        contextId: number,
        text: string | undefined,
        files?: File[],
        replyToMessageId?: number | undefined,
        onProgress?: (percent: number) => void,
        signal?: AbortSignal
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
    const [fileState, fileActions] = useFile();
    const [, reactionActions] = useReaction();
    const [, authActions] = useAuth();
    const [, context] = useContext();
    const notification = useNotification();
    let cleanupFn: (() => void) | null = null;

    const actions: MessageActions = {
        async init() {
            actions.cleanup();

            cleanupFn = connection.onServerEvent((event) => {
                if (event.type === "messageCreated") {
                    const { messageId, senderId, messageType, messageText, timestamp, replyToMessageId, files } = event as any;

                    const channelId = messageType.type === "Channel" ? messageType.channel_id : null;
                    const recipientId = messageType.type === "Direct" ? messageType.recipient_id : null;

                    actions.add({
                        id: messageId,
                        senderId,
                        channelId,
                        recipientId,
                        messageText,
                        createdAt: timestamp,
                        modifiedAt: undefined,
                        replyToMessageId,
                    });

                    for (const file of files) {
                        fileActions.add(file);
                    }

                    const currentUserId = authActions.getUser().userId;
                    if (senderId !== currentUserId) {
                        if (messageType.type === "Channel" && !context.isCurrentContext("channel", channelId)) {
                            notification.pushChannel(messageId, channelId);
                        } else if (messageType.type === "Direct" && !context.isCurrentContext("dm", senderId)) {
                            notification.pushDM(messageId, senderId);
                        }
                    }
                } else if (event.type === "messageUpdated") {
                    const { messageId, messageText } = event as any;
                    const existing = actions.findById(messageId);
                    if (existing) {
                        actions.update({
                            ...existing,
                            messageText,
                            modifiedAt: new Date().toISOString(),
                        });
                    }
                } else if (event.type === "messageDeleted") {
                    const deletedId = (event as any).messageId;
                    actions.markRepliesDeleted(deletedId);
                    fileActions.removeByMessageId(deletedId);
                    reactionActions.removeByMessageId(deletedId);
                    actions.remove(deletedId);
                }
            });

            return ok(undefined);
        },

        cleanup() {
            if (cleanupFn) {
                cleanupFn();
                cleanupFn = null;
            }
            setState("messages", []);
        },

        list() {
            return state.messages;
        },

        findById(id) {
            return state.messages.find((m) => m.id === id);
        },

        findByChannel(channelId) {
            return state.messages.filter((m) => m.channelId === channelId);
        },

        findByRecipient(recipientId) {
            const user = authActions.getUser();

            return state.messages.filter((m) =>
            ((m.senderId === user.userId && m.recipientId === recipientId) ||
                (m.senderId === recipientId && m.recipientId === user.userId))
            );
        },

        getAttachments(messageId) {
            return fileState.files.filter((f) => f.messageId === messageId);
        },

        add(message) {
            setState("messages", (msgs) => {
                const time = new Date(message.createdAt).getTime();

                if (msgs.length === 0 || time >= new Date(msgs.at(-1)!.createdAt).getTime()) {
                    return [...msgs, message];
                }

                if (time <= new Date(msgs[0].createdAt).getTime()) {
                    return [message, ...msgs];
                }

                let left = 0;
                let right = msgs.length - 1;
                while (left <= right) {
                    const mid = Math.floor((left + right) / 2);
                    if (new Date(msgs[mid].createdAt).getTime() <= time) {
                        left = mid + 1;
                    } else {
                        right = mid - 1;
                    }
                }

                return [...msgs.slice(0, left), message, ...msgs.slice(left)];
            });
        },

        update(message) {
            setState("messages", (msgs) => msgs.map((m) => m.id === message.id ? message : m));
        },

        remove(id) {
            setState("messages", (msgs) => msgs.filter((m) => m.id !== id));
        },

        removeByChannel(channelId) {
            for (const msg of state.messages.filter((m) => m.channelId === channelId)) {
                fileActions.removeByMessageId(msg.id);
                reactionActions.removeByMessageId(msg.id);
            }
            setState("messages", (msgs) => msgs.filter((m) => m.channelId !== channelId));
        },

        markRepliesDeleted(deletedMessageId) {
            setState("messages", (msgs) =>
                msgs.map((m) =>
                    m.replyToMessageId === deletedMessageId
                        ? { ...m, replyToMessageId: undefined }
                        : m
                )
            );
        },

        async fetchMessages(contextType, contextId, limit, timestamp) {
            const endpoint =
                contextType === "dm"
                    ? `/message/dm/${contextId}/messages`
                    : `/message/channel/${contextId}/messages`;

            const result = await request<MessagesResponse>(endpoint, {
                method: "GET",
                query: { limit, timestamp },
            });

            if (result.isErr()) {
                return err(result.error.reason);
            }

            for (const message of result.value.messages) {
                actions.add(message);
            }

            for (const file of result.value.files) {
                fileActions.add(file);
            }

            for (const reaction of result.value.reactions) {
                reactionActions.add(reaction);
            }

            return ok(result.value.messages);
        },

        async fetchMessagesRange(contextType, contextId, fromMessageId, upToMessageId) {
            const endpoint =
                contextType === "dm"
                    ? `/message/dm/${contextId}/messages/range`
                    : `/message/channel/${contextId}/messages/range`;

            const result = await request<MessagesResponse>(endpoint, {
                method: "GET",
                query: { fromMessageId, upToMessageId },
            });

            if (result.isErr()) {
                return err(result.error.reason);
            }

            for (const message of result.value.messages) {
                actions.add(message);
            }

            for (const file of result.value.files) {
                fileActions.add(file);
            }

            for (const reaction of result.value.reactions) {
                reactionActions.add(reaction);
            }

            return ok(result.value.messages);
        },

        async send(contextType, contextId, text, files = [], replyToMessageId = undefined, onProgress, signal) {
            const endpoint =
                contextType === "dm"
                    ? `/message/dm/${contextId}/messages`
                    : `/message/channel/${contextId}/messages`;

            const formData = new FormData();
            if (text) {
                formData.append("messageText", text);
            }
            if (replyToMessageId) {
                formData.append("replyToMessageId", String(replyToMessageId));
            }
            for (const file of files) {
                formData.append("files", file);
            }

            const result = await upload(endpoint, formData, onProgress, signal);
            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },

        async updateMessage(messageId, text) {
            const result = await request(`/message/${messageId}`, {
                method: "PUT",
                body: { message_text: text },
            });

            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },

        async delete(messageId) {
            const result = await request(`/message/${messageId}`, {
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

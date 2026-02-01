import { createRoot } from "solid-js";
import { decode, encode } from "@msgpack/msgpack";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import type {
    Channel,
    Group,
    Role,
    User,
    VoipParticipant,
    GroupRoleRights,
    File,
    ServerConfig,
    Reaction,
} from "../model";
import { getWsUrl } from "../lib/ServerConfig";


const PING_INTERVAL_MS = 1000;
const PONG_TIMEOUT_MS = 2000;
const MAX_MISSED_PONGS = 1;

const CLOSE_CODE_NORMAL = 1000;
const CLOSE_CODE_GOING_AWAY = 1001;
const CLOSE_CODE_ABNORMAL = 1006;
const CLOSE_CODE_AUTH_FAILED = 4001;
const CLOSE_CODE_DISCONNECTED = 4002;


export type EventPayload =
    | { type: "channelCreated"; channel: Channel }
    | { type: "channelUpdated"; channel: Channel }
    | { type: "channelDeleted"; channelId: number }
    | { type: "groupCreated"; group: Group }
    | { type: "groupUpdated"; group: Group }
    | { type: "groupDeleted"; groupId: number }
    | { type: "roleCreated"; role: Role }
    | { type: "roleUpdated"; role: Role }
    | { type: "roleDeleted"; roleId: number }
    | { type: "userCreated"; user: User }
    | { type: "userUpdated"; user: User }
    | { type: "userDeleted"; userId: number }
    | { type: "serverUpdated"; server: ServerConfig }
    | { type: "groupRoleRightUpdated"; right: GroupRoleRights }
    | { type: "voipParticipantCreated"; user: VoipParticipant }
    | { type: "voipParticipantUpdated"; user: VoipParticipant }
    | { type: "voipParticipantDeleted"; userId: number }
    | {
        type: "messageCreated";
        messageId: number;
        senderId: number;
        messageType: string;
        messageText: string | null;
        replyToMessageId: number | undefined;
        timestamp: string;
        files: File[];
    }
    | { type: "messageUpdated"; messageId: number; messageText: string }
    | { type: "messageDeleted"; messageId: number }
    | {
        type: "reactionAdded";
        reaction: Reaction;
        messageType: { type: "Channel"; channelId: number } | { type: "Direct"; recipientId: number };
    }
    | {
        type: "reactionRemoved";
        messageId: number;
        userId: number;
        emoji: string;
        messageType: { type: "Channel"; channelId: number } | { type: "Direct"; recipientId: number };
    }
    | { type: "readStatusUpdated"; channelId: number | null; recipientId: number | null; hasNewMessage: boolean }
    | { type: "speakStatusUpdated"; userId: number; speaking: boolean };

type ConnectionMessage =
    | { type: "ping"; timestamp: number }
    | { type: "pong"; timestamp: number }
    | { type: "event"; payload: EventPayload };

export type ConnectionError =
    | { type: "networkError" }
    | { type: "authFailed" };

export interface ConnectionActions {
    connect: (token: string) => Promise<Result<void, ConnectionError>>;
    disconnect: () => void;
    onServerEvent: (callback: (event: EventPayload) => void) => () => void;
    onConnectionClosed: (callback: () => void) => () => void;
    onConnectionLost: (callback: () => void) => () => void;
    sendSpeakStatus: (userId: number, speaking: boolean) => void;
}


interface PendingPing {
    timestamp: number;
    sentAt: number;
    timeoutId: number;
}


function createConnectionStore(): ConnectionActions {
    const serverEventCallbacks = new Set<(event: EventPayload) => void>();
    const closedCallbacks = new Set<() => void>();
    const connectionLostCallbacks = new Set<() => void>();

    let socket: WebSocket | null = null;
    let pingIntervalId: number | null = null;
    let pendingPings: PendingPing[] = [];
    let missedPongs = 0;
    let connectResolve: ((result: Result<void, ConnectionError>) => void) | null = null;

    function disconnect() {
        if (pingIntervalId !== null) {
            clearInterval(pingIntervalId);
            pingIntervalId = null;
        }
        pendingPings.forEach(p => clearTimeout(p.timeoutId));
        pendingPings = [];
        missedPongs = 0;
        if (socket) {
            socket.close(1000, "Client disconnect");
            socket = null;
        }
    }

    function startPingPong() {
        pingIntervalId = window.setInterval(() => {
            if (!socket || socket.readyState !== WebSocket.OPEN) return;

            const timestamp = Date.now();
            socket.send(encode({ type: "ping", timestamp }));

            const timeoutId = window.setTimeout(() => {
                pendingPings = pendingPings.filter(p => p.timestamp !== timestamp);
                missedPongs++;

                if (missedPongs >= MAX_MISSED_PONGS) {
                    disconnect();
                    notifyConnectionLost();
                }
            }, PONG_TIMEOUT_MS);

            pendingPings.push({ timestamp, sentAt: Date.now(), timeoutId });
        }, PING_INTERVAL_MS);
    }

    function handleMessage(data: ArrayBuffer) {
        const message = decode(data) as ConnectionMessage;

        switch (message.type) {
            case "ping":
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(encode({ type: "pong", timestamp: message.timestamp }));
                }
                break;

            case "pong": {
                const ping = pendingPings.find(p => p.timestamp === message.timestamp);
                if (ping) {
                    clearTimeout(ping.timeoutId);
                    pendingPings = pendingPings.filter(p => p.timestamp !== message.timestamp);
                    missedPongs = 0;
                }
                break;
            }

            case "event":
                notifyServerEvent(message.payload);
                break;
        }
    }

    function handleOpen() {
        startPingPong();
        if (connectResolve) {
            connectResolve(ok(undefined));
            connectResolve = null;
        }
    }

    function handleClose(event: CloseEvent) {
        disconnect();

        switch (event.code) {
            case CLOSE_CODE_NORMAL:
                break;
            case CLOSE_CODE_AUTH_FAILED:
                if (connectResolve) {
                    connectResolve(err({ type: "authFailed" }));
                    connectResolve = null;
                }
                break;
            case CLOSE_CODE_DISCONNECTED:
                if (connectResolve) {
                    connectResolve(err({ type: "networkError" }));
                    connectResolve = null;
                } else {
                    notifyClosed();
                }
                break;
            case CLOSE_CODE_GOING_AWAY:
            case CLOSE_CODE_ABNORMAL:
            default:
                if (connectResolve) {
                    connectResolve(err({ type: "networkError" }));
                    connectResolve = null;
                } else {
                    notifyConnectionLost();
                }
                break;
        }
    }

    function notifyServerEvent(event: EventPayload): void {
        serverEventCallbacks.forEach((cb) => cb(event));
    }

    function notifyClosed(): void {
        closedCallbacks.forEach((cb) => cb());
    }

    function notifyConnectionLost(): void {
        connectionLostCallbacks.forEach((cb) => cb());
    }

    const actions: ConnectionActions = {
        connect(token: string): Promise<Result<void, ConnectionError>> {
            disconnect();

            try {
                const wsUrl = `${getWsUrl()}/ws?token=${encodeURIComponent(token)}`;
                socket = new WebSocket(wsUrl);
                socket.binaryType = "arraybuffer";
                socket.onopen = handleOpen;
                socket.onmessage = (event) => handleMessage(event.data);
                socket.onclose = handleClose;

            } catch {
                return Promise.resolve(err({ type: "networkError" }));
            }

            return new Promise((resolve) => {
                connectResolve = resolve;
            });
        },

        disconnect,

        onServerEvent(callback: (event: EventPayload) => void): () => void {
            serverEventCallbacks.add(callback);
            return () => serverEventCallbacks.delete(callback);
        },

        onConnectionClosed(callback: () => void): () => void {
            closedCallbacks.add(callback);
            return () => closedCallbacks.delete(callback);
        },

        onConnectionLost(callback: () => void): () => void {
            connectionLostCallbacks.add(callback);
            return () => connectionLostCallbacks.delete(callback);
        },

        sendSpeakStatus(userId: number, speaking: boolean): void {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(encode({
                    type: "event",
                    payload: { type: "speakStatusUpdated", userId, speaking }
                }));
            }
        },
    };

    return actions;
}

let instance: ConnectionActions | null = null;

export function useConnection(): ConnectionActions {
    if (!instance) {
        createRoot(() => {
            instance = createConnectionStore();
        });
    }
    return instance!;
}

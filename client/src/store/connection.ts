import { createRoot } from "solid-js";
import { decode, encode } from "@msgpack/msgpack";
import type {
  Channel,
  Group,
  Role,
  User,
  VoipParticipant,
  GroupRoleRights,
  Subscription,
  File,
  ServerConfig,
  Reaction,
} from "../model";
import { err, ok, type Result } from "opencord-utils";
import { MediaTransport } from "opencord-transport";

function hexToUint8Array(hexString: string): Uint8Array {
  const cleanHex = hexString.replace(/[^0-9A-Fa-f]/g, '');
  const matches = cleanHex.match(/.{1,2}/g);
  if (!matches) return new Uint8Array();
  return new Uint8Array(
    matches.map((byte) => parseInt(byte, 16))
  );
}

function getCertificateHash(): WebTransportHash | undefined {
  const certHash = import.meta.env.VITE_CERT_HASH;
  if (!certHash) return undefined;
  return {
    algorithm: 'sha-256',
    value: hexToUint8Array(certHash)
  };
}

export type AnswerPayload =
  | { type: "accept" }
  | { type: "decline"; reason: string };

export type ControlPayload =
  | { type: "connect"; token: string }
  | { type: "answer"; answer: AnswerPayload }
  | { type: "close"; reason?: string }
  | { type: "error"; reason: string };

export type VoipPayload =
  | {
    type: "speech";
    userId: number;
    isSpeaking: boolean;
  }
  | {
    type: "media";
    userId: number;
    mediaType: "voice" | "camera" | "screen" | "screenSound";
    data: Uint8Array;
    timestamp: number;
    realTimestamp: number;
    key: "key" | "delta";
    sequence: number;
  };

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
    replyToMessageId: number | null;
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
  | { type: "mediaSubscription"; subscription: Subscription }
  | { type: "mediaUnsubscription"; subscription: Subscription }
  | { type: "readStatusUpdated"; channelId: number | null; recipientId: number | null; hasNewMessage: boolean };

type ConnectionMessage =
  | { type: "voip"; payload: VoipPayload }
  | { type: "event"; payload: EventPayload }
  | { type: "control"; payload: ControlPayload };

export interface ConnectionActions {
  connect: (url: string, token: string) => Promise<Result<void, string>>;
  disconnect: () => Promise<void>;
  sendVoip: (payload: VoipPayload) => Promise<void>;
  sendControl: (payload: ControlPayload) => void;

  onVoipData: (callback: (data: VoipPayload) => void) => () => void;
  onServerEvent: (callback: (event: EventPayload) => void) => () => void;
  onConnectionClosed: (callback: () => void) => () => void;
  onConnectionError: (callback: (reason: string) => void) => () => void;
}

interface TransportConfig {
  certificateHash?: WebTransportHash;
}

function createConnectionStore(config?: TransportConfig): ConnectionActions {
  const voipDataCallbacks = new Set<(data: VoipPayload) => void>();
  const serverEventCallbacks = new Set<(event: EventPayload) => void>();
  const closedCallbacks = new Set<() => void>();
  const errorCallbacks = new Set<(reason: string) => void>();

  let pendingConnection: {
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  const protocol = new MediaTransport(
    (data: ArrayBuffer) => {
      const message = decode(data) as ConnectionMessage;
      handleConnectionMessage(message);
    },
    (data: ArrayBuffer) => {
      const message = decode(data) as ConnectionMessage;
      handleConnectionMessage(message);
    },
    async (error: string) => {
      await actions.disconnect();
      notifyError(error);
    }
  );

  function handleConnectionMessage(message: ConnectionMessage): void {
    switch (message.type) {
      case "voip":
        notifyVoipData(message.payload);
        break;
      case "control":
        handleControlPayload(message.payload);
        break;
      case "event":
        notifyServerEvent(message.payload);
        break;
    }
  }

  async function handleControlPayload(payload: ControlPayload) {
    switch (payload.type) {
      case "answer":
        if (pendingConnection) {
          const success = payload.answer.type === "accept";
          pendingConnection.resolve(success);
          pendingConnection = null;
        }
        break;

      case "close":
        await actions.disconnect()
        notifyClosed();
        break;

      case "error":
        await actions.disconnect();
        notifyError(payload.reason);
        break;

      case "connect":
        console.warn("Received unexpected connect message from server");
        break;
    }
  }

  function notifyVoipData(data: VoipPayload): void {
    voipDataCallbacks.forEach((cb) => cb(data));
  }

  function notifyServerEvent(event: EventPayload): void {
    serverEventCallbacks.forEach((cb) => cb(event));
  }

  function notifyClosed(): void {
    closedCallbacks.forEach((cb) => cb());
  }

  function notifyError(reason: string): void {
    errorCallbacks.forEach((cb) => cb(reason));
  }

  const actions: ConnectionActions = {
    async connect(url: string, token: string): Promise<Result<void, string>> {
      await actions.disconnect();

      try {
        if (config?.certificateHash) {
          await protocol.connect(url, config.certificateHash);
        } else {
          await protocol.connect(url);
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Connection failed";
        return err(errorMsg);
      }

      return new Promise((resolve) => {
        if (pendingConnection) {
          resolve(err("Connection already in progress"));
          return;
        }

        pendingConnection = {
          resolve: (success: boolean) => {
            if (success) {
              resolve(ok(undefined));
            } else {
              resolve(err("Connection rejected by server"));
            }
          },
          reject: (error: Error) => {
            resolve(err(error.message));
          },
        };

        const connectMessage: ControlPayload = {
          type: "connect",
          token,
        };

        protocol.sendSafe(encode(connectMessage));

        setTimeout(() => {
          if (pendingConnection) {
            pendingConnection.reject(new Error("Connection timeout"));
            pendingConnection = null;
          }
        }, 10000);
      });
    },

    async disconnect(): Promise<void> {
      pendingConnection = null;
      await protocol.disconnect()
    },

    async sendVoip(payload: VoipPayload): Promise<void> {
      await protocol.send(encode(payload));
    },

    sendControl(payload: ControlPayload): void {
      protocol.sendSafe(encode(payload));
    },

    onVoipData(callback: (data: VoipPayload) => void): () => void {
      voipDataCallbacks.add(callback);
      return () => voipDataCallbacks.delete(callback);
    },

    onServerEvent(callback: (event: EventPayload) => void): () => void {
      serverEventCallbacks.add(callback);
      return () => serverEventCallbacks.delete(callback);
    },

    onConnectionClosed(callback: () => void): () => void {
      closedCallbacks.add(callback);
      return () => closedCallbacks.delete(callback);
    },

    onConnectionError(callback: (reason: string) => void): () => void {
      errorCallbacks.add(callback);
      return () => errorCallbacks.delete(callback);
    },
  };

  return actions;
}

let instance: ConnectionActions | null = null;

export function useConnection(): ConnectionActions {
  if (!instance) {
    createRoot(() => {
      instance = createConnectionStore({
        certificateHash: getCertificateHash()
      });
    });
  }
  return instance!;
}

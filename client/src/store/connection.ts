import { createRoot } from "solid-js";
import { RTCPProtocol } from "opencord-transport";
import { decode, encode } from "@msgpack/msgpack";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";

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

export interface VoipPayload {
  type: string;
  userId: number;
  [key: string]: unknown;
}

export interface EventPayload {
  type: string;
  [key: string]: unknown;
}

type ConnectionMessage =
  | { type: "voip"; payload: VoipPayload }
  | { type: "event"; payload: EventPayload }
  | { type: "control"; payload: ControlPayload };

export interface ConnectionActions {
  connect: (url: string, token: string) => Promise<Result<void, string>>;
  disconnect: () => Promise<void>;
  sendVoip: (payload: VoipPayload) => void;
  sendControl: (payload: ControlPayload) => void;

  // Event subscriptions - return unsubscribe function
  onVoipData: (callback: (data: VoipPayload) => void) => () => void;
  onServerEvent: (callback: (event: EventPayload) => void) => () => void;
  onConnectionClosed: (callback: () => void) => () => void;
  onConnectionError: (callback: (reason: string) => void) => () => void;
}

interface TransportConfig {
  certificateHash?: WebTransportHash;
}

function createConnectionStore(config?: TransportConfig): ConnectionActions {
  // Callback registries
  const voipDataCallbacks = new Set<(data: VoipPayload) => void>();
  const serverEventCallbacks = new Set<(event: EventPayload) => void>();
  const closedCallbacks = new Set<() => void>();
  const errorCallbacks = new Set<(reason: string) => void>();

  // Pending connection promise
  let pendingConnection: {
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  // RTCPProtocol instance
  const protocol = new RTCPProtocol(
    (data: ArrayBuffer) => {
      const message = decode(data) as ConnectionMessage;
      handleConnectionMessage(message);
    },
    (data: ArrayBuffer) => {
      const message = decode(data) as ConnectionMessage;
      handleConnectionMessage(message);
    },
    () => {
      notifyError("Connection to server lost");
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

  function handleControlPayload(payload: ControlPayload): void {
    switch (payload.type) {
      case "answer":
        if (pendingConnection) {
          const success = payload.answer.type === "accept";
          pendingConnection.resolve(success);
          pendingConnection = null;
        }
        break;

      case "close":
        notifyClosed();
        actions.disconnect();
        break;

      case "error":
        notifyError(payload.reason);
        actions.disconnect();
        break;

      case "connect":
        console.warn("Received unexpected connect message from server");
        break;
    }
  }

  // Notification helpers
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
      try {
        await protocol.connect(url, config?.certificateHash);
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
      const closeMessage: ConnectionMessage = {
        type: "control",
        payload: {
          type: "close",
        },
      };
      protocol.send(encode(closeMessage));
      await protocol.disconnect();
    },

    sendVoip(payload: VoipPayload): void {
      protocol.send(encode(payload));
    },

    sendControl(payload: ControlPayload): void {
      protocol.sendSafe(encode(payload));
    },

    // Event subscriptions - return unsubscribe function
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

// Singleton instance
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

import { RTCPProtocol } from 'opencord-transport'
import { decode, encode } from '@msgpack/msgpack'
import type { ConnectionMessage, ControlPayload, EventPayload, VoipPayload } from '../store';
import type { Result } from 'opencord-utils';
import { err } from 'opencord-utils';
import { ok } from 'opencord-utils';

export interface TransportConfig {
  certificateHash?: {
    algorithm: string;
    value: Uint8Array;
  };
}

export class TransportProvider {
  private protocol: RTCPProtocol;
  private certificateHash?: WebTransportHash;
  private pendingConnection: {
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  private onVoipData?: (data: VoipPayload) => void;
  private onServerEvent?: (event: EventPayload) => void;
  private onClose?: () => void;
  private onError?: (reason: string) => void;
  private onAuthRejected?: () => void;

  constructor(config?: TransportConfig) {
    this.certificateHash = config?.certificateHash;
    this.protocol = new RTCPProtocol(
      (data: ArrayBuffer) => {
        const event = decode(data) as ConnectionMessage;
        this.handleConnectionMessage(event)
      },
      (data: ArrayBuffer) => {
        const event = decode(data) as ConnectionMessage;
        this.handleConnectionMessage(event)
      },
      () => {
        if (this.onError) {
          this.onError("Connection to server lost");
        }
      }
    );
  }

  private handleConnectionMessage(message: ConnectionMessage): void {
    switch (message.type) {
      case "voip":
        if (this.onVoipData)
          this.onVoipData(message.payload)
        break
      case 'control':
        this.handleControlPayload(message.payload);
        break;
      case "event":
        if (this.onServerEvent)
          this.onServerEvent(message.payload)
        break;
    }
  }

  private handleControlPayload(payload: ControlPayload): void {
    switch (payload.type) {
      case 'answer':
        if (this.pendingConnection) {
          const success = payload.answer.type === 'accept';
          this.pendingConnection.resolve(success);
          this.pendingConnection = null;
          if (!success && this.onAuthRejected) {
            this.onAuthRejected();
          }
        }
        break;

      case 'close':
        if (this.onClose) {
          this.onClose();
          this.disconnect()
        }
        break;

      case 'error':
        if (this.onError) {
          this.onError(payload.reason);
          this.disconnect()
        }
        break;

      case 'connect':
        console.warn('Received unexpected connect message from server');
        break;
    }
  }

  public async connect(url: string, token: string): Promise<Result<void, string>> {
    await this.protocol.connect(url, this.certificateHash)

    return new Promise((resolve) => {
      if (this.pendingConnection) {
        resolve(err('Connection already in progress'));
        return;
      }

      this.pendingConnection = {
        resolve: (success: boolean) => {
          if (success) {
            resolve(ok(undefined));
          } else {
            resolve(err('Connection rejected by server'));
          }
        },
        reject: (error: Error) => {
          resolve(err(error.message));
        }
      };

      const connectMessage: ControlPayload = {
        type: 'connect',
        token
      };

      this.protocol.sendSafe(encode(connectMessage));

      setTimeout(() => {
        if (this.pendingConnection) {
          this.pendingConnection.reject(new Error('Connection timeout'));
          this.pendingConnection = null;
        }
      }, 10000);
    });
  }

  public sendVoip(payload: VoipPayload): void {
    this.protocol.send(encode(payload));
  }

  public sendControl(payload: ControlPayload): void {
    this.protocol.sendSafe(encode(payload));
  }

  public onVoipDataReceived(callback: (data: VoipPayload) => void): void {
    this.onVoipData = callback;
  }

  public onServerEventReceived(callback: (event: EventPayload) => void): void {
    this.onServerEvent = callback;
  }

  public onConnectionClosed(callback: () => void): void {
    this.onClose = callback;
  }

  public onConnectionError(callback: (reason: string) => void): void {
    this.onError = callback;
  }


  public async disconnect() {
    const closeMessage: ConnectionMessage = {
      type: 'control',
      payload: {
        type: 'close'
      }
    };
    this.protocol.send(encode(closeMessage));
    await this.protocol.disconnect()
  }

}

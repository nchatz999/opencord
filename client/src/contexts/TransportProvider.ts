import { RTCPProtocol } from 'opencord-transport'
import { decode, encode } from '@msgpack/msgpack'
import type { ConnectionMessage, ControlPayload, EventPayload, VoipPayload } from '../store';

export interface TransportConfig {
  url: string;
  certificateHash: {
    algorithm: string;
    value: Uint8Array;
  };
}

export class TransportProvider {
  private protocol: RTCPProtocol;
  private pendingConnection: {
    resolve: (success: boolean) => void;
    reject: (error: Error) => void;
  } | null = null;

  private onVoipData?: (data: VoipPayload) => void;
  private onServerEvent?: (event: EventPayload) => void;
  private onConnect?: () => void;
  private onDisconnect?: () => void;

  constructor(config: TransportConfig) {
    this.protocol = new RTCPProtocol(
      config.url,
      config.certificateHash,
      (data: any) => {
        const message = decode(data) as VoipPayload;
        if (this.onVoipData) {
          this.onVoipData(message);
        }
      },
      (data: any) => {
        const event = decode(data) as ConnectionMessage;
        this.handleConnectionMessage(event)
      },
      () => {
        if (this.onConnect) {
          this.onConnect();
        }
      },
      () => {
        if (this.onDisconnect) {
          this.onDisconnect();
        }
      }
    );
  }

  private handleConnectionMessage(payload: ConnectionMessage): void {
    switch (payload.type) {
      case 'control':
        this.handleControlPayload(payload.payload);
        break;
      case "event":
        if (this.onServerEvent)
          this.onServerEvent(payload.payload)
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
        }
        break;

      case 'close':
        if (this.onDisconnect) {
          this.onDisconnect();
        }
        break;

      case 'connect':
        // Server shouldn't send connect messages to client
        console.warn('Received unexpected connect message from server');
        break;
    }
  }

  public async connect(token: string): Promise<boolean> {
    await this.protocol.connect()
    return new Promise((resolve, reject) => {
      if (this.pendingConnection) {
        reject(new Error('Connection already in progress'));
        return;
      }

      this.pendingConnection = { resolve, reject };

      const connectMessage: ControlPayload = {
        type: 'connect',
        token
      };

      this.protocol.sendSafe(encode(connectMessage));

      // Set timeout for connection attempt
      setTimeout(() => {
        if (this.pendingConnection) {
          this.pendingConnection.reject(new Error('Connection timeout'));
          this.pendingConnection = null;
        }
      }, 10000); // 10 second timeout
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

  public onConnectionEstablished(callback: () => void): void {
    this.onConnect = callback;
  }

  public onConnectionLost(callback: () => void): void {
    this.onDisconnect = callback;
  }

  public disconnect(): void {
    const closeMessage: ConnectionMessage = {
      type: 'control',
      payload: {
        type: 'close',
        reason: 'User disconnected'
      }
    };
    this.protocol.send(encode(closeMessage));
  }

}

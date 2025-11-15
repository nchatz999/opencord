import { RTCPProtocol } from 'opencord-transport'
import { decode, encode } from '@msgpack/msgpack'
import { 
  type ControlPayload, 
  type ConnectionMessage, 
  type VoipPayload, 
  type ServerEvent,
  AnswerType 
} from '../store'

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
  private onServerEvent?: (event: ServerEvent) => void;
  private onConnect?: () => void;
  private onDisconnect?: () => void;

  constructor(config: TransportConfig) {
    this.protocol = new RTCPProtocol(
      config.url,
      config.certificateHash,
      (data: any) => {
        const message = decode(data) as ConnectionMessage;
        this.handleConnectionMessage(message);
      },
      (data: any) => {
        const event = decode(data) as ServerEvent;
        if (this.onServerEvent) {
          this.onServerEvent(event);
        }
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

  private handleConnectionMessage(message: ConnectionMessage): void {
    switch (message.type) {
      case 'voip':
        if (this.onVoipData) {
          this.onVoipData(message.payload);
        }
        break;
      
      case 'event':
        if (this.onServerEvent) {
          this.onServerEvent(message.payload);
        }
        break;
      
      case 'control':
        this.handleControlMessage(message.payload);
        break;
    }
  }

  private handleControlMessage(payload: ControlPayload): void {
    switch (payload.type) {
      case 'answer':
        if (this.pendingConnection) {
          const success = payload.payload.type === AnswerType.Accept;
          this.pendingConnection.resolve(success);
          this.pendingConnection = null;
        }
        break;
      
      case 'close':
        if (this.onDisconnect) {
          this.onDisconnect();
        }
        break;
    }
  }

  public async connect(token: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (this.pendingConnection) {
        reject(new Error('Connection already in progress'));
        return;
      }

      this.pendingConnection = { resolve, reject };

      // Send connect message
      const connectMessage: ConnectionMessage = {
        type: 'control',
        payload: {
          type: 'connect',
          token: token
        }
      };

      this.protocol.send(encode(connectMessage));

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
    const message: ConnectionMessage = {
      type: 'voip',
      payload: payload
    };
    this.protocol.send(encode(message));
  }

  public sendControl(payload: ControlPayload): void {
    const message: ConnectionMessage = {
      type: 'control',
      payload: payload
    };
    this.protocol.send(encode(message));
  }

  public onVoipDataReceived(callback: (data: VoipPayload) => void): void {
    this.onVoipData = callback;
  }

  public onServerEventReceived(callback: (event: ServerEvent) => void): void {
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

  public isConnected(): boolean {
    return this.protocol.isConnected();
  }
}

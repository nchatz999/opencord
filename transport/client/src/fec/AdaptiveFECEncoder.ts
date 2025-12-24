import { FECController, FECDecision } from './FECController';
import { PacketType, RTPPacket, FecPacket } from '../transmission';

export class AdaptiveFECEncoder {
  private controller: FECController;
  private pendingPackets: RTPPacket[] = [];
  private lastDecision: FECDecision = { ratio: 4 };
  private currentFrameId: bigint | null = null;

  constructor(controller: FECController) {
    this.controller = controller;
  }

  processPacket(packet: RTPPacket): FecPacket | null {
    if (this.currentFrameId !== null && packet.frameId !== this.currentFrameId) {
      const flushed = this.pendingPackets.length > 1
        ? this.generateFECPacket(this.pendingPackets)
        : null;
      this.pendingPackets = [packet];
      this.currentFrameId = packet.frameId;
      return flushed;
    }

    this.currentFrameId = packet.frameId;
    const decision = this.controller.decide();
    this.lastDecision = decision;
    this.pendingPackets.push(packet);

    if (this.pendingPackets.length >= decision.ratio) {
      const fecPacket = this.generateFECPacket(this.pendingPackets);
      this.pendingPackets = [];
      return fecPacket;
    }

    return null;
  }

  flush(): FecPacket[] {
    const fecPackets: FecPacket[] = [];

    if (this.pendingPackets.length > 1) {
      fecPackets.push(this.generateFECPacket(this.pendingPackets));
      this.pendingPackets = [];
    }

    return fecPackets;
  }

  private generateFECPacket(packets: RTPPacket[]): FecPacket {
    const maxLength = Math.max(...packets.map(p => p.data.length));
    const xorResult = new Uint8Array(maxLength);
    const protectedLengths: number[] = [];

    for (const packet of packets) {
      protectedLengths.push(packet.data.length);
      for (let i = 0; i < packet.data.length; i++) {
        xorResult[i] ^= packet.data[i];
      }
    }

    return {
      type: PacketType.FEC,
      timestamp: packets[packets.length - 1].timestamp,
      protectedSequences: packets.map(p => p.sequenceNumber),
      protectedLengths,
      fecData: xorResult,
    };
  }

  getCurrentDecision(): FECDecision {
    return this.lastDecision;
  }

  getPendingCount(): number {
    return this.pendingPackets.length;
  }

  reset(): void {
    this.pendingPackets = [];
    this.currentFrameId = null;
  }
}

import { FECController, FECDecision } from './FECController';
import { PacketType, RTPPacket, FecPacket, ProtectedPacketMeta } from '../transmission';

const INTERLEAVE_DEPTH = 3;

export class AdaptiveFECEncoder {
  private controller: FECController;
  private slots: RTPPacket[][] = [];
  private currentSlot: number = 0;
  private groupSize: number = INTERLEAVE_DEPTH;
  private lastDecision: FECDecision = { ratio: INTERLEAVE_DEPTH };

  constructor(controller: FECController) {
    this.controller = controller;
    this.initializeSlots();
  }

  private initializeSlots(): void {
    this.slots = Array.from({ length: INTERLEAVE_DEPTH }, () => []);
    this.currentSlot = 0;
  }

  processPacket(packet: RTPPacket): FecPacket[] {
    const fecPackets: FecPacket[] = [];

    const decision = this.controller.decide();

    if (decision.ratio !== this.groupSize) {
      fecPackets.push(...this.flushAll());
      this.groupSize = Math.max(2, decision.ratio);
    }

    this.lastDecision = decision;

    this.slots[this.currentSlot].push(packet);
    this.currentSlot = (this.currentSlot + 1) % INTERLEAVE_DEPTH;

    for (const slot of this.slots) {
      if (slot.length >= this.groupSize) {
        fecPackets.push(this.generateFECPacket(slot));
        slot.length = 0;
      }
    }

    return fecPackets;
  }

  private flushAll(): FecPacket[] {
    const fecPackets: FecPacket[] = [];

    for (const slot of this.slots) {
      if (slot.length > 1) {
        fecPackets.push(this.generateFECPacket(slot));
      }
      slot.length = 0;
    }

    return fecPackets;
  }

  flush(): FecPacket[] {
    const result = this.flushAll();
    this.currentSlot = 0;
    return result;
  }

  private generateFECPacket(packets: RTPPacket[]): FecPacket {
    const maxLength = Math.max(...packets.map(p => p.data.length));
    const xorResult = new Uint8Array(maxLength);
    const protectedPackets: ProtectedPacketMeta[] = [];

    for (const packet of packets) {
      protectedPackets.push({
        sequenceNumber: packet.sequenceNumber,
        timestamp: packet.timestamp,
        frameId: packet.frameId,
        fragmentNumber: packet.fragmentNumber,
        totalFragments: packet.totalFragments,
        dataLength: packet.data.length,
      });
      for (let i = 0; i < packet.data.length; i++) {
        xorResult[i] ^= packet.data[i];
      }
    }

    return {
      type: PacketType.FEC,
      timestamp: packets[packets.length - 1].timestamp,
      protectedPackets,
      fecData: xorResult,
    };
  }

  getCurrentDecision(): FECDecision {
    return this.lastDecision;
  }

  getPendingCount(): number {
    return this.slots.reduce((sum, slot) => sum + slot.length, 0);
  }

  reset(): void {
    for (const slot of this.slots) {
      slot.length = 0;
    }
    this.currentSlot = 0;
  }

  static recoverPacket(fecPacket: FecPacket, availablePackets: RTPPacket[]): RTPPacket | null {
    if (availablePackets.length !== fecPacket.protectedPackets.length - 1) {
      return null;
    }

    const missingMeta = fecPacket.protectedPackets.find(
      (meta) => !availablePackets.some((p) => p.sequenceNumber === meta.sequenceNumber)
    );

    if (!missingMeta) {
      return null;
    }

    const xorResult = new Uint8Array(fecPacket.fecData);
    for (const packet of availablePackets) {
      const minLength = Math.min(xorResult.length, packet.data.length);
      for (let i = 0; i < minLength; i++) {
        xorResult[i] ^= packet.data[i];
      }
    }

    const trimmedData = xorResult.slice(0, missingMeta.dataLength);

    return {
      type: PacketType.RTP,
      sequenceNumber: missingMeta.sequenceNumber,
      timestamp: missingMeta.timestamp,
      frameId: missingMeta.frameId,
      fragmentNumber: missingMeta.fragmentNumber,
      totalFragments: missingMeta.totalFragments,
      data: trimmedData,
    };
  }
}

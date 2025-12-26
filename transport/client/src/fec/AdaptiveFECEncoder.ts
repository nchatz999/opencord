import { LossEstimator } from './LossEstimator';
import { PacketType, RTPPacket, FecPacket, ProtectedPacketMeta } from '../transmission';

const INTERLEAVE_DEPTH = 3;
const DEFAULT_FEC_RATIO = 4;

const MIN_HOLD_TIME_MS = 2000;
const INCREASE_THRESHOLD_OFFSET = 0.005;
const DECREASE_THRESHOLD_OFFSET = 0.01;

export class AdaptiveFECEncoder {
  private lossEstimator: LossEstimator;
  private slots: RTPPacket[][] = [];
  private currentSlot: number = 0;
  private groupSize: number = DEFAULT_FEC_RATIO;
  private currentRatio: number = DEFAULT_FEC_RATIO;
  private lastChangeTime: number = 0;

  constructor(lossEstimator: LossEstimator) {
    this.lossEstimator = lossEstimator;
    this.initializeSlots();
  }

  private initializeSlots(): void {
    this.slots = Array.from({ length: INTERLEAVE_DEPTH }, () => []);
    this.currentSlot = 0;
  }

  processPacket(packet: RTPPacket, rtt: number): FecPacket[] {
    const fecPackets: FecPacket[] = [];
    const ratio = this.decideRatio(rtt);

    if (ratio !== this.groupSize) {
      fecPackets.push(...this.flushAll());
      this.groupSize = Math.max(2, ratio);
    }

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

  private decideRatio(rtt: number): number {
    const stats = this.lossEstimator.getStats();
    const targetRatio = this.calculateTargetRatio(stats.lossRate, rtt);
    return this.applyHysteresis(targetRatio, stats.lossRate);
  }

  private calculateTargetRatio(lossRate: number, rtt: number): number {
    if (rtt > 200) return 2;
    if (rtt > 100) {
      if (lossRate < 0.03) return 3;
      return 2;
    }
    if (lossRate < 0.03) return 4;
    if (lossRate < 0.10) return 3;
    return 2;
  }

  private applyHysteresis(targetRatio: number, currentLoss: number): number {
    const now = Date.now();
    const timeSinceLastChange = now - this.lastChangeTime;

    if (targetRatio < this.currentRatio) {
      const increaseThreshold = this.getCurrentThreshold() + INCREASE_THRESHOLD_OFFSET;
      if (currentLoss > increaseThreshold) {
        this.currentRatio = targetRatio;
        this.lastChangeTime = now;
      }
    } else if (targetRatio > this.currentRatio) {
      if (timeSinceLastChange < MIN_HOLD_TIME_MS) {
        return this.currentRatio;
      }
      const decreaseThreshold = this.getCurrentThreshold() - DECREASE_THRESHOLD_OFFSET;
      if (currentLoss < decreaseThreshold) {
        this.currentRatio = targetRatio;
        this.lastChangeTime = now;
      }
    }

    return this.currentRatio;
  }

  private getCurrentThreshold(): number {
    switch (this.currentRatio) {
      case 4: return 0.03;
      case 3: return 0.10;
      default: return 0.10;
    }
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

  getCurrentRatio(): number {
    return this.currentRatio;
  }

  getPendingCount(): number {
    return this.slots.reduce((sum, slot) => sum + slot.length, 0);
  }

  reset(): void {
    for (const slot of this.slots) {
      slot.length = 0;
    }
    this.currentSlot = 0;
    this.groupSize = DEFAULT_FEC_RATIO;
    this.currentRatio = DEFAULT_FEC_RATIO;
    this.lastChangeTime = 0;
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

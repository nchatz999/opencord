import { RingBuffer } from 'opencord-utils';

interface PacketRecord {
  sequence: bigint;
  received: boolean;
}

export interface LossStats {
  lossRate: number;
  sampleSize: number;
}

const WINDOW_SIZE = 200;
const SMOOTHING_ALPHA = 0.1;

export class LossEstimator {
  private window: RingBuffer<PacketRecord>;
  private sequenceMap: Map<bigint, PacketRecord>;
  private smoothedLossRate: number = 0;

  constructor() {
    this.window = new RingBuffer<PacketRecord>(WINDOW_SIZE);
    this.sequenceMap = new Map();
  }

  recordPacketSent(sequence: bigint): void {
    const record: PacketRecord = { sequence, received: false };

    if (this.window.isFull()) {
      const removed = this.window.shift();
      if (removed) {
        this.sequenceMap.delete(removed.sequence);
      }
    }

    this.window.push(record);
    this.sequenceMap.set(sequence, record);
    this.updateSmoothedRate();
  }

  recordPacketReceived(sequence: bigint): void {
    const record = this.sequenceMap.get(sequence);
    if (record) {
      record.received = true;
      this.updateSmoothedRate();
    }
  }

  recordPacketRecovered(sequence: bigint): void {
    const record = this.sequenceMap.get(sequence);
    if (record) {
      record.received = true;
      this.updateSmoothedRate();
    }
  }

  getStats(): LossStats {
    return {
      lossRate: this.smoothedLossRate,
      sampleSize: this.window.length(),
    };
  }

  private updateSmoothedRate(): void {
    const packets = this.window.toArray();
    if (packets.length === 0) return;

    const received = packets.filter(p => p.received).length;
    const rawLossRate = (packets.length - received) / packets.length;

    if (this.smoothedLossRate === 0) {
      this.smoothedLossRate = rawLossRate;
    } else {
      this.smoothedLossRate = (1 - SMOOTHING_ALPHA) * this.smoothedLossRate + SMOOTHING_ALPHA * rawLossRate;
    }
  }

  reset(): void {
    this.window.clear();
    this.sequenceMap.clear();
    this.smoothedLossRate = 0;
  }
}

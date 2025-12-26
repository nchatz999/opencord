export interface LossStats {
  lossRate: number;
  sampleSize: number;
}

const WINDOW_MS = 2000;
const SMOOTHING_ALPHA = 0.1;

interface SentRecord {
  sequence: bigint;
  timestamp: number;
}

export class LossEstimator {
  private sentPackets: SentRecord[] = [];
  private nackedSet: Set<bigint> = new Set();
  private smoothedLossRate: number = 0;

  recordPacketSent(sequence: bigint): void {
    this.sentPackets.push({ sequence, timestamp: Date.now() });
    this.prune();
  }

  recordNackReceived(sequences: bigint[]): void {
    const windowSeqs = new Set(this.sentPackets.map(p => p.sequence));
    for (const seq of sequences) {
      if (windowSeqs.has(seq)) {
        this.nackedSet.add(seq);
      }
    }
    this.updateSmoothedRate();
  }

  getStats(): LossStats {
    return {
      lossRate: this.smoothedLossRate,
      sampleSize: this.sentPackets.length,
    };
  }

  private prune(): void {
    const cutoff = Date.now() - WINDOW_MS;
    const toRemove: bigint[] = [];

    this.sentPackets = this.sentPackets.filter(p => {
      if (p.timestamp < cutoff) {
        toRemove.push(p.sequence);
        return false;
      }
      return true;
    });

    for (const seq of toRemove) {
      this.nackedSet.delete(seq);
    }
  }

  private updateSmoothedRate(): void {
    if (this.sentPackets.length === 0) return;

    const rawLossRate = this.nackedSet.size / this.sentPackets.length;

    if (this.smoothedLossRate === 0) {
      this.smoothedLossRate = rawLossRate;
    } else {
      this.smoothedLossRate = (1 - SMOOTHING_ALPHA) * this.smoothedLossRate + SMOOTHING_ALPHA * rawLossRate;
    }
  }

  reset(): void {
    this.sentPackets = [];
    this.nackedSet.clear();
    this.smoothedLossRate = 0;
  }
}

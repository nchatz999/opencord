import { timerManager } from 'opencord-utils';
import type { LossEstimator } from '../fec';

const PACING_INTERVAL_MS = 5;
const LOSS_THRESHOLD = 0.10;
const MIN_INTERVALS = 3;
const MAX_INTERVALS = 6;
const MIN_BUDGET_BYTES = 10000;

export class PacketPacer {
  private queue: Uint8Array[] = [];
  private queueBytes: number = 0;
  private intervalId: number | null = null;
  private sendFn: (data: Uint8Array) => void;
  private lossEstimator: LossEstimator;

  constructor(
    sendFn: (data: Uint8Array) => void,
    lossEstimator: LossEstimator
  ) {
    this.sendFn = sendFn;
    this.lossEstimator = lossEstimator;
  }

  start(): void {
    if (this.intervalId !== null) return;
    this.intervalId = timerManager.setInterval(() => this.drain(), PACING_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      timerManager.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.queue = [];
    this.queueBytes = 0;
  }

  enqueue(data: Uint8Array): void {
    this.queue.push(data);
    this.queueBytes += data.length;
  }

  private drain(): void {
    if (this.queue.length === 0) return;

    const budget = this.getBudget();
    let sent = 0;

    while (this.queue.length > 0 && sent + this.queue[0].length <= budget) {
      const packet = this.queue.shift()!;
      sent += packet.length;
      this.queueBytes -= packet.length;
      this.sendFn(packet);
    }
  }

  private getBudget(): number {
    const { lossRate } = this.lossEstimator.getStats();

    const t = Math.min(lossRate / LOSS_THRESHOLD, 1);
    const targetIntervals = MIN_INTERVALS + t * (MAX_INTERVALS - MIN_INTERVALS);
    const adaptiveBudget = this.queueBytes / targetIntervals;

    return Math.max(adaptiveBudget, MIN_BUDGET_BYTES);
  }

  get pending(): number {
    return this.queue.length;
  }

  reset(): void {
    this.queue = [];
    this.queueBytes = 0;
  }
}

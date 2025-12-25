import { LossEstimator, LossStats } from './LossEstimator';

export interface FECDecision {
  ratio: number;
}

interface RatioThreshold {
  maxLoss: number;
  ratio: number;
}

const RATIO_TABLE: RatioThreshold[] = [
  { maxLoss: 0.03, ratio: 4 },
  { maxLoss: 0.10, ratio: 3 },
  { maxLoss: 1.00, ratio: 2 },
];

const MIN_HOLD_TIME_MS = 2000;
const INCREASE_THRESHOLD_OFFSET = 0.005;
const DECREASE_THRESHOLD_OFFSET = 0.01;

export class FECController {
  private lossEstimator: LossEstimator;
  private currentRatio: number = 4;
  private lastChangeTime: number = 0;
  private currentThresholdIndex: number = 0;

  constructor(lossEstimator: LossEstimator) {
    this.lossEstimator = lossEstimator;
  }

  decide(): FECDecision {
    const stats = this.lossEstimator.getStats();
    const targetRatio = this.calculateTargetRatio(stats);
    const finalRatio = this.applyHysteresis(targetRatio, stats.lossRate);
    return { ratio: finalRatio };
  }

  private calculateTargetRatio(stats: LossStats): number {
    for (const threshold of RATIO_TABLE) {
      if (stats.lossRate < threshold.maxLoss) {
        return threshold.ratio;
      }
    }
    return RATIO_TABLE[RATIO_TABLE.length - 1].ratio;
  }

  private applyHysteresis(targetRatio: number, currentLoss: number): number {
    const now = Date.now();
    const timeSinceLastChange = now - this.lastChangeTime;

    if (targetRatio < this.currentRatio) {
      const increaseThreshold = this.getCurrentThreshold() + INCREASE_THRESHOLD_OFFSET;
      if (currentLoss > increaseThreshold) {
        this.currentRatio = targetRatio;
        this.lastChangeTime = now;
        this.updateThresholdIndex(targetRatio);
      }
    } else if (targetRatio > this.currentRatio) {
      if (timeSinceLastChange < MIN_HOLD_TIME_MS) {
        return this.currentRatio;
      }
      const decreaseThreshold = this.getCurrentThreshold() - DECREASE_THRESHOLD_OFFSET;
      if (currentLoss < decreaseThreshold) {
        this.currentRatio = targetRatio;
        this.lastChangeTime = now;
        this.updateThresholdIndex(targetRatio);
      }
    }

    return this.currentRatio;
  }

  private getCurrentThreshold(): number {
    if (this.currentThresholdIndex < 0 || this.currentThresholdIndex >= RATIO_TABLE.length) {
      return 0.05;
    }
    return RATIO_TABLE[this.currentThresholdIndex].maxLoss;
  }

  private updateThresholdIndex(ratio: number): void {
    for (let i = 0; i < RATIO_TABLE.length; i++) {
      if (RATIO_TABLE[i].ratio === ratio) {
        this.currentThresholdIndex = i;
        return;
      }
    }
  }

  getCurrentRatio(): number {
    return this.currentRatio;
  }

  reset(): void {
    this.currentRatio = 4;
    this.lastChangeTime = 0;
    this.currentThresholdIndex = 0;
  }
}

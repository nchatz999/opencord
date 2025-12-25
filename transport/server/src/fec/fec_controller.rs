use super::loss_estimator::LossEstimator;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct FecDecision {
    pub ratio: u8,
}

struct RatioThreshold {
    max_loss: f64,
    ratio: u8,
}

const RATIO_TABLE: &[RatioThreshold] = &[
    RatioThreshold { max_loss: 0.03, ratio: 4 },
    RatioThreshold { max_loss: 0.10, ratio: 3 },
    RatioThreshold { max_loss: 1.00, ratio: 2 },
];

const MIN_HOLD_TIME_MS: u64 = 2000;
const INCREASE_THRESHOLD_OFFSET: f64 = 0.005;
const DECREASE_THRESHOLD_OFFSET: f64 = 0.01;

pub struct FecController {
    current_ratio: u8,
    last_change_time: Option<Instant>,
    current_threshold_index: usize,
}

impl FecController {
    pub fn new() -> Self {
        Self {
            current_ratio: 4,
            last_change_time: None,
            current_threshold_index: 0,
        }
    }

    pub fn decide(&mut self, loss_estimator: &LossEstimator) -> FecDecision {
        let stats = loss_estimator.get_stats();
        let target_ratio = self.calculate_target_ratio(stats.loss_rate);
        let final_ratio = self.apply_hysteresis(target_ratio, stats.loss_rate);
        FecDecision { ratio: final_ratio }
    }

    fn calculate_target_ratio(&self, loss_rate: f64) -> u8 {
        for threshold in RATIO_TABLE {
            if loss_rate < threshold.max_loss {
                return threshold.ratio;
            }
        }
        RATIO_TABLE.last().map(|t| t.ratio).unwrap_or(2)
    }

    fn apply_hysteresis(&mut self, target_ratio: u8, current_loss: f64) -> u8 {
        let now = Instant::now();

        if target_ratio < self.current_ratio {
            let increase_threshold = self.get_current_threshold() + INCREASE_THRESHOLD_OFFSET;
            if current_loss > increase_threshold {
                self.current_ratio = target_ratio;
                self.last_change_time = Some(now);
                self.update_threshold_index(target_ratio);
            }
        } else if target_ratio > self.current_ratio {
            let time_since_last_change = self
                .last_change_time
                .map(|t| now.duration_since(t).as_millis() as u64)
                .unwrap_or(u64::MAX);

            if time_since_last_change < MIN_HOLD_TIME_MS {
                return self.current_ratio;
            }

            let decrease_threshold = self.get_current_threshold() - DECREASE_THRESHOLD_OFFSET;
            if current_loss < decrease_threshold {
                self.current_ratio = target_ratio;
                self.last_change_time = Some(now);
                self.update_threshold_index(target_ratio);
            }
        }

        self.current_ratio
    }

    fn get_current_threshold(&self) -> f64 {
        RATIO_TABLE
            .get(self.current_threshold_index)
            .map(|t| t.max_loss)
            .unwrap_or(0.05)
    }

    fn update_threshold_index(&mut self, ratio: u8) {
        for (i, threshold) in RATIO_TABLE.iter().enumerate() {
            if threshold.ratio == ratio {
                self.current_threshold_index = i;
                return;
            }
        }
    }

    pub fn get_current_ratio(&self) -> u8 {
        self.current_ratio
    }

    pub fn reset(&mut self) {
        self.current_ratio = 4;
        self.last_change_time = None;
        self.current_threshold_index = 0;
    }
}

impl Default for FecController {
    fn default() -> Self {
        Self::new()
    }
}

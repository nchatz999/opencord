use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone)]
struct PacketRecord {
    sequence: u64,
    received: bool,
}

#[derive(Debug, Clone)]
pub struct LossStats {
    pub loss_rate: f64,
    pub sample_size: usize,
}

const WINDOW_SIZE: usize = 200;
const SMOOTHING_ALPHA: f64 = 0.1;

pub struct LossEstimator {
    window: VecDeque<PacketRecord>,
    sequence_map: HashMap<u64, usize>,
    smoothed_loss_rate: f64,
}

impl LossEstimator {
    pub fn new() -> Self {
        Self {
            window: VecDeque::with_capacity(WINDOW_SIZE),
            sequence_map: HashMap::new(),
            smoothed_loss_rate: 0.0,
        }
    }

    pub fn record_packet_sent(&mut self, sequence: u64) {
        let record = PacketRecord {
            sequence,
            received: false,
        };

        if self.window.len() >= WINDOW_SIZE {
            if let Some(removed) = self.window.pop_front() {
                self.sequence_map.remove(&removed.sequence);
            }
            for (_, idx) in self.sequence_map.iter_mut() {
                *idx = idx.saturating_sub(1);
            }
        }

        let idx = self.window.len();
        self.window.push_back(record);
        self.sequence_map.insert(sequence, idx);
        self.update_smoothed_rate();
    }

    pub fn record_packet_received(&mut self, sequence: u64) {
        if let Some(&idx) = self.sequence_map.get(&sequence) {
            if let Some(record) = self.window.get_mut(idx) {
                record.received = true;
                self.update_smoothed_rate();
            }
        }
    }

    pub fn record_packet_recovered(&mut self, sequence: u64) {
        if let Some(&idx) = self.sequence_map.get(&sequence) {
            if let Some(record) = self.window.get_mut(idx) {
                record.received = true;
                self.update_smoothed_rate();
            }
        }
    }

    pub fn get_stats(&self) -> LossStats {
        LossStats {
            loss_rate: self.smoothed_loss_rate,
            sample_size: self.window.len(),
        }
    }

    fn update_smoothed_rate(&mut self) {
        if self.window.is_empty() {
            return;
        }

        let received = self.window.iter().filter(|p| p.received).count();
        let raw_loss_rate = (self.window.len() - received) as f64 / self.window.len() as f64;

        if self.smoothed_loss_rate == 0.0 {
            self.smoothed_loss_rate = raw_loss_rate;
        } else {
            self.smoothed_loss_rate =
                (1.0 - SMOOTHING_ALPHA) * self.smoothed_loss_rate + SMOOTHING_ALPHA * raw_loss_rate;
        }
    }

    pub fn reset(&mut self) {
        self.window.clear();
        self.sequence_map.clear();
        self.smoothed_loss_rate = 0.0;
    }
}

impl Default for LossEstimator {
    fn default() -> Self {
        Self::new()
    }
}

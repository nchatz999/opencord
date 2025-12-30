use std::collections::HashSet;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct LossStats {
    pub loss_rate: f64,
    pub sample_size: usize,
}

const WINDOW_DURATION: Duration = Duration::from_millis(2000);

struct SentRecord {
    sequence: u64,
    timestamp: Instant,
}

pub struct LossEstimator {
    sent_packets: Vec<SentRecord>,
    nacked_set: HashSet<u64>,
    smoothed_loss_rate: f64,
}

impl LossEstimator {
    pub fn new() -> Self {
        Self {
            sent_packets: Vec::new(),
            nacked_set: HashSet::new(),
            smoothed_loss_rate: 0.0,
        }
    }

    pub fn record_packet_sent(&mut self, sequence: u64) {
        self.sent_packets.push(SentRecord {
            sequence,
            timestamp: Instant::now(),
        });
        self.prune();
        self.update_smoothed_rate();
    }

    pub fn record_nack_received(&mut self, sequences: &[u64]) {
        let window_seqs: HashSet<u64> = self.sent_packets.iter().map(|p| p.sequence).collect();
        for &seq in sequences {
            if window_seqs.contains(&seq) {
                self.nacked_set.insert(seq);
            }
        }
        self.update_smoothed_rate();
    }

    pub fn get_stats(&self) -> LossStats {
        LossStats {
            loss_rate: self.smoothed_loss_rate,
            sample_size: self.sent_packets.len(),
        }
    }

    fn prune(&mut self) {
        let cutoff = Instant::now() - WINDOW_DURATION;
        let mut to_remove = Vec::new();

        self.sent_packets.retain(|p| {
            if p.timestamp < cutoff {
                to_remove.push(p.sequence);
                false
            } else {
                true
            }
        });

        for seq in to_remove {
            self.nacked_set.remove(&seq);
        }
    }

    fn update_smoothed_rate(&mut self) {
        if self.sent_packets.is_empty() {
            return;
        }

        let raw = self.nacked_set.len() as f64 / self.sent_packets.len() as f64;

        if self.smoothed_loss_rate == 0.0 {
            self.smoothed_loss_rate = raw;
        } else if raw > self.smoothed_loss_rate {
            self.smoothed_loss_rate = 0.8 * self.smoothed_loss_rate + 0.2 * raw;
        } else {
            self.smoothed_loss_rate = 0.95 * self.smoothed_loss_rate + 0.05 * raw;
        }
    }

    pub fn reset(&mut self) {
        self.sent_packets.clear();
        self.nacked_set.clear();
        self.smoothed_loss_rate = 0.0;
    }
}

impl Default for LossEstimator {
    fn default() -> Self {
        Self::new()
    }
}

use bytes::Bytes;
use std::collections::VecDeque;

use crate::fec::LossEstimator;

const LOSS_THRESHOLD: f64 = 0.10;
const MIN_INTERVALS: f64 = 3.0;
const MAX_INTERVALS: f64 = 6.0;
const MIN_BUDGET_BYTES: usize = 10000;

pub struct PacketPacer {
    queue: VecDeque<Bytes>,
    queue_bytes: usize,
}

impl PacketPacer {
    pub fn new() -> Self {
        Self {
            queue: VecDeque::new(),
            queue_bytes: 0,
        }
    }

    pub fn enqueue(&mut self, data: Bytes) {
        self.queue_bytes += data.len();
        self.queue.push_back(data);
    }

    pub fn drain(&mut self, loss_estimator: &LossEstimator) -> Vec<Bytes> {
        if self.queue.is_empty() {
            return Vec::new();
        }

        let budget = self.get_budget(loss_estimator);
        let mut sent = 0usize;
        let mut packets = Vec::new();

        while let Some(front) = self.queue.front() {
            if sent + front.len() > budget {
                break;
            }
            let packet = self.queue.pop_front().unwrap();
            sent += packet.len();
            self.queue_bytes -= packet.len();
            packets.push(packet);
        }

        packets
    }

    fn get_budget(&self, loss_estimator: &LossEstimator) -> usize {
        let stats = loss_estimator.get_stats();

        let t = (stats.loss_rate / LOSS_THRESHOLD).min(1.0);
        let target_intervals = MIN_INTERVALS + t * (MAX_INTERVALS - MIN_INTERVALS);
        let adaptive_budget = (self.queue_bytes as f64 / target_intervals) as usize;

        adaptive_budget.max(MIN_BUDGET_BYTES)
    }

    pub fn pending(&self) -> usize {
        self.queue.len()
    }

    pub fn reset(&mut self) {
        self.queue.clear();
        self.queue_bytes = 0;
    }
}

impl Default for PacketPacer {
    fn default() -> Self {
        Self::new()
    }
}

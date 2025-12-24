use super::fec_controller::{FecController, FecDecision};
use super::loss_estimator::LossEstimator;
use crate::packet::{FecBody, RtpBody};

pub struct AdaptiveFecEncoder {
    pending_packets: Vec<RtpBody>,
    last_decision: FecDecision,
    current_frame_id: Option<u64>,
}

impl AdaptiveFecEncoder {
    pub fn new() -> Self {
        Self {
            pending_packets: Vec::new(),
            last_decision: FecDecision { ratio: 4 },
            current_frame_id: None,
        }
    }

    pub fn process_packet(
        &mut self,
        packet: RtpBody,
        loss_estimator: &LossEstimator,
        fec_controller: &mut FecController,
    ) -> Option<FecBody> {
        if self
            .current_frame_id
            .is_some_and(|fid| fid != packet.frame_id)
        {
            let flushed = if self.pending_packets.len() > 1 {
                Self::generate_fec_packet(&self.pending_packets)
            } else {
                None
            };
            self.pending_packets = vec![packet];
            self.current_frame_id = Some(self.pending_packets[0].frame_id);
            return flushed;
        }
        self.current_frame_id = Some(packet.frame_id);
        let decision = fec_controller.decide(loss_estimator);
        self.last_decision = decision.clone();
        self.pending_packets.push(packet);

        if self.pending_packets.len() >= decision.ratio as usize {
            let fec_packet = Self::generate_fec_packet(&self.pending_packets);
            self.pending_packets.clear();
            return fec_packet;
        }

        None
    }

    pub fn flush(&mut self) -> Vec<FecBody> {
        let mut fec_packets = Vec::new();

        if self.pending_packets.len() > 1 {
            if let Some(fec) = Self::generate_fec_packet(&self.pending_packets) {
                fec_packets.push(fec);
            }
            self.pending_packets.clear();
        }

        fec_packets
    }

    fn generate_fec_packet(packets: &[RtpBody]) -> Option<FecBody> {
        if packets.is_empty() {
            return None;
        }

        let max_len = packets.iter().map(|p| p.data.len()).max().unwrap_or(0);
        if max_len == 0 {
            return None;
        }

        let mut fec_data = vec![0u8; max_len];
        let mut protected_sequences = Vec::with_capacity(packets.len());
        let mut protected_lengths = Vec::with_capacity(packets.len());

        for packet in packets {
            protected_sequences.push(packet.sequence_number);
            protected_lengths.push(packet.data.len() as u16);
            for (i, &byte) in packet.data.iter().enumerate() {
                fec_data[i] ^= byte;
            }
        }

        let timestamp = packets.last().map(|p| p.timestamp).unwrap_or(0);

        Some(FecBody {
            timestamp,
            protected_sequences,
            protected_lengths,
            fec_data,
        })
    }

    pub fn get_current_decision(&self) -> &FecDecision {
        &self.last_decision
    }

    pub fn get_pending_count(&self) -> usize {
        self.pending_packets.len()
    }

    pub fn reset(&mut self) {
        self.pending_packets.clear();
        self.current_frame_id = None;
    }
}

impl Default for AdaptiveFecEncoder {
    fn default() -> Self {
        Self::new()
    }
}

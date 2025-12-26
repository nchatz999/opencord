use super::loss_estimator::LossEstimator;
use crate::packet::{FecBody, ProtectedPacketMeta, RtpBody};

const DEFAULT_INTERLEAVE_DEPTH: usize = 3;
const DEFAULT_FEC_RATIO: u8 = 4;

pub struct AdaptiveFecEncoder {
    slots: Vec<Vec<RtpBody>>,
    current_slot: usize,
    group_size: usize,
    interleave_depth: usize,
}

impl AdaptiveFecEncoder {
    pub fn new() -> Self {
        Self::with_depth(DEFAULT_INTERLEAVE_DEPTH)
    }

    pub fn with_depth(depth: usize) -> Self {
        let depth = depth.max(1);
        Self {
            slots: (0..depth).map(|_| Vec::new()).collect(),
            current_slot: 0,
            group_size: DEFAULT_FEC_RATIO as usize,
            interleave_depth: depth,
        }
    }

    pub fn process_packet(
        &mut self,
        packet: RtpBody,
        loss_estimator: &LossEstimator,
        rtt: f64,
    ) -> Vec<FecBody> {
        let mut fec_packets = Vec::new();

        let ratio = self.decide_ratio(loss_estimator, rtt);
        self.group_size = (ratio as usize).max(2);

        self.slots[self.current_slot].push(packet);
        self.current_slot = (self.current_slot + 1) % self.interleave_depth;

        for slot in &mut self.slots {
            if slot.len() >= self.group_size {
                if let Some(fec) = Self::generate_fec_packet(slot) {
                    fec_packets.push(fec);
                }
                slot.clear();
            }
        }

        fec_packets
    }

    fn decide_ratio(&self, loss_estimator: &LossEstimator, rtt: f64) -> u8 {
        let loss = loss_estimator.get_stats().loss_rate;

        if rtt > 200.0 || loss >= 0.10 { 2 }
        else if rtt > 100.0 || loss >= 0.05 { 3 }
        else { 4 }
    }

    fn flush_all(&mut self) -> Vec<FecBody> {
        let mut fec_packets = Vec::new();

        for slot in &mut self.slots {
            if slot.len() > 1 {
                if let Some(fec) = Self::generate_fec_packet(slot) {
                    fec_packets.push(fec);
                }
            }
            slot.clear();
        }

        fec_packets
    }

    pub fn flush(&mut self) -> Vec<FecBody> {
        let result = self.flush_all();
        self.current_slot = 0;
        result
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
        let mut protected_packets = Vec::with_capacity(packets.len());

        for packet in packets {
            protected_packets.push(ProtectedPacketMeta {
                sequence_number: packet.sequence_number,
                timestamp: packet.timestamp,
                frame_id: packet.frame_id,
                fragment_number: packet.fragment_number,
                total_fragments: packet.total_fragments,
                data_length: packet.data.len() as u16,
            });
            for (i, &byte) in packet.data.iter().enumerate() {
                fec_data[i] ^= byte;
            }
        }

        let timestamp = packets.last().map(|p| p.timestamp).unwrap_or(0);

        Some(FecBody {
            timestamp,
            protected_packets,
            fec_data,
        })
    }

    pub fn get_pending_count(&self) -> usize {
        self.slots.iter().map(|s| s.len()).sum()
    }

    pub fn reset(&mut self) {
        for slot in &mut self.slots {
            slot.clear();
        }
        self.current_slot = 0;
        self.group_size = DEFAULT_FEC_RATIO as usize;
    }

    pub fn recover_packet(fec_packet: &FecBody, available_packets: &[RtpBody]) -> Option<RtpBody> {
        if available_packets.len() != fec_packet.protected_packets.len() - 1 {
            return None;
        }

        let missing_meta = fec_packet.protected_packets.iter().find(|meta| {
            !available_packets
                .iter()
                .any(|p| p.sequence_number == meta.sequence_number)
        })?;

        let mut recovered_data = fec_packet.fec_data.clone();
        for packet in available_packets {
            for (i, &byte) in packet.data.iter().enumerate() {
                if i < recovered_data.len() {
                    recovered_data[i] ^= byte;
                }
            }
        }

        recovered_data.truncate(missing_meta.data_length as usize);

        Some(RtpBody {
            timestamp: missing_meta.timestamp,
            sequence_number: missing_meta.sequence_number,
            frame_id: missing_meta.frame_id,
            fragment_number: missing_meta.fragment_number,
            total_fragments: missing_meta.total_fragments,
            data: recovered_data.into(),
        })
    }
}

impl Default for AdaptiveFecEncoder {
    fn default() -> Self {
        Self::new()
    }
}

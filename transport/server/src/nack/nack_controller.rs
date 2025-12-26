use crate::packet::{NackBody, Packet, RtpBody};
use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_SEQUENCE_GAP: u64 = 100;
const MAX_RETRANSMISSIONS: u32 = 5;

pub struct PendingNack {
    pub packet: NackBody,
    pub sent_at: Instant,
    pub created_at: u64,
    pub retransmissions: u32,
}

pub struct NackController;

impl NackController {
    pub fn get_delay(srtt: f64, rto: u64, retransmissions: u32) -> Duration {
        if retransmissions == 0 {
            if srtt > 150.0 { Duration::from_millis(60) } else { Duration::from_millis(20) }
        } else {
            Duration::from_millis(rto)
        }
    }

    pub fn on_gap_detected(
        pending_nacks: &mut Vec<PendingNack>,
        received_packets: &HashMap<u64, RtpBody>,
        _srtt: f64,
        start: u64,
        end: u64,
    ) {
        if end.saturating_sub(start) > MAX_SEQUENCE_GAP {
            return;
        }

        let missing: Vec<u64> = (start..end)
            .filter(|seq| !received_packets.contains_key(seq))
            .collect();

        if missing.is_empty() {
            return;
        }

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        pending_nacks.push(PendingNack {
            packet: NackBody { missing_sequences: missing },
            sent_at: Instant::now(),
            created_at: now,
            retransmissions: 0,
        });
    }

    pub fn on_rtp_received(
        pending_nacks: &mut Vec<PendingNack>,
        sequence_number: u64,
    ) {
        pending_nacks.retain_mut(|nack| {
            nack.packet.missing_sequences.retain(|s| *s != sequence_number);
            !nack.packet.missing_sequences.is_empty()
        });
    }

    pub fn check_pending_nacks<F>(
        pending_nacks: &mut Vec<PendingNack>,
        received_packets: &HashMap<u64, RtpBody>,
        srtt: f64,
        rto: u64,
        mut send_fn: F,
    ) where
        F: FnMut(&Packet),
    {
        pending_nacks.retain_mut(|nack| {
            nack.packet.missing_sequences.retain(|seq| !received_packets.contains_key(seq));
            if nack.packet.missing_sequences.is_empty() {
                return false;
            }
            if nack.retransmissions >= MAX_RETRANSMISSIONS {
                return false;
            }

            let delay = Self::get_delay(srtt, rto, nack.retransmissions);
            if Instant::now() >= nack.sent_at + delay {
                send_fn(&Packet::Nack(nack.packet.clone()));
                nack.sent_at = Instant::now();
                nack.retransmissions += 1;
            }
            true
        });
    }

    pub fn cleanup(pending_nacks: &mut Vec<PendingNack>, max_age_ms: u64) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        pending_nacks.retain(|nack| now - nack.created_at < max_age_ms);
    }
}

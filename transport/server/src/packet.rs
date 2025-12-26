use bytes::Bytes;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum PacketType {
    Ping = 0x01,
    Pong = 0x02,
    Fec = 0x03,
    Nack = 0x04,
    Rtp = 0x11,
}

#[derive(Debug, Clone)]
pub struct PingBody {
    pub timestamp: u64,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct PongBody {
    pub timestamp: u64,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct NackBody {
    pub missing_sequences: Vec<u64>,
}

#[derive(Debug, Clone)]
pub struct ProtectedPacketMeta {
    pub sequence_number: u64,
    pub timestamp: u64,
    pub frame_id: u64,
    pub fragment_number: u16,
    pub total_fragments: u16,
    pub data_length: u16,
}

#[derive(Debug, Clone)]
pub struct FecBody {
    pub timestamp: u64,
    pub protected_packets: Vec<ProtectedPacketMeta>,
    pub fec_data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, PartialOrd)]
pub struct RtpBody {
    pub timestamp: u64,
    pub sequence_number: u64,
    pub frame_id: u64,
    pub fragment_number: u16,
    pub total_fragments: u16,
    pub data: Bytes,
}

impl TryFrom<u8> for PacketType {
    type Error = &'static str;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0x01 => Ok(PacketType::Ping),
            0x02 => Ok(PacketType::Pong),
            0x03 => Ok(PacketType::Fec),
            0x04 => Ok(PacketType::Nack),
            0x11 => Ok(PacketType::Rtp),
            _ => Err("Invalid packet type"),
        }
    }
}

#[derive(Debug, Clone)]
pub enum Packet {
    Ping(PingBody),
    Pong(PongBody),
    Nack(NackBody),
    Fec(FecBody),
    Rtp(RtpBody),
}

pub struct FrameBuffer {
    pub frame_id: u64,
    expected_fragments: u16,
    packets: HashMap<u16, RtpBody>,
    pub created_at: u64,
}

impl FrameBuffer {
    pub fn new(frame_id: u64, expected_fragments: u16) -> Self {
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();

        Self {
            frame_id,
            expected_fragments,
            packets: HashMap::new(),
            created_at: created_at as u64,
        }
    }

    pub fn add_packet(&mut self, packet: RtpBody) -> Result<(), &'static str> {
        if packet.frame_id != self.frame_id {
            return Err("Packet does not belong to this frame");
        }
        if packet.total_fragments != self.expected_fragments {
            return Err("Inconsistent fragment count");
        }
        self.packets.insert(packet.fragment_number, packet);
        Ok(())
    }

    pub fn is_complete(&self) -> bool {
        self.packets.len() == self.expected_fragments as usize
    }

    pub fn reconstruct_data(&self) -> Option<Vec<u8>> {
        if !self.is_complete() {
            return None;
        }

        let mut sorted_packets: Vec<_> = self.packets.values().collect();
        sorted_packets.sort_by_key(|body| body.fragment_number);

        let total_length = sorted_packets.iter().map(|body| body.data.len()).sum();

        let mut result = Vec::with_capacity(total_length);

        for body in sorted_packets {
            result.extend_from_slice(&body.data);
        }

        Some(result)
    }
}

pub struct PacketSerializer;

impl PacketSerializer {
    pub fn serialize(packet: &Packet) -> Bytes {
        let mut buffer = Vec::new();

        match packet {
            Packet::Rtp(body) => {
                buffer.push(PacketType::Rtp as u8);
                buffer.extend_from_slice(&body.sequence_number.to_be_bytes());
                buffer.extend_from_slice(&body.timestamp.to_be_bytes());
                buffer.extend_from_slice(&body.frame_id.to_be_bytes());
                buffer.extend_from_slice(&body.total_fragments.to_be_bytes());
                buffer.extend_from_slice(&body.fragment_number.to_be_bytes());
                buffer.extend_from_slice(&body.data);
            }
            Packet::Fec(body) => {
                buffer.push(PacketType::Fec as u8);
                buffer.extend_from_slice(&body.timestamp.to_be_bytes());
                buffer.push(body.protected_packets.len() as u8);
                for meta in &body.protected_packets {
                    buffer.extend_from_slice(&meta.sequence_number.to_be_bytes());
                    buffer.extend_from_slice(&meta.timestamp.to_be_bytes());
                    buffer.extend_from_slice(&meta.frame_id.to_be_bytes());
                    buffer.extend_from_slice(&meta.fragment_number.to_be_bytes());
                    buffer.extend_from_slice(&meta.total_fragments.to_be_bytes());
                    buffer.extend_from_slice(&meta.data_length.to_be_bytes());
                }
                buffer.extend_from_slice(&body.fec_data);
            }
            Packet::Nack(body) => {
                buffer.push(PacketType::Nack as u8);
                buffer.push(body.missing_sequences.len() as u8);
                for seq in &body.missing_sequences {
                    buffer.extend_from_slice(&seq.to_be_bytes());
                }
            }
            Packet::Ping(body) => {
                buffer.push(PacketType::Ping as u8);
                buffer.extend_from_slice(&body.timestamp.to_be_bytes());
                buffer.extend_from_slice(&body.data);
            }
            Packet::Pong(body) => {
                buffer.push(PacketType::Pong as u8);
                buffer.extend_from_slice(&body.timestamp.to_be_bytes());
                buffer.extend_from_slice(&body.data);
            }
        }

        buffer.into()
    }

    pub fn deserialize(buffer: &[u8]) -> Option<Packet> {
        if buffer.is_empty() {
            return None;
        }

        let packet_type = PacketType::try_from(buffer[0]).ok()?;
        let mut offset = 1;

        match packet_type {
            PacketType::Rtp => {
                if buffer.len() < 29 {
                    return None;
                }
                let sequence_number = u64::from_be_bytes([
                    buffer[offset],
                    buffer[offset + 1],
                    buffer[offset + 2],
                    buffer[offset + 3],
                    buffer[offset + 4],
                    buffer[offset + 5],
                    buffer[offset + 6],
                    buffer[offset + 7],
                ]);
                offset += 8;
                let timestamp = u64::from_be_bytes([
                    buffer[offset],
                    buffer[offset + 1],
                    buffer[offset + 2],
                    buffer[offset + 3],
                    buffer[offset + 4],
                    buffer[offset + 5],
                    buffer[offset + 6],
                    buffer[offset + 7],
                ]);
                offset += 8;
                let frame_id = u64::from_be_bytes([
                    buffer[offset],
                    buffer[offset + 1],
                    buffer[offset + 2],
                    buffer[offset + 3],
                    buffer[offset + 4],
                    buffer[offset + 5],
                    buffer[offset + 6],
                    buffer[offset + 7],
                ]);
                offset += 8;
                let total_fragments = u16::from_be_bytes([buffer[offset], buffer[offset + 1]]);
                offset += 2;
                let fragment_number = u16::from_be_bytes([buffer[offset], buffer[offset + 1]]);
                offset += 2;
                let data = Bytes::copy_from_slice(&buffer[offset..]);

                Some(Packet::Rtp(RtpBody {
                    timestamp,
                    sequence_number,
                    frame_id,
                    fragment_number,
                    total_fragments,
                    data,
                }))
            }
            PacketType::Fec => {
                if buffer.len() < 10 {
                    return None;
                }
                let timestamp = u64::from_be_bytes([
                    buffer[offset],
                    buffer[offset + 1],
                    buffer[offset + 2],
                    buffer[offset + 3],
                    buffer[offset + 4],
                    buffer[offset + 5],
                    buffer[offset + 6],
                    buffer[offset + 7],
                ]);
                offset += 8;
                let protected_count = buffer[offset] as usize;
                offset += 1;

                // 30 bytes per protected packet: seq(8) + ts(8) + frame_id(8) + frag(2) + total(2) + len(2)
                let metadata_size = protected_count * 30;
                if buffer.len() < 10 + metadata_size {
                    return None;
                }

                let mut protected_packets = Vec::with_capacity(protected_count);
                for _ in 0..protected_count {
                    let sequence_number = u64::from_be_bytes([
                        buffer[offset],
                        buffer[offset + 1],
                        buffer[offset + 2],
                        buffer[offset + 3],
                        buffer[offset + 4],
                        buffer[offset + 5],
                        buffer[offset + 6],
                        buffer[offset + 7],
                    ]);
                    offset += 8;
                    let pkt_timestamp = u64::from_be_bytes([
                        buffer[offset],
                        buffer[offset + 1],
                        buffer[offset + 2],
                        buffer[offset + 3],
                        buffer[offset + 4],
                        buffer[offset + 5],
                        buffer[offset + 6],
                        buffer[offset + 7],
                    ]);
                    offset += 8;
                    let frame_id = u64::from_be_bytes([
                        buffer[offset],
                        buffer[offset + 1],
                        buffer[offset + 2],
                        buffer[offset + 3],
                        buffer[offset + 4],
                        buffer[offset + 5],
                        buffer[offset + 6],
                        buffer[offset + 7],
                    ]);
                    offset += 8;
                    let fragment_number = u16::from_be_bytes([buffer[offset], buffer[offset + 1]]);
                    offset += 2;
                    let total_fragments = u16::from_be_bytes([buffer[offset], buffer[offset + 1]]);
                    offset += 2;
                    let data_length = u16::from_be_bytes([buffer[offset], buffer[offset + 1]]);
                    offset += 2;

                    protected_packets.push(ProtectedPacketMeta {
                        sequence_number,
                        timestamp: pkt_timestamp,
                        frame_id,
                        fragment_number,
                        total_fragments,
                        data_length,
                    });
                }

                let fec_data = buffer[offset..].to_vec();

                Some(Packet::Fec(FecBody {
                    timestamp,
                    protected_packets,
                    fec_data,
                }))
            }
            PacketType::Nack => {
                if buffer.len() < 2 {
                    return None;
                }
                let count = buffer[offset] as usize;
                offset += 1;
                if buffer.len() < 2 + count * 8 {
                    return None;
                }
                let mut missing_sequences = Vec::with_capacity(count);
                for _ in 0..count {
                    let seq = u64::from_be_bytes([
                        buffer[offset],
                        buffer[offset + 1],
                        buffer[offset + 2],
                        buffer[offset + 3],
                        buffer[offset + 4],
                        buffer[offset + 5],
                        buffer[offset + 6],
                        buffer[offset + 7],
                    ]);
                    offset += 8;
                    missing_sequences.push(seq);
                }

                Some(Packet::Nack(NackBody { missing_sequences }))
            }
            PacketType::Ping | PacketType::Pong => {
                if buffer.len() < 9 {
                    return None;
                }
                let timestamp = u64::from_be_bytes([
                    buffer[offset],
                    buffer[offset + 1],
                    buffer[offset + 2],
                    buffer[offset + 3],
                    buffer[offset + 4],
                    buffer[offset + 5],
                    buffer[offset + 6],
                    buffer[offset + 7],
                ]);
                offset += 8;
                let data = buffer[offset..].to_vec();

                match packet_type {
                    PacketType::Ping => Some(Packet::Ping(PingBody { timestamp, data })),
                    PacketType::Pong => Some(Packet::Pong(PongBody { timestamp, data })),
                    _ => unreachable!(),
                }
            }
        }
    }
}

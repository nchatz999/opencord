pub mod fec;
pub mod nack;
pub mod packet;
pub mod pacing;

use bytes::Bytes;
use fec::{AdaptiveFecEncoder, LossEstimator};
use nack::{NackController, PendingNack};
use pacing::PacketPacer;
use packet::{FrameBuffer, Packet, PacketSerializer, PingBody};

use std::{
    collections::HashMap,
    fs, io,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
use tokio::time::{interval, Duration, Instant};
use tracing::{error, info};
use web_transport::quinn::{self, quinn::rustls::pki_types::CertificateDer, Request};

use crate::packet::RtpBody;

pub struct Server {
    server: quinn::Server,
}

impl Server {
    pub async fn bind(
        addr: &str,
        cert_path: &str,
        key_path: &str,
    ) -> Result<Self, WebTransportError> {
        let chain = fs::File::open(cert_path)?;
        let mut chain = io::BufReader::new(chain);
        let certs: Vec<CertificateDer<'static>> = rustls_pemfile::certs(&mut chain)
            .map_while(Result::ok)
            .collect();

        let keys = fs::File::open(key_path)?;
        let key = rustls_pemfile::private_key(&mut io::BufReader::new(keys))?.ok_or_else(|| {
            WebTransportError::Io(io::Error::new(
                io::ErrorKind::NotFound,
                "No private key found",
            ))
        })?;

        let server =
            quinn::ServerBuilder::new()
                .with_addr(addr.parse().map_err(|e| {
                    WebTransportError::Connection(format!("Invalid address: {}", e))
                })?)
                .with_congestion_control(quinn::CongestionControl::Default)
                .with_certificate(certs, key)
                .unwrap();

        info!("Server listening on {}", addr);
        Ok(Self { server })
    }

    pub async fn get_request(&mut self) -> Option<Request> {
        self.server.accept().await
    }

    pub async fn accept_request(&mut self, incoming: Request) -> Option<Connection> {
        let session = match incoming.ok().await {
            Ok(s) => s,
            Err(e) => {
                error!("Failed to accept connection: {}", e);
                return None;
            }
        };
        Some(Connection::new(session))
    }
}
pub enum Message {
    Ordered(Bytes),
    Unordered(Bytes),
}

enum SessionCommand {
    Disconnect { code: u32, reason: Vec<u8> },
}

pub struct Connection {
    url: url::Url,
    outgoing_sender: Option<mpsc::Sender<Bytes>>,
    outgoing_sender_safe: Option<mpsc::Sender<Bytes>>,
    message_receiver: mpsc::Receiver<Message>,
    session_command_sender: mpsc::Sender<SessionCommand>,
}

impl Connection {
    fn new(session: web_transport::quinn::Session) -> Self {
        let (message_sender, message_receiver) = mpsc::channel(1000);
        let (outgoing_sender, outgoing_receiver) = mpsc::channel(10204);
        let (outgoing_sender_safe, outgoing_receiver_safe) = mpsc::channel(10204);
        let (session_command_sender, session_command_receiver) = mpsc::channel(10);

        let url = session.url().clone();
        let runner = ConnectionRunner {
            streams: HashMap::new(),
            session,
            message_sender,
            outgoing_receiver,
            outgoing_receiver_safe,
            session_command_receiver,
            send_packets: HashMap::new(),
            received_rackets: HashMap::new(),
            out_seq: 0,
            in_seq: 0,
            nacks: vec![],
            nack_responses: HashMap::new(),
            next_frame_id: 0,
            send_pings: HashMap::new(),
            failed_pings: 0,
            srtt: 0.0,
            rttvar: 0.0,
            rto: 1000,
            loss_estimator: LossEstimator::new(),
            adaptive_fec_encoder: AdaptiveFecEncoder::new(),
            pacer: PacketPacer::new(),
        };

        tokio::spawn(runner.run());

        Self {
            url,
            outgoing_sender: Some(outgoing_sender),
            outgoing_sender_safe: Some(outgoing_sender_safe),
            message_receiver,
            session_command_sender,
        }
    }
    pub fn url(&self) -> &url::Url {
        &self.url
    }
    pub fn id(&self) -> String {
        self.url.query().unwrap_or_default().to_string()
    }

    pub async fn read_message(&mut self) -> Option<Message> {
        self.message_receiver.recv().await
    }

    pub async fn send_ordered(&mut self, data: Bytes) {
        if let Some(sender) = &self.outgoing_sender_safe {
            let _ = sender.send(data.into()).await;
        }
    }
    pub async fn send(&mut self, data: Bytes, safe: bool) {
        if safe {
            if let Some(sender) = &self.outgoing_sender_safe {
                let _ = sender.send(data.into()).await;
            }
        } else if let Some(sender) = &self.outgoing_sender {
            let _ = sender.send(data.into()).await;
        }
    }

    pub async fn send_unordered(&mut self, data: Bytes) {
        if let Some(sender) = &self.outgoing_sender {
            let _ = sender.send(data.into()).await;
        }
    }
    pub async fn close(&mut self) {
        self.outgoing_sender.take();
    }

    pub async fn disconnect_with_message(&mut self, code: u32, message: &str) {
        let _ = self
            .session_command_sender
            .send(SessionCommand::Disconnect {
                code,
                reason: message.as_bytes().to_vec(),
            })
            .await;
    }
}

const MAX_MISSED_PONGS: usize = 15;
const MAX_FRAMES: usize = 16384;
const MAX_PACKETS: usize = 262144;
const NACK_COOLDOWN: Duration = Duration::from_millis(30);
const PING_INTERVAL: Duration = Duration::from_millis(200);
const CHECK_PING_INTERVAL: Duration = Duration::from_secs(1);
const PONG_TIMEOUT: u64 = 2000;
const CLEANUP_INTERVAL: Duration = Duration::from_millis(100);
const PACING_INTERVAL: Duration = Duration::from_millis(5);

struct ConnectionRunner {
    pub streams: HashMap<u64, FrameBuffer>,
    send_packets: HashMap<u64, RtpBody>,
    received_rackets: HashMap<u64, RtpBody>,
    session: web_transport::quinn::Session,
    outgoing_receiver: mpsc::Receiver<Bytes>,
    outgoing_receiver_safe: mpsc::Receiver<Bytes>,
    message_sender: mpsc::Sender<Message>,
    session_command_receiver: mpsc::Receiver<SessionCommand>,
    in_seq: u64,
    out_seq: u64,
    nacks: Vec<PendingNack>,
    nack_responses: HashMap<u64, Instant>,
    next_frame_id: u64,
    send_pings: HashMap<u64, PingBody>,
    failed_pings: usize,
    srtt: f64,
    rttvar: f64,
    pub rto: u64,
    loss_estimator: LossEstimator,
    adaptive_fec_encoder: AdaptiveFecEncoder,
    pacer: PacketPacer,
}

impl ConnectionRunner {
    fn update_rto(&mut self, measured_rtt: f64) {
        const ALPHA: f64 = 0.125;
        const BETA: f64 = 0.25;
        const K: f64 = 4.0;
        const MIN_RTO: u64 = 10;
        const MAX_RTO: u64 = 2000;

        if self.srtt == 0.0 {
            self.srtt = measured_rtt;
            self.rttvar = measured_rtt / 2.0;
        } else {
            let rtt_diff = (measured_rtt - self.srtt).abs();
            self.rttvar = (1.0 - BETA) * self.rttvar + BETA * rtt_diff;
            self.srtt = (1.0 - ALPHA) * self.srtt + ALPHA * measured_rtt;
        }

        let calculated_rto = self.srtt + (10.0_f64).max(K * self.rttvar);
        self.rto = (calculated_rto as u64).clamp(MIN_RTO, MAX_RTO);
    }

    async fn run(mut self) {
        info!(
            "Connection runner started for {}",
            self.session.remote_address()
        );
        let mut check_pings_interval = interval(CHECK_PING_INTERVAL);
        let mut keep_alive_interval = interval(PING_INTERVAL);
        let mut retransmission_check_interval = interval(Duration::from_millis(10));
        let mut cleanup_interval = interval(CLEANUP_INTERVAL);
        let mut pacing_interval = interval(PACING_INTERVAL);

        loop {
            tokio::select! {

                datagram = self.session.read_datagram() => {
                    let datagram = match datagram {
                        Ok(d) => d,
                        Err(_) => break,
                    };
                    self.handle_packet(datagram).await;
                }


                maybe_packet = self.outgoing_receiver.recv() => {
                    if let Some(data) = maybe_packet {
                        self.fragment_and_send_data(data).await;
                    } else {
                        break;
                    }
                }
                maybe_packet = self.outgoing_receiver_safe.recv()=>{
                    match maybe_packet {
                        Some(p)=>{
                            match self.session.open_uni().await {
                                Ok(mut stream)=>{
                                    if let Err(e) = stream.write_chunk(p).await {
                                        error!("{}",e);
                                    }
                                }

                                Err(e) => error!("{}",e)
                            }
                        }
                        None => error!(" af")
                    }
                }

                stream = self.session.accept_uni() => {
                    match stream {
                        Ok(mut recv_stream) => {

                            match recv_stream.read_to_end(1000).await {
                                Ok(data) => {
                                    let message = Bytes::from(data);
                                    if let Err(_) = self.message_sender.send(Message::Ordered(message)).await {
                                        break;
                                    }
                                }
                                Err(_) => {}
                            }
                        }
                        Err(_) => {}
                    }
                }

                _ = keep_alive_interval.tick() => {
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;
                    let packet =  PingBody { timestamp:  now, data: vec![] };
                    self.send_pings.insert(now, packet.clone());
                    let encoded = PacketSerializer::serialize(&Packet::Ping(packet));
                    if let Err(e) = self.session.send_datagram(encoded){
                        error!("Failed to send RTP packet: {}", e);
                    }
                }

                _ = check_pings_interval.tick() =>{
                    let initial_count = self.send_pings.len();
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;

                    self.send_pings.retain(|_id, ping| {
                        now - ping.timestamp < PONG_TIMEOUT
                    });

                    let timeouts = initial_count - self.send_pings.len();
                    self.failed_pings += timeouts;
                    if self.failed_pings > MAX_MISSED_PONGS {
                        error!("Max failed pings reached");
                        break
                    }

                }

                _ = retransmission_check_interval.tick() => {
                    let session = &self.session;
                    NackController::check_pending_nacks(
                        &mut self.nacks,
                        &self.received_rackets,
                        self.srtt,
                        self.rto,
                        |packet| {
                            if let Err(e) = session.send_datagram(PacketSerializer::serialize(packet)) {
                                error!("Failed to send NACK retransmission: {}", e);
                            }
                        },
                    );
                }

                _ = cleanup_interval.tick() => {
                    let now = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64;
                    self.streams.retain(|_key,value| now - value.created_at < 5000 );
                    self.send_pings.retain(|_key,value| now - value.timestamp < 5000 );
                    self.send_packets.retain(|_key,value| now - value.timestamp < 5000 );
                    self.received_rackets.retain(|_key,value| now - value.timestamp < 5000 );
                    NackController::cleanup(&mut self.nacks, 5000);
                    self.nack_responses.retain(|_, time| time.elapsed() < Duration::from_secs(5));
                },

                _ = pacing_interval.tick() => {
                    for packet in self.pacer.drain(&self.loss_estimator) {
                        if let Err(e) = self.session.send_datagram(packet) {
                            error!("Failed to send paced packet: {}", e);
                        }
                    }
                },

                Some(command) = self.session_command_receiver.recv() => {
                    match command {
                        SessionCommand::Disconnect { code, reason } => {
                            self.session.close(code, &reason);
                            break;
                        }
                    }
                }

                _ = self.session.closed() => {
                    break;
                }
            }
        }
        self.session.close(0u32, b"graceful shutdown");
    }

    async fn handle_packet(&mut self, datagram: Bytes) {
        match packet::PacketSerializer::deserialize(&datagram) {
            Some(packet) => match packet {
                packet::Packet::Ping(body) => {
                    let pong = packet::Packet::Pong(packet::PongBody {
                        timestamp: body.timestamp,
                        data: vec![],
                    });
                    let _ = self
                        .session
                        .send_datagram(packet::PacketSerializer::serialize(&pong));
                }
                packet::Packet::Pong(body) => {
                    if let Some(ping) = self.send_pings.get(&body.timestamp) {
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;
                        let rtt = now - ping.timestamp;

                        self.update_rto(rtt as f64);
                        self.failed_pings = 0;
                        self.send_pings.remove(&body.timestamp);
                    }
                }
                packet::Packet::Rtp(body) => {
                    if self.streams.len() >= MAX_FRAMES
                        && !self.streams.contains_key(&body.frame_id)
                    {
                        return;
                    }
                    if self.received_rackets.len() >= MAX_PACKETS {
                        return;
                    }
                    let msg_sender = self.message_sender.clone();
                    let frame = self.streams.entry(body.frame_id).or_insert_with(|| {
                        packet::FrameBuffer::new(body.frame_id, body.total_fragments)
                    });
                    let sec = body.sequence_number;
                    if frame.add_packet(body.clone()).is_err() {
                        return;
                    }
                    if frame.is_complete() {
                        if let Some(data) = frame.reconstruct_data() {
                            let _ = msg_sender.send(Message::Unordered(data.into())).await;
                        }
                    }
                    NackController::on_rtp_received(&mut self.nacks, sec);
                    self.received_rackets.insert(body.sequence_number, body);

                    if sec > self.in_seq {
                        NackController::on_gap_detected(
                            &mut self.nacks,
                            &self.received_rackets,
                            self.srtt,
                            self.in_seq,
                            sec,
                        );
                        self.in_seq = sec.wrapping_add(1);
                    } else if sec == self.in_seq {
                        self.in_seq += 1;
                    }
                }
                packet::Packet::Nack(body) => {
                    self.loss_estimator.record_nack_received(&body.missing_sequences);
                    let now = Instant::now();
                    for seq in body.missing_sequences {
                        if let Some(last) = self.nack_responses.get(&seq) {
                            if now.duration_since(*last) < NACK_COOLDOWN {
                                continue;
                            }
                        }
                        if let Some(p) = self.send_packets.get(&seq) {
                            self.pacer.enqueue(PacketSerializer::serialize(
                                &Packet::Rtp(p.clone()),
                            ));
                            self.nack_responses.insert(seq, now);
                        }
                    }
                }

                packet::Packet::Fec(body) => {
                    let protected_seqs: Vec<u64> = body
                        .protected_packets
                        .iter()
                        .map(|m| m.sequence_number)
                        .collect();
                    let aval_packets: Vec<RtpBody> = self
                        .received_rackets
                        .iter()
                        .filter(|(seq, _)| protected_seqs.contains(seq))
                        .map(|(_, value)| value)
                        .cloned()
                        .collect();

                    if let Some(p) = AdaptiveFecEncoder::recover_packet(&body, &aval_packets) {
                        let msg_sender = self.message_sender.clone();
                        let frame = self.streams.entry(p.frame_id).or_insert_with(|| {
                            packet::FrameBuffer::new(p.frame_id, p.total_fragments)
                        });
                        if frame.add_packet(p.clone()).is_err() {
                            return;
                        }
                        if frame.is_complete() {
                            if let Some(data) = frame.reconstruct_data() {
                                let _ = msg_sender.send(Message::Unordered(data.into())).await;
                            }
                        }
                        NackController::on_rtp_received(&mut self.nacks, p.sequence_number);
                        self.received_rackets.insert(p.sequence_number, p);
                    }
                }
            },
            None => error!("Failed to parse packet"),
        }
    }

    async fn fragment_and_send_data(&mut self, mut data: Bytes) {
        const MAX_FRAGMENT_SIZE: usize = 1000;

        let frame_id = self.next_frame_id;
        self.next_frame_id = self.next_frame_id.wrapping_add(1);

        let total_fragments = data.len().div_ceil(MAX_FRAGMENT_SIZE) as u16;

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let mut fragment_number = 0u16;

        while !data.is_empty() {
            let chunk_size = std::cmp::min(MAX_FRAGMENT_SIZE, data.len());
            let chunk = data.split_to(chunk_size);

            let sequence_number = self.out_seq;
            self.out_seq = self.out_seq.wrapping_add(1);

            let rtp_packet = packet::RtpBody {
                timestamp,
                sequence_number,
                frame_id,
                fragment_number,
                total_fragments,
                data: chunk,
            };
            let encoded = PacketSerializer::serialize(&Packet::Rtp(rtp_packet.clone()));
            if self.send_packets.len() < MAX_PACKETS {
                self.send_packets
                    .insert(rtp_packet.sequence_number, rtp_packet.clone());
            }
            self.loss_estimator
                .record_packet_sent(rtp_packet.sequence_number);

            self.pacer.enqueue(encoded);

            for fec in self.adaptive_fec_encoder.process_packet(
                rtp_packet,
                &self.loss_estimator,
                self.srtt,
            ) {
                self.pacer.enqueue(PacketSerializer::serialize(&Packet::Fec(fec)));
            }

            fragment_number += 1;
        }

        for fec in self.adaptive_fec_encoder.flush() {
            self.pacer.enqueue(PacketSerializer::serialize(&Packet::Fec(fec)));
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WebTransportError {
    #[error("Connection error: {0}")]
    Connection(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

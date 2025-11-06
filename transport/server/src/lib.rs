pub mod packet;
use bytes::Bytes;
use packet::{FrameBuffer, Packet, PacketSerializer, PingBody};

use std::{
    collections::HashMap,
    fs, io,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
use tokio::time::{interval, Duration, Instant};
use tracing::{error, info, warn};
use web_transport::quinn::{self, quinn::rustls::pki_types::CertificateDer, Request};

use crate::packet::{FecEncoder, RtpBody};

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
    Safe(Bytes),
    Unsafe(Bytes),
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
            next_frame_id: 0,
            send_pings: HashMap::new(),
            failed_pings: 0,
            srtt: 0.0,
            rttvar: 0.0,
            rto: 1000,
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

    pub async fn send_data_safe(&mut self, data: Bytes) {
        if let Some(sender) = &self.outgoing_sender_safe {
            sender.send(data.into()).await.unwrap();
        } else {
            warn!("Attempted to send data on a closed connection.");
        }
    }
    pub async fn send(&mut self, data: Bytes, safe: bool) {
        if safe {
            if let Some(sender) = &self.outgoing_sender_safe {
                sender.send(data.into()).await.unwrap();
            } else {
                warn!("Attempted to send data on a closed connection.");
            }
        } else {
            if let Some(sender) = &self.outgoing_sender {
                sender.send(data.into()).await.unwrap();
            } else {
                warn!("Attempted to send data on a closed connection.");
            }
        }
    }

    pub async fn send_data(&mut self, data: Bytes) {
        if let Some(sender) = &self.outgoing_sender {
            sender.send(data.into()).await.unwrap();
        } else {
            warn!("Attempted to send data on a closed connection.");
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
const MAX_RETRANSMISSIONS: u32 = 5;
const PING_INTERVAL: Duration = Duration::from_millis(200);
const CHECK_PING_INTERVAL: Duration = Duration::from_secs(1);
const PONG_TIMEOUT: u64 = 2000;
const CLEANUP_INTERVAL: Duration = Duration::from_millis(100);

struct InFlightPacket {
    pub packet: packet::NackBody,
    pub sent_at: Instant,
    pub retransmissions: u32,
}

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
    nacks: Vec<InFlightPacket>,
    next_frame_id: u64,
    send_pings: HashMap<u64, PingBody>,
    failed_pings: usize,
    srtt: f64,
    rttvar: f64,
    pub rto: u64,
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

        loop {
            tokio::select! {

                datagram = self.session.read_datagram() => {
                    let datagram = match datagram {
                        Ok(d) => d,
                        Err(e) => {
                            println!("Failed to read datagram: {}", e);
                            break;
                        }
                    };
                    self.handle_packet(datagram).await;
                }


                maybe_packet = self.outgoing_receiver.recv() => {
                    if let Some(data) = maybe_packet {
                        self.fragment_and_send_data(data).await;
                    } else {

                        println!("Outgoing channel closed, shutting down connection runner.");
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
                                    if let Err(_) = self.message_sender.send(Message::Safe(message)).await {
                                        break;
                                    }
                                }
                                Err(e) => {
                                    eprintln!("Error reading from stream: {}", e);
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("Error accepting stream: {}", e);
                        }
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
                    for nack in &mut self.nacks {
                        let duration = if nack.retransmissions == 0 {
                            Duration::from_millis(20)
                        } else {
                            Duration::from_millis(self.rto)
                        };
                        if nack.sent_at.elapsed() > duration {
                            if nack.retransmissions < MAX_RETRANSMISSIONS {
                                if let Err(e) = self.session.send_datagram(PacketSerializer::serialize(&packet::Packet::Nack(nack.packet.clone()))) {
                                    error!("Failed to send NACK retransmission: {}", e);
                                }
                                nack.sent_at = Instant::now();
                                nack.retransmissions += 1;
                            }
                        }
                    }
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
                },

                Some(command) = self.session_command_receiver.recv() => {
                    match command {
                        SessionCommand::Disconnect { code, reason } => {
                            println!("Disconnecting with code {} and reason: {:?}", code, String::from_utf8_lossy(&reason));
                            self.session.close(code, &reason);
                            break;
                        }
                    }
                }

                e = self.session.closed() => {
                    println!("Connection closes {} with error {}", self.session.remote_address(),e);
                    break;
                }
            }
        }
        println!(
            "Connection runner stoppe1d for {}",
            self.session.remote_address()
        );
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
                    self.session
                        .send_datagram(packet::PacketSerializer::serialize(&pong))
                        .unwrap();
                }
                packet::Packet::Pong(body) => {
                    if let Some(ping) = self.send_pings.get(&body.timestamp) {
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap()
                            .as_millis() as u64;
                        let rtt = now - ping.timestamp;

                        self.update_rto(rtt as f64);

                        self.send_pings.remove(&body.timestamp);
                    }
                }
                packet::Packet::Rtp(body) => {
                    let msg_sender = self.message_sender.clone();
                    let frame = self.streams.entry(body.frame_id).or_insert_with(|| {
                        packet::FrameBuffer::new(body.frame_id, body.total_fragments)
                    });
                    let sec = body.sequence_number;
                    frame.add_packet(body.clone()).unwrap();
                    if frame.is_complete() {
                        let packet = frame.reconstruct_data().unwrap();
                        msg_sender
                            .send(Message::Unsafe(packet.into()))
                            .await
                            .unwrap();
                    }
                    self.nacks
                        .retain(|item| item.packet.missing_sequence != sec);
                    self.received_rackets.insert(body.sequence_number, body);

                    if sec > self.in_seq {
                        for i in self.in_seq..sec {
                            let dur = Instant::now();
                            let nack = packet::NackBody {
                                missing_sequence: i,
                            };
                            self.nacks.push(InFlightPacket {
                                packet: nack,
                                sent_at: dur,
                                retransmissions: 0,
                            });
                        }

                        self.in_seq = sec.wrapping_add(1);
                    }
                    if sec == self.in_seq {
                        self.in_seq += 1;
                    }
                }
                packet::Packet::Nack(body) => {
                    let packet = self.send_packets.get(&body.missing_sequence);
                    if let Some(p) = packet {
                        let encoded = PacketSerializer::serialize(&Packet::Rtp(p.clone()));
                        self.session.send_datagram(encoded).unwrap();
                    }
                }

                packet::Packet::Fec(body) => {
                    let aval_packets: Vec<RtpBody> = self
                        .received_rackets
                        .iter()
                        .filter(|(seq, _)| body.protected_sequences.contains(&seq))
                        .map(|(_, value)| value)
                        .cloned()
                        .collect();

                    if let Some(p) = FecEncoder::recover_packet(&body, &aval_packets) {
                        let msg_sender = self.message_sender.clone();
                        let frame = self.streams.entry(p.frame_id).or_insert_with(|| {
                            packet::FrameBuffer::new(p.frame_id, p.total_fragments)
                        });
                        frame.add_packet(p.clone()).unwrap();
                        if frame.is_complete() {
                            let packet = frame.reconstruct_data().unwrap();
                            msg_sender
                                .send(Message::Unsafe(packet.into()))
                                .await
                                .unwrap();
                        }
                        self.nacks
                            .retain(|item| item.packet.missing_sequence != p.sequence_number);
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

        let mut fec_group = vec![];
        let mut fragment_number = 0u16;

        while !data.is_empty() {
            let chunk_size = std::cmp::min(MAX_FRAGMENT_SIZE, data.len());
            let chunk = data.split_to(chunk_size);

            let sequence_number = self.out_seq;
            self.out_seq = self.out_seq.wrapping_add(1);
            let marker_bit = fragment_number == total_fragments - 1;

            let rtp_packet = packet::RtpBody {
                timestamp,
                sequence_number,
                frame_id,
                fragment_number,
                total_fragments,
                marker_bit,
                data: chunk,
            };
            let encoded = PacketSerializer::serialize(&Packet::Rtp(rtp_packet.clone()));
            self.send_packets
                .insert(rtp_packet.sequence_number, rtp_packet.clone());
            if let Err(e) = self.session.send_datagram(encoded) {
                error!("Failed to send RTP packet: {}", e);
            }

            fec_group.push(rtp_packet);
            if fec_group.len() == 4 {
                if let Some(fec) = FecEncoder::generate_fec_packet(&fec_group) {
                    if let Err(e) = self
                        .session
                        .send_datagram(PacketSerializer::serialize(&Packet::Fec(fec)))
                    {
                        error!("Failed to send RTP packet: {}", e);
                    }
                }
                fec_group = vec![];
            }

            fragment_number += 1;
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

use bytes::Bytes;
use clap::Parser;
use opencord_transport_server::fec::{AdaptiveFecEncoder, LossEstimator};
use opencord_transport_server::packet::{FecBody, RtpBody};
use rand::{rngs::StdRng, Rng, SeedableRng};
use std::collections::HashMap;

#[derive(Parser)]
#[command(name = "simulator", about = "FEC packet loss simulator with Gilbert-Elliott model")]
struct Args {
    #[arg(short, long, default_value = "50000")]
    packets: usize,

    #[arg(long, default_value = "0.02")]
    p_good_to_bad: f64,

    #[arg(long, default_value = "0.20")]
    p_bad_to_good: f64,

    #[arg(long, default_value = "0.01")]
    loss_in_good: f64,

    #[arg(long, default_value = "0.30")]
    loss_in_bad: f64,

    #[arg(short, long, default_value = "42")]
    seed: u64,

    #[arg(short, long, value_delimiter = ',', default_value = "1,2,3,4")]
    depths: Vec<usize>,
}

#[derive(Clone, Copy, PartialEq)]
enum ChannelState {
    Good,
    Bad,
}

struct GilbertElliottChannel {
    state: ChannelState,
    p_good_to_bad: f64,
    p_bad_to_good: f64,
    loss_in_good: f64,
    loss_in_bad: f64,
    rng: StdRng,
    total_packets: usize,
    packets_in_good: usize,
    packets_in_bad: usize,
    drops_in_good: usize,
    drops_in_bad: usize,
    burst_lengths: Vec<usize>,
    current_burst: usize,
}

impl GilbertElliottChannel {
    fn new(
        p_good_to_bad: f64,
        p_bad_to_good: f64,
        loss_in_good: f64,
        loss_in_bad: f64,
        seed: u64,
    ) -> Self {
        Self {
            state: ChannelState::Good,
            p_good_to_bad,
            p_bad_to_good,
            loss_in_good,
            loss_in_bad,
            rng: StdRng::seed_from_u64(seed),
            total_packets: 0,
            packets_in_good: 0,
            packets_in_bad: 0,
            drops_in_good: 0,
            drops_in_bad: 0,
            burst_lengths: Vec::new(),
            current_burst: 0,
        }
    }

    fn should_drop(&mut self) -> bool {
        self.total_packets += 1;

        match self.state {
            ChannelState::Good => {
                if self.rng.gen::<f64>() < self.p_good_to_bad {
                    self.state = ChannelState::Bad;
                }
            }
            ChannelState::Bad => {
                if self.rng.gen::<f64>() < self.p_bad_to_good {
                    self.state = ChannelState::Good;
                    if self.current_burst > 0 {
                        self.burst_lengths.push(self.current_burst);
                        self.current_burst = 0;
                    }
                }
            }
        }

        let (loss_prob, in_bad) = match self.state {
            ChannelState::Good => {
                self.packets_in_good += 1;
                (self.loss_in_good, false)
            }
            ChannelState::Bad => {
                self.packets_in_bad += 1;
                (self.loss_in_bad, true)
            }
        };

        let dropped = self.rng.gen::<f64>() < loss_prob;

        if dropped {
            if in_bad {
                self.drops_in_bad += 1;
                self.current_burst += 1;
            } else {
                self.drops_in_good += 1;
            }
        }

        dropped
    }

    fn print_stats(&self) {
        let total_drops = self.drops_in_good + self.drops_in_bad;
        let loss_rate = 100.0 * total_drops as f64 / self.total_packets as f64;

        println!("Channel Statistics:");
        println!("  Total packets:    {}", self.total_packets);
        println!("  Total dropped:    {} ({:.2}%)", total_drops, loss_rate);
        println!();
        println!("  Time in Good:     {} ({:.1}%)",
            self.packets_in_good,
            100.0 * self.packets_in_good as f64 / self.total_packets as f64
        );
        println!("  Time in Bad:      {} ({:.1}%)",
            self.packets_in_bad,
            100.0 * self.packets_in_bad as f64 / self.total_packets as f64
        );
        println!();
        println!("  Drops in Good:    {} ({:.2}% of good)",
            self.drops_in_good,
            if self.packets_in_good > 0 {
                100.0 * self.drops_in_good as f64 / self.packets_in_good as f64
            } else { 0.0 }
        );
        println!("  Drops in Bad:     {} ({:.2}% of bad)",
            self.drops_in_bad,
            if self.packets_in_bad > 0 {
                100.0 * self.drops_in_bad as f64 / self.packets_in_bad as f64
            } else { 0.0 }
        );

        if !self.burst_lengths.is_empty() {
            let avg_burst: f64 = self.burst_lengths.iter().sum::<usize>() as f64
                / self.burst_lengths.len() as f64;
            let max_burst = self.burst_lengths.iter().max().unwrap_or(&0);
            let min_burst = self.burst_lengths.iter().min().unwrap_or(&0);

            println!();
            println!("  Burst count:      {}", self.burst_lengths.len());
            println!("  Burst length:     min={}, avg={:.1}, max={}", min_burst, avg_burst, max_burst);
        }
    }
}

struct SimResult {
    lost: usize,
    recovered: usize,
    fec_count: usize,
}

fn run_simulation(args: &Args, depth: usize, channel: &mut GilbertElliottChannel) -> SimResult {
    let mut rng = StdRng::seed_from_u64(args.seed);

    let mut fec_encoder = AdaptiveFecEncoder::with_depth(depth);
    let mut loss_estimator = LossEstimator::new();

    let mut all_packets: Vec<RtpBody> = Vec::new();
    let mut all_fec: Vec<FecBody> = Vec::new();
    let mut received: HashMap<u64, RtpBody> = HashMap::new();
    let mut lost_count: usize = 0;

    for seq in 0..args.packets as u64 {
        let data: Vec<u8> = (0..100).map(|_| rng.gen()).collect();
        let packet = RtpBody {
            timestamp: 0,
            sequence_number: seq,
            frame_id: seq / 10,
            fragment_number: (seq % 10) as u16,
            total_fragments: 10,
            data: Bytes::from(data),
        };

        loss_estimator.record_packet_sent(seq);
        all_packets.push(packet.clone());

        let fec_packets = fec_encoder.process_packet(packet.clone(), &loss_estimator, 50.0);
        all_fec.extend(fec_packets);

        if !channel.should_drop() {
            received.insert(packet.sequence_number, packet);
        } else {
            lost_count += 1;
        }
    }
    all_fec.extend(fec_encoder.flush());

    let mut recovered_count: usize = 0;
    for fec in &all_fec {
        let protected_seqs: Vec<u64> = fec
            .protected_packets
            .iter()
            .map(|m| m.sequence_number)
            .collect();

        let available: Vec<RtpBody> = protected_seqs
            .iter()
            .filter_map(|seq| received.get(seq).cloned())
            .collect();

        if let Some(recovered) = AdaptiveFecEncoder::recover_packet(fec, &available) {
            if !received.contains_key(&recovered.sequence_number) {
                received.insert(recovered.sequence_number, recovered);
                recovered_count += 1;
            }
        }
    }

    SimResult {
        lost: lost_count,
        recovered: recovered_count,
        fec_count: all_fec.len(),
    }
}

fn main() {
    let args = Args::parse();

    println!("FEC Simulator - Gilbert-Elliott Channel Model");
    println!("==============================================");
    println!("Packets: {}", args.packets);
    println!("P(Good→Bad): {:.2}%  P(Bad→Good): {:.1}%",
        args.p_good_to_bad * 100.0,
        args.p_bad_to_good * 100.0
    );
    println!("Loss in Good: {:.1}%  Loss in Bad: {:.0}%",
        args.loss_in_good * 100.0,
        args.loss_in_bad * 100.0
    );
    println!();

    let mut stats_channel = GilbertElliottChannel::new(
        args.p_good_to_bad,
        args.p_bad_to_good,
        args.loss_in_good,
        args.loss_in_bad,
        args.seed + 100,
    );
    for _ in 0..args.packets {
        stats_channel.should_drop();
    }
    stats_channel.print_stats();
    println!();

    println!(
        "{:>6} {:>8} {:>10} {:>12} {:>10}",
        "Depth", "Lost", "Recovered", "Unrecov", "FEC pkts"
    );
    println!("{:-<6} {:-<8} {:-<10} {:-<12} {:-<10}", "", "", "", "", "");

    for depth in &args.depths {
        let mut channel = GilbertElliottChannel::new(
            args.p_good_to_bad,
            args.p_bad_to_good,
            args.loss_in_good,
            args.loss_in_bad,
            args.seed + 100,
        );
        let result = run_simulation(&args, *depth, &mut channel);
        let unrecov = result.lost.saturating_sub(result.recovered);
        let recovery_pct = if result.lost > 0 {
            100.0 * result.recovered as f64 / result.lost as f64
        } else {
            100.0
        };

        println!(
            "{:>6} {:>8} {:>9.1}% {:>12} {:>10}",
            depth, result.lost, recovery_pct, unrecov, result.fec_count
        );
    }
}

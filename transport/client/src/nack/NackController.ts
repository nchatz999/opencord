import { NackPacket, PacketType, RTPPacket } from '../transmission';
import { PacketSerializer } from '../packet';

const MAX_SEQUENCE_GAP = 100n;
const MAX_RETRANSMISSIONS = 5;

export interface PendingNack {
  packet: NackPacket;
  sentAt: number;
  createdAt: number;
  retransmissions: number;
}

export interface NackContext {
  pendingNacks: PendingNack[];
  receivedPackets: Map<bigint, RTPPacket>;
  srtt: number;
  rto: number;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
}

export class NackController {
  static onGapDetected(ctx: NackContext, start: bigint, end: bigint): void {
    const gap = end - start;
    if (gap > MAX_SEQUENCE_GAP) return;

    const missingSequences: bigint[] = [];
    for (let i: bigint = start; i < end; i++) {
      if (!ctx.receivedPackets.has(i)) {
        missingSequences.push(i);
      }
    }
    if (missingSequences.length === 0) return;

    const delay = ctx.srtt > 150 ? 40 : 0;
    const now = Date.now();

    ctx.pendingNacks.push({
      packet: { type: PacketType.NACK, missingSequences },
      sentAt: now + delay,
      createdAt: now,
      retransmissions: 0,
    });
  }

  static onRtpReceived(ctx: NackContext, sequenceNumber: bigint): void {
    for (const entry of ctx.pendingNacks) {
      const idx = entry.packet.missingSequences.indexOf(sequenceNumber);
      if (idx !== -1) {
        entry.packet.missingSequences.splice(idx, 1);
      }
    }
    ctx.pendingNacks = ctx.pendingNacks.filter(
      e => e.packet.missingSequences.length > 0
    );
  }

  static async checkPendingNacks(ctx: NackContext): Promise<void> {
    if (!ctx.writer) return;

    const now = Date.now();

    ctx.pendingNacks = ctx.pendingNacks.filter(nack => {
      nack.packet.missingSequences = nack.packet.missingSequences.filter(
        seq => !ctx.receivedPackets.has(seq)
      );
      return nack.packet.missingSequences.length > 0;
    });

    for (const nack of ctx.pendingNacks) {
      if (nack.retransmissions >= MAX_RETRANSMISSIONS) continue;

      const duration = nack.retransmissions === 0 ? 20 : ctx.rto;
      if (now >= nack.sentAt + duration) {
        if (ctx.writer && nack.packet.missingSequences.length > 0) {
          await ctx.writer.write(PacketSerializer.serialize(nack.packet)!);
        }
        nack.sentAt = now;
        nack.retransmissions++;
      }
    }

    ctx.pendingNacks = ctx.pendingNacks.filter(
      nack => nack.retransmissions < MAX_RETRANSMISSIONS &&
              nack.packet.missingSequences.length > 0
    );
  }

  static cleanup(ctx: NackContext, maxAge: number = 5000): void {
    const now = Date.now();
    ctx.pendingNacks = ctx.pendingNacks.filter(
      nack => now - nack.createdAt < maxAge
    );
  }
}

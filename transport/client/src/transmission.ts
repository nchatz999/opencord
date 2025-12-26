import { ok, err, timerManager } from 'opencord-utils';
import { PacketSerializer } from './packet';
import { LossEstimator, AdaptiveFECEncoder } from './fec';
import { NackController, PendingNack } from './nack';
import { PacketPacer } from './pacing';
import type { Result } from 'opencord-utils';
export enum PacketType {
  PING = 0x01,
  PONG = 0x02,
  FEC = 0x03,
  NACK = 0x04,
  RTP = 0x11,
}

export interface BasePacket {
  type: PacketType;
}

export interface PingPacket extends BasePacket {
  type: PacketType.PING;
  timestamp: bigint;
  data: Uint8Array;
}

export interface PongPacket extends BasePacket {
  type: PacketType.PONG;
  timestamp: bigint;
  data: Uint8Array;
}

export interface NackPacket extends BasePacket {
  type: PacketType.NACK;
  missingSequences: bigint[];
}

export interface ProtectedPacketMeta {
  sequenceNumber: bigint;
  timestamp: bigint;
  frameId: bigint;
  fragmentNumber: number;
  totalFragments: number;
  dataLength: number;
}

export interface FecPacket extends BasePacket {
  type: PacketType.FEC;
  timestamp: bigint;
  protectedPackets: ProtectedPacketMeta[];
  fecData: Uint8Array;
}

export interface RTPPacket extends BasePacket {
  type: PacketType.RTP;
  timestamp: bigint;
  sequenceNumber: bigint;
  frameId: bigint;
  fragmentNumber: number;
  totalFragments: number;
  data: Uint8Array;
}

export type Packet = PingPacket | PongPacket | NackPacket | FecPacket | RTPPacket;

export class FrameBuffer {
  public frameId: bigint;
  public expectedFragments: number;
  public packets: Map<number, RTPPacket>;
  public createdAt: number;

  constructor(frameId: bigint, expectedFragments: number) {
    this.frameId = frameId;
    this.expectedFragments = expectedFragments;
    this.packets = new Map<number, RTPPacket>();
    this.createdAt = Date.now();
  }

  public addPacket(packet: RTPPacket): void {
    this.packets.set(packet.fragmentNumber, packet);
  }

  public isComplete(): boolean {
    return this.packets.size === this.expectedFragments;
  }

  public reconstructData(): Uint8Array | null {
    if (!this.isComplete()) return null;

    const sortedPackets = Array.from(this.packets.values()).sort(
      (a, b) => a.fragmentNumber - b.fragmentNumber
    );

    const totalLength = sortedPackets.reduce(
      (sum, packet) => sum + packet.data.length,
      0
    );

    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const packet of sortedPackets) {
      result.set(packet.data, offset);
      offset += packet.data.length;
    }

    return result;
  }
}

export type TransportError = { type: "disconnect", message: string } | { type: "error", message: Error }

export class MediaTransport {
  token: string = "";
  outSeq: bigint;
  outFrame: bigint = 0n;
  outReader: ReadableStreamDefaultReader | null = null;
  outWriter: WritableStreamDefaultWriter | null = null;
  inSeq: bigint;
  pendingNacks: PendingNack[];
  sendPackets: Map<bigint, RTPPacket>;
  receivedPackets: Map<bigint, RTPPacket>;
  duplicatePackets: number;
  buffers: Map<bigint, FrameBuffer>;
  rtt: number;
  rttSamples: number[] = [];
  srtt: number = 0;
  rttvar: number = 0;
  rto: number = 1000;
  reader: ReadableStreamDefaultReader | null = null;
  writer: WritableStreamDefaultWriter | null = null;
  transport: WebTransport | null = null;
  mtu: number = 1200;
  pings: { timer: number; timestamp: bigint }[] = [];
  missedPongs: number = 0;
  private closed: boolean = true;
  private pingIntervalId: number | null = null;
  private cleanerIntervalId: number | null = null;
  private nackCheckIntervalId: number | null = null;
  private lossEstimator: LossEstimator;
  private adaptiveFecEncoder: AdaptiveFECEncoder;
  private pacer: PacketPacer;
  onFrameComplete: (data: Uint8Array) => void;
  onSafeDataComplete: (data: Uint8Array) => void;
  onDisconnect: (error: string) => void;

  constructor(
    onFrameConplete: (data: Uint8Array) => void,
    onSafeDataComplete: (data: Uint8Array) => void,
    onDisconnect: (error: string) => void,
  ) {
    this.outSeq = 0n;
    this.inSeq = 0n;
    this.pendingNacks = [];
    this.buffers = new Map<bigint, FrameBuffer>;
    this.rtt = 0;
    this.sendPackets = new Map();
    this.receivedPackets = new Map<bigint, RTPPacket>;
    this.duplicatePackets = 0;
    this.lossEstimator = new LossEstimator();
    this.adaptiveFecEncoder = new AdaptiveFECEncoder(this.lossEstimator);
    this.pacer = new PacketPacer(
      (data) => this.writeDatagram(data),
      this.lossEstimator
    );
    this.onFrameComplete = onFrameConplete;
    this.onSafeDataComplete = onSafeDataComplete;
    this.onDisconnect = onDisconnect;
  }

  public setToken(token: string) {
    this.token = token
  }

  public async connect(url: string, hash?: WebTransportHash): Promise<Result<void, TransportError>> {
    if (!this.closed) {
      throw new Error("Already connected. Disconnect first.");
    }

    try {
      const options: WebTransportOptions = hash
        ? { serverCertificateHashes: [hash] }
        : {};
      this.transport = new WebTransport(url + `/?${this.token}`, options);
      await this.transport.ready;
      this.closed = false;

      this.reader = this.transport.datagrams.readable.getReader();
      this.writer = this.transport.datagrams.writable.getWriter();

      const stream = new TransformStream();
      this.outReader = stream.readable.getReader();
      this.outWriter = stream.writable.getWriter();

      this.runSafePacketHandler();
      this.runIncomingHandler();
      this.runOutgoingSender();
      this.runPingInterval(200);
      this.runNackCheckInterval();
      this.runCleaner();
      this.handleTransportClosed();
      this.pacer.start();
      return ok(undefined)
    } catch (e) {
      console.dir(e);
      this.closed = true;
      return err({ type: "error", message: e as Error })
    }
  }

  public send(data: Uint8Array) {
    if (this.closed) return;

    const mtu = this.mtu - 200;
    let currentTime = BigInt(Date.now());
    const frameId = this.outFrame++;

    for (let i = 0; i < data.length; i += mtu) {
      const chunk = data.slice(i, i + mtu);
      let packet: RTPPacket = {
        type: PacketType.RTP,
        sequenceNumber: this.outSeq++,
        timestamp: currentTime,
        frameId,
        fragmentNumber: Math.floor(i / mtu),
        totalFragments: Math.ceil(data.length / mtu),
        data: chunk,
      };
      this.sendPackets.set(packet.sequenceNumber, packet);
      this.lossEstimator.recordPacketSent(packet.sequenceNumber);

      const serialized = PacketSerializer.serialize(packet);
      if (serialized) this.pacer.enqueue(serialized);

      for (const fecPacket of this.adaptiveFecEncoder.processPacket(packet, this.srtt)) {
        const fecSerialized = PacketSerializer.serialize(fecPacket);
        if (fecSerialized) this.pacer.enqueue(fecSerialized);
      }
    }

    for (const fecPacket of this.adaptiveFecEncoder.flush()) {
      const fecSerialized = PacketSerializer.serialize(fecPacket);
      if (fecSerialized) this.pacer.enqueue(fecSerialized);
    }
  }

  private writeDatagram(data: Uint8Array): void {
    if (this.closed || !this.outWriter) return;
    this.outWriter.write(data).catch(() => {});
  }

  public async sendSafe(data: Uint8Array) {
    if (this.closed || !this.transport) return;

    try {
      let stream = await this.transport.createUnidirectionalStream();
      let writer = stream.getWriter()
      await writer.write(data)
      await writer.close()
    } catch (e) {
      this.onDisconnect(e instanceof Error ? e.message : String(e));
      await this.disconnect()
    }
  }

  public processPacket(packet: Packet) {
    switch (packet.type) {
      case PacketType.PING:
        this.handlePing(packet);
        break;
      case PacketType.PONG:
        this.handlePong(packet);
        break;
      case PacketType.FEC:
        this.handleFEC(packet);
        break;
      case PacketType.NACK:
        this.handleNACK(packet);
        break;
      case PacketType.RTP:
        this.handleMediaPacket(packet);
        break;
    }
  }

  public deliverFrame(frame: FrameBuffer) {
    if (frame.isComplete()) {
      const data = frame.reconstructData();
      if (data) {
        this.onFrameComplete(data);
        this.buffers.delete(frame.frameId);
      }
    }
  }

  public cancelRetransmission(sequence: bigint) {
    NackController.onRtpReceived(this, sequence);
  }

  private handleGapDetected(start: bigint, end: bigint): void {
    NackController.onGapDetected(this, start, end);
  }

  private runNackCheckInterval() {
    this.nackCheckIntervalId = timerManager.setInterval(async () => {
      if (this.closed) return;
      await NackController.checkPendingNacks(this);
    }, 10);
  }

  public async handlePing(packet: PingPacket) {
    if (!this.writer) return;

    const pongPacket: PongPacket = {
      type: PacketType.PONG,
      timestamp: packet.timestamp,
      data: packet.data,
    };
    await this.writer.write(PacketSerializer.serialize(pongPacket));
  }

  public handlePong(packet: PongPacket) {
    let ping = this.pings.find((p) => p.timestamp === packet.timestamp);
    if (!ping) {
      return;
    }
    timerManager.clearTimeout(ping.timer);
    this.pings = this.pings.filter((p) => p.timestamp !== packet.timestamp);
    const rtt = Number(BigInt(Date.now()) - ping.timestamp);
    this.updateRTT(rtt)
    this.missedPongs = 0
  }

  public handleFEC(packet: FecPacket) {
    const protectedSeqs = packet.protectedPackets.map(m => m.sequenceNumber);
    const availablePackets = Array.from(this.receivedPackets.values()).filter((p) =>
      protectedSeqs.includes(p.sequenceNumber)
    );
    const recoveredPacket = AdaptiveFECEncoder.recoverPacket(packet, availablePackets);
    if (recoveredPacket) {
      let frame = this.buffers.get(recoveredPacket.frameId);
      if (!frame) {
        frame = new FrameBuffer(recoveredPacket.frameId, recoveredPacket.totalFragments);
        this.buffers.set(frame.frameId, frame);
      }
      frame.addPacket(recoveredPacket);
      this.deliverFrame(frame);
      this.cancelRetransmission(recoveredPacket.sequenceNumber);
      this.receivedPackets.set(recoveredPacket.sequenceNumber, recoveredPacket);
    }
  }

  public handleNACK(nack: NackPacket) {
    this.lossEstimator.recordNackReceived(nack.missingSequences);
    for (const seq of nack.missingSequences) {
      const packet = this.sendPackets.get(seq);
      if (packet) {
        const serialized = PacketSerializer.serialize(packet);
        if (serialized) this.pacer.enqueue(serialized);
      }
    }
  }

  public handleMediaPacket(packet: RTPPacket) {
    let frame = this.buffers.get(packet.frameId);
    if (!frame) {
      frame = new FrameBuffer(packet.frameId, packet.totalFragments);
      this.buffers.set(packet.frameId, frame);
    }
    frame.addPacket(packet);
    if (this.receivedPackets.has(packet.sequenceNumber)) this.duplicatePackets++;
    this.cancelRetransmission(packet.sequenceNumber);
    this.receivedPackets.set(packet.sequenceNumber, packet);
    this.deliverFrame(frame)

    if (packet.sequenceNumber > this.inSeq) {
      this.handleGapDetected(this.inSeq, packet.sequenceNumber);
      this.inSeq = packet.sequenceNumber + 1n;
    }
    else if (packet.sequenceNumber == this.inSeq) this.inSeq += 1n;
  }

  public updateRTT(measuredRtt: number): void {
    const ALPHA = 0.125;
    const BETA = 0.25;
    const K = 4.0;
    const MIN_RTO = 10;
    const MAX_RTO = 2000;
    const CLOCK_GRANULARITY = 10;

    if (this.srtt === 0) {
      this.srtt = measuredRtt;
      this.rttvar = measuredRtt / 2;
    } else {
      const rttDiff = Math.abs(measuredRtt - this.srtt);
      this.rttvar = (1 - BETA) * this.rttvar + BETA * rttDiff;
      this.srtt = (1 - ALPHA) * this.srtt + ALPHA * measuredRtt;
    }

    const calculatedRto = this.srtt + Math.max(CLOCK_GRANULARITY, K * this.rttvar);
    this.rto = Math.min(MAX_RTO, Math.max(MIN_RTO, Math.round(calculatedRto)));
    this.rtt = measuredRtt;
  }

  public runPingInterval(interval: number) {
    this.pingIntervalId = timerManager.setInterval(async () => {
      if (this.missedPongs >= 5) {
        this.onDisconnect("Connection timed out");
        await this.disconnect()
        return;
      }

      let currentTime = BigInt(Date.now());
      const pingPacket: PingPacket = {
        type: PacketType.PING,
        timestamp: currentTime,
        data: new Uint8Array(0),
      };
      try {

        if (this.writer)
          await this.writer.write(PacketSerializer.serialize(pingPacket));
      } catch (e) {
      }
      this.pings.push({
        timer: timerManager.setTimeout(() => {
          this.missedPongs++;
        }, 1000),
        timestamp: currentTime,
      });
    }, interval);
  }

  public async runSafePacketHandler() {
    if (!this.transport) return;

    try {
      const reader = this.transport.incomingUnidirectionalStreams.getReader();

      while (!this.closed) {
        const { value: stream, done } = await reader.read();
        if (done) {
          break;
        }
        this.handleSafeDataStream(stream);
      }
    } catch (e) {
      this.onDisconnect(e instanceof Error ? e.message : String(e));
      await this.disconnect()
    }
  }

  private async handleSafeDataStream(stream: ReadableStream<Uint8Array>) {
    try {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
      }

      const completeMessage = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        completeMessage.set(chunk, offset);
        offset += chunk.length;
      }

      this.onSafeDataComplete(completeMessage);
    } catch (e) {
      this.onDisconnect(e instanceof Error ? e.message : String(e));
      await this.disconnect()
    }
  }

  public async runIncomingHandler() {
    while (!this.closed && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done || this.closed) break;
        const packet = PacketSerializer.deserialize(value);
        if (packet) {
          this.processPacket(packet);
        }
      } catch (e) {
        await this.disconnect()
        break;
      }
    }
  }

  public async runOutgoingSender() {
    while (!this.closed && this.outReader && this.writer) {
      try {
        const { value, done } = await this.outReader.read();
        if (done || this.closed) break;
        await this.writer.write(value);
      } catch (e) {
        await this.disconnect()
        break;
      }
    }
  }

  public async runCleaner() {
    this.cleanerIntervalId = timerManager.setInterval(() => {
      if (this.closed) return;
      let now = Date.now();

      this.sendPackets = new Map(
        Array.from(this.sendPackets).filter(([_, value]) => now - Number(value.timestamp) < 5000)
      );

      this.receivedPackets = new Map(
        Array.from(this.receivedPackets).filter(([_, value]) => now - Number(value.timestamp) < 5000)
      );

      this.buffers = new Map(
        Array.from(this.buffers).filter(([_, value]) => now - Number(value.createdAt) < 5000)
      );

      this.pings = Array.from(this.pings).filter((ping) => now - Number(ping.timestamp) < 5000);

      NackController.cleanup(this);
    }, 50)
  }

  private async handleTransportClosed() {
    if (!this.transport) return;

    try {
      const { closeCode, reason } = await this.transport.closed;

      this.closed = true;

      if (this.pingIntervalId !== null) {
        timerManager.clearInterval(this.pingIntervalId);
        this.pingIntervalId = null;
      }

      if (this.cleanerIntervalId !== null) {
        timerManager.clearInterval(this.cleanerIntervalId);
        this.cleanerIntervalId = null;
      }

      if (this.nackCheckIntervalId !== null) {
        timerManager.clearInterval(this.nackCheckIntervalId);
        this.nackCheckIntervalId = null;
      }

      this.pendingNacks = [];
      this.pings.forEach(({ timer }) => timerManager.clearTimeout(timer));

      try {
        if (this.reader) await this.reader.cancel();
        if (this.writer) await this.writer.close();
        if (this.outReader) await this.outReader.cancel();
        if (this.outWriter) await this.outWriter.close();
      } catch (e) {
      }

      if (this.onDisconnect && closeCode && reason) {
        this.onDisconnect(reason);
        await this.disconnect()
      }
    } catch (e) {
      this.onDisconnect(e instanceof Error ? e.message : String(e));
      await this.disconnect()
    }
  }

  public async disconnect(code: number = 0, reason: string = "Client initiated disconnect"): Promise<void> {
    this.closed = true;

    if (this.pingIntervalId !== null) {
      timerManager.clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }

    if (this.cleanerIntervalId !== null) {
      timerManager.clearInterval(this.cleanerIntervalId);
      this.cleanerIntervalId = null;
    }

    if (this.nackCheckIntervalId !== null) {
      timerManager.clearInterval(this.nackCheckIntervalId);
      this.nackCheckIntervalId = null;
    }

    this.pendingNacks = [];

    this.pings.forEach(({ timer }) => timerManager.clearTimeout(timer));
    this.pings = [];
    this.missedPongs = 0;

    this.sendPackets.clear();
    this.receivedPackets.clear();
    this.buffers.clear();

    this.lossEstimator.reset();
    this.adaptiveFecEncoder.reset();
    this.pacer.stop();

    try {
      if (this.reader) await this.reader.cancel();
    } catch (e) { }

    try {
      if (this.writer) await this.writer.close();
    } catch (e) { }

    try {
      if (this.outReader) await this.outReader.cancel();
    } catch (e) { }

    try {
      if (this.outWriter) await this.outWriter.close();
    } catch (e) { }

    try {
      if (this.transport) this.transport.close({ closeCode: code, reason });
    } catch (e) { }

    this.transport = null;
    this.reader = null;
    this.writer = null;
    this.outReader = null;
    this.outWriter = null;
  }
}

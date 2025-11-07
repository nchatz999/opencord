import { ok } from 'opencord-utils';
import { PacketSerializer, FECEncoder } from './packet';
import type { Result } from 'opencord-utils'
import { err } from 'opencord-utils';
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
  missingSequence: bigint;
}

export interface FecPacket extends BasePacket {
  type: PacketType.FEC;
  timestamp: bigint;
  protectedSequences: bigint[];
  fecData: Uint8Array;
}

export interface RTPPacket extends BasePacket {
  type: PacketType.RTP;
  timestamp: bigint;
  sequenceNumber: bigint;
  frameId: bigint;
  fragmentNumber: number;
  totalFragments: number;
  markerBit: boolean;
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

export type RtcpError = { type: "disconnect", message: string } | { type: "error", message: Error }

export class RTCPProtocol {
  token: string = "";
  outSeq: bigint;
  outFrame: bigint = 0n;
  outReader: ReadableStreamDefaultReader | null = null;
  outWriter: WritableStreamDefaultWriter | null = null;
  inSeq: bigint;
  retransmission: Map<
    bigint,
    { packet: NackPacket; count: number; timer: number }
  >;
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
  private hash: WebTransportHash;
  onFrameComplete: (data: Uint8Array) => void;
  onSafeDataComplete: (data: Uint8Array) => void;
  onConnect: () => void;
  onDisconnect: () => void;

  private url: string;

  constructor(
    url: string,
    hash: WebTransportHash,
    onFrameConplete: (data: Uint8Array) => void,
    onSafeDataComplete: (data: Uint8Array) => void,
    onConnect: () => void,
    onDisconnect: (() => void),
  ) {
    this.url = url;
    this.outSeq = 0n;
    this.inSeq = 0n;
    this.retransmission = new Map();
    this.buffers = new Map<bigint, FrameBuffer>;
    this.rtt = 0;
    this.sendPackets = new Map();
    this.receivedPackets = new Map<bigint, RTPPacket>;
    this.duplicatePackets = 0;
    this.onFrameComplete = onFrameConplete;
    this.onSafeDataComplete = onSafeDataComplete;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.hash = hash;
  }

  public setToken(token: string) {
    this.token = token
  }

  public async connect(): Promise<Result<void, RtcpError>> {
    if (!this.closed) {
      throw new Error("Already connected. Disconnect first.");
    }

    try {
      this.transport = new WebTransport(this.url + `/?${this.token}`, { serverCertificateHashes: [this.hash] })
      await this.transport.ready;
      this.closed = false;
      this.onConnect()

      this.reader = this.transport.datagrams.readable.getReader();
      this.writer = this.transport.datagrams.writable.getWriter();

      const stream = new TransformStream();
      this.outReader = stream.readable.getReader();
      this.outWriter = stream.writable.getWriter();

      this.runSafePacketHandler();
      this.runIncomingHandler();
      this.runOutgoingSender();
      this.runPingInterval(200);
      this.runCleaner();
      this.handleTransportClosed();
      return ok(undefined)
    } catch (e) {
      console.dir(e);
      this.closed = true;
      return err({ type: "error", message: e as Error })
    }
  }

  public async send(data: Uint8Array) {
    if (this.closed || !this.outWriter) return;
    try {
      const mtu = this.mtu - 200;
      let currentTime = BigInt(Date.now());
      let fecGroup: RTPPacket[] = [];
      for (let i = 0; i < data.length; i += mtu) {
        const chunk = data.slice(i, i + mtu);
        const last = i + mtu >= data.length;
        let packet: RTPPacket = {
          type: PacketType.RTP,
          sequenceNumber: this.outSeq++,
          timestamp: currentTime,
          frameId: this.outFrame,
          fragmentNumber: Math.floor(i / mtu),
          totalFragments: Math.ceil(data.length / mtu),
          markerBit: last,
          data: chunk,
        };
        this.sendPackets.set(packet.sequenceNumber, packet);
        this.outWriter.write(PacketSerializer.serialize(packet));
        fecGroup.push(packet);
        if (fecGroup.length == 4) {
          const fecPacket = FECEncoder.generateFECPacket(fecGroup);
          this.outWriter.write(PacketSerializer.serialize(fecPacket));
          fecGroup = [];
        }
      }
      this.outFrame += 1n;
    } catch (e) {

      this.onDisconnect();
      await this.disconnect()
    }
  }

  public async sendSafe(data: Uint8Array) {
    if (this.closed || !this.transport) return;

    try {
      let stream = await this.transport.createUnidirectionalStream();
      let writer = stream.getWriter()
      await writer.write(data)
      await writer.close()
    } catch (e) {
      this.onDisconnect();
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
    const packet = this.retransmission.get(sequence);
    if (packet) {
      clearTimeout(packet.timer);
      this.retransmission.delete(sequence);
    }
  }

  public scheduleRetransmission(nack: NackPacket) {
    if (!this.writer) return;

    let packet = this.retransmission.get(nack.missingSequence);
    if (!packet) {
      packet = { packet: nack, count: 0, timer: Date.now() };
      this.retransmission.set(nack.missingSequence, packet);
    }
    packet.count++;
    let time = packet.count == 1 ? 20 : this.rto;
    packet.timer = window.setTimeout(() => {
      if (this.writer) {
        this.writer.write(PacketSerializer.serialize(packet.packet));
        this.scheduleRetransmission(nack);
      }
    }, time);
  }

  public handlePing(packet: PingPacket) {
    if (!this.writer) return;

    const pongPacket: PongPacket = {
      type: PacketType.PONG,
      timestamp: packet.timestamp,
      data: packet.data,
    };
    this.writer.write(PacketSerializer.serialize(pongPacket));
  }

  public handlePong(packet: PongPacket) {
    let ping = this.pings.find((p) => p.timestamp === packet.timestamp);
    if (!ping) {
      return;
    }
    clearTimeout(ping.timer);
    this.pings = this.pings.filter((p) => p.timestamp !== packet.timestamp);
    const rtt = Number(BigInt(Date.now()) - ping.timestamp);
    this.updateRTT(rtt)
    this.missedPongs = 0
  }

  public handleFEC(packet: FecPacket) {
    const availablePackets = Object.values(this.receivedPackets).filter((p) =>
      packet.protectedSequences.includes(p.sequenceNumber)
    );
    const recoveredPacket = FECEncoder.recoverPacket(packet, availablePackets);
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
    if (!this.writer) return;

    let packet = this.sendPackets.get(nack.missingSequence);
    if (packet) {
      this.writer.write(PacketSerializer.serialize(packet));
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
      for (let i = this.inSeq; i < packet.sequenceNumber; i++) {
        const nack: NackPacket = {
          type: PacketType.NACK,
          missingSequence: i,
        };
        this.scheduleRetransmission(nack);
      }
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
    this.pingIntervalId = window.setInterval(async () => {
      if (this.missedPongs >= 5) {
        this.onDisconnect();
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
          this.writer.write(PacketSerializer.serialize(pingPacket));
      } catch (e) {
      }
      this.pings.push({
        timer: window.setTimeout(() => {
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
      this.onDisconnect();
      await this.disconnect()
      this.onDisconnect();
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
      this.onDisconnect();
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
    this.cleanerIntervalId = window.setInterval(() => {
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

      this.pings = Array.from(this.pings).filter((ping) => now - Number(ping.timestamp) < 5000)
    }, 50)
  }

  private async handleTransportClosed() {
    if (!this.transport) return;

    try {
      const { closeCode, reason } = await this.transport.closed;

      this.closed = true;

      if (this.pingIntervalId !== null) {
        clearInterval(this.pingIntervalId);
        this.pingIntervalId = null;
      }

      if (this.cleanerIntervalId !== null) {
        clearInterval(this.cleanerIntervalId);
        this.cleanerIntervalId = null;
      }

      this.retransmission.forEach(({ timer }) => clearTimeout(timer));
      this.pings.forEach(({ timer }) => clearTimeout(timer));

      try {
        if (this.reader) await this.reader.cancel();
        if (this.writer) await this.writer.close();
        if (this.outReader) await this.outReader.cancel();
        if (this.outWriter) await this.outWriter.close();
      } catch (e) {
      }

      if (this.onDisconnect && closeCode && reason) {
        this.onDisconnect();
        await this.disconnect()
      }
    } catch (e) {
      this.onDisconnect();
      await this.disconnect()
    }
  }

  public async disconnect(code: number = 0, reason: string = "Client initiated disconnect"): Promise<void> {

    this.closed = true;

    if (this.pingIntervalId !== null) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }

    if (this.cleanerIntervalId !== null) {
      clearInterval(this.cleanerIntervalId);
      this.cleanerIntervalId = null;
    }

    this.retransmission.forEach(({ timer }) => clearTimeout(timer));
    this.retransmission.clear();

    this.pings.forEach(({ timer }) => clearTimeout(timer));
    this.pings = [];

    this.sendPackets.clear();
    this.receivedPackets.clear();
    this.buffers.clear();

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

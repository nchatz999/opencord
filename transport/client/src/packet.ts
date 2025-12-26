import { Packet, PacketType, RTPPacket, FecPacket, NackPacket, PingPacket, PongPacket, ProtectedPacketMeta } from './transmission';

export class PacketSerializer {
  public static serialize(packet: Packet): Uint8Array | null {
    let buffer: ArrayBuffer;
    let view: DataView;
    let offset = 0;

    switch (packet.type) {
      case PacketType.RTP: {
        const dataLength = packet.data.length;
        // Header: type(1) + seq(8) + ts(8) + frameId(8) + totalFrag(2) + fragNum(2) = 29
        buffer = new ArrayBuffer(29 + dataLength);
        view = new DataView(buffer);
        view.setUint8(offset, packet.type);
        offset += 1;
        view.setBigUint64(offset, packet.sequenceNumber);
        offset += 8;
        view.setBigUint64(offset, packet.timestamp);
        offset += 8;
        view.setBigUint64(offset, packet.frameId);
        offset += 8;
        view.setUint16(offset, packet.totalFragments);
        offset += 2;
        view.setUint16(offset, packet.fragmentNumber);
        offset += 2;
        new Uint8Array(buffer, offset).set(packet.data);
        break;
      }
      case PacketType.FEC: {
        const protectedCount = packet.protectedPackets.length;
        const fecDataLength = packet.fecData.length;
        // Header: type(1) + ts(8) + count(1) + metadata(count*30) + fecData
        // Per packet: seq(8) + ts(8) + frameId(8) + fragNum(2) + totalFrag(2) + dataLen(2) = 30
        buffer = new ArrayBuffer(10 + protectedCount * 30 + fecDataLength);
        view = new DataView(buffer);
        view.setUint8(offset, packet.type);
        offset += 1;
        view.setBigUint64(offset, packet.timestamp);
        offset += 8;
        view.setUint8(offset, protectedCount);
        offset += 1;
        for (const meta of packet.protectedPackets) {
          view.setBigUint64(offset, meta.sequenceNumber);
          offset += 8;
          view.setBigUint64(offset, meta.timestamp);
          offset += 8;
          view.setBigUint64(offset, meta.frameId);
          offset += 8;
          view.setUint16(offset, meta.fragmentNumber);
          offset += 2;
          view.setUint16(offset, meta.totalFragments);
          offset += 2;
          view.setUint16(offset, meta.dataLength);
          offset += 2;
        }
        new Uint8Array(buffer, offset).set(packet.fecData);
        break;
      }
      case PacketType.NACK: {
        const count = packet.missingSequences.length;
        buffer = new ArrayBuffer(2 + count * 8);
        view = new DataView(buffer);
        view.setUint8(offset, packet.type);
        offset += 1;
        view.setUint8(offset, count);
        offset += 1;
        for (const seq of packet.missingSequences) {
          view.setBigUint64(offset, seq);
          offset += 8;
        }
        break;
      }
      case PacketType.PING:
      case PacketType.PONG: {
        const dataLength = packet.data.length;
        // Header: type(1) + ts(8) = 9
        buffer = new ArrayBuffer(9 + dataLength);
        view = new DataView(buffer);
        view.setUint8(offset, packet.type);
        offset += 1;
        view.setBigUint64(offset, packet.timestamp);
        offset += 8;
        new Uint8Array(buffer, offset).set(packet.data);
        break;
      }
      default:
        return null;
    }

    return new Uint8Array(buffer);
  }

  public static deserialize(buffer: Uint8Array): Packet | null {
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength
    );
    let offset = 0;

    if (buffer.byteLength < 1) {
      return null;
    }
    const type = view.getUint8(offset) as PacketType;
    offset += 1;

    switch (type) {
      case PacketType.RTP: {
        if (buffer.byteLength < 29) {
          return null;
        }
        const sequenceNumber = view.getBigUint64(offset);
        offset += 8;
        const timestamp = view.getBigUint64(offset);
        offset += 8;
        const frameId = view.getBigUint64(offset);
        offset += 8;
        const totalFragments = view.getUint16(offset);
        offset += 2;
        const fragmentNumber = view.getUint16(offset);
        offset += 2;
        const data = new Uint8Array(buffer.buffer, buffer.byteOffset + offset);
        const packet: RTPPacket = {
          type,
          sequenceNumber,
          timestamp,
          frameId,
          totalFragments,
          fragmentNumber,
          data,
        };
        return packet;
      }
      case PacketType.FEC: {
        if (buffer.byteLength < 10) {
          return null;
        }
        const timestamp = view.getBigUint64(offset);
        offset += 8;
        const protectedCount = view.getUint8(offset);
        offset += 1;
        // 30 bytes per protected packet: seq(8) + ts(8) + frameId(8) + frag(2) + total(2) + len(2)
        const metadataSize = protectedCount * 30;
        if (buffer.byteLength < 10 + metadataSize) {
          return null;
        }
        const protectedPackets: ProtectedPacketMeta[] = [];
        for (let i = 0; i < protectedCount; i++) {
          const sequenceNumber = view.getBigUint64(offset);
          offset += 8;
          const pktTimestamp = view.getBigUint64(offset);
          offset += 8;
          const frameId = view.getBigUint64(offset);
          offset += 8;
          const fragmentNumber = view.getUint16(offset);
          offset += 2;
          const totalFragments = view.getUint16(offset);
          offset += 2;
          const dataLength = view.getUint16(offset);
          offset += 2;
          protectedPackets.push({
            sequenceNumber,
            timestamp: pktTimestamp,
            frameId,
            fragmentNumber,
            totalFragments,
            dataLength,
          });
        }
        const fecData = new Uint8Array(
          buffer.buffer,
          buffer.byteOffset + offset
        );
        const packet: FecPacket = {
          type,
          timestamp,
          protectedPackets,
          fecData,
        };
        return packet;
      }
      case PacketType.NACK: {
        if (buffer.byteLength < 2) {
          return null;
        }
        const count = view.getUint8(offset);
        offset += 1;
        if (buffer.byteLength < 2 + count * 8) {
          return null;
        }
        const missingSequences: bigint[] = [];
        for (let i = 0; i < count; i++) {
          missingSequences.push(view.getBigUint64(offset));
          offset += 8;
        }
        const packet: NackPacket = {
          type,
          missingSequences,
        };
        return packet;
      }
      case PacketType.PING:
      case PacketType.PONG: {
        if (buffer.byteLength < 9) {
          return null;
        }
        const timestamp = view.getBigUint64(offset);
        offset += 8;
        const data = new Uint8Array(buffer.buffer, buffer.byteOffset + offset);
        const packet: PingPacket | PongPacket = {
          type,
          timestamp,
          data,
        };
        return packet;
      }
      default:
        console.error("Unknown packet type for deserialization:", type);
        return null;
    }
  }
}

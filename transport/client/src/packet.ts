import { Packet, PacketType, RTPPacket, FecPacket, NackPacket, PingPacket, PongPacket } from './rtcp';

export class PacketSerializer {
  public static serialize(packet: Packet): Uint8Array | null {
    let buffer: ArrayBuffer;
    let view: DataView;
    let offset = 0;

    switch (packet.type) {
      case PacketType.RTP: {
        const dataLength = packet.data.length;
        // Header: type(1) + seq(8) + ts(8) + frameId(8) + totalFrag(2) + fragNum(2) + marker(1) = 30
        buffer = new ArrayBuffer(30 + dataLength);
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
        view.setUint8(offset, packet.markerBit ? 1 : 0);
        offset += 1;
        new Uint8Array(buffer, offset).set(packet.data);
        break;
      }
      case PacketType.FEC: {
        const protectedSequencesCount = packet.protectedSequences.length;
        const fecDataLength = packet.fecData.length;
        // Header: type(1) + ts(8) + count(1) + sequences(count*8) + lengths(count*2) + fecData
        buffer = new ArrayBuffer(
          10 + protectedSequencesCount * 8 + protectedSequencesCount * 2 + fecDataLength
        );
        view = new DataView(buffer);
        view.setUint8(offset, packet.type);
        offset += 1;
        view.setBigUint64(offset, packet.timestamp);
        offset += 8;
        view.setUint8(offset, protectedSequencesCount);
        offset += 1;
        for (const seq of packet.protectedSequences) {
          view.setBigUint64(offset, seq);
          offset += 8;
        }
        for (const len of packet.protectedLengths) {
          view.setUint16(offset, len);
          offset += 2;
        }
        new Uint8Array(buffer, offset).set(packet.fecData);
        break;
      }
      case PacketType.NACK: {
        // Header: type(1) + missingSeq(8) = 9
        buffer = new ArrayBuffer(9);
        view = new DataView(buffer);
        view.setUint8(offset, packet.type);
        offset += 1;
        view.setBigUint64(offset, packet.missingSequence);
        offset += 8;
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
        if (buffer.byteLength < 30) {
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
        const markerBit = view.getUint8(offset) === 1;
        offset += 1;
        const data = new Uint8Array(buffer.buffer, buffer.byteOffset + offset);
        const packet: RTPPacket = {
          type,
          sequenceNumber,
          timestamp,
          frameId,
          totalFragments,
          fragmentNumber,
          markerBit,
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
        const protectedSequencesCount = view.getUint8(offset);
        offset += 1;
        // sequences (8 bytes each) + lengths (2 bytes each)
        const metadataSize = protectedSequencesCount * 8 + protectedSequencesCount * 2;
        if (buffer.byteLength < 10 + metadataSize) {
          return null;
        }
        const protectedSequences: bigint[] = [];
        for (let i = 0; i < protectedSequencesCount; i++) {
          protectedSequences.push(view.getBigUint64(offset));
          offset += 8;
        }
        const protectedLengths: number[] = [];
        for (let i = 0; i < protectedSequencesCount; i++) {
          protectedLengths.push(view.getUint16(offset));
          offset += 2;
        }
        const fecData = new Uint8Array(
          buffer.buffer,
          buffer.byteOffset + offset
        );
        const packet: FecPacket = {
          type,
          timestamp,
          protectedSequences,
          protectedLengths,
          fecData,
        };
        return packet;
      }
      case PacketType.NACK: {
        if (buffer.byteLength < 9) {
          return null;
        }
        const missingSequence = view.getBigUint64(offset);
        offset += 8;
        const packet: NackPacket = {
          type,
          missingSequence,
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

export class FECEncoder {
  public static generateFECPacket(packets: RTPPacket[]): FecPacket {
    const maxLength = Math.max(...packets.map((p) => p.data.length));

    const xorResult = new Uint8Array(maxLength);
    const protectedLengths: number[] = [];

    for (const packet of packets) {
      protectedLengths.push(packet.data.length);
      if (packet.data) {
        for (let i = 0; i < packet.data.length; i++) {
          xorResult[i] ^= packet.data[i];
        }
      }
    }

    return {
      type: PacketType.FEC,
      timestamp: packets[packets.length - 1].timestamp,
      protectedSequences: packets.map((p) => p.sequenceNumber),
      protectedLengths,
      fecData: xorResult,
    };
  }

  public static recoverPacket(
    fecPacket: FecPacket,
    availablePackets: RTPPacket[]
  ): RTPPacket | null {
    if (availablePackets.length < fecPacket.protectedSequences.length - 1) {
      return null;
    }

    // Find the missing sequence and its index
    let missingIndex = -1;
    let missingSequence: bigint | undefined;
    for (let i = 0; i < fecPacket.protectedSequences.length; i++) {
      const seq = fecPacket.protectedSequences[i];
      if (!availablePackets.some((p) => p.sequenceNumber === seq)) {
        missingIndex = i;
        missingSequence = seq;
        break;
      }
    }

    if (missingSequence === undefined || missingIndex === -1) {
      return null;
    }

    const templatePacket = availablePackets[0];

    const xorResult = new Uint8Array(fecPacket.fecData);

    for (const packet of availablePackets) {
      const minLength = Math.min(xorResult.length, packet.data.length);
      for (let i = 0; i < minLength; i++) {
        xorResult[i] ^= packet.data[i];
      }
    }

    // Trim to original packet length
    const originalLength = fecPacket.protectedLengths[missingIndex] ?? xorResult.length;
    const trimmedData = xorResult.slice(0, originalLength);

    // Find templatePacket's position in the FEC group
    const refIndex = fecPacket.protectedSequences.findIndex(
      (seq) => seq === templatePacket.sequenceNumber
    );

    // Calculate fragment offset using positions in the FEC group, not sequence differences
    // This correctly handles non-consecutive sequence numbers from concurrent sends
    const fragmentOffset = missingIndex - refIndex;
    const recoveredFragmentNumber = templatePacket.fragmentNumber + fragmentOffset;

    return {
      type: templatePacket.type,
      sequenceNumber: missingSequence,
      timestamp: templatePacket.timestamp,
      frameId: templatePacket.frameId,
      fragmentNumber: recoveredFragmentNumber,
      totalFragments: templatePacket.totalFragments,
      markerBit: recoveredFragmentNumber === templatePacket.totalFragments - 1,
      data: trimmedData,
    };
  }
}

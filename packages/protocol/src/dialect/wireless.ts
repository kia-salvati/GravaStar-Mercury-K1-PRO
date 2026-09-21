import { checksum, FRAME_BODY_BYTES, FRAME_BYTES, type Bytes } from '../frame.js'
import { Command, WriteCommand, type Dialect, type ReplyPacket, type RequestArgs } from './dialect.js'

/**
 * The 2.4G dongle dialect. Every constant here was observed in
 * test/fixtures/session-1-*.jsonl on a real K1 PRO — see docs/protocol-observations.md.
 *
 * Requests: [opcode, 0, 0, layer << 4, 0…] on output report 19. No checksum on requests.
 * Replies:  [opcode, totalPackets, index, layer << 4 | dataLength, …data, checksum] as input
 *           reports, checksum = (reportId + bytes[0..17]) & 0xff.
 * Writes:   the same packet shape as replies, sent as output reports — [0x04, 10, index, length,
 *           …data, checksum] for a profile, the last packet declaring its real length — and the
 *           keyboard echoes each packet back as an input report to acknowledge it. Observed in
 *           session-2 and session-3 fixtures.
 */
export class WirelessDialect implements Dialect {
  readonly name = 'wireless' as const
  readonly reportId = 0x13
  readonly channel = 'output' as const

  static readonly OPCODES: Readonly<Record<Command, number>> = {
    [Command.Identity]: 0x05,
    [Command.Keymap]: 0x41,
    /** From the vendor source (`getKeyboardCustomLightColor`); not yet seen on hardware. */
    [Command.CustomColor]: 0x42,
    [Command.Macros]: 0x43,
    [Command.Profile]: 0x44,
    [Command.LightColor]: 0x49,
  }

  /** Only the profile write has been captured on the dongle; the colour blocks were written over cable. */
  static readonly WRITE_OPCODES: Readonly<Partial<Record<WriteCommand, number>>> = {
    [WriteCommand.Profile]: 0x04,
  }

  static readonly CHUNK_DATA_BYTES = 14

  /** Identity is the one request whose trailing byte is a literal parameter, not zero padding. */
  static readonly IDENTITY_REQUEST = [0x05, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x19] as const

  opcodeFor(command: Command): number {
    return WirelessDialect.OPCODES[command]
  }

  request(command: Command, args: RequestArgs = {}): Bytes {
    const frame = new Uint8Array(FRAME_BYTES)
    if (command === Command.Identity) {
      frame.set(WirelessDialect.IDENTITY_REQUEST)
      return frame
    }
    frame[0] = this.opcodeFor(command)
    frame[3] = (args.layer ?? 0) << 4
    return frame
  }

  /**
   * Chunks the payload 14 bytes per packet, exactly as captured: a 128-byte profile goes out as
   * 10 packets, the last declaring its real length (2) and zero-padded to the frame.
   */
  writeFrames(command: WriteCommand, payload: Uint8Array): Bytes[] {
    const opcode = WirelessDialect.WRITE_OPCODES[command]
    if (opcode === undefined) {
      throw new Error(`wireless ${command} has not been captured from the vendor app; refusing to guess its opcode`)
    }
    const chunk = WirelessDialect.CHUNK_DATA_BYTES
    const total = Math.ceil(payload.length / chunk)
    if (total > 0xff) throw new RangeError(`payload of ${payload.length} bytes needs ${total} packets, maximum 255`)

    const frames: Bytes[] = []
    for (let index = 0; index < total; index++) {
      const length = Math.min(chunk, payload.length - index * chunk)
      const frame = new Uint8Array(FRAME_BYTES)
      frame.set([opcode, total, index, length])
      frame.set(payload.subarray(index * chunk, (index + 1) * chunk), 4)
      frame[FRAME_BODY_BYTES] = checksum(this.reportId, frame.subarray(0, FRAME_BODY_BYTES))
      frames.push(frame)
    }
    return frames
  }

  /** The keyboard acknowledges a write packet by echoing it: same opcode, same index. */
  isAck(frame: Bytes, packet: ReplyPacket): boolean {
    return packet.opcode === frame[0] && packet.index === frame[2]
  }

  parseReply(frame: DataView): ReplyPacket {
    if (frame.byteLength !== FRAME_BYTES) {
      throw new Error(`wireless reply is ${frame.byteLength} bytes, expected ${FRAME_BYTES}`)
    }
    const body = new Uint8Array(frame.buffer, frame.byteOffset, FRAME_BYTES - 1)
    const expected = checksum(this.reportId, body)
    const actual = frame.getUint8(FRAME_BYTES - 1)
    if (actual !== expected) {
      throw new Error(`wireless reply checksum ${actual.toString(16)} != expected ${expected.toString(16)}`)
    }

    const length = frame.getUint8(3) & 0x0f
    return {
      opcode: frame.getUint8(0),
      total: frame.getUint8(1),
      index: frame.getUint8(2),
      data: new Uint8Array(frame.buffer, frame.byteOffset + 4, length),
    }
  }
}

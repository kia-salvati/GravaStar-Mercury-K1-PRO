import type { Bytes } from '../frame.js'
import { Command, WriteCommand, type Dialect, type ReplyPacket, type RequestArgs } from './dialect.js'


/**
 * The cable dialect. Every constant here was observed in test/fixtures/session-4-wired.jsonl on
 * a real K1 PRO — see docs/protocol-observations.md.
 *
 * Requests: feature report 6, 519 bytes, header then zero padding, no checksum:
 *   [opcode, arg, 0x00, 0x01, 0x00, lengthLo, lengthHi, 0…]
 * Replies:  one feature report per request. Byte 0 is the report id (WebHID includes it), then
 *   the 7-byte request header echoed back, then exactly `length` payload bytes. No chunking.
 * Writes:   the same header shape with opcode 0x04 and the payload in the same report. No reply.
 */
export class WiredDialect implements Dialect {
  readonly name = 'wired' as const
  readonly reportId = 0x06
  readonly channel = 'feature' as const

  static readonly FRAME_BYTES = 519
  static readonly HEADER_BYTES = 7

  static readonly OPCODES: Readonly<Record<Command, number>> = {
    [Command.Identity]: 0x82,
    [Command.Keymap]: 0x83,
    [Command.Profile]: 0x84,
    [Command.Macros]: 0x85,
    [Command.CustomColor]: 0x86,
    [Command.LightColor]: 0x8a,
  }

  /** Payload length the request declares; the reply carries exactly this many bytes. */
  static readonly LENGTHS: Readonly<Record<Command, number>> = {
    [Command.Identity]: 10,
    [Command.Keymap]: 504,
    [Command.Profile]: 128,
    [Command.Macros]: 512,
    [Command.CustomColor]: 378,
    [Command.LightColor]: 483,
  }

  /**
   * Write opcodes, the payload each carries, and byte 3 of the header — `01` for profile and
   * per-key writes, `00` for the light-colour write, exactly as captured. The light-colour
   * write is longer than its read.
   */
  static readonly WRITES: Readonly<Record<WriteCommand, { opcode: number; length: number; flag: number }>> = {
    [WriteCommand.Profile]: { opcode: 0x04, length: 128, flag: 0x01 },
    [WriteCommand.LightColor]: { opcode: 0x0a, length: 512, flag: 0x00 },
    [WriteCommand.CustomColor]: { opcode: 0x06, length: 378, flag: 0x01 },
  }

  opcodeFor(command: Command): number {
    return WiredDialect.OPCODES[command]
  }

  request(command: Command, args: RequestArgs = {}): Bytes {
    const length = WiredDialect.LENGTHS[command]
    // Byte 1 is the layer for keymap reads; identity carries a literal 1 there, as on the dongle.
    const arg = command === Command.Identity ? 0x01 : (args.layer ?? 0)
    const frame = new Uint8Array(WiredDialect.FRAME_BYTES)
    frame.set([this.opcodeFor(command), arg, 0x00, 0x01, 0x00, length & 0xff, length >> 8])
    return frame
  }

  /**
   * A write is one feature report: the same 7-byte header shape as a read, then the payload.
   * Profile `[0x04, 0, 0, 1, 0, 0x80, 0, …128]` observed 37 times (session 5); light colour
   * `0x0a` (512) 18 times and per-key `0x06` (378) 6 times (session 6). The keyboard sends
   * nothing back; the vendor app reads the block again to confirm, and so does K916.
   */
  writeFrames(command: WriteCommand, payload: Uint8Array): Bytes[] {
    const { opcode, length, flag } = WiredDialect.WRITES[command]
    if (payload.length !== length) {
      throw new RangeError(`${command} payload is ${payload.length} bytes, expected ${length}`)
    }
    const frame = new Uint8Array(WiredDialect.FRAME_BYTES)
    frame.set([opcode, 0x00, 0x00, flag, 0x00, length & 0xff, length >> 8])
    frame.set(payload, WiredDialect.HEADER_BYTES)
    return [frame]
  }

  /** The cable never acknowledges a write; confirmation is the read-back. */
  isAck(_frame: Bytes, _packet: ReplyPacket): boolean {
    return false
  }

  parseReply(frame: DataView): ReplyPacket {
    const start = 1 + WiredDialect.HEADER_BYTES
    if (frame.byteLength < start) {
      throw new Error(`wired reply is ${frame.byteLength} bytes, shorter than its ${start}-byte header`)
    }
    if (frame.getUint8(0) !== this.reportId) {
      throw new Error(`wired reply on report ${frame.getUint8(0)}, expected ${this.reportId}`)
    }
    const length = frame.getUint16(6, true)
    if (frame.byteLength < start + length) {
      throw new Error(`wired reply declares ${length} bytes but only ${frame.byteLength - start} follow`)
    }
    return {
      opcode: frame.getUint8(1),
      total: 1,
      index: 0,
      data: new Uint8Array(frame.buffer, frame.byteOffset + start, length),
    }
  }
}

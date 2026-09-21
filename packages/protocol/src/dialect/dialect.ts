import type { Bytes } from '../frame.js'

/**
 * What the caller wants, independent of how the keyboard is connected. The dialect turns intent
 * into the opcode and framing the current connection expects, so nothing above it ever learns
 * that a keymap read is 0x41 on the dongle and something else on the cable.
 */
export enum Command {
  Identity = 'identity',
  Keymap = 'keymap',
  Macros = 'macros',
  Profile = 'profile',
  LightColor = 'lightColor',
  CustomColor = 'customColor',
}

export interface RequestArgs {
  layer?: number
}

/** One frame of a reply. Bulk replies span several packets that `reassemble` joins. */
export interface ReplyPacket {
  opcode: number
  total: number
  index: number
  data: Uint8Array
}

export enum WriteCommand {
  Profile = 'writeProfile',
  LightColor = 'writeLightColor',
  CustomColor = 'writeCustomColor',
}

export interface Dialect {
  readonly name: 'wired' | 'wireless'
  readonly reportId: number
  /** feature → command in, reply pulled back; output → command in, replies pushed as input reports. */
  readonly channel: 'feature' | 'output'
  opcodeFor(command: Command): number
  request(command: Command, args?: RequestArgs): Bytes
  /** Verifies the checksum and throws on mismatch — a corrupt frame must never decode silently. */
  parseReply(frame: DataView): ReplyPacket
  /** The frames that carry a write, in send order. Throws if this dialect's write path is unverified. */
  writeFrames(command: WriteCommand, payload: Uint8Array): Bytes[]
  /** Whether a pushed packet acknowledges a specific sent frame. */
  isAck(frame: Bytes, packet: ReplyPacket): boolean
}

/**
 * Which packet indices of a reply are still outstanding. The 2.4G link drops packets — captured
 * reads were missing arbitrary indices and occasionally delivered one twice — so completeness is
 * judged by coverage of 0..total-1, never by count.
 */
export function missingIndices(packets: ReadonlyMap<number, ReplyPacket>, total: number): number[] {
  const missing: number[] = []
  for (let index = 0; index < total; index++) if (!packets.has(index)) missing.push(index)
  return missing
}

/** Joins a complete reply in index order. Throws if any index is missing. */
export function reassemble(packets: ReadonlyMap<number, ReplyPacket>, total: number): Uint8Array {
  const missing = missingIndices(packets, total)
  if (missing.length > 0) {
    throw new Error(`reply incomplete: missing packet(s) ${missing.join(', ')} of ${total}`)
  }

  const ordered = [...packets.values()].sort((a, b) => a.index - b.index)
  const length = ordered.reduce((sum, packet) => sum + packet.data.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const packet of ordered) {
    out.set(packet.data, offset)
    offset += packet.data.length
  }
  return out
}

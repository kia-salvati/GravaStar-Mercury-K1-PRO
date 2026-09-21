import type { ReplyPacket } from '../dialect/dialect.js'

export interface PowerState {
  percent: number
  charging: boolean
  full: boolean
}

/**
 * The keyboard pushes a power packet on its own, once, right after answering an identity
 * request. Observed on the 2.4G dongle:
 *
 *   0a 01 00 04 | 05 64 01 00 | …checksum
 *   opcode 0x0a, 1 packet, index 0, 4 data bytes
 *   data: [subtype, percent, flags, 0]
 *
 * The vendor's decoder looks for subtype 0x02; the K1 PRO sends 0x05. The layout is otherwise
 * identical, so the subtype is not checked — what matters is the opcode.
 */
export const POWER_OPCODE = 0x0a

const OFFSET_PERCENT = 1
const OFFSET_FLAGS = 2
const FLAG_FULL = 0x01
const FLAG_CHARGING = 0x10

export function isPowerPacket(packet: ReplyPacket): boolean {
  return packet.opcode === POWER_OPCODE && packet.data.length >= OFFSET_FLAGS + 1
}

export function decodePower(packet: ReplyPacket): PowerState {
  const flags = packet.data[OFFSET_FLAGS]!
  return {
    percent: packet.data[OFFSET_PERCENT]!,
    charging: (flags & FLAG_CHARGING) !== 0,
    full: (flags & FLAG_FULL) !== 0,
  }
}

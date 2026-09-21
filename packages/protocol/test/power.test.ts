import { expect, test } from 'vitest'
import { decodePower, isPowerPacket, POWER_OPCODE } from '../src/codec/power.js'
import type { ReplyPacket } from '../src/dialect/dialect.js'
import { WirelessDialect } from '../src/dialect/wireless.js'

const packet = (percent: number, flags: number, subtype = 0x05): ReplyPacket => ({
  opcode: POWER_OPCODE,
  total: 1,
  index: 0,
  data: Uint8Array.from([subtype, percent, flags, 0]),
})

test('recognises a power packet by its opcode', () => {
  expect(isPowerPacket(packet(91, 0x10))).toBe(true)
})

test('rejects a packet with a different opcode', () => {
  expect(isPowerPacket({ ...packet(91, 0x10), opcode: 0x41 })).toBe(false)
})

test('rejects a packet too short to carry flags', () => {
  expect(isPowerPacket({ ...packet(91, 0x10), data: Uint8Array.from([0x05, 91]) })).toBe(false)
})

test('decodes percentage, charging and full flags', () => {
  expect(decodePower(packet(91, 0x10))).toEqual({ percent: 91, charging: true, full: false })
  expect(decodePower(packet(100, 0x01))).toEqual({ percent: 100, charging: false, full: true })
  expect(decodePower(packet(47, 0x00))).toEqual({ percent: 47, charging: false, full: false })
})

test('charging and full can both be set', () => {
  expect(decodePower(packet(100, 0x11))).toEqual({ percent: 100, charging: true, full: true })
})

test('ignores flag bits that are not charging or full', () => {
  // 0xee has six bits set but neither 0x01 nor 0x10, so both flags stay false.
  expect(decodePower(packet(50, 0xee))).toEqual({ percent: 50, charging: false, full: false })
})

test('the subtype byte is not checked — the vendor expects 0x02, the K1 PRO sends 0x05', () => {
  expect(isPowerPacket(packet(80, 0, 0x02))).toBe(true)
  expect(isPowerPacket(packet(80, 0, 0x05))).toBe(true)
})

test('decodes the exact power frame captured from the K1 PRO on the dongle', () => {
  // session-1-connect.jsonl, arrives right after the identity reply
  const frame = Uint8Array.from([
    0x0a, 0x01, 0x00, 0x04, 0x05, 0x64, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x8c,
  ])
  const parsed = new WirelessDialect().parseReply(new DataView(frame.buffer))

  expect(isPowerPacket(parsed)).toBe(true)
  expect(decodePower(parsed)).toEqual({ percent: 100, charging: false, full: true })
})

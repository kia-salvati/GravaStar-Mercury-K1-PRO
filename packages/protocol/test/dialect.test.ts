import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { Command, missingIndices, reassemble, type ReplyPacket } from '../src/dialect/dialect.js'
import { connectionTypeFor, dialectFor } from '../src/dialect/select.js'
import { WiredDialect } from '../src/dialect/wired.js'
import { WirelessDialect } from '../src/dialect/wireless.js'
import { bytesOf, parseCapture } from '../src/transport/transport.js'

const capture = parseCapture(readFileSync('test/fixtures/session-1-connect.jsonl', 'utf8'))
const screens = parseCapture(readFileSync('test/fixtures/session-1-screens.jsonl', 'utf8'))
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')

const wireless = new WirelessDialect()

// ---- selection --------------------------------------------------------------------------------

test('the wired keyboard and the dongle map to their dialects by vendor id', () => {
  expect(connectionTypeFor({ vendorId: 0x258a })).toBe('wired')
  expect(connectionTypeFor({ vendorId: 0x3554 })).toBe('wireless')
  expect(connectionTypeFor({ vendorId: 0x1532 })).toBeUndefined()

  expect(dialectFor({ vendorId: 0x258a })).toBeInstanceOf(WiredDialect)
  expect(dialectFor({ vendorId: 0x3554 })).toBeInstanceOf(WirelessDialect)
  expect(() => dialectFor({ vendorId: 0x1532 })).toThrow(/no dialect/)
})

// ---- wireless requests reproduce the captured frames exactly ------------------------------------

test('identity request matches the frame the vendor app sent', () => {
  const sent = capture.find((e) => e.dir === 'out:output' && e.bytes.startsWith('05 01'))!
  expect(hex(wireless.request(Command.Identity))).toBe(sent.bytes)
})

test.each([
  [Command.Keymap, 0, '41 00 00 00'],
  [Command.Keymap, 1, '41 00 00 10'],
  [Command.Keymap, 2, '41 00 00 20'],
])('%s layer %i starts %s and pads to 19 bytes', (command, layer, prefix) => {
  const frame = wireless.request(command, { layer })
  expect(frame).toHaveLength(19)
  expect(hex(frame).startsWith(prefix)).toBe(true)
  expect([...frame.subarray(4)].every((b) => b === 0)).toBe(true)
})

test('every bulk request in the capture is one our dialect produces', () => {
  const sent = [...capture, ...screens].filter((e) => e.dir === 'out:output').map((e) => e.bytes)
  const ours = new Set([
    hex(wireless.request(Command.Identity)),
    ...[0, 1, 2].map((layer) => hex(wireless.request(Command.Keymap, { layer }))),
    hex(wireless.request(Command.Macros)),
    hex(wireless.request(Command.Profile)),
    hex(wireless.request(Command.LightColor)),
  ])
  for (const frame of sent) expect(ours.has(frame), `vendor sent ${frame}`).toBe(true)
})

// ---- wireless replies: checksum and framing ---------------------------------------------------

test('every captured reply passes checksum verification', () => {
  const replies = [...capture, ...screens].filter((e) => e.dir === 'in:input')
  expect(replies.length).toBeGreaterThan(700)
  for (const reply of replies) {
    const bytes = bytesOf(reply)
    expect(() => wireless.parseReply(new DataView(bytes.buffer))).not.toThrow()
  }
})

test('a corrupted reply is rejected', () => {
  const bytes = bytesOf(capture.find((e) => e.dir === 'in:input')!)
  bytes[5] ^= 0xff
  expect(() => wireless.parseReply(new DataView(bytes.buffer))).toThrow(/checksum/)
})

test('parses the identity reply into opcode, packet count and payload', () => {
  const bytes = bytesOf(capture.find((e) => e.dir === 'in:input' && e.bytes.startsWith('05 01'))!)
  const packet = wireless.parseReply(new DataView(bytes.buffer))

  expect(packet.opcode).toBe(0x05)
  expect(packet.total).toBe(1)
  expect(packet.index).toBe(0)
  expect(hex(packet.data)).toBe('03 00 00 00 01 97 17 07 00 00')
})

test('a bulk reply reports its packet count and 14-byte payload', () => {
  const bytes = bytesOf(capture.find((e) => e.dir === 'in:input' && e.bytes.startsWith('41 24'))!)
  const packet = wireless.parseReply(new DataView(bytes.buffer))

  expect(packet.total).toBe(36)
  expect(packet.data).toHaveLength(14)
})

test('the layer nibble in a reply does not corrupt the length', () => {
  const fn1 = bytesOf(screens.find((e) => e.dir === 'in:input' && e.bytes.startsWith('41 24 00 2e'))!)
  expect(wireless.parseReply(new DataView(fn1.buffer)).data).toHaveLength(14)
})

// ---- reassembly --------------------------------------------------------------------------------

test('the 2.4G link drops packets: single captured reads have gaps, merging the retries fills them', () => {
  // Every 0x41 read at connect is the same default-layer request. Merge all six by index.
  const packets = new Map<number, ReplyPacket>()
  let inKeymapRead = false
  for (const event of capture) {
    if (event.dir === 'out:output') {
      inKeymapRead = event.bytes.startsWith('41 00 00 00')
      continue
    }
    if (!inKeymapRead) continue
    const packet = wireless.parseReply(new DataView(bytesOf(event).buffer))
    if (!packets.has(packet.index)) packets.set(packet.index, packet)
  }

  expect(missingIndices(packets, 36)).toEqual([])
  const payload = reassemble(packets, 36)
  expect(payload).toHaveLength(36 * 14)
  expect(hex(payload.subarray(0, 12))).toBe('00 00 00 29 00 00 00 35 00 00 00 2b')
})

test('a single captured bulk read is usually incomplete — this is the property the retry loop exists for', () => {
  const start = capture.findIndex((e) => e.dir === 'out:output' && e.bytes.startsWith('41 00'))
  const packets = new Map<number, ReplyPacket>()
  for (let i = start + 1; i < capture.length && !capture[i]!.dir.startsWith('out:'); i++) {
    const packet = wireless.parseReply(new DataView(bytesOf(capture[i]!).buffer))
    packets.set(packet.index, packet)
  }
  expect(missingIndices(packets, 36).length).toBeGreaterThan(0)
})

test('reassembly orders by index regardless of arrival order', () => {
  const p = (index: number, byte: number): ReplyPacket => ({ opcode: 1, total: 2, index, data: Uint8Array.from([byte]) })
  const packets = new Map([[1, p(1, 9)], [0, p(0, 1)]])
  expect([...reassemble(packets, 2)]).toEqual([1, 9])
})

test('reassembly names the missing packets', () => {
  const p: ReplyPacket = { opcode: 1, total: 3, index: 0, data: Uint8Array.from([1]) }
  expect(() => reassemble(new Map([[0, p]]), 3)).toThrow(/missing packet\(s\) 1, 2 of 3/)
})

// ---- wired: verified against session-4-wired.jsonl ----------------------------------------------

const wiredCapture = parseCapture(readFileSync('test/fixtures/session-4-wired.jsonl', 'utf8'))
const wired = new WiredDialect()

test('wired requests are 519-byte feature reports: header, declared length, zero padding', () => {
  const frame = wired.request(Command.Keymap, { layer: 1 })
  expect(wired.reportId).toBe(6)
  expect(wired.channel).toBe('feature')
  expect(frame).toHaveLength(519)
  expect(hex(frame.subarray(0, 7))).toBe('83 01 00 01 00 f8 01')   // 0x01f8 = 504 bytes
  expect([...frame.subarray(7)].every((b) => b === 0)).toBe(true)
})

test('every wired request the vendor sent is one our dialect produces', () => {
  const sent = wiredCapture.filter((e) => e.dir === 'out:feature').map((e) => e.bytes)
  const ours = new Set([
    hex(wired.request(Command.Identity)),
    ...[0, 1, 2].map((layer) => hex(wired.request(Command.Keymap, { layer }))),
    hex(wired.request(Command.Macros)),
    hex(wired.request(Command.Profile)),
    hex(wired.request(Command.LightColor)),
  ])
  expect(sent.length).toBe(20)
  for (const frame of sent) expect(ours.has(frame), `vendor sent ${frame.slice(0, 20)}…`).toBe(true)
})

test('a wired reply echoes the request header and carries exactly the declared payload', () => {
  const reply = bytesOf(wiredCapture.find((e) => e.dir === 'in:feature')!)
  const packet = wired.parseReply(new DataView(reply.buffer))

  expect(packet.opcode).toBe(0x82)
  expect(packet.total).toBe(1)
  expect(hex(packet.data)).toBe('03 00 00 00 01 97 17 07 00 00')   // same identity bytes as the dongle
})

test('every captured wired reply parses to its declared length', () => {
  const replies = wiredCapture.filter((e) => e.dir === 'in:feature')
  expect(replies.length).toBe(20)
  for (const reply of replies) {
    const bytes = bytesOf(reply)
    const packet = wired.parseReply(new DataView(bytes.buffer))
    expect(packet.data.length).toBe(bytes[6]! | (bytes[7]! << 8))
  }
})

test('a wired reply on the wrong report id is rejected', () => {
  const bytes = bytesOf(wiredCapture.find((e) => e.dir === 'in:feature')!)
  bytes[0] = 0x13
  expect(() => wired.parseReply(new DataView(bytes.buffer))).toThrow(/report 19/)
})

test('a truncated wired reply is rejected rather than misread', () => {
  const bytes = bytesOf(wiredCapture.find((e) => e.dir === 'in:feature')!)
  expect(() => wired.parseReply(new DataView(bytes.buffer, 0, 12))).toThrow(/declares 10 bytes/)
})

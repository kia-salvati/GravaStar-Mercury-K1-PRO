import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { CUSTOM_COLOUR_BYTES, decodeKeyColours, effectColour, fromHexColour, keyColour, LIGHT_COLOUR_WRITE_BYTES, toHexColour, withEffectColour, withKeyColour } from '../src/codec/colour.js'
import { K916 } from '../src/device.js'
import { WriteCommand } from '../src/dialect/dialect.js'
import { WiredDialect } from '../src/dialect/wired.js'
import { WirelessDialect } from '../src/dialect/wireless.js'
import { MockTransport } from '../src/transport/mock.js'
import { bytesOf, parseCapture } from '../src/transport/transport.js'

const COLOUR = readFileSync('test/fixtures/session-6-colour.jsonl', 'utf8')
const events = parseCapture(COLOUR)
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')

/** Every (last read of block, following write of block) pair in the session, for one write opcode. */
function readWritePairs(readPrefix: string, writePrefix: string, readLength: number, writeLength: number): { read: Uint8Array; write: Uint8Array; frame: string }[] {
  const pairs: { read: Uint8Array; write: Uint8Array; frame: string }[] = []
  let lastRead: Uint8Array | undefined
  for (const event of events) {
    if (event.dir === 'in:feature' && event.bytes.startsWith(readPrefix)) lastRead = bytesOf(event).subarray(8, 8 + readLength)
    if (event.dir === 'out:feature' && event.bytes.startsWith(writePrefix) && lastRead) {
      pairs.push({ read: lastRead, write: bytesOf(event).subarray(7, 7 + writeLength), frame: event.bytes })
    }
  }
  return pairs
}

const lightPairs = readWritePairs('06 8a ', '0a ', 483, 512)
const customPairs = readWritePairs('06 86 ', '06 ', 378, 378)

// ---- light-colour block: per-effect RGB ---------------------------------------------------------

test('the eight swatch clicks and the typed hex land in effect 1 as RGB, in order', () => {
  const seen = lightPairs.slice(0, 9).map((p) => toHexColour(effectColour(p.write, 1)))
  expect(seen).toEqual(['#000000', '#0000ff', '#00ff00', '#00ffff', '#ff0000', '#ff00ff', '#ffff00', '#ffffff', '#ff8800'])
})

test('GOLDEN: every captured light-colour write is the preceding read with one RGB replaced, padded and trailed', () => {
  expect(lightPairs).toHaveLength(18)
  for (const [i, { read, write }] of lightPairs.entries()) {
    const rgb = effectColour(write, 1)
    expect(hex(withEffectColour(read, 1, rgb)), `write #${i}`).toBe(hex(write))
  }
})

test('GOLDEN: our cable write frame equals the vendor frame for every captured light-colour write', () => {
  const wired = new WiredDialect()
  for (const { write, frame } of lightPairs) {
    expect(hex(wired.writeFrames(WriteCommand.LightColor, write)[0]!)).toBe(frame)
  }
})

test('withEffectColour touches only that effect\'s three bytes within the read region', () => {
  const { read } = lightPairs[0]!
  const out = withEffectColour(read, 15, { r: 1, g: 2, b: 3 })
  const changed = [...out.subarray(0, 483)].map((b, i) => (b !== read[i] ? i : -1)).filter((i) => i >= 0)
  expect(changed).toEqual([63, 64, 65])
  expect(out).toHaveLength(LIGHT_COLOUR_WRITE_BYTES)
  expect([out[506], out[507]]).toEqual([0x5a, 0xa5])
})

test('an effect without a colour slot is refused', () => {
  const { read } = lightPairs[0]!
  expect(() => effectColour(read, 277)).toThrow(/no colour slot/)
  expect(() => withEffectColour(read, 277, { r: 0, g: 0, b: 0 })).toThrow(/no colour slot/)
})

test('a channel outside 0..255 is refused', () => {
  const { read } = lightPairs[0]!
  expect(() => withEffectColour(read, 1, { r: 256, g: 0, b: 0 })).toThrow(/r must be/)
  expect(() => withEffectColour(read, 1, { r: 0, g: -1, b: 0 })).toThrow(/g must be/)
  expect(() => withEffectColour(read, 1, { r: 0, g: 0, b: 1.5 })).toThrow(/b must be/)
})

// ---- custom block: planar per-key RGB ----------------------------------------------------------

test('the per-key edit changed R, G and B of slot 35 in three planes 126 bytes apart', () => {
  const { read, write } = customPairs[1]!
  const changed = [...write].map((b, i) => (b !== read[i] ? i : -1)).filter((i) => i >= 0)
  expect(changed).toEqual([35, 126 + 35, 252 + 35])
  expect(keyColour(write, 35)).toEqual({ r: 0xaf, g: 0x6b, b: 0x48 })
})

test('GOLDEN: every captured per-key write is the preceding read with some slots recoloured', () => {
  // Write #0 is the vendor seeding an all-zero block with its ten-key preset; the rest are
  // single-key edits. Applying withKeyColour per changed slot must reproduce each exactly.
  expect(customPairs.length).toBeGreaterThanOrEqual(6)
  for (const [i, { read, write }] of customPairs.entries()) {
    const slots = new Set([...write].map((b, j) => (b !== read[j] ? j % 126 : -1)).filter((j) => j >= 0))
    let reproduced = read
    for (const slot of slots) reproduced = withKeyColour(reproduced, slot, keyColour(write, slot))
    expect(hex(reproduced), `write #${i} (${slots.size} slot(s))`).toBe(hex(write))
  }
  expect([...customPairs[0]!.write].filter((b, j) => b !== customPairs[0]!.read[j]).length).toBe(29)
})

test('GOLDEN: our cable write frame equals the vendor frame for every captured per-key write', () => {
  const wired = new WiredDialect()
  for (const { write, frame } of customPairs) {
    expect(hex(wired.writeFrames(WriteCommand.CustomColor, write)[0]!)).toBe(frame)
  }
})

test('decodeKeyColours yields 126 entries and agrees with keyColour', () => {
  const { read } = customPairs[0]!
  const all = decodeKeyColours(read)
  expect(all).toHaveLength(126)
  expect(all[20]).toEqual(keyColour(read, 20))
  expect(read).toHaveLength(CUSTOM_COLOUR_BYTES)
})

test('slot bounds are enforced', () => {
  const { read } = customPairs[0]!
  expect(() => keyColour(read, 126)).toThrow(/slot must be/)
  expect(() => withKeyColour(read, -1, { r: 0, g: 0, b: 0 })).toThrow(/slot must be/)
})

// ---- hex helpers ----------------------------------------------------------------------------------

test('hex round-trips', () => {
  for (const h of ['#000000', '#ff8800', '#0a0b0c', '#ffffff']) expect(toHexColour(fromHexColour(h))).toBe(h)
  expect(fromHexColour('FF8800')).toEqual({ r: 255, g: 136, b: 0 })
  expect(() => fromHexColour('#ff88')).toThrow(/not a #rrggbb/)
})

// ---- device, on the cable simulator -------------------------------------------------------------

test('setEffectColour writes the block, reads it back and returns the colour the keyboard holds', async () => {
  const transport = new MockTransport(COLOUR)
  const kb = await K916.connect(transport, { writeSettleMs: 0 })

  const result = await kb.setEffectColour({ r: 0x12, g: 0x34, b: 0x56 }, 1)

  expect(result).toEqual({ r: 0x12, g: 0x34, b: 0x56 })
  expect(transport.writes).toHaveLength(1)
  expect(transport.writes[0]![0]).toBe(0x0a)
  expect(effectColour(transport.wiredBlock(0x8a)!, 1)).toEqual({ r: 0x12, g: 0x34, b: 0x56 })
})

test('setKeyColour writes the planar block and reads it back', async () => {
  const transport = new MockTransport(COLOUR)
  const kb = await K916.connect(transport, { writeSettleMs: 0 })

  await expect(kb.setKeyColour(35, { r: 9, g: 8, b: 7 })).resolves.toEqual({ r: 9, g: 8, b: 7 })
  expect(transport.writes[0]![0]).toBe(0x06)
  expect((await kb.readKeyColours())[35]).toEqual({ r: 9, g: 8, b: 7 })
})

test('readEffectColour defaults to the current effect', async () => {
  const kb = await K916.connect(new MockTransport(COLOUR), { writeSettleMs: 0 })
  const lighting = await kb.readLighting()
  expect(await kb.readEffectColour()).toEqual(await kb.readEffectColour(lighting.effectId))
})

test('backup covers all three blocks and restore puts every one of them back', async () => {
  const transport = new MockTransport(COLOUR)
  const kb = await K916.connect(transport, { writeSettleMs: 0 })
  const backup = await kb.backup()
  expect(backup.profile).toHaveLength(128)
  expect(backup.lightColour).toHaveLength(483)
  expect(backup.customColour).toHaveLength(378)

  await kb.setLighting({ brightness: 3 })
  await kb.setEffectColour({ r: 1, g: 2, b: 3 }, 1)
  await kb.setKeyColour(2, { r: 4, g: 5, b: 6 })   // Tab, in column order
  await kb.setKeyColour(3, { r: 7, g: 8, b: 9 })   // Caps
  expect([...transport.wiredBlock(0x86)!]).not.toEqual([...backup.customColour])

  await kb.restore(backup)

  expect([...transport.wiredBlock(0x84)!]).toEqual([...backup.profile])
  expect([...transport.wiredBlock(0x8a)!]).toEqual([...backup.lightColour])
  expect([...transport.wiredBlock(0x86)!]).toEqual([...backup.customColour])
  expect((await kb.readKeyColours())[2]).toEqual(keyColour(backup.customColour, 2))
})

// ---- dongle: verified against session-7-dongle-colour.jsonl ----------------------------------------

const DONGLE_COLOUR = readFileSync('test/fixtures/session-7-dongle-colour.jsonl', 'utf8')
const DONGLE = { vendorId: 0x3554, productId: 0xfa09 }

/** Every complete write burst of one opcode in the capture: its packets in send order. */
function dongleWriteBursts(opcode: number): string[][] {
  const bursts: string[][] = []
  let current: string[] | undefined
  for (const event of parseCapture(DONGLE_COLOUR)) {
    if (event.dir !== 'out:output') continue
    const bytes = bytesOf(event)
    if (bytes[0] !== opcode) continue
    if (bytes[2] === 0) bursts.push((current = []))
    current?.push(event.bytes)
  }
  return bursts.filter((b) => b.length === bytesOf({ ...parseCapture(DONGLE_COLOUR)[0]!, bytes: b[0]! })[1])
}

test('GOLDEN: the dongle light-colour write is 37 packets of opcode 0x09 and we reproduce every one', () => {
  const bursts = dongleWriteBursts(0x09)
  expect(bursts.length).toBeGreaterThanOrEqual(1)
  const wireless = new WirelessDialect()
  for (const burst of bursts) {
    expect(burst).toHaveLength(37)
    const payload = new Uint8Array(512)
    for (const frame of burst) {
      const bytes = bytesOf({ ...parseCapture(DONGLE_COLOUR)[0]!, bytes: frame })
      payload.set(bytes.subarray(4, 4 + (bytes[3]! & 0x0f)), bytes[2]! * 14)
    }
    wireless.writeFrames(WriteCommand.LightColor, payload).forEach((frame, i) => expect(hex(frame), `packet ${i}`).toBe(burst[i]))
  }
})

test('GOLDEN: the dongle per-key write is 37 packets of opcode 0x02, the 378-byte block padded to 506', () => {
  const [burst] = dongleWriteBursts(0x02)
  expect(burst).toHaveLength(37)
  const wireless = new WirelessDialect()
  const payload = new Uint8Array(378)
  for (const frame of burst!) {
    const bytes = bytesOf({ ...parseCapture(DONGLE_COLOUR)[0]!, bytes: frame })
    const start = bytes[2]! * 14
    if (start < 378) payload.set(bytes.subarray(4, 4 + Math.min(bytes[3]! & 0x0f, 378 - start)), start)
  }
  wireless.writeFrames(WriteCommand.CustomColor, payload).forEach((frame, i) => expect(hex(frame), `packet ${i}`).toBe(burst![i]))
})

test('setEffectColour and setKeyColour work over the dongle on the simulator', async () => {
  const transport = new MockTransport(DONGLE_COLOUR, DONGLE)
  // The capture's first two 0x49 requests are followed only by stale 0x42 packets from an
  // earlier read — the real link interleaves — so this exercises the silent-attempt retry.
  const kb = await K916.connect(transport, { burstIdleMs: 5, ackTimeoutMs: 5, timeoutMs: 20, writeSettleMs: 0 })

  await expect(kb.setEffectColour({ r: 0x12, g: 0x34, b: 0x56 }, 1)).resolves.toEqual({ r: 0x12, g: 0x34, b: 0x56 })
  await expect(kb.setKeyColour(35, { r: 9, g: 8, b: 7 })).resolves.toEqual({ r: 9, g: 8, b: 7 })
  expect(transport.writes.filter((w) => w[0] === 0x09)).toHaveLength(37)
  expect(transport.writes.filter((w) => w[0] === 0x02)).toHaveLength(37)
})

test('a payload longer than the dongle wire length is refused', () => {
  expect(() => new WirelessDialect().writeFrames(WriteCommand.CustomColor, new Uint8Array(507))).toThrow(/maximum 506/)
})

import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { applyLighting, decodeLighting } from '../src/codec/lighting.js'
import { K916, KeyboardBusyError } from '../src/device.js'
import { WriteCommand, type ReplyPacket } from '../src/dialect/dialect.js'
import { WiredDialect } from '../src/dialect/wired.js'
import { WirelessDialect } from '../src/dialect/wireless.js'
import { K1_PRO_UUID, modelForUuid } from '../src/models.js'
import { MockTransport } from '../src/transport/mock.js'
import { bytesOf, parseCapture } from '../src/transport/transport.js'

const CONNECT = readFileSync('test/fixtures/session-1-connect.jsonl', 'utf8')
const LIGHTING = readFileSync('test/fixtures/session-2-lighting.jsonl', 'utf8')
const DONGLE = { vendorId: 0x3554, productId: 0xfa09 }
const FAST = { burstIdleMs: 5, ackTimeoutMs: 5 }
const K1 = modelForUuid(K1_PRO_UUID)!.capabilities.lighting
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')

/** connect (reads) + one captured write, so the mock has a write template to validate shape against. */
const CAPTURE = CONNECT + '\n' + LIGHTING.split('\n').filter((l) => l.includes('"effect-always-on"')).join('\n')

// ---- dialect: frames ----------------------------------------------------------------------------

test('a profile write is ten packets, the last declaring its real length of 2', () => {
  const frames = new WirelessDialect().writeFrames(WriteCommand.Profile, new Uint8Array(128).fill(0xab))

  expect(frames).toHaveLength(10)
  expect(hex(frames[0]!.subarray(0, 4))).toBe('04 0a 00 0e')
  expect(hex(frames[9]!.subarray(0, 4))).toBe('04 0a 09 02')                  // 128 = 9 × 14 + 2
  expect(frames[9]!.subarray(4, 6)).toEqual(Uint8Array.from([0xab, 0xab]))   // the 2 real bytes…
  expect(frames[9]!.subarray(6, 18).every((b) => b === 0)).toBe(true)         // …then zero padding, as captured
})

test('GOLDEN: our write frames for a captured profile are the vendor frames, byte for byte', () => {
  const vendor = parseCapture(LIGHTING).filter((e) => e.label === 'effect-always-on' && e.dir === 'out:output' && e.bytes.startsWith('04 0a'))
  expect(vendor).toHaveLength(10)

  const profile = new Uint8Array(128)
  for (const event of vendor) {
    const bytes = bytesOf(event)
    profile.set(bytes.subarray(4, 4 + (bytes[3]! & 0x0f)), bytes[2]! * 14)
  }
  const ours = new WirelessDialect().writeFrames(WriteCommand.Profile, profile)
  ours.forEach((frame, i) => expect(hex(frame), `packet ${i}`).toBe(vendor[i]!.bytes))
})

test('an echoed packet is the ack for the packet with the same index, and nothing else', () => {
  const dialect = new WirelessDialect()
  const [first, second] = dialect.writeFrames(WriteCommand.Profile, new Uint8Array(128))
  const echoOfFirst: ReplyPacket = { opcode: 0x04, total: 10, index: 0, data: new Uint8Array(14) }

  expect(dialect.isAck(first!, echoOfFirst)).toBe(true)
  expect(dialect.isAck(second!, echoOfFirst)).toBe(false)
  expect(dialect.isAck(first!, { ...echoOfFirst, opcode: 0x44 })).toBe(false)
})

// ---- wired: verified against session-5-wired-writes.jsonl ----------------------------------------

const WIRED_WRITES = readFileSync('test/fixtures/session-5-wired-writes.jsonl', 'utf8')
const wiredWrites = parseCapture(WIRED_WRITES).filter((e) => e.dir === 'out:feature' && e.bytes.startsWith('04 '))

test('a cable write is one 519-byte feature report: header, then the profile', () => {
  const [frame, ...rest] = new WiredDialect().writeFrames(WriteCommand.Profile, new Uint8Array(128).fill(0xab))

  expect(rest).toHaveLength(0)
  expect(frame).toHaveLength(519)
  expect(hex(frame!.subarray(0, 7))).toBe('04 00 00 01 00 80 00')
  expect(frame![7]).toBe(0xab)
  expect(frame![7 + 127]).toBe(0xab)
  expect(frame!.subarray(135).every((b) => b === 0)).toBe(true)
})

test('GOLDEN: every one of the 37 captured cable writes is reproduced byte-for-byte from its own profile', () => {
  expect(wiredWrites).toHaveLength(37)
  const wired = new WiredDialect()
  for (const event of wiredWrites) {
    const captured = bytesOf(event)
    const profile = captured.subarray(7, 7 + 128)
    expect(hex(wired.writeFrames(WriteCommand.Profile, profile)[0]!)).toBe(event.bytes)
  }
})

test('GOLDEN: re-encoding each captured cable write from its predecessor reproduces it byte-for-byte', () => {
  const profiles = wiredWrites.map((e) => bytesOf(e).subarray(7, 7 + 128))
  let previous = profiles[0]!
  for (const next of profiles.slice(1)) {
    expect([...applyLighting(previous, decodeLighting(next), K1)]).toEqual([...next])
    previous = next
  }
})

test('a cable write with the wrong payload size is refused before it becomes a frame', () => {
  expect(() => new WiredDialect().writeFrames(WriteCommand.Profile, new Uint8Array(127))).toThrow(/expected 128/)
})

test('setLighting over the cable: one write, then a read-back that confirms it', async () => {
  const transport = new MockTransport(WIRED_WRITES)
  const kb = await K916.connect(transport)
  const before = await kb.readProfileRaw()

  const result = await kb.setLighting({ brightness: 3 })

  expect(result.brightness).toBe(3)
  expect(transport.writes).toHaveLength(1)
  const changed = [...transport.writtenProfile!].map((b, i) => (b !== before[i] ? i : -1)).filter((i) => i >= 0)
  expect(changed).toHaveLength(1)
})

test('a cable write whose header was never captured is refused by the simulator', async () => {
  const transport = new MockTransport(WIRED_WRITES)
  const frame = new Uint8Array(519)
  frame.set([0x05, 0x00, 0x00, 0x01, 0x00, 0x80, 0x00])   // opcode 0x05 was never a cable write

  await expect(transport.sendFeatureReport(6, frame)).rejects.toThrow(/unexpected frame/)
})

// ---- device: the brightness change, end to end on the simulator -----------------------------------

test('setLighting reads, applies, writes ten acked packets, reads back, and returns what the keyboard holds', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)

  const result = await kb.setLighting({ brightness: 3 })

  expect(result).toMatchObject({ effect: 'Windmill', brightness: 3, speed: 0 })
  expect(transport.writes).toHaveLength(10)
  expect(decodeLighting(transport.writtenProfile!).brightness).toBe(3)
})

test('a brightness change writes the same profile the keyboard reported with exactly one byte different', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)
  const before = await kb.readProfileRaw()

  await kb.setLighting({ brightness: 4 })

  const after = transport.writtenProfile!
  const changed = [...after].map((b, i) => (b !== before[i] ? i : -1)).filter((i) => i >= 0)
  expect(changed).toEqual([86])   // Windmill's pair, brightness byte
})

test('a brightness beyond the model stages is refused before any frame is built — 20 reset the keyboard', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)

  await expect(kb.setLighting({ brightness: 20 })).rejects.toThrow(/brightness must be an integer 0\.\.4/)
  expect(transport.writes).toHaveLength(0)
})

test('writeProfile restores a captured backup verbatim — the escape hatch', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)
  const backup = await kb.readProfileRaw()

  await kb.setLighting({ effectId: 1, brightness: 4 })
  expect(decodeLighting(transport.writtenProfile!).effect).toBe('Always On')

  await kb.writeProfile(backup)
  expect([...transport.writtenProfile!]).toEqual([...backup])
  expect((await kb.readLighting()).effect).toBe('Windmill')
})

test('a write packet with a corrupted checksum is refused by the simulator', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const frame = new WirelessDialect().writeFrames(WriteCommand.Profile, new Uint8Array(128))[0]!
  frame[18] ^= 0xff

  await expect(transport.sendOutputReport(0x13, frame)).rejects.toThrow(/bad checksum/)
})

test('a write frame whose shape was never captured is still refused', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const frame = new Uint8Array(19)
  frame.set([0x07, 0x0a, 0x00, 0x0e])   // opcode 0x07 was never observed as a write

  await expect(transport.sendOutputReport(0x13, frame)).rejects.toThrow(/unexpected frame/)
})

test('a write whose echoes never come is re-sent as a burst, then given up on naming every packet', async () => {
  // A transport that accepts sends but never acknowledges anything.
  const silent = new MockTransport(CAPTURE, DONGLE)
  const original = silent.sendOutputReport.bind(silent)
  let sends = 0
  silent.sendOutputReport = async (reportId, data) => {
    if (data[0] === 0x04) { sends++; return }          // swallow write packets: no echo
    return original(reportId, data)
  }
  const kb = await K916.connect(silent, { ...FAST, maxAttempts: 3 })

  await expect(kb.setLighting({ brightness: 2 })).rejects.toThrow(/packet\(s\) 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 not acknowledged after 3 attempt/)
  expect(sends).toBe(30)   // 3 bursts of 10, pipelined — not 3 × 10 sequential waits
})

test('only the packets whose echo was lost are re-sent', async () => {
  // Drop the echo of packet 4 on the first burst only.
  const lossy = new MockTransport(CAPTURE, DONGLE)
  const original = lossy.sendOutputReport.bind(lossy)
  let firstBurst = true
  const sent: number[] = []
  lossy.sendOutputReport = async (reportId, data) => {
    if (data[0] !== 0x04) return original(reportId, data)
    sent.push(data[2]!)
    const swallow = firstBurst && data[2] === 4   // no echo, and the simulator never sees it
    if (data[2] === 9) firstBurst = false          // the first burst ends with packet 9
    if (swallow) return
    return original(reportId, data)
  }
  const kb = await K916.connect(lossy, FAST)

  await expect(kb.setLighting({ brightness: 2 })).resolves.toMatchObject({ brightness: 2 })
  expect(sent).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 4])   // one full burst, then just packet 4
})

// ---- spam protection ---------------------------------------------------------------------------

test('a write requested while another is in flight is refused at once, not queued', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)

  const first = kb.setLighting({ brightness: 3 })
  expect(kb.busy).toBe(true)
  const spam = [kb.setLighting({ brightness: 1 }), kb.setEffectColour({ r: 1, g: 2, b: 3 }, 1), kb.writeProfile(new Uint8Array(128))]

  for (const attempt of spam) await expect(attempt).rejects.toBeInstanceOf(KeyboardBusyError)
  await expect(first).resolves.toMatchObject({ brightness: 3 })
  expect(kb.busy).toBe(false)

  // Exactly one write happened; the spam sent nothing.
  expect(transport.writes.filter((w) => w[0] === 0x04)).toHaveLength(10)
  expect(decodeLighting(transport.writtenProfile!).brightness).toBe(3)
})

test('the click after the current operation answers goes through', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)

  await kb.setLighting({ brightness: 3 })
  await expect(kb.setLighting({ brightness: 1 })).resolves.toMatchObject({ brightness: 1 })
})

test('reads queue behind an operation in flight, in order', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)
  const order: string[] = []

  const write = kb.setLighting({ brightness: 3 }).then(() => order.push('write'))
  const read = kb.readLighting().then((l) => order.push(`read:${l.brightness}`))
  await Promise.all([write, read])

  expect(order).toEqual(['write', 'read:3'])
})

test('the read queue is capped so nothing can grow without bound', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)

  const attempts = Array.from({ length: 12 }, () => kb.readLighting())
  const outcomes = await Promise.allSettled(attempts)
  const refused = outcomes.filter((o) => o.status === 'rejected' && /too many operations pending/.test(String(o.reason)))
  expect(refused.length).toBeGreaterThan(0)
  expect(outcomes.filter((o) => o.status === 'fulfilled').length).toBe(12 - refused.length)
})

test('a refused write does not disturb the operation in flight', async () => {
  const transport = new MockTransport(CAPTURE, DONGLE)
  const kb = await K916.connect(transport, FAST)

  const inFlight = kb.setLighting({ brightness: 2 })
  await expect(kb.setLighting({ brightness: 20 })).rejects.toBeInstanceOf(KeyboardBusyError)   // busy wins over range
  await expect(inFlight).resolves.toMatchObject({ brightness: 2 })
})

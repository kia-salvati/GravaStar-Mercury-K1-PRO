import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { applySleep, decodeSleep } from '../src/codec/sleep.js'
import { K916 } from '../src/device.js'
import { MockTransport } from '../src/transport/mock.js'
import { bytesOf, parseCapture } from '../src/transport/transport.js'

const DONGLE_COLOUR = readFileSync('test/fixtures/session-7-dongle-colour.jsonl', 'utf8')

/** Every complete profile the vendor wrote in the session, in order. */
function writtenProfiles(): Uint8Array[] {
  const profiles: Uint8Array[] = []
  let current: { bytes: Uint8Array; seen: Set<number> } | undefined
  for (const event of parseCapture(DONGLE_COLOUR)) {
    if (event.dir !== 'out:output' || !event.bytes.startsWith('04 0a')) continue
    const bytes = bytesOf(event)
    if (bytes[2] === 0) current = { bytes: new Uint8Array(128), seen: new Set() }
    if (!current) continue
    current.bytes.set(bytes.subarray(4, 4 + (bytes[3]! & 0x0f)), bytes[2]! * 14)
    current.seen.add(bytes[2]!)
    if (current.seen.size === 10) profiles.push(current.bytes)
  }
  return profiles
}

test('the captured session moved byte 24 through 1 min → 4 → 9.5 → off → 9.5', () => {
  const values = [...new Set(writtenProfiles().map((p) => p[24]))]
  expect(values).toEqual([0x02, 0x08, 0x13, 0x00])
  expect(decodeSleep(writtenProfiles()[0]!)).toEqual({ enabled: true, minutes: 1 })
})

test('decodes half-minutes and the off state', () => {
  const profile = new Uint8Array(128)
  profile[24] = 0x13
  expect(decodeSleep(profile)).toEqual({ enabled: true, minutes: 9.5 })
  profile[24] = 0
  expect(decodeSleep(profile)).toEqual({ enabled: false, minutes: 0 })
})

test('applySleep touches only byte 24 and round-trips', () => {
  const profile = writtenProfiles()[0]!
  const out = applySleep(profile, 9.5)
  const changed = [...out].map((b, i) => (b !== profile[i] ? i : -1)).filter((i) => i >= 0)
  expect(changed).toEqual([24])
  expect(decodeSleep(out)).toEqual({ enabled: true, minutes: 9.5 })
  expect(decodeSleep(applySleep(profile, null))).toEqual({ enabled: false, minutes: 0 })
})

test('refuses values outside the vendor range or off the half-minute grid', () => {
  const profile = new Uint8Array(128)
  expect(() => applySleep(profile, 0.25)).toThrow(/half-minute/)
  expect(() => applySleep(profile, 20.5)).toThrow(/half-minute/)
  expect(() => applySleep(profile, 0)).toThrow(/half-minute/)
})

test('setSleepTimer over the dongle writes and reads back', async () => {
  const transport = new MockTransport(DONGLE_COLOUR, { vendorId: 0x3554, productId: 0xfa09 })
  const kb = await K916.connect(transport, { burstIdleMs: 5, ackTimeoutMs: 5, timeoutMs: 20, writeSettleMs: 0, allowWirelessWrites: true })

  await expect(kb.setSleepTimer(9.5)).resolves.toEqual({ enabled: true, minutes: 9.5 })
  await expect(kb.setSleepTimer(null)).resolves.toEqual({ enabled: false, minutes: 0 })
  expect(transport.writtenProfile![24]).toBe(0)
})

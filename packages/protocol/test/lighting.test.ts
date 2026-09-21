import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { applyLighting, decodeLighting, EFFECTS, effectById } from '../src/codec/lighting.js'
import { K916 } from '../src/device.js'
import { modelForUuid, K1_PRO_UUID } from '../src/models.js'
import { MockTransport } from '../src/transport/mock.js'
import { bytesOf, parseCapture } from '../src/transport/transport.js'

const DONGLE = { vendorId: 0x3554, productId: 0xfa09 }
const FAST = { burstIdleMs: 5 }
const CONNECT = readFileSync('test/fixtures/session-1-connect.jsonl', 'utf8')

/**
 * Rebuilds every 128-byte profile the vendor wrote under a label, in order. A write that never
 * reached its last packet (the link is lossy) is returned incomplete; callers check the trailer.
 */
function writtenProfiles(file: string, label: string): Uint8Array[] {
  const events = parseCapture(readFileSync(file, 'utf8')).filter((e) => e.label === label && e.dir === 'out:output' && e.bytes.startsWith('04 0a'))
  const profiles: Uint8Array[] = []
  for (const event of events) {
    const bytes = bytesOf(event)
    if (bytes[2] === 0) profiles.push(new Uint8Array(128))
    const length = bytes[3]! & 0x0f
    profiles[profiles.length - 1]?.set(bytes.subarray(4, 4 + length), bytes[2]! * 14)
  }
  return profiles
}

const isComplete = (profile: Uint8Array) => profile[126] === 0x5a && profile[127] === 0xa5

// ---- table ------------------------------------------------------------------------------------

test('the effect ids the capture anchored on resolve to the right names', () => {
  expect(effectById(1)?.name).toBe('Always On')
  expect(effectById(15)?.name).toBe('Windmill')
  expect(effectById(16)?.name).toBe('Waterfall')
})

test('mixed-colour effects are flagged, which is why the vendor UI ignores colour for Windmill', () => {
  expect(effectById(15)?.colourMode).toBe('mixed')
  expect(effectById(1)?.colourMode).toBe('single')
  expect(effectById(277)?.colourMode).toBe('perKey')
})

test('every effect the K1 PRO exposes exists in the family table', () => {
  const { effectIds } = modelForUuid(K1_PRO_UUID)!.capabilities
  expect(effectIds).toHaveLength(13)
  for (const id of effectIds) expect(effectById(id), `id ${id}`).toBeDefined()
})

test('effect ids are unique', () => {
  expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(EFFECTS.length)
})

// ---- decoding against real profiles -------------------------------------------------------------

test('reads the lighting state the vendor UI showed at connect: Windmill, speed 0, brightness 1', async () => {
  const kb = await K916.connect(new MockTransport(CONNECT, DONGLE), FAST)
  const lighting = await kb.readLighting()

  expect(lighting).toEqual({
    effectId: 15,
    effect: 'Windmill',
    colourMode: 'mixed',
    brightness: 1,
    speed: 0,
    mixing: true,
  })
})

test('after switching to Always On the vendor wrote effect 1 at brightness 4', () => {
  const [profile] = writtenProfiles('test/fixtures/session-2-lighting.jsonl', 'effect-always-on')
  const lighting = decodeLighting(profile!)

  expect(lighting.effect).toBe('Always On')
  expect(lighting.brightness).toBe(4)
})

test('the slider session walks Always On → Windmill → Waterfall → Windmill', () => {
  const effects = writtenProfiles('test/fixtures/session-3-sliders.jsonl', 'effect-always-on')
    .filter(isComplete)
    .map((profile) => decodeLighting(profile).effect)

  expect(effects[0]).toBe('Always On')
  expect(effects.at(-1)).toBe('Windmill')
  expect(effects).toContain('Waterfall')
})

test('brightness and speed stay within the model stages across every complete captured write', () => {
  const { lighting: range } = modelForUuid(K1_PRO_UUID)!.capabilities
  const profiles = writtenProfiles('test/fixtures/session-3-sliders.jsonl', 'effect-always-on').filter(isComplete)

  expect(profiles.length).toBeGreaterThan(3)
  for (const profile of profiles) {
    const state = decodeLighting(profile)
    expect(state.brightness).toBeGreaterThanOrEqual(1)
    expect(state.brightness).toBeLessThanOrEqual(range.brightnessStages)
    expect(state.speed).toBeLessThanOrEqual(range.speedStages)
  }
})

// ---- encoding: the inverse of decoding, proven against what the vendor actually wrote ----------

const connectProfile = (() => {
  const events = parseCapture(CONNECT).filter((e) => e.dir === 'in:input' && e.bytes.startsWith('44 0a'))
  const profile = new Uint8Array(128)
  for (const event of events) {
    const bytes = bytesOf(event)
    profile.set(bytes.subarray(4, 4 + (bytes[3]! & 0x0f)), bytes[2]! * 14)
  }
  return profile
})()

/** The K1 PRO's declared stages — the only range a write may use. */
const K1 = modelForUuid(K1_PRO_UUID)!.capabilities.lighting

test('applying no change returns a byte-identical copy — undecoded bytes are never touched', () => {
  const out = applyLighting(connectProfile, {}, K1)
  expect(out).not.toBe(connectProfile)
  expect([...out]).toEqual([...connectProfile])
})

test('applying the decoded state back is the identity', () => {
  const state = decodeLighting(connectProfile)
  expect([...applyLighting(connectProfile, state, K1)]).toEqual([...connectProfile])
})

test('decode(apply(x)) round-trips every field', () => {
  const change = { effectId: 11, brightness: 3, speed: 2, mixing: false }
  expect(decodeLighting(applyLighting(connectProfile, change, K1))).toMatchObject({ ...change, effect: 'Wave' })
})

test('mixing writes nibble 7, mono writes 0, and an unset mixing leaves the nibble alone', () => {
  expect(applyLighting(connectProfile, { mixing: true }, K1)[87]! & 0x0f).toBe(7)
  expect(applyLighting(connectProfile, { mixing: false }, K1)[87]! & 0x0f).toBe(0)
  const odd = Uint8Array.from(connectProfile)
  odd[87] = (odd[87]! & 0xf0) | 0x3   // a nibble never observed
  expect(applyLighting(odd, { brightness: 2 }, K1)[87]! & 0x0f).toBe(3)
})

test('a brightness change touches exactly one byte', () => {
  const out = applyLighting(connectProfile, { brightness: 3 }, K1)
  const changed = [...out].map((b, i) => (b !== connectProfile[i] ? i : -1)).filter((i) => i >= 0)
  expect(changed).toEqual([56 + 2 * 15])   // Windmill's pair, first byte
  expect(out[56 + 2 * 15]).toBe(3)
})

test('GOLDEN: re-encoding each captured vendor write from its predecessor reproduces it byte-for-byte', () => {
  const written = writtenProfiles('test/fixtures/session-3-sliders.jsonl', 'effect-always-on').filter(isComplete)
  expect(written.length).toBeGreaterThan(3)

  let previous = written[0]!
  for (const next of written.slice(1)) {
    const reproduced = applyLighting(previous, decodeLighting(next), K1)
    expect([...reproduced], `write #${written.indexOf(next)}`).toEqual([...next])
    previous = next
  }
})

test('values outside the model stages are refused before they can reach a profile', () => {
  // Hardware-tested: brightness 20 reset the keyboard, 5..12 rendered as 4. Never again.
  expect(() => applyLighting(connectProfile, { brightness: 20 }, K1)).toThrow(/brightness must be an integer 0\.\.4/)
  expect(() => applyLighting(connectProfile, { brightness: 5 }, K1)).toThrow(/brightness/)
  expect(() => applyLighting(connectProfile, { brightness: -1 }, K1)).toThrow(/brightness/)
  expect(() => applyLighting(connectProfile, { brightness: 2.5 }, K1)).toThrow(/brightness/)
  expect(() => applyLighting(connectProfile, { speed: 5 }, K1)).toThrow(/speed must be an integer 0\.\.4/)
  expect(() => applyLighting(connectProfile, { effectId: 99 }, K1)).toThrow(/unknown effect/)
})

test('the full declared range is accepted: brightness 0..4, speed 0..4', () => {
  for (let b = 0; b <= 4; b++) expect(decodeLighting(applyLighting(connectProfile, { brightness: b }, K1)).brightness).toBe(b)
  for (let s = 0; s <= 4; s++) expect(decodeLighting(applyLighting(connectProfile, { speed: s }, K1)).speed).toBe(s)
})

test('switching to Off writes the id and leaves every pair alone', () => {
  const out = applyLighting(connectProfile, { effectId: 0 }, K1)
  expect(out[9]).toBe(0)
  expect(out[10]).toBe(0)
  expect([...out.subarray(56)]).toEqual([...connectProfile.subarray(56)])
})

test('a short buffer is rejected rather than misread', () => {
  expect(() => decodeLighting(new Uint8Array(64))).toThrow(/128/)
})

test('an unknown effect id decodes to a visible placeholder', () => {
  const profile = new Uint8Array(128)
  profile[10] = 18
  expect(decodeLighting(profile).effect).toBe('Effect(18)')
})

test('the effect id is 16-bit, so Custom (277 = 01 15) decodes correctly', () => {
  const profile = new Uint8Array(128)
  profile[9] = 0x01
  profile[10] = 0x15
  const state = decodeLighting(profile)
  expect(state.effectId).toBe(277)
  expect(state.effect).toBe('Custom')
  expect(state.colourMode).toBe('perKey')
})

test('Off has no settings pair and decodes to zeros rather than reading a neighbour', () => {
  const profile = new Uint8Array(128)
  profile[56] = 0xff   // where a pair for id 0 would sit — deliberately garbage
  profile[57] = 0xff
  expect(decodeLighting(profile)).toMatchObject({ effect: 'Off', brightness: 0, speed: 0 })
})

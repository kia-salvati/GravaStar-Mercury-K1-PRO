import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { K916, MockTransport, toHex } from 'k916'
import { expect, test } from 'vitest'
import { backupOf, deserialise, hexToBytes, nextPresetName, readoutOf, serialise, snapshotOf, validatePreset, type Preset } from './presets'

const CABLE_CAPTURE = readFileSync(resolve(__dirname, '../../../../packages/protocol/test/fixtures/session-6-colour.jsonl'), 'utf8')
const UUID = '0x030000000197'

const presetFrom = async (): Promise<Preset> => {
  const kb = await K916.connect(new MockTransport(CABLE_CAPTURE), { burstIdleMs: 5 })
  const backup = await kb.backup()
  return { id: 'p1', name: 'Preset 1', savedAt: '2026-09-21T12:00:00.000Z', keyboardUuid: UUID, snapshot: snapshotOf(backup), readout: readoutOf(backup) }
}

test('hex round-trips through k916 toHex and back, byte for byte', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
  expect(hexToBytes(toHex(bytes))).toEqual(bytes)
  expect(hexToBytes('')).toEqual(new Uint8Array(0))
  expect(() => hexToBytes('zz 00')).toThrow(RangeError)
})

test('a snapshot round-trips to the same three blocks', async () => {
  const kb = await K916.connect(new MockTransport(CABLE_CAPTURE), { burstIdleMs: 5 })
  const backup = await kb.backup()

  expect(backupOf(snapshotOf(backup))).toEqual(backup)
})

test('the readout is decoded from the snapshot itself: session 6 was on Wave with mixing on, so no colour', async () => {
  const { readout } = await presetFrom()

  expect(readout).toMatchObject({ effect: 'Wave', effectId: 11, colourMode: 'single', mixing: true, colourHex: null })
})

test('a presets file survives serialise → deserialise unchanged', async () => {
  const preset = await presetFrom()
  const file = { version: 1 as const, keyboardUuid: UUID, presets: [preset] }

  expect(deserialise(serialise(file), UUID)).toEqual({ ok: true, file })
})

test('validation refuses another board, another version, malformed json and a block of the wrong size', async () => {
  const preset = await presetFrom()
  const file = { version: 1, keyboardUuid: UUID, presets: [preset] }

  expect(deserialise(JSON.stringify(file), '0x0300000000ff')).toEqual({ ok: false, reason: 'foreign-keyboard' })
  expect(deserialise(JSON.stringify({ ...file, version: 2 }), UUID)).toEqual({ ok: false, reason: 'wrong-version' })
  expect(deserialise('{not json', UUID)).toEqual({ ok: false, reason: 'invalid-json' })
  const shortProfile = { ...preset, snapshot: { ...preset.snapshot, profileHex: preset.snapshot.profileHex.slice(3) } }
  expect(deserialise(JSON.stringify({ ...file, presets: [shortProfile] }), UUID)).toEqual({ ok: false, reason: 'invalid-preset' })
  expect(validatePreset({ ...preset, keyboardUuid: 'other' }, UUID)).toBeNull()
  expect(validatePreset(preset, UUID)).toEqual(preset)
})

test('the light-colour block may be the cable length or the dongle packet length, nothing else', async () => {
  const preset = await presetFrom()
  const asDongle = { ...preset, snapshot: { ...preset.snapshot, lightColourHex: preset.snapshot.lightColourHex + ' 00'.repeat(7) } }
  const tooLong = { ...preset, snapshot: { ...preset.snapshot, lightColourHex: preset.snapshot.lightColourHex + ' 00' } }

  expect(validatePreset(asDongle, UUID)).not.toBeNull()
  expect(validatePreset(tooLong, UUID)).toBeNull()
})

test('the default name is one above the highest in use, so deleting a low number does not reuse it', () => {
  const named = (...names: string[]) => names.map((name) => ({ name }))

  expect(nextPresetName([])).toBe('Preset 1')
  expect(nextPresetName(named('Preset 1', 'Preset 2', 'Preset 3'))).toBe('Preset 4')
  expect(nextPresetName(named('Preset 1', 'Preset 3'))).toBe('Preset 4')
  expect(nextPresetName(named('Gaming', 'Preset 7', 'Preset 12 copy'))).toBe('Preset 8')
})

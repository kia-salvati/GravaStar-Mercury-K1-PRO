import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { K916, MockTransport } from 'k916'
import { expect, test } from 'vitest'
import { colourLabel, lookOfKeyboard, lookOfPreset, looksEqual, type Look } from './look'
import { readoutOf, snapshotOf, type Preset } from './presets'

const DONGLE_CUSTOM = readFileSync(resolve(__dirname, '../../../../packages/protocol/test/fixtures/session-7-dongle-colour.jsonl'), 'utf8')
const wave: Look = { effect: 'Wave', brightness: 2, speed: 3, mixing: false, colourMode: 'single', colourHex: '#3ee0e8', keys: null }

test('the keyboard look carries the single colour only when the effect uses one and mixing is off', () => {
  const lighting = { effectId: 11, effect: 'Wave', colourMode: 'single' as const, brightness: 2, speed: 3, mixing: false }
  expect(lookOfKeyboard({ lighting, effectColour: { r: 0x3e, g: 0xe0, b: 0xe8 } })).toEqual(wave)
  expect(lookOfKeyboard({ lighting: { ...lighting, mixing: true }, effectColour: { r: 0x3e, g: 0xe0, b: 0xe8 } }).colourHex).toBeNull()
})

test('a Custom preset decodes its 126 per-key colours from the snapshot', async () => {
  const kb = await K916.connect(new MockTransport(DONGLE_CUSTOM, { vendorId: 0x3554, productId: 0xfa09 }), { burstIdleMs: 5 })
  const backup = await kb.backup()
  const preset: Preset = { id: 'p', name: 'Gaming', savedAt: '2026-09-21T00:00:00.000Z', keyboardUuid: kb.info.uuid, snapshot: snapshotOf(backup), readout: readoutOf(backup) }

  const look = lookOfPreset(preset)
  expect(look).toMatchObject({ effect: 'Custom', colourMode: 'perKey', colourHex: null })
  expect(look.keys).toHaveLength(126)
  expect(look.keys?.every((hex) => /^#[0-9a-f]{6}$/.test(hex))).toBe(true)
}, 10000)

test('looks match on effect, stages, mixing and colour; unknown per-key colours never match known ones', () => {
  expect(looksEqual(wave, { ...wave })).toBe(true)
  expect(looksEqual(wave, { ...wave, speed: 1 })).toBe(false)
  expect(looksEqual(wave, { ...wave, colourHex: '#000000' })).toBe(false)
  const custom: Look = { ...wave, effect: 'Custom', colourMode: 'perKey', colourHex: null, keys: Array(126).fill('#ff0000') }
  expect(looksEqual(custom, { ...custom, keys: null })).toBe(false)
  expect(looksEqual(custom, { ...custom, keys: [...custom.keys!] })).toBe(true)
})

test('the colour label names what a swatch cannot show', () => {
  expect(colourLabel(wave)).toBe('#3ee0e8')
  expect(colourLabel({ ...wave, colourHex: null })).toBe('Colour not read')
  expect(colourLabel({ ...wave, mixing: true })).toBe('Mixed colours — set by the effect')
  expect(colourLabel({ ...wave, effect: 'Windmill', colourMode: 'mixed', mixing: true, colourHex: null })).toBe('Mixed colours — set by the effect')
  expect(colourLabel({ ...wave, effect: 'Custom', colourMode: 'perKey', colourHex: null })).toBe('Per-key RGB · 126 keys')
  expect(colourLabel({ ...wave, effect: 'Off', colourMode: 'none', colourHex: null })).toBe('Lighting is off')
})

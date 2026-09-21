import type { Capabilities } from 'k916'
import type { Keyboard } from '../types/keyboard'
import { PRESETS_FILE_VERSION, serialise, storageKey, type Preset, type PresetReadout } from '../utils/presets'

export const UUID = '0x030000000197'

const K1_PRO: Capabilities = {
  layers: 3, slots: 126, keyCount: 84, macroBytes: 512, hasScreen: false, battery: 'wireless',
  lighting: { speedStages: 4, speedStep: 1, brightnessStages: 4, brightnessStep: 1 },
  effectIds: [0, 277, 1, 3, 4, 7, 8, 11, 12, 13, 15, 16, 17],
}

const hexOf = (bytes: number) => Array.from({ length: bytes }, () => '00').join(' ')
/** Blocks of the right size; the light-colour block carries blue at effect 1 (offset 18 + 3). */
const snapshot = () => {
  const light = Array.from({ length: 483 }, () => '00')
  light[21] = '00'
  light[22] = '00'
  light[23] = 'ff'
  return { profileHex: hexOf(128), lightColourHex: light.join(' '), customColourHex: hexOf(378) }
}

export const readout = (partial: Partial<PresetReadout> = {}): PresetReadout => ({ effect: 'Always On', effectId: 1, brightness: 4, speed: 0, mixing: false, colourMode: 'single', colourHex: '#0000ff', ...partial })

export const preset = (id: string, name: string, partial: Partial<PresetReadout> = {}): Preset => ({ id, name, savedAt: '2026-09-21T12:00:00.000Z', keyboardUuid: UUID, snapshot: snapshot(), readout: readout(partial) })

export const seedPresets = (presets: Preset[]): void => localStorage.setItem(storageKey(UUID), serialise({ version: PRESETS_FILE_VERSION, keyboardUuid: UUID, presets }))

/** A connected keyboard on Always On, blue, brightness 4 — the same look as `preset()`'s default readout. */
export const connectedKeyboard = (partial: Partial<Keyboard & { status: 'connected' }> = {}): Keyboard => ({
  status: 'connected',
  busy: false,
  info: { uuid: UUID, productName: 'GravaStar Mercury K1 PRO', firmwareVersion: '0x1707', connection: 'wired' },
  capabilities: K1_PRO,
  reportsBattery: false,
  canWrite: true,
  power: null,
  lighting: { effectId: 1, effect: 'Always On', colourMode: 'single', brightness: 4, speed: 0, mixing: false },
  effectColour: { r: 0, g: 0, b: 255 },
  sleepTimer: null,
  notice: null,
  connect: async () => {},
  refresh: async () => {},
  setLighting: async () => {},
  setEffectColour: async () => {},
  setKeyColour: async () => undefined,
  setSleepTimer: async () => {},
  backup: async () => undefined,
  restore: async () => false,
  ...partial,
})

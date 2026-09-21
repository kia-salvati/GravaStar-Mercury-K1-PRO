import { CUSTOM_COLOUR_BYTES, decodeLighting, effectColour, LIGHT_COLOUR_READ_BYTES, PROFILE_BYTES, toHex, toHexColour, type Backup, type ColourMode } from 'k916'

export const PRESET_LIMIT = 10
export const PRESETS_FILE_VERSION = 1

export interface PresetSnapshot {
  profileHex: string
  lightColourHex: string
  customColourHex: string
}

/** Decoded when the preset is saved, so a card can describe it without applying it. */
export interface PresetReadout {
  effect: string
  effectId: number
  brightness: number
  speed: number
  mixing: boolean
  colourMode: ColourMode
  colourHex: string | null
}

export interface Preset {
  id: string
  name: string
  /** ISO timestamp */
  savedAt: string
  /** `kb.info.uuid`: a preset is never offered to another board. */
  keyboardUuid: string
  snapshot: PresetSnapshot
  readout: PresetReadout
}

export interface PresetsFile {
  version: typeof PRESETS_FILE_VERSION
  keyboardUuid: string
  presets: Preset[]
}

export type PresetsFileFailure = 'invalid-json' | 'wrong-version' | 'foreign-keyboard' | 'invalid-preset'
export type DeserialiseResult = { ok: true; file: PresetsFile } | { ok: false; reason: PresetsFileFailure }

export const storageKey = (keyboardUuid: string): string => `k1.presets.${keyboardUuid}`

/** Inverse of k916's `toHex` ("1a 2b …"). */
export function hexToBytes(hex: string): Uint8Array {
  const trimmed = hex.trim()
  if (trimmed === '') return new Uint8Array(0)
  const pairs = trimmed.split(' ')
  if (pairs.some((pair) => !/^[0-9a-f]{2}$/i.test(pair))) throw new RangeError('not a space-separated hex string')
  return Uint8Array.from(pairs, (pair) => parseInt(pair, 16))
}

const WIRELESS_CHUNK_BYTES = 14
/** The dongle returns the light-colour block as whole packets, so it is 490 bytes there and 483 on cable. */
const LIGHT_COLOUR_PACKET_BYTES = Math.ceil(LIGHT_COLOUR_READ_BYTES / WIRELESS_CHUNK_BYTES) * WIRELESS_CHUNK_BYTES
const BLOCK_BYTES: Record<keyof PresetSnapshot, readonly number[]> = {
  profileHex: [PROFILE_BYTES],
  lightColourHex: [LIGHT_COLOUR_READ_BYTES, LIGHT_COLOUR_PACKET_BYTES],
  customColourHex: [CUSTOM_COLOUR_BYTES],
}

export function snapshotOf(backup: Backup): PresetSnapshot {
  return { profileHex: toHex(backup.profile), lightColourHex: toHex(backup.lightColour), customColourHex: toHex(backup.customColour) }
}

export function backupOf(snapshot: PresetSnapshot): Backup {
  return { profile: hexToBytes(snapshot.profileHex), lightColour: hexToBytes(snapshot.lightColourHex), customColour: hexToBytes(snapshot.customColourHex) }
}

/** What the backup holds, decoded by the same codecs the Device screen uses. Custom has no colour slot. */
export function readoutOf(backup: Backup): PresetReadout {
  const { effectId, effect, colourMode, brightness, speed, mixing } = decodeLighting(backup.profile)
  const colourHex = colourMode === 'single' && !mixing ? toHexColour(effectColour(backup.lightColour, effectId)) : null
  return { effect, effectId, brightness, speed, mixing, colourMode, colourHex }
}

const DEFAULT_NAME = /^Preset (\d+)$/

/** "Preset N", one above the highest N in use — so a deleted number is not reused while a higher one exists. */
export function nextPresetName(presets: readonly Pick<Preset, 'name'>[]): string {
  const highest = presets.reduce((max, { name }) => {
    const match = DEFAULT_NAME.exec(name)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `Preset ${highest + 1}`
}

export function serialise(file: PresetsFile): string {
  return JSON.stringify(file, null, 2)
}

export function deserialise(json: string, keyboardUuid: string): DeserialiseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'invalid-json' }
  if (parsed.version !== PRESETS_FILE_VERSION) return { ok: false, reason: 'wrong-version' }
  if (parsed.keyboardUuid !== keyboardUuid) return { ok: false, reason: 'foreign-keyboard' }
  if (!Array.isArray(parsed.presets)) return { ok: false, reason: 'invalid-preset' }
  const presets: Preset[] = []
  for (const entry of parsed.presets) {
    const preset = validatePreset(entry, keyboardUuid)
    if (!preset) return { ok: false, reason: 'invalid-preset' }
    presets.push(preset)
  }
  return { ok: true, file: { version: PRESETS_FILE_VERSION, keyboardUuid, presets } }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const COLOUR_MODES: readonly ColourMode[] = ['none', 'single', 'perKey', 'mixed']

const hexHasBytes = (value: unknown, lengths: readonly number[]): value is string => {
  if (!isString(value)) return false
  try {
    return lengths.includes(hexToBytes(value).length)
  } catch {
    return false
  }
}

/** A preset exactly as stored, or null if any field is missing, mistyped, the wrong size or another board's. */
export function validatePreset(value: unknown, keyboardUuid: string): Preset | null {
  if (!isRecord(value) || !isRecord(value.snapshot) || !isRecord(value.readout)) return null
  const { id, name, savedAt, snapshot, readout } = value
  if (!isString(id) || !isString(name) || !isString(savedAt) || value.keyboardUuid !== keyboardUuid) return null
  for (const block of Object.keys(BLOCK_BYTES) as (keyof PresetSnapshot)[]) {
    if (!hexHasBytes(snapshot[block], BLOCK_BYTES[block])) return null
  }
  const { effect, effectId, brightness, speed, mixing, colourMode, colourHex } = readout
  if (!isString(effect) || !isNumber(effectId) || !isNumber(brightness) || !isNumber(speed) || typeof mixing !== 'boolean') return null
  if (!COLOUR_MODES.some((mode) => mode === colourMode) || !(colourHex === null || isString(colourHex))) return null
  return {
    id,
    name,
    savedAt,
    keyboardUuid,
    snapshot: { profileHex: snapshot.profileHex as string, lightColourHex: snapshot.lightColourHex as string, customColourHex: snapshot.customColourHex as string },
    readout: { effect, effectId, brightness, speed, mixing, colourMode: colourMode as ColourMode, colourHex: colourHex as string | null },
  }
}

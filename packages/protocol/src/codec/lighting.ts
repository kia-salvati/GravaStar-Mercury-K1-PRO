/**
 * Lighting state lives in the 128-byte profile block (wireless opcode 0x44). Layout established
 * by diffing successive profile writes while changing one setting at a time —
 * test/fixtures/session-2-lighting.jsonl and session-3-sliders.jsonl:
 *
 *   bytes 9..10         current effect id, 16-bit big-endian (Custom is 277 = 01 15)
 *   bytes 56 + 2*id     per-effect settings pair: [brightness, speed << 4 | mixing (7) or mono (0)]
 *                       no pair exists for Off (0), Custom (277) or id 19
 *   bytes 126..127      trailer 5a a5
 *
 * HARDWARE-TESTED on the K1 PRO, 2026-09-21: brightness 5..12 render identically to 4, and
 * brightness 20 RESET THE KEYBOARD. The vendor client's "reject above 20" is not the firmware's
 * range. Writes are therefore clamped to the model's declared stages and nothing else.
 *
 * Windmill (15) read as 01 07 = brightness 1, speed 0, mixing on — matching the vendor UI
 * (brightness 1, speed 0, and Windmill is a mixed-colour effect).
 * Always On (1) written as 04 — the vendor's per-effect default brightness.
 *
 * Brightness on the wire IS the stage; the vendor descriptor's brightnessStep does not apply here.
 */

export type ColourMode = 'none' | 'single' | 'perKey' | 'mixed'

export interface Effect {
  id: number
  name: string
  colourMode: ColourMode
}

/** The 916 family table from the vendor bundle. The K1 PRO exposes 13 of these; see models.ts. */
export const EFFECTS: readonly Effect[] = [
  { id: 0, name: 'Off', colourMode: 'none' },
  { id: 1, name: 'Always On', colourMode: 'single' },
  { id: 2, name: 'Breathing', colourMode: 'single' },
  { id: 3, name: 'Dream Rainbow', colourMode: 'mixed' },
  { id: 4, name: 'One Touch', colourMode: 'single' },
  { id: 5, name: 'Rain Walk', colourMode: 'single' },
  { id: 6, name: 'Color Wheel', colourMode: 'single' },
  { id: 7, name: 'Key Ripple', colourMode: 'single' },
  { id: 8, name: 'Stars', colourMode: 'single' },
  { id: 9, name: 'Snow Trace', colourMode: 'single' },
  { id: 10, name: 'Flowing', colourMode: 'single' },
  { id: 11, name: 'Wave', colourMode: 'single' },
  { id: 12, name: 'Shadow', colourMode: 'single' },
  { id: 13, name: 'Sine Wave', colourMode: 'single' },
  { id: 14, name: 'Sine Wave', colourMode: 'single' },
  { id: 15, name: 'Windmill', colourMode: 'mixed' },
  { id: 16, name: 'Waterfall', colourMode: 'mixed' },
  { id: 17, name: 'Blooming', colourMode: 'mixed' },
  { id: 277, name: 'Custom', colourMode: 'perKey' },
]

const EFFECT_BY_ID = new Map(EFFECTS.map((effect) => [effect.id, effect]))

export const PROFILE_BYTES = 128
const OFFSET_EFFECT_ID = 9
const PROFILE_TRAILER = [0x5a, 0xa5] as const

/**
 * A profile must be exactly 128 bytes and end in the trailer every captured profile ends in.
 * Anything else is a bad read and must never be the base of a write.
 */
export function assertProfileBlock(profile: Uint8Array): void {
  if (profile.length !== PROFILE_BYTES) {
    throw new Error(`profile is ${profile.length} bytes, expected ${PROFILE_BYTES}`)
  }
  if (profile[126] !== PROFILE_TRAILER[0] || profile[127] !== PROFILE_TRAILER[1]) {
    throw new Error(`profile trailer is ${profile[126]} ${profile[127]}, expected 5a a5 — refusing to trust this read`)
  }
}
const OFFSET_PAIRS = 56
const UNPAIRED_EFFECT_IDS = new Set([0, 19, 277])

export interface LightingState {
  effectId: number
  effect: string
  colourMode: ColourMode
  /** Stage index. On the K1 PRO 1..4. */
  brightness: number
  /** Stage index. On the K1 PRO 0..4. */
  speed: number
  /**
   * The vendor UI's "Color Mixing" toggle. The pair's low nibble: 7 = mixing, 0 = monochrome —
   * mixed-only effects carry 7 from the start, a fresh single-colour effect carries 0, and the
   * nibble flipped 0 → 7 exactly when the toggle was pressed. The single colour itself lives in
   * the light-colour block (codec/colour.ts), not here.
   */
  mixing: boolean
}

export function effectById(id: number): Effect | undefined {
  return EFFECT_BY_ID.get(id)
}

export type LightingChange = Partial<Pick<LightingState, 'effectId' | 'brightness' | 'speed' | 'mixing'>>

/** The limits a write may not exceed. Taken from the model's capabilities, never from the wire. */
export interface LightingLimits {
  brightnessStages: number
  speedStages: number
}

const NIBBLE_MIXING = 0x7
const NIBBLE_MONO = 0x0

/**
 * Returns a copy of `profile` with a lighting change applied. Only the bytes this module has
 * mapped are ever written; everything else passes through untouched, because most of the block is
 * still undecoded and a byte we do not understand is a byte we must not change.
 *
 * Every value is checked against `limits` first. An out-of-range brightness reset the keyboard
 * on hardware; a value the model does not declare is refused here, before any frame exists.
 */
export function applyLighting(profile: Uint8Array, change: LightingChange, limits: LightingLimits): Uint8Array {
  if (profile.length < PROFILE_BYTES) {
    throw new Error(`profile is ${profile.length} bytes, expected ${PROFILE_BYTES}`)
  }
  const current = decodeLighting(profile)
  const effectId = change.effectId ?? current.effectId
  if (!effectById(effectId)) throw new RangeError(`unknown effect id ${effectId}`)

  const next = Uint8Array.from(profile)
  next[OFFSET_EFFECT_ID] = effectId >> 8
  next[OFFSET_EFFECT_ID + 1] = effectId & 0xff
  if (UNPAIRED_EFFECT_IDS.has(effectId)) return next

  const offset = OFFSET_PAIRS + 2 * effectId
  const packed = next[offset + 1]!
  const brightness = change.brightness ?? next[offset]!
  const speed = change.speed ?? packed >> 4
  // Only 0 and 7 have been observed in the low nibble; an unknown value passes through unless
  // the caller explicitly sets the mode.
  const nibble = change.mixing === undefined ? packed & 0x0f : change.mixing ? NIBBLE_MIXING : NIBBLE_MONO
  assertRange('brightness', brightness, limits.brightnessStages)
  assertRange('speed', speed, limits.speedStages)

  next[offset] = brightness
  next[offset + 1] = (speed << 4) | nibble
  return next
}

function assertRange(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer 0..${max}, got ${value}`)
  }
}

export function decodeLighting(profile: Uint8Array): LightingState {
  if (profile.length < PROFILE_BYTES) {
    throw new Error(`profile is ${profile.length} bytes, expected ${PROFILE_BYTES}`)
  }
  const effectId = (profile[OFFSET_EFFECT_ID]! << 8) | profile[OFFSET_EFFECT_ID + 1]!
  const effect = effectById(effectId)

  if (UNPAIRED_EFFECT_IDS.has(effectId)) {
    return { effectId, effect: effect?.name ?? `Effect(${effectId})`, colourMode: effect?.colourMode ?? 'none', brightness: 0, speed: 0, mixing: false }
  }

  const offset = OFFSET_PAIRS + 2 * effectId
  const packed = profile[offset + 1]!
  return {
    effectId,
    effect: effect?.name ?? `Effect(${effectId})`,
    colourMode: effect?.colourMode ?? 'none',
    brightness: profile[offset]!,
    speed: packed >> 4,
    mixing: (packed & 0x0f) === NIBBLE_MIXING,
  }
}

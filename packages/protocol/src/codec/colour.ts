/**
 * Colours live in two blocks separate from the profile. Both layouts were established from
 * test/fixtures/session-6-colour.jsonl by changing one colour at a time and diffing the writes.
 *
 * Light-colour block (read wired 0x8a / wireless 0x49, write wired 0x0a):
 *   bytes 0..17          constant header, passed through
 *   bytes 18 + 3*id      RGB for effect `id` — the single colour an effect uses when not mixing
 *   read is 483 bytes; the vendor writes 512: the same 483, zero padding, trailer 5a a5 at 506..507
 *
 * Custom (per-key) block (read wired 0x86, write wired 0x06), 378 bytes, PLANAR:
 *   bytes   0..125       R for slots 0..125
 *   bytes 126..251       G
 *   bytes 252..377       B
 * Editing slot 35 changed bytes 35, 161 and 287 — that is the whole proof.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

export const LIGHT_COLOUR_READ_BYTES = 483
export const LIGHT_COLOUR_WRITE_BYTES = 512
const LIGHT_COLOUR_TRAILER_OFFSET = 506
const OFFSET_EFFECT_RGB = 18
/** Bytes 0..17 of every light-colour block ever captured, on both connections. */
const LIGHT_COLOUR_HEADER = [0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0xff, 0x00, 0xff] as const

export const CUSTOM_COLOUR_BYTES = 378
export const CUSTOM_SLOTS = 126

/**
 * Sanity checks a block must pass before it is used as the base of a write or written itself.
 * A read that fails these is a bad read — stale packets merged on the lossy link, a truncated
 * reply — and must never be written back.
 */
export function assertLightColourBlock(block: Uint8Array): void {
  if (block.length < LIGHT_COLOUR_READ_BYTES) {
    throw new Error(`light-colour block is ${block.length} bytes, expected at least ${LIGHT_COLOUR_READ_BYTES}`)
  }
  for (let i = 0; i < LIGHT_COLOUR_HEADER.length; i++) {
    if (block[i] !== LIGHT_COLOUR_HEADER[i]) {
      throw new Error(`light-colour block header byte ${i} is ${block[i]}, expected ${LIGHT_COLOUR_HEADER[i]} — refusing to trust this read`)
    }
  }
}

export function assertCustomColourBlock(block: Uint8Array): void {
  if (block.length !== CUSTOM_COLOUR_BYTES) {
    throw new Error(`custom-colour block is ${block.length} bytes, expected ${CUSTOM_COLOUR_BYTES}`)
  }
}

export function effectColour(block: Uint8Array, effectId: number): RGB {
  const offset = effectRgbOffset(block, effectId)
  return { r: block[offset]!, g: block[offset + 1]!, b: block[offset + 2]! }
}

/** The 512-byte write form of a light-colour block as read: padded and trailed exactly as the vendor app does. */
export function lightColourWriteBlock(block: Uint8Array): Uint8Array {
  if (block.length < LIGHT_COLOUR_READ_BYTES) {
    throw new Error(`light-colour block is ${block.length} bytes, expected at least ${LIGHT_COLOUR_READ_BYTES}`)
  }
  const out = new Uint8Array(LIGHT_COLOUR_WRITE_BYTES)
  out.set(block.subarray(0, LIGHT_COLOUR_READ_BYTES))
  out.set([0x5a, 0xa5], LIGHT_COLOUR_TRAILER_OFFSET)
  return out
}

/** The block as read with one effect's RGB replaced, in write form. Everything else passes through. */
export function withEffectColour(block: Uint8Array, effectId: number, rgb: RGB): Uint8Array {
  assertRgb(rgb)
  const offset = effectRgbOffset(block, effectId)
  const out = lightColourWriteBlock(block)
  out.set([rgb.r, rgb.g, rgb.b], offset)
  return out
}

export function keyColour(block: Uint8Array, slot: number): RGB {
  assertCustomBlock(block)
  assertSlot(slot)
  return { r: block[slot]!, g: block[CUSTOM_SLOTS + slot]!, b: block[2 * CUSTOM_SLOTS + slot]! }
}

export function decodeKeyColours(block: Uint8Array): RGB[] {
  assertCustomBlock(block)
  return Array.from({ length: CUSTOM_SLOTS }, (_, slot) => keyColour(block, slot))
}

export function withKeyColour(block: Uint8Array, slot: number, rgb: RGB): Uint8Array {
  assertCustomBlock(block)
  assertSlot(slot)
  assertRgb(rgb)
  const out = Uint8Array.from(block.subarray(0, CUSTOM_COLOUR_BYTES))
  out[slot] = rgb.r
  out[CUSTOM_SLOTS + slot] = rgb.g
  out[2 * CUSTOM_SLOTS + slot] = rgb.b
  return out
}

export function toHexColour({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function fromHexColour(hex: string): RGB {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) throw new RangeError(`not a #rrggbb colour: ${hex}`)
  const value = parseInt(match[1]!, 16)
  return { r: value >> 16, g: (value >> 8) & 0xff, b: value & 0xff }
}

function effectRgbOffset(block: Uint8Array, effectId: number): number {
  if (block.length < LIGHT_COLOUR_READ_BYTES) {
    throw new Error(`light-colour block is ${block.length} bytes, expected at least ${LIGHT_COLOUR_READ_BYTES}`)
  }
  const offset = OFFSET_EFFECT_RGB + 3 * effectId
  if (!Number.isInteger(effectId) || effectId < 0 || offset + 3 > LIGHT_COLOUR_READ_BYTES) {
    throw new RangeError(`effect ${effectId} has no colour slot in the light-colour block`)
  }
  return offset
}

function assertCustomBlock(block: Uint8Array): void {
  if (block.length < CUSTOM_COLOUR_BYTES) {
    throw new Error(`custom-colour block is ${block.length} bytes, expected ${CUSTOM_COLOUR_BYTES}`)
  }
}

function assertSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= CUSTOM_SLOTS) {
    throw new RangeError(`slot must be an integer 0..${CUSTOM_SLOTS - 1}, got ${slot}`)
  }
}

function assertRgb({ r, g, b }: RGB): void {
  for (const [name, v] of [['r', r], ['g', g], ['b', b]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RangeError(`${name} must be an integer 0..255, got ${v}`)
  }
}

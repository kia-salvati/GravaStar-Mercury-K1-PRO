import { decodeKeyColours, toHexColour, type ColourMode } from 'k916'
import type { Connected } from '../types/keyboard'
import { colourKind } from './colour'
import { hexToBytes, type Preset } from './presets'

/** One lighting state as the screens show it: what the keyboard reports now, or a preset's snapshot. */
export interface Look {
  effect: string
  brightness: number
  speed: number
  mixing: boolean
  colourMode: ColourMode
  /** The single colour, when the effect uses one and it was read. */
  colourHex: string | null
  /** 126 per-key colours for Custom, when known. The keyboard's own are not read in Stage 1. */
  keys: string[] | null
}

export function lookOfKeyboard({ lighting, effectColour }: Pick<Connected, 'lighting' | 'effectColour'>): Look {
  const { effect, brightness, speed, mixing, colourMode } = lighting
  const colourHex = colourMode === 'single' && !mixing && effectColour ? toHexColour(effectColour) : null
  return { effect, brightness, speed, mixing, colourMode, colourHex, keys: null }
}

export function lookOfPreset({ readout, snapshot }: Preset): Look {
  const { effect, brightness, speed, mixing, colourMode, colourHex } = readout
  const keys = colourMode === 'perKey' ? decodeKeyColours(hexToBytes(snapshot.customColourHex)).map(toHexColour) : null
  return { effect, brightness, speed, mixing, colourMode, colourHex, keys }
}

const keysOf = (look: Look): string | null => look.keys?.join() ?? null

/** The same lighting as far as the app can tell. Per-key colours it has not read never match. */
export function looksEqual(a: Look, b: Look): boolean {
  return a.effect === b.effect && a.brightness === b.brightness && a.speed === b.speed && a.mixing === b.mixing && a.colourHex === b.colourHex && keysOf(a) === keysOf(b)
}

/** The colour row's words when there is no single hex to show. */
export function colourLabel(look: Look): string {
  const kind = colourKind(look)
  if (kind === 'single') return look.colourHex ?? 'Colour not read'
  if (kind === 'none') return 'Lighting is off'
  if (kind === 'perKey') return 'Per-key RGB · 126 keys'
  return 'Mixed colours — set by the effect'
}

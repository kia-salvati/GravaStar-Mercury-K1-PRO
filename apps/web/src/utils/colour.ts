import type { LightingState } from 'k916'
import type { Look } from './look'

/** What the colour row and swatch show. */
export type ColourKind = 'single' | 'mixed' | 'perKey' | 'none'

/** The vendor's "Color Mixing" toggle turns a single-colour effect multicoloured, so it reads as mixed. */
export function colourKind({ colourMode, mixing }: Pick<LightingState, 'colourMode' | 'mixing'>): ColourKind {
  return colourMode === 'single' && mixing ? 'mixed' : colourMode
}

const MIXED_STAND_IN = '#b56bff'

/**
 * The effect as one hue, for the card glow and the single-colour field motions: the colour read
 * from the keyboard, a violet stand-in when the effect mixes its own colours, nothing when off.
 */
export function tintColour(look: Pick<Look, 'colourMode' | 'mixing' | 'colourHex'> | null): string {
  if (!look || look.colourMode === 'none') return 'transparent'
  return colourKind(look) === 'single' && look.colourHex ? look.colourHex : MIXED_STAND_IN
}

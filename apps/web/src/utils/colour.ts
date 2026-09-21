import { toHexColour, type LightingState, type RGB } from 'k916'

/** What the colour row and swatch show. */
export type ColourKind = 'single' | 'mixed' | 'perKey' | 'none'

/** The vendor's "Color Mixing" toggle turns a single-colour effect multicoloured, so it reads as mixed. */
export function colourKind({ colourMode, mixing }: LightingState): ColourKind {
  return colourMode === 'single' && mixing ? 'mixed' : colourMode
}

/** The hex to draw for a swatch or the field: only a single-colour effect whose colour was read has one. */
export function swatchHex(lighting: LightingState, effectColour: RGB | null): string | null {
  return colourKind(lighting) === 'single' && effectColour ? toHexColour(effectColour) : null
}

const MIXED_STAND_IN = '#b56bff'

/**
 * The effect as one hue, for the card glow and the single-colour field motions: the colour read
 * from the keyboard, a violet stand-in when the effect mixes its own colours, nothing when off.
 */
export function tintColour(lighting: LightingState | null, effectColour: RGB | null): string {
  if (!lighting || lighting.colourMode === 'none') return 'transparent'
  return swatchHex(lighting, effectColour) ?? MIXED_STAND_IN
}

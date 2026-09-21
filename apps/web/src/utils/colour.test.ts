import type { LightingState } from 'k916'
import { expect, test } from 'vitest'
import { colourKind, swatchHex, tintColour } from './colour'

const state = (partial: Pick<LightingState, 'colourMode' | 'mixing'>): LightingState => ({ effectId: 1, effect: 'x', brightness: 1, speed: 0, ...partial })
const BLUE = { r: 0, g: 0, b: 255 }

test('a single-colour effect with mixing on reads as mixed; everything else keeps its mode', () => {
  expect(colourKind(state({ colourMode: 'single', mixing: false }))).toBe('single')
  expect(colourKind(state({ colourMode: 'single', mixing: true }))).toBe('mixed')
  expect(colourKind(state({ colourMode: 'mixed', mixing: true }))).toBe('mixed')
  expect(colourKind(state({ colourMode: 'perKey', mixing: false }))).toBe('perKey')
  expect(colourKind(state({ colourMode: 'none', mixing: false }))).toBe('none')
})

test('only a single-colour effect whose colour was read gets a swatch hex', () => {
  expect(swatchHex(state({ colourMode: 'single', mixing: false }), BLUE)).toBe('#0000ff')
  expect(swatchHex(state({ colourMode: 'single', mixing: true }), BLUE)).toBeNull()
  expect(swatchHex(state({ colourMode: 'single', mixing: false }), null)).toBeNull()
  expect(swatchHex(state({ colourMode: 'mixed', mixing: true }), BLUE)).toBeNull()
})

test('the tint is the read colour, a violet stand-in for mixed, nothing when off or disconnected', () => {
  expect(tintColour(state({ colourMode: 'single', mixing: false }), BLUE)).toBe('#0000ff')
  expect(tintColour(state({ colourMode: 'mixed', mixing: true }), BLUE)).toBe('#b56bff')
  expect(tintColour(state({ colourMode: 'perKey', mixing: false }), null)).toBe('#b56bff')
  expect(tintColour(state({ colourMode: 'none', mixing: false }), null)).toBe('transparent')
  expect(tintColour(null, null)).toBe('transparent')
})

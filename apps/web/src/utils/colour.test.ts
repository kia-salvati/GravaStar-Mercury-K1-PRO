import { expect, test } from 'vitest'
import { colourKind, tintColour } from './colour'

test('a single-colour effect with mixing on reads as mixed; everything else keeps its mode', () => {
  expect(colourKind({ colourMode: 'single', mixing: false })).toBe('single')
  expect(colourKind({ colourMode: 'single', mixing: true })).toBe('mixed')
  expect(colourKind({ colourMode: 'mixed', mixing: true })).toBe('mixed')
  expect(colourKind({ colourMode: 'perKey', mixing: false })).toBe('perKey')
  expect(colourKind({ colourMode: 'none', mixing: false })).toBe('none')
})

test('the tint is the read colour, a violet stand-in for mixed, nothing when off or disconnected', () => {
  expect(tintColour({ colourMode: 'single', mixing: false, colourHex: '#0000ff' })).toBe('#0000ff')
  expect(tintColour({ colourMode: 'single', mixing: true, colourHex: '#0000ff' })).toBe('#b56bff')
  expect(tintColour({ colourMode: 'mixed', mixing: true, colourHex: null })).toBe('#b56bff')
  expect(tintColour({ colourMode: 'perKey', mixing: false, colourHex: null })).toBe('#b56bff')
  expect(tintColour({ colourMode: 'none', mixing: false, colourHex: null })).toBe('transparent')
  expect(tintColour(null)).toBe('transparent')
})

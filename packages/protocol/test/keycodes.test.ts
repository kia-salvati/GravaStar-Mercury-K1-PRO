import { expect, test } from 'vitest'
import { codeToKey, isKnownCode, KEYCODES, keyToCode } from '../src/keycodes.js'

test('every keycode round-trips through both directions', () => {
  for (const [name, code] of Object.entries(KEYCODES)) {
    expect(codeToKey(code)).toBe(name)
    expect(keyToCode(name)).toBe(code)
  }
})

test('no two key names share a code', () => {
  const codes = Object.values(KEYCODES)
  expect(new Set(codes).size).toBe(codes.length)
})

// Anchors taken from the published HID usage tables, matching the values seen in the vendor
// bundle. If a generated range silently shifts, these catch it.
test.each([
  ['KeyA', 0x04],
  ['KeyZ', 0x1d],
  ['Digit1', 0x1e],
  ['Digit0', 0x27],
  ['Enter', 0x28],
  ['Escape', 0x29],
  ['Tab', 0x2b],
  ['Space', 0x2c],
  ['Backquote', 0x35],
  ['CapsLock', 0x39],
  ['F1', 0x3a],
  ['F12', 0x45],
  ['Numpad1', 0x59],
  ['Numpad9', 0x61],
  ['ControlLeft', 0xe0],
  ['MetaRight', 0xe7],
])('%s is HID 0x%s', (name, code) => {
  expect(keyToCode(name)).toBe(code)
})

test('covers a full 104-key keyboard', () => {
  expect(Object.keys(KEYCODES).length).toBeGreaterThanOrEqual(104)
})

test('an unknown code decodes to a stable placeholder rather than throwing', () => {
  expect(codeToKey(0xfffe)).toBe('Unknown(0xfffe)')
  expect(isKnownCode(0xfffe)).toBe(false)
})

test('an unknown name returns undefined rather than throwing', () => {
  expect(keyToCode('NoSuchKey')).toBeUndefined()
})

test('the table is frozen so a consumer cannot corrupt it', () => {
  expect(() => {
    ;(KEYCODES as Record<string, number>)['KeyA'] = 999
  }).toThrow()
})

// Media (consumer page), modifiers and Fn are decoded in codec/keymap.ts — see keymap.test.ts.
// Mouse-button bindings have not appeared in any capture yet, so their type byte is unknown.
test.todo('decodes mouse-button bindings once a capture shows one')

import { expect, test } from 'vitest'
import { decodeKeymap, SlotType } from '../src/codec/keymap.js'

const slot = (...bytes: number[]) => decodeKeymap(Uint8Array.from(bytes))[0]!

test('a plain key decodes to its HID name', () => {
  expect(slot(0x00, 0x00, 0x00, 0x29).key).toBe('Escape')
})

test('a modifier-only slot decodes from the HID modifier byte', () => {
  expect(slot(0x00, 0x01, 0x00, 0x00).key).toBe('ControlLeft')
  expect(slot(0x00, 0x02, 0x00, 0x00).key).toBe('ShiftLeft')
  expect(slot(0x00, 0x80, 0x00, 0x00).key).toBe('MetaRight')
})

test('several modifier bits join with +', () => {
  expect(slot(0x00, 0x03, 0x00, 0x00).key).toBe('ControlLeft+ShiftLeft')
})

test('the Fn key is recognised by its type', () => {
  expect(slot(0x0d, 0x00, 0x00, 0x00).key).toBe('Fn')
  expect(slot(0x0d, 0x00, 0x00, 0x00).type).toBe(SlotType.Fn)
})

test('consumer-page keys decode by name when known and stay hex otherwise', () => {
  expect(slot(0x02, 0x00, 0x00, 0xe9).key).toBe('AudioVolumeUp')
  expect(slot(0x02, 0x00, 0x00, 0x42).key).toBe('Consumer(0x42)')
})

test('an empty slot is None', () => {
  expect(slot(0x00, 0x00, 0x00, 0x00).key).toBe('None')
})

test('an unmapped type keeps its full raw value visible', () => {
  expect(slot(0x07, 0x00, 0x00, 0x1d).key).toBe('Type07(0x0700001d)')
})

test('raw is the big-endian 32-bit value, matching the vendor keycode tables', () => {
  expect(slot(0x0d, 0x00, 0x00, 0x00).raw).toBe(218103808)   // "Fn" in the vendor table
  expect(slot(0x00, 0x02, 0x00, 0x00).raw).toBe(131072)      // "L_shift" in the vendor table
  expect(slot(0x00, 0x01, 0x00, 0x00).raw).toBe(65536)       // "L_Ctrl" in the vendor table
})

test('decodes whole slots only, ignoring a trailing partial', () => {
  expect(decodeKeymap(Uint8Array.from([0, 0, 0, 0x29, 0, 0, 0]))).toHaveLength(1)
})

import { expect, test } from 'vitest'
import { buildFrame, checksum, FRAME_BODY_BYTES, FRAME_BYTES } from '../src/frame.js'

// Expectations below are computed by hand, not by running the implementation, so these tests
// can actually fail. The battery request from the vendor source is [0x87,0,0,1,0,2] on report 6:
//   6 + 0x87 + 0 + 0 + 1 + 0 + 2  =  6 + 135 + 3  =  144  =  0x90
const POWER_BODY = [0x87, 0x00, 0x00, 0x01, 0x00, 0x02]
const POWER_CHECKSUM = 0x90

test('checksum sums the report id and body, masked to a byte', () => {
  expect(checksum(6, POWER_BODY)).toBe(POWER_CHECKSUM)
})

test('checksum wraps past 255 rather than overflowing', () => {
  // 6 + 255 + 255 = 516 = 0x204 -> low byte 0x04
  expect(checksum(6, [0xff, 0xff])).toBe(0x04)
})

test('checksum of an empty body is the report id alone', () => {
  expect(checksum(6, [])).toBe(6)
})

test('checksum accepts a Uint8Array as well as a plain array', () => {
  expect(checksum(6, Uint8Array.from(POWER_BODY))).toBe(POWER_CHECKSUM)
})

test('buildFrame pads the body to 18 bytes and appends the checksum', () => {
  const frame = buildFrame(6, POWER_BODY)

  expect(frame).toHaveLength(FRAME_BYTES)
  expect([...frame.subarray(0, 6)]).toEqual(POWER_BODY)
  expect([...frame.subarray(6, FRAME_BODY_BYTES)]).toEqual(new Array(12).fill(0))
  expect(frame[FRAME_BODY_BYTES]).toBe(POWER_CHECKSUM)
})

test('buildFrame produces the exact 19 bytes expected for the battery request', () => {
  expect([...buildFrame(6, POWER_BODY)]).toEqual([
    0x87, 0x00, 0x00, 0x01, 0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x90,
  ])
})

test('buildFrame rejects a body that will not fit', () => {
  expect(() => buildFrame(6, new Array(19).fill(0))).toThrow(/18/)
})

test('buildFrame accepts a body of exactly 18 bytes', () => {
  expect(() => buildFrame(6, new Array(FRAME_BODY_BYTES).fill(0))).not.toThrow()
})

test('reproduces the checksum byte of a reply captured from the K1 PRO', () => {
  // session-1-connect.jsonl, identity reply on report 0x13. The keyboard computed 0xdc.
  const captured = [0x05, 0x01, 0x00, 0x0a, 0x03, 0x00, 0x00, 0x00, 0x01, 0x97, 0x17, 0x07, 0, 0, 0, 0, 0, 0, 0xdc]
  expect(checksum(0x13, captured.slice(0, 18))).toBe(0xdc)
})

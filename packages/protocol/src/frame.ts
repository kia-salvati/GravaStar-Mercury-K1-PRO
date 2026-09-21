/**
 * Byte buffers crossing a transport boundary must be backed by a real ArrayBuffer, not the
 * SharedArrayBuffer that a bare `Uint8Array` also permits — WebHID's BufferSource rejects the
 * latter. Naming it keeps that constraint in one place.
 */
export type Bytes = Uint8Array<ArrayBuffer>

/** A command frame is 18 body bytes followed by one checksum byte. */
export const FRAME_BODY_BYTES = 18
export const FRAME_BYTES = FRAME_BODY_BYTES + 1

/** Additive checksum over the report id followed by the frame body, masked to one byte. */
export function checksum(reportId: number, body: readonly number[] | Uint8Array): number {
  let sum = reportId
  for (const byte of body) sum += byte
  return sum & 0xff
}

export function buildFrame(reportId: number, body: readonly number[]): Bytes {
  if (body.length > FRAME_BODY_BYTES) {
    throw new RangeError(`frame body is ${body.length} bytes, maximum is ${FRAME_BODY_BYTES}`)
  }

  const frame = new Uint8Array(FRAME_BYTES)
  frame.set(body)
  frame[FRAME_BODY_BYTES] = checksum(reportId, frame.subarray(0, FRAME_BODY_BYTES))
  return frame
}

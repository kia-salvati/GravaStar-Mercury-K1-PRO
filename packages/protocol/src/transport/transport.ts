import type { Bytes } from '../frame.js'

/**
 * The single seam between the protocol core and the outside world. Everything above this
 * interface is platform-agnostic, so supporting a new platform means writing one more
 * implementation of it and nothing else.
 */
export interface Transport {
  /** Wired dialect: command in, then pull the reply with receiveFeatureReport. */
  sendFeatureReport(reportId: number, data: Bytes): Promise<void>
  receiveFeatureReport(reportId: number): Promise<DataView>
  /** Wireless dialect: command in, replies arrive as pushed input reports. */
  sendOutputReport(reportId: number, data: Bytes): Promise<void>
  onInputReport(handler: (reportId: number, data: DataView) => void): () => void
  readonly info: { vendorId: number; productId: number }
}

export type CaptureDirection = 'out:feature' | 'out:output' | 'in:feature' | 'in:input'

/** One recorded HID exchange, as written by tools/capture/record.js. */
export interface CaptureEvent {
  t: number
  dir: CaptureDirection
  reportId: number
  bytes: string
  label: string
}

export function parseCapture(ndjson: string): CaptureEvent[] {
  return ndjson
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as CaptureEvent)
}

export function bytesOf(event: CaptureEvent): Bytes {
  return Uint8Array.from(event.bytes.split(' ').map((byte) => parseInt(byte, 16)))
}

export function toHex(data: Uint8Array): string {
  return [...data].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
}

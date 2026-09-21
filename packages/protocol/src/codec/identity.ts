export interface Identity {
  uuid: string
  firmwareVersion: string
}

const UUID_BYTES = 6
const OFFSET_FIRMWARE = 6

/**
 * Identity reply payload, observed: 03 00 00 00 01 97 17 07 00 00
 *   bytes 0..5  uuid            → 0x030000000197
 *   bytes 6..7  firmware, BE    → 0x1707 (matches the vendor's Device Overview)
 */
export function decodeIdentity(data: Uint8Array): Identity {
  if (data.length < OFFSET_FIRMWARE + 2) {
    throw new Error(`identity payload is ${data.length} bytes, need at least ${OFFSET_FIRMWARE + 2}`)
  }
  const hex = (byte: number) => byte.toString(16).padStart(2, '0')
  const uuid = '0x' + [...data.subarray(0, UUID_BYTES)].map(hex).join('')
  const firmwareVersion = '0x' + hex(data[OFFSET_FIRMWARE]!) + hex(data[OFFSET_FIRMWARE + 1]!)
  return { uuid, firmwareVersion }
}

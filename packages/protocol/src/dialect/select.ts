import type { Dialect } from './dialect.js'
import { WiredDialect } from './wired.js'
import { WirelessDialect } from './wireless.js'

/** The wired keyboard and its dongle are separate USB devices with separate vendor ids. */
export const VENDOR_ID_WIRED = 0x258a
export const VENDOR_ID_DONGLE = 0x3554

export type ConnectionType = 'wired' | 'wireless'

export function connectionTypeFor(info: { vendorId: number }): ConnectionType | undefined {
  if (info.vendorId === VENDOR_ID_WIRED) return 'wired'
  if (info.vendorId === VENDOR_ID_DONGLE) return 'wireless'
  return undefined
}

/** Chosen once at connect from the transport's ids; nothing above the device sees this. */
export function dialectFor(info: { vendorId: number }): Dialect {
  const type = connectionTypeFor(info)
  if (type === 'wired') return new WiredDialect()
  if (type === 'wireless') return new WirelessDialect()
  throw new Error(`no dialect for vendor id 0x${info.vendorId.toString(16)}`)
}

import { connectionTypeFor, VENDOR_ID_DONGLE, VENDOR_ID_WIRED, WebHIDTransport, type ConnectionType, type ConnectOptions, type Transport } from 'k916'

/**
 * Where keyboards come from. The only thing in the app that knows about `navigator.hid`; the
 * hook receives one of these so tests can hand it a `MockTransport` instead.
 */
export interface DeviceSource {
  /** False when the browser has no WebHID; the connect button is then replaced by an explanation. */
  readonly supported: boolean
  /** Asks the user to pick the keyboard or its dongle. Resolves null when they cancel. */
  request(): Promise<Transport | null>
  /** A device the user granted earlier, so the app reconnects on load without a prompt. */
  remembered(): Promise<Transport | null>
  onDisconnect(handler: (reason: string) => void): () => void
  connectOptions?: ConnectOptions
}

const FILTERS: HIDDeviceFilter[] = [{ vendorId: VENDOR_ID_WIRED }, { vendorId: VENDOR_ID_DONGLE }]
const VENDOR_USAGE_PAGE_MIN = 0xff00

const hasReports = (reports: HIDReportInfo[] | undefined): boolean => (reports?.length ?? 0) > 0

/**
 * Chrome returns every HID interface of a chosen keyboard; only one carries the vendor protocol.
 * These are the vendor app's own picks (research/proto.clean.js): on cable the vendor-page
 * collection with feature + input reports, on the dongle the one with output + input reports.
 */
const IS_VENDOR_CHANNEL: Record<ConnectionType, (collection: HIDCollectionInfo) => boolean> = {
  wired: (c) => hasReports(c.inputReports) && hasReports(c.featureReports) && (c.usagePage ?? 0) >= VENDOR_USAGE_PAGE_MIN,
  wireless: (c) => hasReports(c.inputReports) && hasReports(c.outputReports),
}

const isVendorChannel = (device: HIDDevice): boolean => {
  const connection = connectionTypeFor(device)
  return connection !== undefined && device.collections.some(IS_VENDOR_CHANNEL[connection])
}

export function webHidSource(): DeviceSource {
  const hid = 'hid' in navigator ? navigator.hid : undefined
  let current: HIDDevice | undefined

  const adopt = async (devices: HIDDevice[]): Promise<Transport | null> => {
    const device = devices.find(isVendorChannel)
    if (!device) return null
    current = device
    return WebHIDTransport.open(device)
  }

  return {
    supported: hid !== undefined,
    async request() {
      if (!hid) return null
      return adopt(await hid.requestDevice({ filters: FILTERS }))
    },
    async remembered() {
      if (!hid) return null
      return adopt(await hid.getDevices())
    },
    onDisconnect(handler) {
      const listener = (event: HIDConnectionEvent) => {
        if (event.device !== current) return
        current = undefined
        handler(`${event.device.productName || 'The keyboard'} was disconnected.`)
      }
      hid?.addEventListener('disconnect', listener)
      return () => hid?.removeEventListener('disconnect', listener)
    },
  }
}

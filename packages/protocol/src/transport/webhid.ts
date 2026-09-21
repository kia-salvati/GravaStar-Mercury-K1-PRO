import type { Bytes } from '../frame.js'
import type { Transport } from './transport.js'

/**
 * Wraps an HIDDevice the caller has already been granted access to.
 *
 * Device selection stays out of the library on purpose: it differs per platform (a Chrome
 * permission prompt, a native device list, a CLI flag) and is a UI concern.
 */
export class WebHIDTransport implements Transport {
  static async open(device: HIDDevice): Promise<WebHIDTransport> {
    if (!device.opened) await device.open()
    return new WebHIDTransport(device)
  }

  readonly info: { vendorId: number; productId: number }

  private constructor(private readonly device: HIDDevice) {
    this.info = { vendorId: device.vendorId, productId: device.productId }
  }

  async sendFeatureReport(reportId: number, data: Bytes): Promise<void> {
    await this.device.sendFeatureReport(reportId, data)
  }

  async receiveFeatureReport(reportId: number): Promise<DataView> {
    return this.device.receiveFeatureReport(reportId)
  }

  async sendOutputReport(reportId: number, data: Bytes): Promise<void> {
    await this.device.sendReport(reportId, data)
  }

  onInputReport(handler: (reportId: number, data: DataView) => void): () => void {
    const listener = (event: HIDInputReportEvent) => handler(event.reportId, event.data)
    this.device.addEventListener('inputreport', listener)
    return () => {
      this.device.removeEventListener('inputreport', listener)
    }
  }
}

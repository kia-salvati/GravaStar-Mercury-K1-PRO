import { expect, test, vi } from 'vitest'
import { WebHIDTransport } from '../src/transport/webhid.js'

function fakeDevice() {
  return {
    vendorId: 0x258a,
    productId: 0x010c,
    opened: false,
    open: vi.fn(async function (this: { opened: boolean }) {
      this.opened = true
    }),
    sendFeatureReport: vi.fn(async () => {}),
    sendReport: vi.fn(async () => {}),
    receiveFeatureReport: vi.fn(async () => new DataView(Uint8Array.from([1, 2, 3]).buffer)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

const asDevice = (device: ReturnType<typeof fakeDevice>) => device as unknown as HIDDevice

test('opens the device when it is not already open', async () => {
  const device = fakeDevice()
  await WebHIDTransport.open(asDevice(device))

  expect(device.open).toHaveBeenCalledTimes(1)
})

test('does not reopen a device that is already open', async () => {
  const device = fakeDevice()
  device.opened = true
  await WebHIDTransport.open(asDevice(device))

  expect(device.open).not.toHaveBeenCalled()
})

test('exposes vendor and product ids', async () => {
  const transport = await WebHIDTransport.open(asDevice(fakeDevice()))

  expect(transport.info).toEqual({ vendorId: 0x258a, productId: 0x010c })
})

test('forwards feature reports to the device', async () => {
  const device = fakeDevice()
  const transport = await WebHIDTransport.open(asDevice(device))
  const frame = Uint8Array.from([0x87, 0x00])

  await transport.sendFeatureReport(6, frame)
  expect(device.sendFeatureReport).toHaveBeenCalledWith(6, frame)

  const reply = await transport.receiveFeatureReport(6)
  expect([...new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength)]).toEqual([1, 2, 3])
})

test('forwards output reports to the device', async () => {
  const device = fakeDevice()
  const transport = await WebHIDTransport.open(asDevice(device))
  const frame = Uint8Array.from([0x05, 0x01])

  await transport.sendOutputReport(19, frame)
  expect(device.sendReport).toHaveBeenCalledWith(19, frame)
})

test('unsubscribing removes the input report listener', async () => {
  const device = fakeDevice()
  const transport = await WebHIDTransport.open(asDevice(device))

  const unsubscribe = transport.onInputReport(() => {})
  expect(device.addEventListener).toHaveBeenCalledWith('inputreport', expect.any(Function))

  unsubscribe()
  expect(device.removeEventListener).toHaveBeenCalledWith('inputreport', expect.any(Function))
})

test('the same listener reference is added and removed', async () => {
  const device = fakeDevice()
  const transport = await WebHIDTransport.open(asDevice(device))

  const unsubscribe = transport.onInputReport(() => {})
  unsubscribe()

  expect(device.addEventListener.mock.calls[0]![1]).toBe(device.removeEventListener.mock.calls[0]![1])
})

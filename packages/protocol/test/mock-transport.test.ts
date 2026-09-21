import { expect, test } from 'vitest'
import { MockTransport } from '../src/transport/mock.js'

const CAPTURE = [
  '{"t":1,"dir":"out:feature","reportId":6,"bytes":"87 00","label":"connect"}',
  '{"t":2,"dir":"in:feature","reportId":6,"bytes":"0a 01 00","label":"connect"}',
].join('\n')

test('replays the recorded response for a matching request', async () => {
  const transport = new MockTransport(CAPTURE)
  await transport.sendFeatureReport(6, Uint8Array.from([0x87, 0x00]))
  const reply = await transport.receiveFeatureReport(6)

  expect([...new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength)]).toEqual([0x0a, 0x01, 0x00])
})

test('throws when the code sends a frame the vendor app never sent', async () => {
  const transport = new MockTransport(CAPTURE)
  await expect(transport.sendFeatureReport(6, Uint8Array.from([0xff, 0xff]))).rejects.toThrow(
    /unexpected frame/i,
  )
})

test('throws when a reply is read that was never recorded', async () => {
  const transport = new MockTransport(CAPTURE)
  await transport.sendFeatureReport(6, Uint8Array.from([0x87, 0x00]))
  await transport.receiveFeatureReport(6)

  await expect(transport.receiveFeatureReport(6)).rejects.toThrow(/no recorded reply/i)
})

test('delivers input reports to subscribers', () => {
  const capture =
    '{"t":1,"dir":"in:input","reportId":6,"bytes":"0a 01 00 04 02 5b 10","label":"battery"}'
  const transport = new MockTransport(capture)
  const seen: number[][] = []

  transport.onInputReport((_id, data) =>
    seen.push([...new Uint8Array(data.buffer, data.byteOffset, data.byteLength)]),
  )
  transport.flushInputReports()

  expect(seen).toEqual([[0x0a, 0x01, 0x00, 0x04, 0x02, 0x5b, 0x10]])
})

test('unsubscribing stops delivery', () => {
  const capture =
    '{"t":1,"dir":"in:input","reportId":6,"bytes":"0a 01 00 04 02 5b 10","label":"battery"}'
  const transport = new MockTransport(capture)
  const seen: unknown[] = []

  const unsubscribe = transport.onInputReport(() => seen.push(1))
  unsubscribe()
  transport.flushInputReports()

  expect(seen).toEqual([])
})

test('reports the K1 PRO vendor and product ids by default', () => {
  expect(new MockTransport(CAPTURE).info).toEqual({ vendorId: 0x258a, productId: 0x010c })
})

test('can pose as the dongle', () => {
  const transport = new MockTransport(CAPTURE, { vendorId: 0x3554, productId: 0xfa09 })
  expect(transport.info).toEqual({ vendorId: 0x3554, productId: 0xfa09 })
})

test('each recorded exchange replays once', async () => {
  const transport = new MockTransport(CAPTURE)
  await transport.sendFeatureReport(6, Uint8Array.from([0x87, 0x00]))

  await expect(transport.sendFeatureReport(6, Uint8Array.from([0x87, 0x00]))).rejects.toThrow(
    /unexpected frame/i,
  )
})

// The dongle replies with pushed input reports rather than a pulled feature report.
const DONGLE_CAPTURE = [
  '{"t":1,"dir":"out:output","reportId":19,"bytes":"05 01 00","label":"connect"}',
  '{"t":2,"dir":"in:input","reportId":19,"bytes":"05 01 00 0a","label":"connect"}',
  '{"t":3,"dir":"in:input","reportId":19,"bytes":"0a 01 00 04 05 64 01","label":"connect"}',
  '{"t":4,"dir":"out:output","reportId":19,"bytes":"41 00 00","label":"keymap"}',
  '{"t":5,"dir":"in:input","reportId":19,"bytes":"41 24 00 0e","label":"keymap"}',
].join('\n')

test('an output-report send pushes only the replies recorded for that exchange', async () => {
  const transport = new MockTransport(DONGLE_CAPTURE)
  const seen: string[] = []
  transport.onInputReport((_id, data) =>
    seen.push([...new Uint8Array(data.buffer, data.byteOffset, data.byteLength)].map((b) => b.toString(16).padStart(2, '0')).join(' ')),
  )

  await transport.sendOutputReport(19, Uint8Array.from([0x05, 0x01, 0x00]))
  await Promise.resolve()

  expect(seen).toEqual(['05 01 00 0a', '0a 01 00 04 05 64 01'])
})

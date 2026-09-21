import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { Layer } from '../src/codec/keymap.js'
import { K916 } from '../src/device.js'
import { MockTransport } from '../src/transport/mock.js'

const CONNECT = readFileSync('test/fixtures/session-1-connect.jsonl', 'utf8')
const SCREENS = readFileSync('test/fixtures/session-1-screens.jsonl', 'utf8')
const DONGLE = { vendorId: 0x3554, productId: 0xfa09 }

const dongle = (capture = CONNECT) => new MockTransport(capture, DONGLE)
// The mock answers within a microtask, so the burst-idle wait can be tiny.
const FAST = { burstIdleMs: 5 }

test('connects over the dongle and resolves identity from the real handshake', async () => {
  const kb = await K916.connect(dongle(), FAST)

  expect(kb.info).toEqual({
    uuid: '0x030000000197',
    productName: 'GravaStar Mercury K1 PRO',
    firmwareVersion: '0x1707',
    connection: 'wireless',
  })
  expect(kb.capabilities.layers).toBe(3)
})

test('rejects a transport whose vendor id is not one of ours', async () => {
  await expect(K916.connect(new MockTransport(CONNECT, { vendorId: 0x1532, productId: 1 }))).rejects.toThrow(
    /unsupported device/,
  )
})

test('the power packet that follows identity is captured as lastPower', async () => {
  const kb = await K916.connect(dongle(), FAST)
  await Promise.resolve()

  expect(kb.lastPower).toEqual({ percent: 100, charging: false, full: true })
})

test('readPower re-sends identity and resolves with the pushed power packet', async () => {
  // Two identity exchanges are needed: connect consumes one, readPower the other.
  const twoConnects = CONNECT + '\n' + CONNECT.split('\n').slice(0, 3).join('\n')
  const kb = await K916.connect(dongle(twoConnects), FAST)

  await expect(kb.readPower()).resolves.toEqual({ percent: 100, charging: false, full: true })
})

test('power subscribers are notified', async () => {
  const seen: unknown[] = []
  const twoConnects = CONNECT + '\n' + CONNECT.split('\n').slice(0, 3).join('\n')
  const kb = await K916.connect(dongle(twoConnects), FAST)
  kb.subscribePower((state) => seen.push(state))

  await kb.readPower()
  expect(seen).toEqual([{ percent: 100, charging: false, full: true }])
})

test('reads the default keymap layer: 126 slots in column order, 84 populated', async () => {
  const kb = await K916.connect(dongle(), FAST)
  const layer = await kb.readKeymap(Layer.Default)

  expect(layer).toHaveLength(kb.capabilities.slots)
  expect(layer.filter((b) => b.raw !== 0)).toHaveLength(kb.capabilities.keyCount)
  // First column top to bottom: Esc, `~, Tab, Caps, LShift, LCtrl
  expect(layer.slice(0, 6).map((b) => b.key)).toEqual(['Escape', 'Backquote', 'Tab', 'CapsLock', 'ShiftLeft', 'ControlLeft'])
})

test('the default layer decodes modifiers, the Fn key and media keys by name', async () => {
  const kb = await K916.connect(dongle(), FAST)
  const layer = await kb.readKeymap(Layer.Default)
  const byKey = new Map(layer.map((b) => [b.key, b]))

  for (const name of ['ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft', 'ShiftRight', 'AltRight']) {
    expect(byKey.has(name), name).toBe(true)
  }
  expect(byKey.get('Fn')?.slot).toBe(59)
  expect(byKey.get('AudioVolumeUp')?.raw).toBe(0x020000e9)
  expect(byKey.get('AudioVolumeDown')?.raw).toBe(0x020000ea)
  expect(layer.filter((b) => b.key.startsWith('Unknown')).length).toBe(0)
})

test('reads the Fn layer and keeps unmapped types visible rather than mislabelling them', async () => {
  const kb = await K916.connect(dongle(CONNECT + '\n' + SCREENS), FAST)
  const fn = await kb.readKeymap(Layer.Fn)

  expect(fn).toHaveLength(126)
  expect(fn[0]!.type).toBe(0x07)
  expect(fn[0]!.key).toMatch(/^Type07\(0x07000004\)$/)
})

test('reads all three layers', async () => {
  const kb = await K916.connect(dongle(CONNECT + '\n' + SCREENS), FAST)
  const layers = await kb.readAllLayers()

  expect(Object.keys(layers)).toHaveLength(3)
  expect(layers[Layer.Fn1]).toHaveLength(126)
})

test('raw reads honour the last packet length: macros are exactly the 512-byte budget', async () => {
  const kb = await K916.connect(dongle(), FAST)

  expect(await kb.readMacrosRaw()).toHaveLength(kb.capabilities.macroBytes)   // 36×14 + 8
  expect(await kb.readProfileRaw()).toHaveLength(128)                        // 9×14 + 2
  expect(await kb.readLightColorRaw()).toHaveLength(35 * 14)
})

test('the macro block is empty on this keyboard, as the vendor UI showed 0 / 512 bytes', async () => {
  const kb = await K916.connect(dongle(), FAST)
  const macros = await kb.readMacrosRaw()

  expect(macros.every((b) => b === 0)).toBe(true)
})

test('an unobserved frame never reaches the transport', async () => {
  // Sending a frame the vendor never sent must throw — that is safety rule 1 as a test.
  // The capture holds a finite number of macro reads (and a lossy read may consume several to fill
  // gaps). Once they are used up, the next one is a frame with no recorded exchange — refused.
  const kb = await K916.connect(dongle(), FAST)
  let successful = 0
  let refusal: unknown
  for (let i = 0; i < 10 && !refusal; i++) {
    await kb.readMacrosRaw().then(() => successful++, (error) => (refusal = error))
  }

  expect(successful).toBeGreaterThan(0)
  expect(String(refusal)).toMatch(/unexpected frame/)
})

test('a request that draws no reply is re-sent, then fails clearly rather than hanging', async () => {
  const silent = CONNECT.split('\n').slice(0, 3).join('\n')   // identity only
  const request = '{"t":9,"dir":"out:output","reportId":19,"bytes":"41 00 00 00","label":"x"}'
  const kb = await K916.connect(dongle(silent + '\n' + request + '\n' + request), { ...FAST, timeoutMs: 20, maxAttempts: 2 })

  await expect(kb.readKeymap(Layer.Default)).rejects.toThrow(/incomplete after 2 attempt\(s\), no packets at all/)
})

// ---- wired ------------------------------------------------------------------------------------

const WIRED = readFileSync('test/fixtures/session-4-wired.jsonl', 'utf8')
const wired = () => new MockTransport(WIRED)   // default info is the wired keyboard, 258a:010c

test('connects over the cable and reads the same identity as the dongle', async () => {
  const kb = await K916.connect(wired())

  expect(kb.info).toEqual({
    uuid: '0x030000000197',
    productName: 'GravaStar Mercury K1 PRO',
    firmwareVersion: '0x1707',
    connection: 'wired',
  })
})

test('the same keymap decoder works on a wired read — one reply, no reassembly', async () => {
  const kb = await K916.connect(wired())
  const layer = await kb.readKeymap(Layer.Default)

  expect(layer).toHaveLength(126)
  expect(layer.slice(0, 3).map((b) => b.key)).toEqual(['Escape', 'Backquote', 'Tab'])
})

test('reads lighting over the cable: the board was on Blooming', async () => {
  const kb = await K916.connect(wired())
  const lighting = await kb.readLighting()

  expect(lighting.effect).toBe('Blooming')
  expect(lighting.colourMode).toBe('mixed')
})

test('no power packet ever arrives on the cable, and the device says so up front', async () => {
  const kb = await K916.connect(wired())
  await Promise.resolve()

  expect(kb.reportsBattery).toBe(false)
  expect(kb.lastPower).toBeUndefined()
})

test('over the dongle the device reports battery', async () => {
  const kb = await K916.connect(dongle(), FAST)
  expect(kb.reportsBattery).toBe(true)
})

test('close stops power notifications', async () => {
  const seen: unknown[] = []
  const kb = await K916.connect(dongle(), FAST)
  kb.subscribePower((s) => seen.push(s))
  kb.close()
  await Promise.resolve()

  expect(seen).toEqual([])
})

test('a failed identity send during readPower rejects once, with no unhandled power rejection', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const silent = CONNECT.split('\n').slice(0, 3).join('\n')   // identity only — no second identity exchange
    const kb = await K916.connect(dongle(silent), { ...FAST, timeoutMs: 20, maxAttempts: 1 })

    await expect(kb.readPower()).rejects.toThrow(/unexpected frame/)
    await new Promise((r) => setTimeout(r, 60))   // past the power wait
    expect(unhandled.map(String)).toEqual([])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

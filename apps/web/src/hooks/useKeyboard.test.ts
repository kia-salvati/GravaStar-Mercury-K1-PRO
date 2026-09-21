import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockTransport, type Transport } from 'k916'
import { expect, test } from 'vitest'
import type { DeviceSource } from '../api/hidSource'
import type { Connected } from '../types/keyboard'
import { useKeyboard } from './useKeyboard'

// Under jsdom import.meta.url is an http: URL, so the fixtures are located from the module's directory.
const FIXTURES = resolve(__dirname, '../../../../packages/protocol/test/fixtures')
const DONGLE_CAPTURE = readFileSync(resolve(FIXTURES, 'session-1-connect.jsonl'), 'utf8')
const CABLE_CAPTURE = readFileSync(resolve(FIXTURES, 'session-4-wired.jsonl'), 'utf8')
const COLOUR_CAPTURE = readFileSync(resolve(FIXTURES, 'session-6-colour.jsonl'), 'utf8')
const DONGLE_CUSTOM_CAPTURE = readFileSync(resolve(FIXTURES, 'session-7-dongle-colour.jsonl'), 'utf8')
const DONGLE = { vendorId: 0x3554, productId: 0xfa09 }
// A refresh re-runs every exchange, so the session is replayed twice for tests that refresh.
const DONGLE_CAPTURE_TWICE = [DONGLE_CAPTURE, DONGLE_CAPTURE].join('\n')

/** A source that remembers one transport, so the hook takes its reconnect-on-load path. */
const sourceOf = (transport: Transport | null) => {
  const handlers = new Set<(reason: string) => void>()
  const source: DeviceSource = {
    supported: true,
    request: async () => transport,
    remembered: async () => transport,
    onDisconnect: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    // The mock answers within a microtask, so the burst-idle wait can be tiny.
    connectOptions: { burstIdleMs: 5 },
  }
  return { source, disconnect: (reason: string) => handlers.forEach((handler) => handler(reason)) }
}

const connected = async (source: DeviceSource) => {
  const rendered = renderHook(() => useKeyboard(source))
  // Captures replay the dongle's recorded packet loss, so a connect can take a few retries.
  await waitFor(() => expect(rendered.result.current.status).toBe('connected'), { timeout: 5000 })
  return { ...rendered, state: rendered.result.current as Connected }
}

test('over the dongle: reconnects on load, reports battery and decodes Windmill', async () => {
  const { state } = await connected(sourceOf(new MockTransport(DONGLE_CAPTURE, DONGLE)).source)

  expect(state.info).toMatchObject({ productName: 'GravaStar Mercury K1 PRO', firmwareVersion: '0x1707', connection: 'wireless' })
  expect(state.reportsBattery).toBe(true)
  expect(state.canWrite).toBe(false)
  expect(state.power).toEqual({ percent: 100, charging: false, full: true })
  expect(state.lighting).toMatchObject({ effect: 'Windmill', colourMode: 'mixed', brightness: 1, speed: 0, mixing: true })
  expect(state.effectColour).toEqual({ r: 255, g: 255, b: 255 })
  expect(state.sleepTimer).toEqual({ enabled: true, minutes: 1 })
})

test('over the cable: battery is not reported and the board was on Blooming', async () => {
  const { state } = await connected(sourceOf(new MockTransport(CABLE_CAPTURE)).source)

  expect(state.info.connection).toBe('wired')
  expect(state.reportsBattery).toBe(false)
  expect(state.canWrite).toBe(true)
  expect(state.power).toBeNull()
  expect(state.lighting).toMatchObject({ effect: 'Blooming', colourMode: 'mixed', mixing: true })
  expect(state.effectColour).toEqual({ r: 0, g: 255, b: 0 })
  expect(state.sleepTimer).toBeNull()
})

test('session 7: Custom has no colour slot, which reads as null rather than a failure', async () => {
  const { state } = await connected(sourceOf(new MockTransport(DONGLE_CUSTOM_CAPTURE, DONGLE)).source)

  expect(state.lighting).toMatchObject({ effect: 'Custom', colourMode: 'perKey' })
  expect(state.effectColour).toBeNull()
  expect(state.notice).toBeNull()
})

test('busy is true for the whole of a read and false once it has answered', async () => {
  const { result } = await connected(sourceOf(new MockTransport(DONGLE_CAPTURE_TWICE, DONGLE)).source)
  expect(result.current.busy).toBe(false)

  let refreshing: Promise<void> = Promise.resolve()
  act(() => {
    refreshing = result.current.refresh()
  })
  expect(result.current.busy).toBe(true)

  await act(() => refreshing)
  expect(result.current.busy).toBe(false)
})

test('on cable, a write while a read is in flight is refused as a notice: nothing is sent and nothing fails', async () => {
  // The cable allows writes, so the refusal here is the busy check alone. Its replies are held
  // back a little, or the refresh would be over before the refusal could be seen.
  const transport = new MockTransport(COLOUR_CAPTURE)
  const receive = transport.receiveFeatureReport.bind(transport)
  transport.receiveFeatureReport = async (reportId) => {
    await new Promise((resolve) => setTimeout(resolve, 20))
    return receive(reportId)
  }
  const { result } = await connected(sourceOf(transport).source)
  const before = result.current as Connected

  let refreshing: Promise<void> = Promise.resolve()
  await act(async () => {
    refreshing = result.current.refresh()
    await result.current.setSleepTimer(5)
  })
  expect(result.current.notice).toMatch(/Sleep timer change was not sent — the keyboard is still busy/)

  await act(() => refreshing)
  expect(transport.writes).toHaveLength(0)
  expect(result.current).toMatchObject({ status: 'connected', lighting: before.lighting })
  expect(result.current.notice).toBeNull()
})

test('over the dongle, a write is refused as the disabled notice — not busy, not a failure', async () => {
  const transport = new MockTransport(DONGLE_CAPTURE, DONGLE)
  const { result } = await connected(sourceOf(transport).source)

  await act(async () => {
    await result.current.setSleepTimer(5)
  })

  expect(result.current.notice).toBe('Sleep timer change was not sent — writes are disabled over 2.4G. Connect the cable.')
  expect(transport.writes).toHaveLength(0)
  expect(result.current.status).toBe('connected')
})

test('session 6: a single-colour effect reads its own stored colour, with the mixing flag as the firmware has it', async () => {
  const { state } = await connected(sourceOf(new MockTransport(COLOUR_CAPTURE)).source)

  expect(state.lighting).toMatchObject({ effect: 'Wave', colourMode: 'single', mixing: true })
  expect(state.effectColour).toEqual({ r: 0, g: 0, b: 255 })
})

test('a disconnect returns to the connect state with the reason shown', async () => {
  const { source, disconnect } = sourceOf(new MockTransport(DONGLE_CAPTURE, DONGLE))
  const { result } = await connected(source)

  act(() => disconnect('Dongle was disconnected.'))

  expect(result.current).toMatchObject({ status: 'idle', notice: 'Dongle was disconnected.' })
})

test('a cancelled prompt says so instead of failing silently', async () => {
  const { source } = sourceOf(null)
  const { result } = renderHook(() => useKeyboard(source))

  await act(() => result.current.connect())

  expect(result.current).toMatchObject({ status: 'idle', notice: 'No keyboard was chosen.' })
})

test('without WebHID the hook reports unsupported and never asks the source', () => {
  const { result } = renderHook(() => useKeyboard({ ...sourceOf(null).source, supported: false }))

  expect(result.current.status).toBe('unsupported')
})

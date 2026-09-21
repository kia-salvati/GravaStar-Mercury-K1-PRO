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
const DONGLE = { vendorId: 0x3554, productId: 0xfa09 }

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
  await waitFor(() => expect(rendered.result.current.status).toBe('connected'))
  return { ...rendered, state: rendered.result.current as Connected }
}

test('over the dongle: reconnects on load, reports battery and decodes Windmill', async () => {
  const { state } = await connected(sourceOf(new MockTransport(DONGLE_CAPTURE, DONGLE)).source)

  expect(state.info).toMatchObject({ productName: 'GravaStar Mercury K1 PRO', firmwareVersion: '0x1707', connection: 'wireless' })
  expect(state.reportsBattery).toBe(true)
  expect(state.power).toEqual({ percent: 100, charging: false, full: true })
  expect(state.lighting).toMatchObject({ effect: 'Windmill', colourMode: 'mixed', brightness: 1, speed: 0, mixing: true })
  expect(state.effectColour).toEqual({ r: 255, g: 255, b: 255 })
})

test('over the cable: battery is not reported and the board was on Blooming', async () => {
  const { state } = await connected(sourceOf(new MockTransport(CABLE_CAPTURE)).source)

  expect(state.info.connection).toBe('wired')
  expect(state.reportsBattery).toBe(false)
  expect(state.power).toBeNull()
  expect(state.lighting).toMatchObject({ effect: 'Blooming', colourMode: 'mixed', mixing: true })
  expect(state.effectColour).toEqual({ r: 0, g: 255, b: 0 })
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

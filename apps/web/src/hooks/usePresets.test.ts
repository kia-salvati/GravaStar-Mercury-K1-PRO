import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MockTransport, type RestoreStep } from 'k916'
import { beforeEach, expect, test } from 'vitest'
import type { DeviceSource } from '../api/hidSource'
import type { Keyboard } from '../types/keyboard'
import { PRESET_LIMIT, storageKey, type Preset } from '../utils/presets'
import { useKeyboard } from './useKeyboard'
import { usePresets } from './usePresets'

const CABLE_CAPTURE = readFileSync(resolve(__dirname, '../../../../packages/protocol/test/fixtures/session-6-colour.jsonl'), 'utf8')
const UUID = '0x030000000197'
const WIRED_PROFILE_READ = 0x84
const OFFSET_ALWAYS_ON_BRIGHTNESS = 56 + 2 * 1

const sourceOf = (transport: MockTransport): DeviceSource => ({
  supported: true,
  request: async () => transport,
  remembered: async () => transport,
  onDisconnect: () => () => {},
  // No write settle: the simulated keyboard has no flash to wait for.
  connectOptions: { burstIdleMs: 5, writeSettleMs: 0 },
})

/** Both hooks together, the way a screen gets them, with an optional tap on the keyboard's restore. */
const mount = async (transport: MockTransport, tap?: (step: RestoreStep) => void) => {
  const source = sourceOf(transport)   // one source per mount: a new one each render would reconnect every render
  const rendered = renderHook(() => {
    const keyboard = useKeyboard(source)
    const tapped: Keyboard = tap ? { ...keyboard, restore: (backup, onProgress) => keyboard.restore(backup, (step) => { tap(step); onProgress?.(step) }) } : keyboard
    return { keyboard, presets: usePresets(tapped) }
  })
  await waitFor(() => expect(rendered.result.current.keyboard.status).toBe('connected'), { timeout: 5000 })
  return rendered
}

const stored = (): Preset[] => (JSON.parse(localStorage.getItem(storageKey(UUID)) ?? '{"presets":[]}') as { presets: Preset[] }).presets

beforeEach(() => localStorage.clear())

test('save reads a backup, names it Preset 1 and stores it under the keyboard uuid', async () => {
  const { result } = await mount(new MockTransport(CABLE_CAPTURE))

  let saved: Awaited<ReturnType<typeof result.current.presets.save>> | undefined
  await act(async () => {
    saved = await result.current.presets.save()
  })

  expect(saved).toMatchObject({ ok: true, preset: { name: 'Preset 1', keyboardUuid: UUID, readout: { effect: 'Wave' } } })
  expect(result.current.presets.presets).toHaveLength(1)
  expect(stored()[0]?.snapshot.profileHex).toHaveLength(128 * 3 - 1)
  expect(result.current.keyboard.busy).toBe(false)
})

test('at the cap, save refuses without touching the keyboard, and replace overwrites one in place', async () => {
  const transport = new MockTransport(CABLE_CAPTURE)
  const { result } = await mount(transport)
  await act(async () => {
    await result.current.presets.save('Seed')
  })
  const seed = result.current.presets.presets[0]!
  const filler = Array.from({ length: PRESET_LIMIT - 1 }, (_, i) => ({ ...seed, id: `filler-${i}`, name: `Filler ${i}` }))
  const before = transport.writes.length
  act(() => {
    result.current.presets.importFrom(JSON.stringify({ version: 1, keyboardUuid: UUID, presets: filler }))
  })
  expect(result.current.presets.full).toBe(true)

  let saved: Awaited<ReturnType<typeof result.current.presets.save>> | undefined
  let replaced: Awaited<ReturnType<typeof result.current.presets.replace>> | undefined
  await act(async () => {
    saved = await result.current.presets.save()
    replaced = await result.current.presets.replace(seed.id, 'Seed again')
  })

  expect(saved).toEqual({ ok: false, reason: 'full' })
  expect(replaced).toMatchObject({ ok: true, preset: { id: seed.id, name: 'Seed again' } })
  expect(result.current.presets.presets).toHaveLength(PRESET_LIMIT)
  expect(result.current.presets.presets[0]?.name).toBe('Seed again')
  expect(transport.writes.length).toBe(before)
})

test('apply restores the three blocks to the keyboard, reports six steps in order, and the readings refresh', async () => {
  const transport = new MockTransport(CABLE_CAPTURE)
  const steps: string[] = []
  const { result } = await mount(transport, (step) => steps.push(`${step.block}:${step.state}`))
  await act(async () => {
    await result.current.presets.save()
  })
  const preset = result.current.presets.presets[0]!
  // Hand-edit the stored snapshot so the apply is observable: Always On's brightness byte → 3.
  const bytes = preset.snapshot.profileHex.split(' ')
  bytes[OFFSET_ALWAYS_ON_BRIGHTNESS] = '03'
  act(() => {
    result.current.presets.importFrom(JSON.stringify({ version: 1, keyboardUuid: UUID, presets: [{ ...preset, id: 'edited', name: 'Edited', snapshot: { ...preset.snapshot, profileHex: bytes.join(' ') } }] }))
  })

  let applied: Awaited<ReturnType<typeof result.current.presets.apply>> | undefined
  await act(async () => {
    applied = await result.current.presets.apply('edited')
  })

  expect(applied).toEqual({ ok: true })
  expect(steps).toEqual(['profile:writing', 'profile:verified', 'lightColour:writing', 'lightColour:verified', 'customColour:writing', 'customColour:verified'])
  expect(transport.block(WIRED_PROFILE_READ)?.[OFFSET_ALWAYS_ON_BRIGHTNESS]).toBe(3)
  expect(result.current.presets.applying).toBeNull()
  expect(result.current.keyboard).toMatchObject({ status: 'connected', notice: null, busy: false })
  await expect(result.current.presets.apply('nope')).resolves.toEqual({ ok: false, reason: 'missing' })
})

test('applying names the preset from the first moment of the restore and clears when it is done', async () => {
  const { result } = await mount(new MockTransport(CABLE_CAPTURE))
  await act(async () => {
    await result.current.presets.save()
  })
  const id = result.current.presets.presets[0]!.id

  let applying: Promise<unknown> = Promise.resolve()
  act(() => {
    applying = result.current.presets.apply(id)
  })
  expect(result.current.presets.applying).toEqual({ id, steps: [] })
  expect(result.current.keyboard.busy).toBe(true)
  await act(() => applying)

  expect(result.current.presets.applying).toBeNull()
})

test('import at the cap says how many fit and names the rest; export → import round-trips', async () => {
  const { result } = await mount(new MockTransport(CABLE_CAPTURE))
  await act(async () => {
    await result.current.presets.save('One')
  })
  const one = result.current.presets.presets[0]!
  const nine = Array.from({ length: 9 }, (_, i) => ({ ...one, id: `n${i}`, name: `N${i}` }))
  const two = ['Over A', 'Over B'].map((name, i) => ({ ...one, id: `o${i}`, name }))

  let atCap: ReturnType<typeof result.current.presets.importFrom> | undefined
  act(() => {
    result.current.presets.importFrom(JSON.stringify({ version: 1, keyboardUuid: UUID, presets: nine.slice(0, 8) }))
  })
  act(() => {
    atCap = result.current.presets.importFrom(JSON.stringify({ version: 1, keyboardUuid: UUID, presets: [nine[8], ...two] }))
  })
  expect(atCap).toEqual({ ok: true, imported: 1, skipped: ['Over A', 'Over B'] })
  expect(result.current.presets.presets.map((preset) => preset.name)).toEqual(['One', 'N0', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'])

  const exported = result.current.presets.exportAll()!
  act(() => {
    for (const preset of result.current.presets.presets) result.current.presets.remove(preset.id)
  })
  expect(result.current.presets.presets).toHaveLength(0)
  act(() => {
    result.current.presets.importFrom(exported)
  })
  expect(result.current.presets.exportAll()).toBe(exported)
  expect(result.current.presets.importFrom(JSON.stringify({ version: 1, keyboardUuid: 'other', presets: [] }))).toEqual({ ok: false, reason: 'foreign-keyboard' })
})

test('rename trims the name, ignores an empty one, and persists', async () => {
  const { result } = await mount(new MockTransport(CABLE_CAPTURE))
  await act(async () => {
    await result.current.presets.save()
  })
  const id = result.current.presets.presets[0]!.id

  act(() => {
    result.current.presets.rename(id, '  Night  ')
    result.current.presets.rename(id, '   ')
  })
  expect(result.current.presets.presets[0]?.name).toBe('Night')
  expect(stored()[0]?.name).toBe('Night')
})

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { WRITES_DISABLED_REASON } from '../components/presets/PresetDetail'
import { connectedKeyboard, preset, seedPresets } from '../test/presetFixtures'
import PresetsPage from './PresetsPage'

// Frames are queued and flushed by hand, so a preview lands exactly when the test says.
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
beforeEach(() => {
  localStorage.clear()
  frames.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback)
    return nextFrame++
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => vi.unstubAllGlobals())
const flushFrames = () => act(() => {
  const queued = [...frames.values()]
  frames.clear()
  queued.forEach((callback) => callback(performance.now()))
})

const square = (name: string) => screen.getByRole('button', { name })
const stateLine = () => document.querySelector('.preview-head .state')?.textContent

/** Two presets: Alpha is what the keyboard reports; Beta is not. */
const mountWithTwo = (keyboardPartial = {}) => {
  seedPresets([preset('a', 'Alpha'), preset('b', 'Beta', { effect: 'Stars', effectId: 8, brightness: 1 })])
  const onPreview = vi.fn()
  render(<PresetsPage keyboard={connectedKeyboard(keyboardPartial)} onPreview={onPreview} />)
  return { onPreview }
}

test('hover previews on the next frame and the field is told; click selects and the preview is gone at once', () => {
  const { onPreview } = mountWithTwo()
  expect(stateLine()).toBe('keyboard now')

  fireEvent.pointerOver(square('Beta'))
  expect(stateLine()).toBe('keyboard now')   // not before the frame
  flushFrames()
  expect(stateLine()).toBe('previewing — not written')
  expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ effect: 'Stars' }))

  fireEvent.pointerOver(square('Alpha'))     // a pending preview…
  fireEvent.click(square('Beta'))            // …is cancelled by the click, which selects at once
  expect(stateLine()).toBe('selected — not written')
  expect(frames.size).toBe(0)
  expect(screen.getByRole('button', { name: 'Apply “Beta”' })).toBeTruthy()

  fireEvent.pointerLeave(screen.getByRole('group', { name: 'Presets' }))
  flushFrames()
  expect(stateLine()).toBe('selected — not written')
})

test('Escape clears a selection that is not what the keyboard reports, and keeps one that is', () => {
  mountWithTwo()
  const root = document.querySelector('.presets')!

  fireEvent.click(square('Beta'))
  fireEvent.keyDown(root, { key: 'Escape' })
  expect(stateLine()).toBe('keyboard now')

  fireEvent.click(square('Alpha'))
  expect(stateLine()).toBe('selected · matches the keyboard')
  fireEvent.keyDown(root, { key: 'Escape' })
  expect(stateLine()).toBe('selected · matches the keyboard')
})

test('over 2.4G Apply is disabled with the reason, while Save stays available', () => {
  mountWithTwo({ canWrite: false, info: { uuid: '0x030000000197', productName: 'GravaStar Mercury K1 PRO', firmwareVersion: '0x1707', connection: 'wireless' } })

  fireEvent.click(square('Beta'))
  expect(screen.getByRole('button', { name: 'Apply “Beta”' })).toHaveProperty('disabled', true)
  expect(screen.getByText(WRITES_DISABLED_REASON)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save current' })).toHaveProperty('disabled', false)
})

test('disconnected, the Lighting route shows the connect panel', () => {
  render(<PresetsPage keyboard={{ ...connectedKeyboard(), status: 'idle', notice: null }} onPreview={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Connect keyboard' })).toBeTruthy()
})

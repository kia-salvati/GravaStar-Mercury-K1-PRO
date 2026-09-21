import { render, screen } from '@testing-library/react'
import type { Capabilities, LightingState, RGB } from 'k916'
import { expect, test } from 'vitest'
import type { Keyboard } from '../types/keyboard'
import DevicePage from './DevicePage'

const K1_PRO: Capabilities = {
  layers: 3, slots: 126, keyCount: 84, macroBytes: 512, hasScreen: false, battery: 'wireless',
  lighting: { speedStages: 4, speedStep: 1, brightnessStages: 4, brightnessStep: 1 },
  effectIds: [0, 277, 1, 3, 4, 7, 8, 11, 12, 13, 15, 16, 17],
}

const onCable: Keyboard = {
  status: 'connected',
  info: { uuid: '0x030000000197', productName: 'GravaStar Mercury K1 PRO', firmwareVersion: '0x1707', connection: 'wired' },
  capabilities: K1_PRO,
  reportsBattery: false,
  power: null,
  lighting: { effectId: 17, effect: 'Blooming', colourMode: 'mixed', brightness: 2, speed: 1, mixing: true },
  effectColour: { r: 0, g: 255, b: 0 },
  notice: null,
  connect: async () => {},
  refresh: async () => {},
}

test('on cable the battery sentence is full weight, sleep is absent and the mixed colour is explained', () => {
  render(<DevicePage keyboard={onCable} />)

  const sentence = screen.getByText('Battery not reported on cable')
  expect(sentence.tagName).toBe('STRONG')
  expect(sentence.closest('.note')?.classList.contains('muted')).toBe(false)
  expect(screen.getByText('On cable')).toBeTruthy()
  expect(screen.getByText('Blooming')).toBeTruthy()
  expect(screen.getByText('Mixed colours — set by the effect')).toBeTruthy()
  expect(screen.getByRole('img', { name: 'Brightness 2 of 1–4' })).toBeTruthy()
  expect(screen.queryByText('Sleep')).toBeNull()
})

const withLighting = (lighting: LightingState, effectColour: RGB | null): Keyboard => ({ ...onCable, lighting, effectColour })

test('a single-colour effect with mixing off shows its swatch and the hex read from the keyboard', () => {
  render(<DevicePage keyboard={withLighting({ effectId: 1, effect: 'Always On', colourMode: 'single', brightness: 4, speed: 0, mixing: false }, { r: 0, g: 0, b: 255 })} />)

  const hex = screen.getByText('#0000ff')
  expect(hex.previousElementSibling?.getAttribute('style')).toContain('background: rgb(0, 0, 255)')
  expect(screen.queryByText(/Mixed colours/)).toBeNull()
})

test('a single-colour effect with mixing on reads as mixed and hides its colour', () => {
  render(<DevicePage keyboard={withLighting({ effectId: 11, effect: 'Wave', colourMode: 'single', brightness: 1, speed: 1, mixing: true }, { r: 0, g: 0, b: 255 })} />)

  expect(screen.getByText('Mixed colours — set by the effect')).toBeTruthy()
  expect(screen.queryByText('#0000ff')).toBeNull()
})

test('Custom is per-key and has no colour slot to show', () => {
  render(<DevicePage keyboard={withLighting({ effectId: 277, effect: 'Custom', colourMode: 'perKey', brightness: 0, speed: 0, mixing: false }, null)} />)

  expect(screen.getByText('Per-key RGB — set per key in Lighting')).toBeTruthy()
})

test('disconnected, the page is the connect panel with the reason', () => {
  render(<DevicePage keyboard={{ status: 'idle', notice: 'Dongle was disconnected.', connect: async () => {}, refresh: async () => {} }} />)

  expect(screen.getByRole('status').textContent).toBe('Dongle was disconnected.')
  expect(screen.getByRole('button', { name: 'Connect keyboard' })).toBeTruthy()
})

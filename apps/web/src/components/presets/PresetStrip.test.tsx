import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { focusWithoutPreview } from '../../utils/focus'
import { lookOfPreset } from '../../utils/look'
import { preset } from '../../test/presetFixtures'
import PresetStrip from './PresetStrip'

const presets = [preset('a', 'Alpha'), preset('b', 'Beta', { effect: 'Stars', effectId: 8, brightness: 1 }), preset('c', 'Gamma', { effect: 'Windmill', effectId: 15, colourMode: 'mixed', mixing: true, colourHex: null })]
const looks = new Map(presets.map((p) => [p.id, lookOfPreset(p)]))

const mount = () => {
  const onPreview = vi.fn()
  const onSelect = vi.fn()
  const onSave = vi.fn()
  render(<PresetStrip presets={presets} looks={looks} selectedId={null} currentLook={looks.get('a')!} mode={null} applying={false} busy={false} onSelect={onSelect} onPreview={onPreview} onSave={onSave} />)
  const strip = screen.getByRole('group', { name: 'Presets' })
  const square = (name: string) => screen.getByRole('button', { name })
  return { strip, square, onPreview, onSelect, onSave }
}

test('hovering a square previews it; leaving the strip, not the square, clears the preview', () => {
  const { square, onPreview } = mount()

  fireEvent.pointerOver(square('Beta').firstElementChild!)   // over a child: the square still counts
  expect(onPreview).toHaveBeenLastCalledWith('b')
  fireEvent.pointerOut(square('Beta'), { relatedTarget: square('Gamma') })   // square to square: no leave
  expect(onPreview).toHaveBeenCalledTimes(1)
  fireEvent.pointerOut(square('Gamma'), { relatedTarget: document.body })   // out of the strip
  expect(onPreview).toHaveBeenLastCalledWith(null)
  expect(onPreview).toHaveBeenCalledTimes(2)
})

test('focus previews like hover; restoring focus programmatically does not', () => {
  const { strip, square, onPreview } = mount()

  square('Beta').focus()
  expect(onPreview).toHaveBeenLastCalledWith('b')
  fireEvent.blur(strip, { relatedTarget: document.body })
  expect(onPreview).toHaveBeenLastCalledWith(null)

  onPreview.mockClear()
  focusWithoutPreview(square('Gamma'))
  expect(document.activeElement).toBe(square('Gamma'))
  expect(onPreview).not.toHaveBeenCalled()
})

test('a click selects, and the strip asks for the preview to go at once', () => {
  const { square, onSelect, onPreview } = mount()

  fireEvent.click(square('Gamma').firstElementChild!)
  expect(onSelect).toHaveBeenCalledWith('c')
  expect(onPreview).not.toHaveBeenCalled()
})

test('Arrow Up/Down, Home and End rove the squares and the add square', () => {
  const { square } = mount()
  const add = screen.getByRole('button', { name: 'Save current' })

  square('Alpha').focus()
  fireEvent.keyDown(square('Alpha'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(square('Beta'))
  fireEvent.keyDown(square('Beta'), { key: 'End' })
  expect(document.activeElement).toBe(add)
  fireEvent.keyDown(add, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(add)
  fireEvent.keyDown(add, { key: 'Home' })
  expect(document.activeElement).toBe(square('Alpha'))
  fireEvent.keyDown(square('Alpha'), { key: 'ArrowUp' })
  expect(document.activeElement).toBe(square('Alpha'))
})

test('the add square saves, and the current-lighting dot marks the matching preset', () => {
  const { onSave } = mount()

  fireEvent.click(screen.getByRole('button', { name: 'Save current' }))
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Alpha' }).querySelector('.cur')).not.toBeNull()
  expect(screen.getByRole('button', { name: 'Beta' }).querySelector('.cur')).toBeNull()
})

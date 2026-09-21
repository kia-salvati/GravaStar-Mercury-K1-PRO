import { render, screen } from '@testing-library/react'
import type { RestoreStep } from 'k916'
import { expect, test, vi } from 'vitest'
import { lookOfPreset } from '../../utils/look'
import { preset } from '../../test/presetFixtures'
import { ApplyProgressSheet } from './PresetSheets'

const step = (block: RestoreStep['block'], state: RestoreStep['state']): RestoreStep => ({ block, state })
const rows = () => [...document.querySelectorAll('ul.check li')].map((li) => li.getAttribute('data-status'))
const done = () => screen.getByRole('button', { name: 'Done' })

test('rows follow the steps: verified, writing, pending — and Done waits', () => {
  render(<ApplyProgressSheet name="Night" steps={[step('profile', 'writing'), step('profile', 'verified'), step('lightColour', 'writing')]} result={null} readBack={null} failure={null} onDone={vi.fn()} returnTo={() => null} />)

  expect(rows()).toEqual(['verified', 'writing', 'pending'])
  expect(done()).toHaveProperty('disabled', true)
  expect(screen.getByRole('dialog', { name: 'Applying “Night”…' })).toBeTruthy()
})

test('with every block verified and a result, Done unlocks and the read-back is shown', () => {
  const all = [step('profile', 'writing'), step('profile', 'verified'), step('lightColour', 'writing'), step('lightColour', 'verified'), step('customColour', 'writing'), step('customColour', 'verified')]
  render(<ApplyProgressSheet name="Night" steps={all} result={{ ok: true }} readBack={lookOfPreset(preset('x', 'Night'))} failure={null} onDone={vi.fn()} returnTo={() => null} />)

  expect(rows()).toEqual(['verified', 'verified', 'verified'])
  expect(done()).toHaveProperty('disabled', false)
  expect(screen.getByText(/all three blocks match/)).toBeTruthy()
})

test('a failed apply unlocks Done and says why', () => {
  render(<ApplyProgressSheet name="Night" steps={[step('profile', 'writing')]} result={{ ok: false, reason: 'device' }} readBack={null} failure="Restore failed: read-back differs" onDone={vi.fn()} returnTo={() => null} />)

  expect(done()).toHaveProperty('disabled', false)
  expect(screen.getByText(/read-back differs/)).toBeTruthy()
})

import { expect, test } from 'vitest'
import { isLowBattery, powerLabel } from './power'

test('the power line reads the flags the keyboard sends', () => {
  expect(powerLabel({ percent: 100, charging: false, full: true })).toBe('Full · not charging')
  expect(powerLabel({ percent: 23, charging: true, full: false })).toBe('Charging')
  expect(powerLabel({ percent: 8, charging: false, full: false })).toBe('Low · not charging')
  expect(powerLabel({ percent: 61, charging: false, full: false })).toBe('Not charging')
})

test('a charging battery is never shown as low', () => {
  expect(isLowBattery({ percent: 8, charging: true, full: false })).toBe(false)
})

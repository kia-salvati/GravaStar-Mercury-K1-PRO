import { expect, test } from 'vitest'
import { sleepLabel } from './sleep'

test('the sleep line reads the timer in minutes, seconds for the half-minute floor, or off', () => {
  expect(sleepLabel({ enabled: true, minutes: 9.5 })).toBe('Sleep after 9.5 min')
  expect(sleepLabel({ enabled: true, minutes: 1 })).toBe('Sleep after 1 min')
  expect(sleepLabel({ enabled: true, minutes: 0.5 })).toBe('Sleep after 30 s')
  expect(sleepLabel({ enabled: false, minutes: 0 })).toBe('Sleep timer off')
})

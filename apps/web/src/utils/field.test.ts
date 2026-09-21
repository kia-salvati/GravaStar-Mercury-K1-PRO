import { expect, test } from 'vitest'
import { brightnessLevel, brightnessStage, fieldMotion, fieldOpacity, isAnimated, speedPeriodSeconds } from './field'

test('every brightness stage round-trips through its level', () => {
  for (const stage of [0, 1, 2, 3, 4]) expect(brightnessStage(brightnessLevel(stage))).toBe(stage)
})

test('a level no stage produces has no stage', () => {
  expect(brightnessStage(0.5)).toBe(-1)
})

test('stages outside the keyboard range clamp instead of escaping the cap', () => {
  expect(brightnessLevel(-1)).toBe(0)
  expect(brightnessLevel(9)).toBe(1)
  expect(fieldOpacity(9, 0.34)).toBe(0.34)
  expect(speedPeriodSeconds(9)).toBe(speedPeriodSeconds(4))
})

test('the K1 PRO effects map to the motions the spec names', () => {
  expect(fieldMotion('Windmill', 'mixed')).toBe('windmill')
  expect(fieldMotion('Blooming', 'mixed')).toBe('bloom')
  expect(fieldMotion('Stars', 'single')).toBe('stars')
  expect(fieldMotion('Always On', 'single')).toBe('solid')
  expect(fieldMotion('Off', 'none')).toBe('off')
  expect(isAnimated('windmill')).toBe(true)
  expect(isAnimated('solid')).toBe(false)
})

test('an effect the table does not know falls back to its colour mode', () => {
  expect(fieldMotion('Breathing', 'single')).toBe('solid')
  expect(fieldMotion('Effect(99)', 'mixed')).toBe('rainbow')
})

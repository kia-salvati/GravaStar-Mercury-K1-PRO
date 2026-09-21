import { expect, test } from 'vitest'
import { VERSION } from '../src/index.js'

test('package exports a version', () => {
  expect(VERSION).toBe('0.1.0')
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, expect, test } from 'vitest'
import type { ResolvedTheme } from '../config/settings'
import { brightnessLevel, fieldOpacity } from '../utils/field'

/** The per-theme ceilings the design measured contrast against. */
const CAP_BY_THEME: Record<ResolvedTheme, number> = { white: 0.34, dark: 0.14, black: 0.26 }
const STAGES = [0, 1, 2, 3, 4]

const computedCap = (theme: ResolvedTheme): number => {
  document.documentElement.dataset.theme = theme
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cap'))
}

beforeAll(() => {
  const style = document.createElement('style')
  style.textContent = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')
  document.head.append(style)
})

test.each(Object.entries(CAP_BY_THEME))('%s: the computed --cap is the design cap and no stage draws above it', (theme, expected) => {
  const cap = computedCap(theme as ResolvedTheme)
  expect(cap).toBe(expected)
  for (const stage of STAGES) expect(fieldOpacity(stage, cap)).toBeLessThanOrEqual(cap)
  expect(Math.max(...STAGES.map((stage) => fieldOpacity(stage, cap)))).toBe(cap)
})

test('the stylesheet multiplies --cap by --lvl, and --lvl is never above 1', () => {
  expect(readFileSync(resolve(__dirname, 'app.css'), 'utf8')).toContain('opacity: calc(var(--cap) * var(--lvl))')
  for (const stage of [...STAGES, 9, 20]) expect(brightnessLevel(stage)).toBeLessThanOrEqual(1)
})

import { useCallback, useLayoutEffect, useState } from 'react'
import { FIELDS, STORAGE_KEYS, THEMES, type Field, type ResolvedTheme, type Theme } from '../config/settings'
import { useMediaQuery } from './useMediaQuery'

export interface Settings {
  theme: Theme
  field: Field
  resolvedTheme: ResolvedTheme
  /** The OS asks for reduced motion; the stylesheet freezes the ambient field regardless of `field`. */
  reducedMotion: boolean
  setTheme(theme: Theme): void
  setField(field: Field): void
}

const isOneOf = <T extends string>(allowed: readonly T[], value: string | null): value is T => allowed.some((known) => known === value)

const readStored = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const stored = localStorage.getItem(key)
    return isOneOf(allowed, stored) ? stored : fallback
  } catch (error) {
    console.error('[settings] could not read', key, error)
    return fallback
  }
}

const store = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch (error) {
    console.error('[settings] could not save', key, error)
  }
}

export function useSettings(): Settings {
  const [theme, setThemeState] = useState(() => readStored(STORAGE_KEYS.theme, THEMES, 'system'))
  const [field, setFieldState] = useState(() => readStored(STORAGE_KEYS.field, FIELDS, 'ambient'))
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const resolvedTheme: ResolvedTheme = theme === 'system' ? (prefersDark ? 'dark' : 'white') : theme

  // Before paint, so the first frame is already themed. The window's own colour (title bar,
  // splash) follows the theme's --bg rather than a second copy of that value.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    root.dataset.field = field
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim())
  }, [resolvedTheme, field])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    store(STORAGE_KEYS.theme, next)
  }, [])
  const setField = useCallback((next: Field) => {
    setFieldState(next)
    store(STORAGE_KEYS.field, next)
  }, [])

  return { theme, field, resolvedTheme, reducedMotion, setTheme, setField }
}

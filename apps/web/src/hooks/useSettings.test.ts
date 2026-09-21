import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, test } from 'vitest'
import { useSettings } from './useSettings'

beforeEach(() => localStorage.clear())

test('defaults follow the system and draw the ambient field', () => {
  const { result } = renderHook(() => useSettings())

  expect(result.current).toMatchObject({ theme: 'system', resolvedTheme: 'white', field: 'ambient' })
  expect(document.documentElement.dataset).toMatchObject({ theme: 'white', field: 'ambient' })
})

test('a change applies to the document at once and survives a reload', () => {
  const first = renderHook(() => useSettings())
  act(() => {
    first.result.current.setTheme('black')
    first.result.current.setField('static')
  })
  expect(document.documentElement.dataset).toMatchObject({ theme: 'black', field: 'static' })
  first.unmount()

  const second = renderHook(() => useSettings())
  expect(second.result.current).toMatchObject({ theme: 'black', resolvedTheme: 'black', field: 'static' })
})

test('a stored value the app does not know falls back to the default', () => {
  localStorage.setItem('k1.theme', 'sepia')
  const { result } = renderHook(() => useSettings())

  expect(result.current.theme).toBe('system')
})

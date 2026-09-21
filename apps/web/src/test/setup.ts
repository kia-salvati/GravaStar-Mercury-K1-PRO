import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts between tests on its own when vitest globals are on.
afterEach(cleanup)

// jsdom has no matchMedia; the hooks only need a list that never matches and never changes.
const stillList = (query: string): MediaQueryList => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})

Object.defineProperty(window, 'matchMedia', { writable: true, value: stillList })

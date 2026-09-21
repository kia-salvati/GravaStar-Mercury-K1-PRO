import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('without WebHID the whole tree renders: rail, field and the honest connect panel', () => {
  render(<App />)

  expect(screen.getByText('WebHID is not available here')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'Areas' }).querySelectorAll('a')).toHaveLength(5)
  expect(screen.getByRole('link', { name: 'Device' }).getAttribute('aria-current')).toBe('page')
  expect(document.querySelector('.field')?.getAttribute('data-fx')).toBe('off')
})

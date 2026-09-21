import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import WriteButton from './WriteButton'

test('while the keyboard is busy the button is disabled and a click does nothing', () => {
  const onClick = vi.fn(async () => {})
  render(<WriteButton busy onClick={onClick}>Apply</WriteButton>)

  const button = screen.getByRole('button', { name: 'Apply' })
  expect(button).toHaveProperty('disabled', true)
  fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
})

test('its own call disables it and shows Working… until the result is back', async () => {
  let finish = () => {}
  const onClick = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
  render(<WriteButton busy={false} onClick={onClick}>Apply</WriteButton>)

  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
  const working = screen.getByRole('button', { name: 'Working…' })
  expect(working).toHaveProperty('disabled', true)
  expect(onClick).toHaveBeenCalledTimes(1)

  await act(async () => finish())
  expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', false)
})

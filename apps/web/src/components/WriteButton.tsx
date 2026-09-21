import { useState, type ReactNode } from 'react'

interface Props {
  busy: boolean
  /** A reason the write cannot happen at all right now (say it next to the button). */
  disabled?: boolean
  onClick: () => Promise<void>
  /** Focus key, so a sheet can return focus here. */
  fk?: string
  children: ReactNode
}

/**
 * The one button for anything that writes to the keyboard. It is disabled while any device call
 * is in flight and shows "Working…" while its own call runs, so a click can never reach the
 * library's busy refusal in normal use — that refusal is the backstop, not the experience.
 */
export default function WriteButton({ busy, disabled = false, onClick, fk, children }: Props) {
  const [working, setWorking] = useState(false)

  const click = async () => {
    setWorking(true)
    try {
      await onClick()
    } finally {
      setWorking(false)
    }
  }

  return (
    <button type="button" className="btn" disabled={busy || disabled || working} aria-busy={working} data-fk={fk} onClick={click}>
      {working ? 'Working…' : children}
    </button>
  )
}

import { useState, type ReactNode } from 'react'

/**
 * The one button for anything that writes to the keyboard. It is disabled while any device call
 * is in flight and shows "Working…" while its own call runs, so a click can never reach the
 * library's busy refusal in normal use — that refusal is the backstop, not the experience.
 */
export default function WriteButton({ busy, onClick, children }: { busy: boolean; onClick: () => Promise<void>; children: ReactNode }) {
  const [working, setWorking] = useState(false)
  const disabled = busy || working

  const click = async () => {
    setWorking(true)
    try {
      await onClick()
    } finally {
      setWorking(false)
    }
  }

  return (
    <button type="button" className="btn" disabled={disabled} aria-busy={working} onClick={click}>
      {working ? 'Working…' : children}
    </button>
  )
}

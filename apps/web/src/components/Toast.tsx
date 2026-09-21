import { useEffect } from 'react'

const TOAST_MS = 6000

/** A short confirmation. Its auto-dismiss is the one timer the screen allows itself. */
export default function Toast({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_MS)
    return () => clearTimeout(timer)
  }, [text, onDismiss])
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      <button type="button" className="link" onClick={onDismiss}>Dismiss</button>
    </div>
  )
}

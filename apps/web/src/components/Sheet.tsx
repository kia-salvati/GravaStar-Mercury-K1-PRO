import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { focusWithoutPreview } from '../utils/focus'

interface Props {
  label: string
  /** False for a sheet that must run to completion: no Escape, no scrim click. */
  dismissable?: boolean
  onClose: () => void
  /** Where focus goes when the sheet unmounts, resolved at that moment. */
  returnTo: () => HTMLElement | null
  children: ReactNode
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])'

/** A bottom sheet over the panel: focus moves in on open, Tab stays inside, and focus goes back to the opener on close. */
export default function Sheet({ label, dismissable = true, onClose, returnTo, children }: Props) {
  const sheet = useRef<HTMLDivElement>(null)
  const latestReturnTo = useRef(returnTo)
  latestReturnTo.current = returnTo

  useEffect(() => {
    const first = sheet.current?.querySelector<HTMLElement>('[data-primary]') ?? sheet.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    return () => focusWithoutPreview(latestReturnTo.current())
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (dismissable) onClose()
      return
    }
    if (event.key !== 'Tab' || !sheet.current) return
    const focusable = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const index = focusable.indexOf(document.activeElement as HTMLElement)
    const last = focusable.length - 1
    if (event.shiftKey && index <= 0) {
      event.preventDefault()
      focusable[last]?.focus()
    } else if (!event.shiftKey && index === last) {
      event.preventDefault()
      focusable[0]?.focus()
    }
  }

  const onScrimClick = (event: MouseEvent<HTMLDivElement>) => {
    if (dismissable && event.target === event.currentTarget) onClose()
  }

  return (
    <div className="sheet-wrap" onClick={onScrimClick} onKeyDown={onKeyDown}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} ref={sheet}>
        {children}
      </div>
    </div>
  )
}

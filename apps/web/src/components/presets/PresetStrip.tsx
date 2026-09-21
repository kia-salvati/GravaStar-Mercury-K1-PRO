import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { isRestoringFocus } from '../../utils/focus'
import { looksEqual, type Look } from '../../utils/look'
import { PRESET_LIMIT, type Preset } from '../../utils/presets'
import PresetSquare from './PresetSquare'

interface Props {
  presets: Preset[]
  looks: ReadonlyMap<string, Look>
  selectedId: string | null
  currentLook: Look
  mode: 'replace' | null
  /** An apply is running: the strip is inert and previews are not accepted. */
  applying: boolean
  /** A device call is in flight: saving (a read) waits. */
  busy: boolean
  onSelect: (id: string) => void
  onPreview: (id: string | null) => void
  onSave: () => void
}

const squareOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('[data-id]') : null)

/** Focus target for a roving key: index of the current square → index of the next. */
const ROVE: Readonly<Record<string, (index: number, last: number) => number>> = {
  ArrowDown: (index, last) => Math.min(last, index + 1),
  ArrowUp: (index) => Math.max(0, index - 1),
  Home: () => 0,
  End: (_index, last) => last,
}

/**
 * The glass column of squares. One `pointerover` starts a preview and one `pointerleave` of the
 * whole strip ends it — never a per-square leave — and focus in/out mirror that for the keyboard.
 */
export default function PresetStrip({ presets, looks, selectedId, currentLook, mode, applying, busy, onSelect, onPreview, onSave }: Props) {
  const full = presets.length >= PRESET_LIMIT
  const isCurrent = (id: string) => {
    const look = looks.get(id)
    return look !== undefined && looksEqual(look, currentLook)
  }

  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    const square = squareOf(event.target)
    if (square) onPreview(square.dataset.id ?? null)
  }
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (isRestoringFocus()) return
    onPreview(squareOf(event.target)?.dataset.id ?? null)
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) onPreview(null)
  }
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const square = squareOf(event.target)
    if (square?.dataset.id) {
      onSelect(square.dataset.id)
      return
    }
    if (event.target instanceof Element && event.target.closest('[data-fk="save"]')) onSave()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rove = ROVE[event.key]
    if (!rove) return
    const squares = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.sq')]
    const index = squares.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    squares[rove(index, squares.length - 1)]?.focus()
  }

  return (
    <div className="sqrail glass" role="group" aria-label="Presets" inert={applying} aria-busy={applying} onPointerOver={onPointerOver} onPointerLeave={() => onPreview(null)} onFocus={onFocus} onBlur={onBlur} onClick={onClick} onKeyDown={onKeyDown}>
      {presets.map((preset, index) => (
        <PresetSquare key={preset.id} preset={preset} look={looks.get(preset.id) ?? currentLook} index={index} selected={preset.id === selectedId} current={isCurrent(preset.id)} replaceMode={mode === 'replace'} />
      ))}
      {full ? (
        <button type="button" className="sq add full" data-fk="save" aria-pressed={mode === 'replace'} aria-label={`${PRESET_LIMIT} of ${PRESET_LIMIT} — save current by replacing one`} disabled={busy}>
          <span>Full</span>
          <span className="tip">{mode === 'replace' ? 'Pick one to replace, or tap to cancel' : 'Full — replace one with current'}</span>
        </button>
      ) : (
        <button type="button" className="sq add" data-fk="save" aria-label="Save current" disabled={busy}>
          +<span className="tip">Save current · {presets.length} of {PRESET_LIMIT}</span>
        </button>
      )}
      <span className="C-count">{presets.length}/{PRESET_LIMIT}</span>
    </div>
  )
}


import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react'
import { formatSavedAt, type Preset } from '../../utils/presets'
import WriteButton from '../WriteButton'

interface Props {
  preset: Preset
  isCurrent: boolean
  renaming: boolean
  canWrite: boolean
  busy: boolean
  onApply: () => void
  onStartRename: () => void
  onRename: (name: string) => void
  onCancelRename: () => void
  onDelete: () => void
}

export const WRITES_DISABLED_REASON = 'Writes are disabled over 2.4G — connect the cable.'
const NAME_MAX = 24

function NameInput({ name, onRename, onCancel }: { name: string; onRename: (name: string) => void; onCancel: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') onRename(event.currentTarget.value)
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }
  const onBlur = (event: FocusEvent<HTMLInputElement>) => onRename(event.currentTarget.value)

  return <input className="name-input" data-fk="rename-input" defaultValue={name} maxLength={NAME_MAX} aria-label="Preset name" ref={input} onKeyDown={onKeyDown} onBlur={onBlur} />
}

/** The selected preset: its name, when it was saved, and the three things that can be done with it. */
export default function PresetDetail({ preset, isCurrent, renaming, canWrite, busy, onApply, onStartRename, onRename, onCancelRename, onDelete }: Props) {
  return (
    <div className="detail">
      {renaming ? <NameInput name={preset.name} onRename={onRename} onCancel={onCancelRename} /> : <div className="nm" title={preset.name}>{preset.name}</div>}
      <div className="dt">Saved {formatSavedAt(preset.savedAt)}{isCurrent && ' · this is what the keyboard reports now'}</div>
      <div className="actions">
        <WriteButton busy={busy} disabled={!canWrite} onClick={async () => onApply()} fk="apply">Apply “{preset.name}”</WriteButton>
        <button type="button" className="btn quiet sm" data-fk="rename" onClick={onStartRename}>Rename</button>
        <button type="button" className="btn danger sm" data-fk="delete" onClick={onDelete}>Delete</button>
      </div>
      {!canWrite && <p className="help">{WRITES_DISABLED_REASON}</p>}
    </div>
  )
}

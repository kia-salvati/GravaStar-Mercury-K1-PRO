import { useState } from 'react'
import type { RestoreStep } from 'k916'
import type { ApplyResult } from '../../hooks/usePresets'
import type { Look } from '../../utils/look'
import { formatSavedAt, PRESET_LIMIT, type Preset } from '../../utils/presets'
import LookSwatch from '../LookSwatch'
import Sheet from '../Sheet'

type ReturnTo = () => HTMLElement | null

const summary = (look: Look): string => `${look.effect}, brightness ${look.brightness}, speed ${look.speed}`

interface Block {
  block: RestoreStep['block']
  name: string
  detail: string
}
const BLOCKS: readonly Block[] = [
  { block: 'profile', name: 'Profile block', detail: 'effect, brightness, speed, mixing' },
  { block: 'lightColour', name: 'Effect colours', detail: '13 × RGB' },
  { block: 'customColour', name: 'Per-key colours', detail: '126 × RGB' },
]
type BlockStatus = 'pending' | 'writing' | 'verified'
const STATUS_LABEL: Record<BlockStatus, string> = { pending: 'pending', writing: 'writing…', verified: 'verified' }
const STATUS_CLASS: Record<BlockStatus, string> = { pending: 'pend', writing: 'busy', verified: 'ok' }
const STATUS_SHARE: Record<BlockStatus, number> = { pending: 0, writing: 0.5, verified: 1 }

const statusOf = (steps: readonly RestoreStep[], block: RestoreStep['block']): BlockStatus => {
  if (steps.some((step) => step.block === block && step.state === 'verified')) return 'verified'
  if (steps.some((step) => step.block === block)) return 'writing'
  return 'pending'
}

export function ConfirmApplySheet({ preset, current, onApply, onSaveFirst, onClose, returnTo }: { preset: Preset; current: Look; onApply: () => void; onSaveFirst: () => void; onClose: () => void; returnTo: ReturnTo }) {
  return (
    <Sheet label={`Apply ${preset.name}`} onClose={onClose} returnTo={returnTo}>
      <h2>Apply “{preset.name}” to the keyboard?</h2>
      <p className="body">This writes to the board and takes about two seconds. Its current lighting — <strong>{summary(current)}</strong> — is not saved anywhere and will be overwritten.</p>
      <ul className="check">
        {BLOCKS.map(({ block, name, detail }) => (
          <li key={block}><span><strong>{name}</strong> <span className="dim">{detail}</span></span><span className="pend">will write</span></li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="btn" data-primary onClick={onApply}>Apply</button>
        <button type="button" className="btn quiet" onClick={onSaveFirst}>Save current first</button>
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  )
}

interface ProgressProps {
  name: string
  steps: readonly RestoreStep[]
  /** Null while the restore runs. */
  result: ApplyResult | null
  /** What the keyboard reports after a successful apply. */
  readBack: Look | null
  /** Why a failed apply failed, from the keyboard hook. */
  failure: string | null
  onDone: () => void
  returnTo: ReturnTo
}

/** Cannot be dismissed: the write runs to its end. Done unlocks once every block is verified (or the apply has failed). */
export function ApplyProgressSheet({ name, steps, result, readBack, failure, onDone, returnTo }: ProgressProps) {
  const statuses = BLOCKS.map(({ block }) => statusOf(steps, block))
  const progress = statuses.reduce((sum, status) => sum + STATUS_SHARE[status], 0) / BLOCKS.length
  const finished = result !== null && (!result.ok || statuses.every((status) => status === 'verified'))
  const title = result === null ? `Applying “${name}”…` : result.ok ? `Applied “${name}”` : `Apply of “${name}” failed`
  return (
    <Sheet label={title} dismissable={false} onClose={onDone} returnTo={returnTo}>
      <h2>{title}</h2>
      {result === null && <p className="body">Each block is written, then given half a second to settle before it is read back.</p>}
      {result?.ok && readBack && <p className="body">Read back from the keyboard: <strong>{summary(readBack)} · mixing {readBack.mixing ? 'on' : 'off'}</strong> — all three blocks match.</p>}
      {result && !result.ok && <p className="body">{failure ?? 'The keyboard did not confirm the write.'} The blocks already verified stay as written.</p>}
      <ul className="check">
        {BLOCKS.map(({ block, name: blockName, detail }, index) => {
          const status = statuses[index] ?? 'pending'
          return (
            <li key={block} data-status={status}><span><strong>{blockName}</strong> <span className="dim">{detail}</span></span><span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span></li>
          )
        })}
      </ul>
      <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="actions">
        <button type="button" className="btn" data-primary disabled={!finished} onClick={onDone}>Done</button>
      </div>
    </Sheet>
  )
}

export function ConfirmDeleteSheet({ preset, onDelete, onClose, returnTo }: { preset: Preset; onDelete: () => void; onClose: () => void; returnTo: ReturnTo }) {
  return (
    <Sheet label={`Delete ${preset.name}`} onClose={onClose} returnTo={returnTo}>
      <h2>Delete “{preset.name}”?</h2>
      <p className="body">The keyboard is not touched; only the saved snapshot goes. There is no undo — Export first if you want a copy.</p>
      <div className="actions">
        <button type="button" className="btn danger" data-primary onClick={onDelete}>Delete</button>
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  )
}

export function ConfirmReplaceSheet({ preset, look, current, onReplace, onClose, returnTo }: { preset: Preset; look: Look; current: Look; onReplace: () => void; onClose: () => void; returnTo: ReturnTo }) {
  return (
    <Sheet label={`Replace ${preset.name}`} onClose={onClose} returnTo={returnTo}>
      <h2>Replace “{preset.name}” with the current lighting?</h2>
      <p className="body">The snapshot of <strong>{summary(look)}</strong> from {formatSavedAt(preset.savedAt)} is discarded and “{preset.name}” becomes <strong>{summary(current)}</strong>. The keyboard is not touched.</p>
      <div className="actions">
        <button type="button" className="btn" data-primary onClick={onReplace}>Replace</button>
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  )
}

interface ImportProps {
  fileName: string
  incoming: Preset[]
  looks: ReadonlyMap<string, Look>
  free: number
  onImport: (picks: Preset[]) => void
  onClose: () => void
  returnTo: ReturnTo
}

const slots = (n: number): string => `${n} slot${n === 1 ? '' : 's'}`

/** Ticks default to what fits; the tally keeps the count honest and the button off while it is over. */
export function ImportSheet({ fileName, incoming, looks, free, onImport, onClose, returnTo }: ImportProps) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(incoming.slice(0, free).map((preset) => preset.id)))
  const over = ticked.size - free
  const toggle = (id: string) => setTicked((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const fit = free >= incoming.length ? `${slots(free)} free — all fit.` : free === 0 ? `No slots free (${PRESET_LIMIT} of ${PRESET_LIMIT}). Delete some first.` : `${slots(free)} free for ${incoming.length} presets. Untick ${incoming.length - free}.`
  return (
    <Sheet label="Import presets" onClose={onClose} returnTo={returnTo}>
      <h2>Import {incoming.length} preset{incoming.length === 1 ? '' : 's'}</h2>
      <p className="body">From <span className="mono">{fileName}</span>, saved for this keyboard. <strong>{fit}</strong></p>
      <ul className="check">
        {incoming.map((preset) => {
          const look = looks.get(preset.id)
          return (
            <li key={preset.id}>
              <label className="pick">
                <input type="checkbox" checked={ticked.has(preset.id)} onChange={() => toggle(preset.id)} />
                {look && <LookSwatch look={look} />}
                <span><strong>{preset.name}</strong> <span className="dim">{preset.readout.effect} · B{preset.readout.brightness} S{preset.readout.speed}</span></span>
              </label>
            </li>
          )
        })}
      </ul>
      <p className="body tally">{over > 0 ? <strong className="over">{ticked.size} ticked, {free} free — {over} too many.</strong> : `${ticked.size} ticked, ${slots(free - ticked.size)} left after.`}</p>
      <div className="actions">
        <button type="button" className="btn" data-primary disabled={over > 0 || ticked.size === 0} onClick={() => onImport(incoming.filter((preset) => ticked.has(preset.id)))}>Import ticked</button>
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  )
}

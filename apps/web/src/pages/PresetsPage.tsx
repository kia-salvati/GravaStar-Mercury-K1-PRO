import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import Card from '../components/Card'
import ConnectPanel from '../components/ConnectPanel'
import PresetDetail from '../components/presets/PresetDetail'
import PresetPreview from '../components/presets/PresetPreview'
import { ApplyProgressSheet, ConfirmApplySheet, ConfirmDeleteSheet, ConfirmReplaceSheet, ImportSheet } from '../components/presets/PresetSheets'
import PresetStrip from '../components/presets/PresetStrip'
import Toast from '../components/Toast'
import { usePresets, type ApplyResult } from '../hooks/usePresets'
import type { Connected, Keyboard } from '../types/keyboard'
import { focusWithoutPreview } from '../utils/focus'
import { lookOfKeyboard, lookOfPreset, looksEqual, type Look } from '../utils/look'
import { deserialise, PRESET_LIMIT, PRESETS_FILE_VERSION, serialise, type Preset, type PresetsFileFailure } from '../utils/presets'

type SheetState =
  | { kind: 'confirmApply'; preset: Preset }
  | { kind: 'applyProgress'; preset: Preset; result: ApplyResult | null }
  | { kind: 'confirmDelete'; preset: Preset }
  | { kind: 'confirmReplace'; preset: Preset }
  | { kind: 'import'; fileName: string; incoming: Preset[] }

const IMPORT_FAILURE: Record<PresetsFileFailure, string> = {
  'invalid-json': 'That file is not a presets file.',
  'wrong-version': 'That presets file is from a newer app version.',
  'foreign-keyboard': 'That file was saved for a different keyboard, so it was refused.',
  'invalid-preset': 'That file holds a preset this app cannot read.',
}

/**
 * Preview changes are coalesced to one animation frame; a click needs the preview gone at once,
 * so it cancels the pending frame. There is no timer anywhere in this.
 */
function useFramedPreview(): [string | null, (id: string | null) => void, () => void] {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const pending = useRef<string | null>(null)
  const frame = useRef(0)
  const schedule = useCallback((id: string | null) => {
    if (pending.current === id) return
    pending.current = id
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        setPreviewId(pending.current)
      })
    }
  }, [])
  const clearNow = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = 0
    pending.current = null
    setPreviewId(null)
  }, [])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return [previewId, schedule, clearNow]
}

const downloadJson = (fileName: string, json: string): void => {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

interface Props {
  keyboard: Keyboard
  /** The look the field should draw instead of the keyboard's, or null for the keyboard's. */
  onPreview: (look: Look | null) => void
}

export default function PresetsPage({ keyboard, onPreview }: Props) {
  if (keyboard.status !== 'connected') return <ConnectPanel status={keyboard.status} notice={keyboard.notice} onConnect={keyboard.connect} />
  return <Presets keyboard={keyboard} onPreview={onPreview} />
}

function Presets({ keyboard, onPreview }: { keyboard: Connected & Keyboard; onPreview: (look: Look | null) => void }) {
  const presets = usePresets(keyboard)
  const root = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewId, schedulePreview, clearPreview] = useFramedPreview()
  const [mode, setMode] = useState<'replace' | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [returnFk, setReturnFk] = useState('save')
  const lastSteps = useRef(presets.applying?.steps ?? [])
  if (presets.applying) lastSteps.current = presets.applying.steps

  const currentLook = useMemo(() => lookOfKeyboard(keyboard), [keyboard.lighting, keyboard.effectColour])
  const looks = useMemo(() => new Map(presets.presets.map((preset) => [preset.id, lookOfPreset(preset)])), [presets.presets])
  const byId = (id: string | null): Preset | null => presets.presets.find((preset) => preset.id === id) ?? null
  const isCurrent = (preset: Preset): boolean => {
    const look = looks.get(preset.id)
    return look !== undefined && looksEqual(look, currentLook)
  }

  const selected = byId(selectedId)
  const shown = byId(previewId) ?? selected
  const shownLook = shown ? (looks.get(shown.id) ?? currentLook) : currentLook
  const live = previewId !== null && previewId !== selectedId
  const stateText = live ? 'previewing — not written' : selected ? (isCurrent(selected) ? 'selected · matches the keyboard' : 'selected — not written') : 'keyboard now'

  useEffect(() => {
    onPreview(shown ? shownLook : null)
    return () => onPreview(null)
  }, [shown, shownLook, onPreview])

  const fk = useCallback((key: string): HTMLElement | null => root.current?.querySelector<HTMLElement>(`[data-fk="${key}"]`) ?? root.current?.querySelector<HTMLElement>('[data-fk="save"]') ?? null, [])
  const returnTo = useCallback(() => fk(returnFk), [fk, returnFk])
  const openSheet = (next: SheetState, opener: string) => {
    setReturnFk(opener)
    setSheet(next)
  }
  const closeSheet = () => setSheet(null)
  const dismissToast = useCallback(() => setToast(null), [])

  const select = (id: string) => {
    const preset = byId(id)
    if (!preset) return
    if (mode === 'replace') {
      openSheet({ kind: 'confirmReplace', preset }, `card-${id}`)
      return
    }
    clearPreview()
    setSelectedId(id)
    setRenamingId(null)
  }

  const save = async () => {
    if (presets.full) {
      setMode((current) => (current === 'replace' ? null : 'replace'))
      return
    }
    const result = await presets.save()
    if (!result.ok) return
    clearPreview()
    setSelectedId(result.preset.id)
    setRenamingId(result.preset.id)
    setToast(`Saved the current lighting as “${result.preset.name}” — ${presets.presets.length + 1} of ${PRESET_LIMIT}. Type to rename.`)
  }

  const apply = async (preset: Preset) => {
    setSheet({ kind: 'applyProgress', preset, result: null })
    clearPreview()
    const result = await presets.apply(preset.id)
    setSheet({ kind: 'applyProgress', preset, result })
  }

  const remove = (preset: Preset) => {
    closeSheet()
    presets.remove(preset.id)
    if (selectedId === preset.id) setSelectedId(null)
    clearPreview()
    setToast(`Deleted “${preset.name}”.`)
  }

  const replace = async (preset: Preset) => {
    closeSheet()
    const result = await presets.replace(preset.id)
    if (!result.ok) return
    setMode(null)
    clearPreview()
    setSelectedId(preset.id)
    setToast(`“${preset.name}” now holds the current lighting.`)
  }

  const rename = (preset: Preset, name: string) => {
    presets.rename(preset.id, name)
    setRenamingId(null)
    focusWithoutPreview(fk('rename'))
  }

  const exportAll = () => {
    const json = presets.exportAll()
    if (!json) return
    const day = new Date().toISOString().slice(0, 10)
    downloadJson(`presets-K1PRO-${day}.json`, json)
    setToast(`Exported ${presets.presets.length} preset${presets.presets.length === 1 ? '' : 's'} — the file names this keyboard, so another board refuses it.`)
  }

  const onImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const result = deserialise(await file.text(), keyboard.info.uuid)
    if (!result.ok) {
      setToast(IMPORT_FAILURE[result.reason])
      return
    }
    openSheet({ kind: 'import', fileName: file.name, incoming: result.file.presets }, 'import')
  }

  const importPicks = (picks: Preset[]) => {
    closeSheet()
    const result = presets.importFrom(serialise({ version: PRESETS_FILE_VERSION, keyboardUuid: keyboard.info.uuid, presets: picks }))
    if (!result.ok) return
    setToast(`Imported ${result.imported} — ${presets.presets.length + result.imported} of ${PRESET_LIMIT}.`)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || presets.applying) return
    if (mode === 'replace') {
      setMode(null)
      focusWithoutPreview(fk('save'))
      return
    }
    clearPreview()
    if (selected && !isCurrent(selected)) setSelectedId(null)
  }

  const importLooks = useMemo(() => (sheet?.kind === 'import' ? new Map(sheet.incoming.map((preset) => [preset.id, lookOfPreset(preset)])) : null), [sheet])

  return (
    <div className="presets" ref={root} onKeyDown={onKeyDown}>
      <header className="panel-head">
        <strong>Lighting</strong>
        <span className="fw">{keyboard.info.productName}</span>
      </header>
      {keyboard.notice && <p className="note" role="status">{keyboard.notice}</p>}
      {presets.notice && <p className="note" role="status">{presets.notice}</p>}
      <div className="C-body">
        <PresetStrip presets={presets.presets} looks={looks} selectedId={selectedId} currentLook={currentLook} mode={mode} applying={presets.applying !== null} busy={keyboard.busy} onSelect={select} onPreview={schedulePreview} onSave={save} />
        <div className="C-main">
          <section className="card glass" aria-live="polite">
            {mode === 'replace' && (
              <div className="mode-bar" role="status">
                <span>{PRESET_LIMIT} of {PRESET_LIMIT} — pick the square to replace</span>
                <button type="button" className="link" data-fk="cancelmode" onClick={() => { setMode(null); focusWithoutPreview(fk('save')) }}>Cancel</button>
              </div>
            )}
            <PresetPreview name={shown?.name ?? 'Keyboard now'} look={shownLook} state={stateText} live={live} savedAt={shown?.savedAt ?? null} />
            {selected ? (
              <PresetDetail preset={selected} isCurrent={isCurrent(selected)} renaming={renamingId === selected.id} canWrite={keyboard.canWrite} busy={keyboard.busy} onApply={() => openSheet({ kind: 'confirmApply', preset: selected }, 'apply')} onStartRename={() => setRenamingId(selected.id)} onRename={(name) => rename(selected, name)} onCancelRename={() => { setRenamingId(null); focusWithoutPreview(fk('rename')) }} onDelete={() => openSheet({ kind: 'confirmDelete', preset: selected }, 'delete')} />
            ) : (
              <p className="help">{presets.presets.length > 0 ? 'Hover or arrow down the squares to preview; click to select.' : `Nothing saved yet — the + square keeps ${currentLook.effect}, brightness ${currentLook.brightness}, speed ${currentLook.speed} as "Preset 1".`}</p>
            )}
            <div className="actions end">
              <button type="button" className="btn quiet sm" data-fk="export" disabled={presets.presets.length === 0} onClick={exportAll}>Export</button>
              <button type="button" className="btn quiet sm" data-fk="import" onClick={() => fileInput.current?.click()}>Import</button>
              <input type="file" accept="application/json,.json" hidden ref={fileInput} onChange={onImportFile} aria-label="Import presets file" />
            </div>
          </section>
          <Card title="Live controls" future>
            <p className="stmt">Effect, colour, brightness, speed — Stage 2</p>
            <p className="help">The live lighting controls go here; presets stay where they are when they arrive.</p>
          </Card>
        </div>
      </div>
      {sheet?.kind === 'confirmApply' && <ConfirmApplySheet preset={sheet.preset} current={currentLook} onApply={() => apply(sheet.preset)} onSaveFirst={() => { closeSheet(); save() }} onClose={closeSheet} returnTo={returnTo} />}
      {sheet?.kind === 'applyProgress' && <ApplyProgressSheet name={sheet.preset.name} steps={presets.applying?.steps ?? lastSteps.current} result={sheet.result} readBack={currentLook} failure={keyboard.notice} onDone={closeSheet} returnTo={returnTo} />}
      {sheet?.kind === 'confirmDelete' && <ConfirmDeleteSheet preset={sheet.preset} onDelete={() => remove(sheet.preset)} onClose={closeSheet} returnTo={() => fk('save')} />}
      {sheet?.kind === 'confirmReplace' && <ConfirmReplaceSheet preset={sheet.preset} look={looks.get(sheet.preset.id) ?? currentLook} current={currentLook} onReplace={() => replace(sheet.preset)} onClose={closeSheet} returnTo={returnTo} />}
      {sheet?.kind === 'import' && importLooks && <ImportSheet fileName={sheet.fileName} incoming={sheet.incoming} looks={importLooks} free={Math.max(PRESET_LIMIT - presets.presets.length, 0)} onImport={importPicks} onClose={closeSheet} returnTo={returnTo} />}
      {toast && <Toast text={toast} onDismiss={dismissToast} />}
    </div>
  )
}

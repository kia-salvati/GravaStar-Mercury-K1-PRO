import { useCallback, useEffect, useRef, useState } from 'react'
import type { RestoreStep } from 'k916'
import type { Keyboard } from '../types/keyboard'
import { backupOf, deserialise, nextPresetName, PRESET_LIMIT, PRESETS_FILE_VERSION, readoutOf, serialise, snapshotOf, storageKey, type Preset, type PresetsFileFailure } from '../utils/presets'

/**
 * `full`: the cap is reached — the screen enters replace mode. `not-connected`: no keyboard.
 * `missing`: no preset has that id. `device`: the keyboard call was refused or failed; the
 * keyboard hook's `notice` says why.
 */
export type PresetFailure = 'full' | 'not-connected' | 'missing' | 'device'
export type PresetResult = { ok: true; preset: Preset } | { ok: false; reason: PresetFailure }
export type ApplyResult = { ok: true } | { ok: false; reason: Exclude<PresetFailure, 'full'> }
/** `skipped` names the presets that did not fit under the cap; nothing is applied silently. */
export type ImportResult = { ok: true; imported: number; skipped: string[] } | { ok: false; reason: PresetsFileFailure | 'not-connected' }

export interface Applying {
  id: string
  /** Two steps per block, `writing` then `verified`, in the order the library writes them. */
  steps: RestoreStep[]
}

export interface Presets {
  /** This keyboard's presets, oldest first. Empty while disconnected. */
  presets: Preset[]
  limit: number
  full: boolean
  /** The apply in progress, with its per-block steps so far; null otherwise. */
  applying: Applying | null
  /** A local failure (storage, import); keyboard failures live on the keyboard hook. */
  notice: string | null
  /** Reads a backup from the keyboard and stores it. Name defaults to "Preset N". */
  save(name?: string): Promise<PresetResult>
  /** Overwrites one preset with a fresh backup, keeping its id (and name unless given). */
  replace(id: string, name?: string): Promise<PresetResult>
  /** Restores the preset's three blocks to the keyboard and refreshes the readings. */
  apply(id: string): Promise<ApplyResult>
  rename(id: string, name: string): void
  remove(id: string): void
  /** The JSON file for this keyboard's presets; null while disconnected. Local only. */
  exportAll(): string | null
  /** Validates, refuses other boards' files, and fills up to the cap. Local only. */
  importFrom(json: string): ImportResult
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const load = (keyboardUuid: string): Preset[] => {
  const json = localStorage.getItem(storageKey(keyboardUuid))
  if (json === null) return []
  const result = deserialise(json, keyboardUuid)
  if (!result.ok) throw new Error(`stored presets are unreadable (${result.reason})`)
  return result.file.presets
}

export function usePresets(keyboard: Keyboard): Presets {
  const keyboardUuid = keyboard.status === 'connected' ? keyboard.info.uuid : null
  const [presets, setPresets] = useState<Preset[]>([])
  // Actions read the list from here, not from their render's closure, so two calls in one tick compose.
  const current = useRef<Preset[]>([])
  const [applying, setApplying] = useState<Applying | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const show = useCallback((next: Preset[]) => {
    current.current = next
    setPresets(next)
  }, [])

  useEffect(() => {
    if (!keyboardUuid) {
      show([])
      return
    }
    try {
      show(load(keyboardUuid))
    } catch (error) {
      console.error('[presets] load failed', error)
      show([])
      setNotice(`Saved presets could not be read: ${describe(error)}`)
    }
  }, [keyboardUuid, show])

  const store = useCallback(
    (update: (list: Preset[]) => Preset[]) => {
      const next = update(current.current)
      show(next)
      if (!keyboardUuid) return
      try {
        localStorage.setItem(storageKey(keyboardUuid), serialise({ version: PRESETS_FILE_VERSION, keyboardUuid, presets: next }))
        setNotice(null)
      } catch (error) {
        console.error('[presets] save failed', error)
        setNotice(`Presets could not be saved in this browser: ${describe(error)}`)
      }
    },
    [keyboardUuid, show],
  )

  /** A fresh backup as a preset. `id` and `name` come from the preset being replaced, if any. */
  const capture = useCallback(
    async (id: string, name: string): Promise<PresetResult> => {
      if (!keyboardUuid) return { ok: false, reason: 'not-connected' }
      const backup = await keyboard.backup()
      if (!backup) return { ok: false, reason: 'device' }
      const preset: Preset = { id, name, savedAt: new Date().toISOString(), keyboardUuid, snapshot: snapshotOf(backup), readout: readoutOf(backup) }
      return { ok: true, preset }
    },
    [keyboard, keyboardUuid],
  )

  const save = useCallback(
    async (name?: string): Promise<PresetResult> => {
      if (current.current.length >= PRESET_LIMIT) return { ok: false, reason: 'full' }
      const result = await capture(crypto.randomUUID(), name?.trim() || nextPresetName(current.current))
      if (result.ok) store((list) => [...list, result.preset])
      return result
    },
    [capture, store],
  )

  const replace = useCallback(
    async (id: string, name?: string): Promise<PresetResult> => {
      const existing = current.current.find((preset) => preset.id === id)
      if (!existing) return { ok: false, reason: 'missing' }
      const result = await capture(id, name?.trim() || existing.name)
      if (result.ok) store((list) => list.map((preset) => (preset.id === id ? result.preset : preset)))
      return result
    },
    [capture, store],
  )

  const apply = useCallback(
    async (id: string): Promise<ApplyResult> => {
      const preset = current.current.find((candidate) => candidate.id === id)
      if (!preset) return { ok: false, reason: 'missing' }
      if (!keyboardUuid) return { ok: false, reason: 'not-connected' }
      setApplying({ id, steps: [] })
      try {
        const ok = await keyboard.restore(backupOf(preset.snapshot), (step) => setApplying((current) => (current ? { ...current, steps: [...current.steps, step] } : current)))
        return ok ? { ok: true } : { ok: false, reason: 'device' }
      } finally {
        setApplying(null)
      }
    },
    [keyboard, keyboardUuid],
  )

  const rename = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      store((list) => list.map((preset) => (preset.id === id ? { ...preset, name: trimmed } : preset)))
    },
    [store],
  )

  const remove = useCallback((id: string) => store((list) => list.filter((preset) => preset.id !== id)), [store])

  const exportAll = useCallback(
    () => (keyboardUuid ? serialise({ version: PRESETS_FILE_VERSION, keyboardUuid, presets }) : null),
    [keyboardUuid, presets],
  )

  const importFrom = useCallback(
    (json: string): ImportResult => {
      if (!keyboardUuid) return { ok: false, reason: 'not-connected' }
      const result = deserialise(json, keyboardUuid)
      if (!result.ok) return result
      const room = Math.max(PRESET_LIMIT - current.current.length, 0)
      const taken = new Set(current.current.map((preset) => preset.id))
      // An id already in the list is the same preset re-imported; it gets a new identity rather than a silent overwrite.
      const incoming = result.file.presets.map((preset) => (taken.has(preset.id) ? { ...preset, id: crypto.randomUUID() } : preset))
      const accepted = incoming.slice(0, room)
      if (accepted.length > 0) store((list) => [...list, ...accepted])
      return { ok: true, imported: accepted.length, skipped: incoming.slice(room).map((preset) => preset.name) }
    },
    [keyboardUuid, store],
  )

  return { presets, limit: PRESET_LIMIT, full: presets.length >= PRESET_LIMIT, applying, notice, save, replace, apply, rename, remove, exportAll, importFrom }
}

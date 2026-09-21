import type { Backup, Capabilities, DeviceInfo, LightingChange, LightingState, PowerState, RestoreStep, RGB, SleepTimer } from 'k916'

export interface Disconnected {
  /** `unsupported`: this browser has no WebHID. `idle`: waiting for the connect button. */
  status: 'unsupported' | 'idle' | 'connecting'
  /** Why the app is not connected: a cancelled prompt, a failed read or a device that went away. */
  notice: string | null
}

export interface Connected {
  status: 'connected'
  info: DeviceInfo
  capabilities: Capabilities
  reportsBattery: boolean
  /** False on the dongle: the library refuses every write there, so the screens say so up front. */
  canWrite: boolean
  /** Null until the first power packet lands, and always null on cable. */
  power: PowerState | null
  lighting: LightingState
  /** The current effect's own colour; null for Custom, which has no slot in the light-colour block. */
  effectColour: RGB | null
  /** Idle time before sleep. Null on cable, where the keyboard ignores it. */
  sleepTimer: SleepTimer | null
  /** A call that failed or was refused; the last good reading stays on screen. */
  notice: string | null
}

export type KeyboardState = Disconnected | Connected

interface KeyboardProgress {
  /** A device call is in flight. Controls that write disable on this; the library refuses them anyway. */
  busy: boolean
}

/**
 * Writes fold the keyboard's read-back into the state. Each resolves to nothing (or to the
 * read-back where the state has no place for it) when the call was refused or failed; the
 * reason is in `notice`.
 */
interface KeyboardActions {
  /** Opens the browser's device prompt; needs a user gesture. */
  connect(): Promise<void>
  /** Re-reads lighting, colour, sleep timer and, over the dongle, battery. */
  refresh(): Promise<void>
  setLighting(change: LightingChange): Promise<void>
  /** The current effect's colour. */
  setEffectColour(rgb: RGB): Promise<void>
  setKeyColour(slot: number, rgb: RGB): Promise<RGB | undefined>
  /** Null switches the timer off. */
  setSleepTimer(minutes: number | null): Promise<void>
  backup(): Promise<Backup | undefined>
  /** Writes all three blocks back; `onProgress` gets two steps per block. Resolves true once the keyboard confirmed them all. */
  restore(backup: Backup, onProgress?: (step: RestoreStep) => void): Promise<boolean>
}

export type Keyboard = KeyboardState & KeyboardProgress & KeyboardActions

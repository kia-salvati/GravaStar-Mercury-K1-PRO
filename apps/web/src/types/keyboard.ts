import type { Capabilities, DeviceInfo, LightingState, PowerState, RGB } from 'k916'

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
  /** Null until the first power packet lands, and always null on cable. */
  power: PowerState | null
  lighting: LightingState
  /** The current effect's own colour; null for Custom, which has no slot in the light-colour block. */
  effectColour: RGB | null
  /** A refresh that failed; the last good reading stays on screen. */
  notice: string | null
}

export type KeyboardState = Disconnected | Connected

interface KeyboardActions {
  /** Opens the browser's device prompt; needs a user gesture. */
  connect(): Promise<void>
  /** Re-reads lighting and, over the dongle, battery. */
  refresh(): Promise<void>
}

export type Keyboard = KeyboardState & KeyboardActions

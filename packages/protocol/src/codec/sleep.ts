import { PROFILE_BYTES } from './lighting.js'

/**
 * The wireless sleep timer lives in the profile block at byte 24, in half-minutes, 0 = off.
 * Established from session-7-dongle-colour: toggling and setting the timer in the vendor UI
 * moved exactly that byte — 02 (the "1 minute" the overview showed) → 08 → 13 (9.5 min) → 00
 * (switched off) → 13 (switched back on, value remembered by the UI, not the keyboard).
 * The vendor UI offers 0.5–20 minutes.
 */
const OFFSET_SLEEP = 24
export const SLEEP_MINUTES_MIN = 0.5
export const SLEEP_MINUTES_MAX = 20

export interface SleepTimer {
  /** false when the byte is 0 */
  enabled: boolean
  /** minutes, in half-minute steps; 0 when disabled */
  minutes: number
}

export function decodeSleep(profile: Uint8Array): SleepTimer {
  assertProfile(profile)
  const halfMinutes = profile[OFFSET_SLEEP]!
  return { enabled: halfMinutes !== 0, minutes: halfMinutes / 2 }
}

/** `null` disables the timer. Minutes must be a half-minute step within the vendor's range. */
export function applySleep(profile: Uint8Array, minutes: number | null): Uint8Array {
  assertProfile(profile)
  const next = Uint8Array.from(profile)
  if (minutes === null) {
    next[OFFSET_SLEEP] = 0
    return next
  }
  const halfMinutes = minutes * 2
  if (!Number.isInteger(halfMinutes) || minutes < SLEEP_MINUTES_MIN || minutes > SLEEP_MINUTES_MAX) {
    throw new RangeError(`sleep minutes must be ${SLEEP_MINUTES_MIN}..${SLEEP_MINUTES_MAX} in half-minute steps, got ${minutes}`)
  }
  next[OFFSET_SLEEP] = halfMinutes
  return next
}

function assertProfile(profile: Uint8Array): void {
  if (profile.length < PROFILE_BYTES) {
    throw new Error(`profile is ${profile.length} bytes, expected ${PROFILE_BYTES}`)
  }
}

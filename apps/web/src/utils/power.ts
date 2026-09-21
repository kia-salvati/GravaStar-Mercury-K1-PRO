import type { PowerState } from 'k916'

const LOW_BATTERY_PERCENT = 15

export function isLowBattery({ percent, charging }: PowerState): boolean {
  return percent <= LOW_BATTERY_PERCENT && !charging
}

export function powerLabel(power: PowerState): string {
  if (power.full) return 'Full · not charging'
  if (power.charging) return 'Charging'
  if (isLowBattery(power)) return 'Low · not charging'
  return 'Not charging'
}

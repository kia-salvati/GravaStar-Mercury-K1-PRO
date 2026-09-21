import type { SleepTimer } from 'k916'

export function sleepLabel({ enabled, minutes }: SleepTimer): string {
  if (!enabled) return 'Sleep timer off'
  return minutes < 1 ? 'Sleep after 30 s' : `Sleep after ${minutes} min`
}

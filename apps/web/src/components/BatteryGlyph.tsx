import type { PowerState } from 'k916'
import { isLowBattery } from '../utils/power'

const FILL_WIDTH_MAX = 25

/** Battery outline with its charge as fill; a dashed case with a plug when nothing is reported. */
export default function BatteryGlyph({ power, width = 26 }: { power: PowerState | null; width?: number }) {
  const height = Math.round((width * 16) / 34)
  if (!power) {
    return (
      <svg className="batt unknown" viewBox="0 0 34 16" width={width} height={height} role="img" aria-label="Battery not reported">
        <rect className="case" x=".75" y=".75" width="28.5" height="14.5" rx="3" />
        <rect className="nub" x="31" y="5" width="3" height="6" rx="1" />
        <path className="plug" d="M12 4v3M18 4v3M10.5 7h9v2a4.5 4.5 0 0 1-9 0z" />
      </svg>
    )
  }
  const fill = Math.max(1, Math.round((FILL_WIDTH_MAX * power.percent) / 100))
  const className = ['batt', power.charging && 'charging', isLowBattery(power) && 'low'].filter(Boolean).join(' ')
  return (
    <svg className={className} viewBox="0 0 34 16" width={width} height={height} role="img" aria-label={`Battery ${power.percent} percent${power.charging ? ', charging' : ''}`}>
      <rect className="case" x=".75" y=".75" width="28.5" height="14.5" rx="3" />
      <rect className="nub" x="31" y="5" width="3" height="6" rx="1" />
      <rect className="fill" x="2.75" y="2.75" width={fill} height="10.5" rx="1.5" />
      {power.charging && <path className="bolt" d="M16.5 2.5 11.5 9h3.5l-1 4.5 5-6.5h-3.5z" />}
    </svg>
  )
}

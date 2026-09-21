import type { FC, ReactNode } from 'react'
import type { PowerState } from 'k916'
import { ROUTE_LABELS, ROUTES, type Route } from '../config/routes'
import type { KeyboardState } from '../types/keyboard'
import { colourKind } from '../utils/colour'
import { lookOfKeyboard } from '../utils/look'
import { powerLabel } from '../utils/power'
import BatteryGlyph from './BatteryGlyph'
import { DeviceIcon, KeysIcon, LightingIcon, MacrosIcon, PlugIcon, RadioIcon, SettingsIcon } from './icons'
import Swatch from './Swatch'

const NAV_ICONS: Record<Route, FC> = { device: DeviceIcon, lighting: LightingIcon, keys: KeysIcon, macros: MacrosIcon, settings: SettingsIcon }
const AREAS: readonly Route[] = ['device', 'lighting', 'keys', 'macros']

interface Glance {
  key: 'connection' | 'battery' | 'effect'
  icon: ReactNode
  /** Under the glyph on the narrow rail. */
  short: string
  /** Beside the glyph once the rail has room for words. */
  long: string
}

const batteryLong = (power: PowerState | null, reportsBattery: boolean): string => {
  if (power) return `${power.percent} % · ${powerLabel(power).toLowerCase()}`
  return reportsBattery ? 'Battery not read yet' : 'Battery n/a on cable'
}

const glanceOf = (keyboard: KeyboardState): Glance[] => {
  if (keyboard.status !== 'connected') {
    return [
      { key: 'connection', icon: <PlugIcon />, short: '—', long: 'Not connected' },
      { key: 'battery', icon: <BatteryGlyph power={null} />, short: 'n/a', long: 'No battery reading' },
      { key: 'effect', icon: <span className="swatch none" />, short: '—', long: 'No lighting reading' },
    ]
  }
  const { info, power, reportsBattery, lighting } = keyboard
  const look = lookOfKeyboard(keyboard)
  const wireless = info.connection === 'wireless'
  return [
    { key: 'connection', icon: wireless ? <RadioIcon /> : <PlugIcon />, short: wireless ? '2.4G' : 'Wired', long: wireless ? '2.4G wireless' : 'Wired' },
    { key: 'battery', icon: <BatteryGlyph power={power} />, short: power ? `${power.percent}%` : 'n/a', long: batteryLong(power, reportsBattery) },
    { key: 'effect', icon: <Swatch kind={colourKind(look)} hex={look.colourHex} />, short: lighting.effect.split(' ')[0] ?? lighting.effect, long: lighting.effect },
  ]
}

function NavLink({ route, current }: { route: Route; current: Route }) {
  const Icon = NAV_ICONS[route]
  return (
    <a href={ROUTES[route]} aria-current={route === current ? 'page' : undefined}>
      <Icon />
      {ROUTE_LABELS[route]}
    </a>
  )
}

export default function Rail({ keyboard, busy, route }: { keyboard: KeyboardState; busy: boolean; route: Route }) {
  return (
    <aside className="rail glass">
      {busy && <span className="working" role="status" aria-label="Talking to the keyboard" />}
      <div className="glance" aria-label="At a glance">
        {glanceOf(keyboard).map((glance) => (
          <div key={glance.key} className="glance-item">
            {glance.icon}
            <span className="n">{glance.short}</span>
            <span className="t">{glance.long}</span>
          </div>
        ))}
      </div>
      <nav className="nav" aria-label="Areas">
        {AREAS.map((area) => <NavLink key={area} route={area} current={route} />)}
        <span className="spacer" />
        <NavLink route="settings" current={route} />
      </nav>
    </aside>
  )
}

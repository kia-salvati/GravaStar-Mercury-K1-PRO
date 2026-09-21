import { useState, type CSSProperties } from 'react'
import { webHidSource } from './api/hidSource'
import Field from './components/Field'
import Rail from './components/Rail'
import { ROUTE_LABELS, type Route } from './config/routes'
import { useKeyboard } from './hooks/useKeyboard'
import { useRoute } from './hooks/useRoute'
import { useSettings, type Settings } from './hooks/useSettings'
import DevicePage from './pages/DevicePage'
import SettingsPage from './pages/SettingsPage'
import StagePage from './pages/StagePage'
import type { Keyboard } from './types/keyboard'
import { tintColour } from './utils/colour'

type AppStyle = CSSProperties & Record<'--c-glow', string>

function page(route: Route, keyboard: Keyboard, settings: Settings) {
  switch (route) {
    case 'device':
      return <DevicePage keyboard={keyboard} />
    case 'settings':
      return <SettingsPage settings={settings} />
    default:
      return <StagePage title={ROUTE_LABELS[route]} />
  }
}

export default function App() {
  const [source] = useState(webHidSource)
  const keyboard = useKeyboard(source)
  const settings = useSettings()
  const route = useRoute()
  const connected = keyboard.status === 'connected' ? keyboard : null
  const lighting = connected?.lighting ?? null
  const effectColour = connected?.effectColour ?? null
  const style: AppStyle = { '--c-glow': tintColour(lighting, effectColour) }

  return (
    <div className="app" style={style}>
      <div className="titlebar" />
      <Field lighting={lighting} effectColour={effectColour} />
      <Rail keyboard={keyboard} busy={keyboard.busy} route={route} />
      <main className="panel">{page(route, keyboard, settings)}</main>
    </div>
  )
}

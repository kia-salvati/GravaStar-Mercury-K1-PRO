import { useState, type CSSProperties } from 'react'
import { webHidSource } from './api/hidSource'
import Field from './components/Field'
import Rail from './components/Rail'
import { ROUTE_LABELS, type Route } from './config/routes'
import { useKeyboard } from './hooks/useKeyboard'
import { useRoute } from './hooks/useRoute'
import { useSettings, type Settings } from './hooks/useSettings'
import DevicePage from './pages/DevicePage'
import PresetsPage from './pages/PresetsPage'
import SettingsPage from './pages/SettingsPage'
import StagePage from './pages/StagePage'
import type { Keyboard } from './types/keyboard'
import { tintColour } from './utils/colour'
import { lookOfKeyboard, type Look } from './utils/look'

type AppStyle = CSSProperties & Record<'--c-glow', string>

function page(route: Route, keyboard: Keyboard, settings: Settings, onPreview: (look: Look | null) => void) {
  switch (route) {
    case 'device':
      return <DevicePage keyboard={keyboard} />
    case 'lighting':
      return <PresetsPage keyboard={keyboard} onPreview={onPreview} />
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
  // A preset previewed on the Lighting screen drives the field instead of the keyboard's own state.
  const [preview, setPreview] = useState<Look | null>(null)
  const look = preview ?? (keyboard.status === 'connected' ? lookOfKeyboard(keyboard) : null)
  const style: AppStyle = { '--c-glow': tintColour(look) }

  return (
    <div className="app" style={style}>
      <div className="titlebar" />
      <Field look={look} />
      <Rail keyboard={keyboard} busy={keyboard.busy} route={route} />
      <main className="panel">{page(route, keyboard, settings, setPreview)}</main>
    </div>
  )
}

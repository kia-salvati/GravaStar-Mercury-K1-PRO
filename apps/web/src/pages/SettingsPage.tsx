import Card from '../components/Card'
import Segmented from '../components/Segmented'
import { FIELD_LABELS, FIELDS, THEME_LABELS, THEMES } from '../config/settings'
import type { Settings } from '../hooks/useSettings'

export default function SettingsPage({ settings }: { settings: Settings }) {
  return (
    <>
      <header className="panel-head">
        <strong>Settings</strong>
        <span className="fw">Saved in this browser</span>
      </header>
      <Card title="Theme">
        <Segmented label="Theme" options={THEMES} labels={THEME_LABELS} value={settings.theme} onChange={settings.setTheme} />
        {settings.theme === 'system' && <p className="help">Following the system: {THEME_LABELS[settings.resolvedTheme]} right now.</p>}
      </Card>
      <Card title="Field">
        <Segmented label="Field" options={FIELDS} labels={FIELD_LABELS} value={settings.field} onChange={settings.setField} />
        <p className="help">Ambient draws the keyboard's current effect behind the glass, at its brightness and speed. Static is a fixed gradient with grain.</p>
        {settings.reducedMotion && <p className="note">Your system asks for reduced motion, so the ambient field stays still.</p>}
      </Card>
    </>
  )
}

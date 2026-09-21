import { SLEEP_MINUTES_MAX, SLEEP_MINUTES_MIN, type PowerState } from 'k916'
import Card from '../components/Card'
import ConnectPanel from '../components/ConnectPanel'
import Steps from '../components/Steps'
import Swatch from '../components/Swatch'
import type { Connected, Keyboard } from '../types/keyboard'
import { colourKind } from '../utils/colour'
import { fieldMotion, isAnimated } from '../utils/field'
import { colourLabel, lookOfKeyboard } from '../utils/look'
import { powerLabel } from '../utils/power'
import { sleepLabel } from '../utils/sleep'

function PowerNote({ power, reportsBattery }: Pick<Connected, 'power' | 'reportsBattery'>) {
  if (!reportsBattery) {
    return (
      <div className="note">
        <strong>Battery not reported on cable</strong>
        The keyboard only reports charge over 2.4G. Unplug to read it.
      </div>
    )
  }
  if (power?.charging) return <p className="note">Charging over the dongle link — the reading updates each poll.</p>
  return <p className="note muted">Battery is read once at connect; Refresh re-sends the poll.</p>
}

const powerSub = (power: PowerState | null, wireless: boolean): string => {
  if (power) return powerLabel(power)
  return wireless ? 'Battery not read yet' : 'USB data + charge'
}

function ColourValue({ lighting, effectColour }: Pick<Connected, 'lighting' | 'effectColour'>) {
  const look = lookOfKeyboard({ lighting, effectColour })
  const kind = colourKind(look)
  return (
    <>
      <Swatch kind={kind} hex={look.colourHex} />
      {kind === 'single' && look.colourHex ? <span className="mono">{look.colourHex}</span> : <span className="dim">{colourLabel(look)}</span>}
    </>
  )
}

function Readout({ keyboard }: { keyboard: Connected & Keyboard }) {
  const { info, power, reportsBattery, lighting, effectColour, sleepTimer, capabilities, notice } = keyboard
  const wireless = info.connection === 'wireless'
  const animated = isAnimated(fieldMotion(lighting.effect, lighting.colourMode))
  return (
    <>
      <header className="panel-head">
        <strong>{info.productName}</strong>
        <span className="fw">Firmware <span className="mono">{info.firmwareVersion}</span> · read at connect</span>
      </header>
      {notice && <p className="note" role="status">{notice}</p>}
      <Card title="Connection">
        <div className="stmt">
          {wireless ? '2.4G wireless' : 'On cable'}
          {power && <span>· {power.percent} %</span>}
          <span className="sub">{powerSub(power, wireless)}</span>
        </div>
        <PowerNote power={power} reportsBattery={reportsBattery} />
        <p className="actions">
          <button type="button" className="btn quiet" onClick={keyboard.refresh}>Refresh readings</button>
        </p>
      </Card>
      <Card title="Lighting">
        <div className="rows">
          <div className="row"><span className="k">Effect</span><span className="v">{lighting.effect}{animated && <span className="dim">animated</span>}</span></div>
          <div className="row"><span className="k">Colour</span><span className="v"><ColourValue lighting={lighting} effectColour={effectColour} /></span></div>
          <div className="row"><span className="k">Brightness</span><span className="v"><Steps label="Brightness" value={lighting.brightness} min={1} max={capabilities.lighting.brightnessStages} /></span></div>
          <div className="row"><span className="k">Speed</span><span className="v"><Steps label="Speed" value={lighting.speed} min={0} max={capabilities.lighting.speedStages} /></span></div>
        </div>
      </Card>
      {sleepTimer && (
        <Card title="Sleep">
          <div className="stmt">
            {sleepLabel(sleepTimer)}
            <span className="sub">idle before the keyboard sleeps · {SLEEP_MINUTES_MIN}–{SLEEP_MINUTES_MAX} min · wireless only</span>
          </div>
        </Card>
      )}
    </>
  )
}

export default function DevicePage({ keyboard }: { keyboard: Keyboard }) {
  if (keyboard.status !== 'connected') return <ConnectPanel status={keyboard.status} notice={keyboard.notice} onConnect={keyboard.connect} />
  return <Readout keyboard={keyboard} />
}

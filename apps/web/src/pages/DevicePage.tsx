import type { PowerState } from 'k916'
import Card from '../components/Card'
import ConnectPanel from '../components/ConnectPanel'
import Steps from '../components/Steps'
import Swatch from '../components/Swatch'
import type { Connected, Keyboard } from '../types/keyboard'
import { colourKind, swatchHex, type ColourKind } from '../utils/colour'
import { fieldMotion, isAnimated } from '../utils/field'
import { powerLabel } from '../utils/power'

const COLOUR_NOTE: Record<Exclude<ColourKind, 'single'>, string> = {
  none: 'Lighting is off',
  mixed: 'Mixed colours — set by the effect',
  perKey: 'Per-key RGB — set per key in Lighting',
}

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
  const kind = colourKind(lighting)
  const hex = swatchHex(lighting, effectColour)
  return (
    <>
      <Swatch kind={kind} hex={hex} />
      {kind !== 'single' && <span className="dim">{COLOUR_NOTE[kind]}</span>}
      {kind === 'single' && (hex ? <span className="mono">{hex}</span> : <span className="dim">Colour not read</span>)}
    </>
  )
}

function Readout({ keyboard }: { keyboard: Connected & Keyboard }) {
  const { info, power, reportsBattery, lighting, effectColour, capabilities, notice } = keyboard
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
      {wireless && (
        <Card title="Sleep">
          <p className="help">The idle-to-sleep timer is wireless-only, but the protocol package does not decode it from the profile block yet, so there is no value to show.</p>
        </Card>
      )}
    </>
  )
}

export default function DevicePage({ keyboard }: { keyboard: Keyboard }) {
  if (keyboard.status !== 'connected') return <ConnectPanel status={keyboard.status} notice={keyboard.notice} onConnect={keyboard.connect} />
  return <Readout keyboard={keyboard} />
}

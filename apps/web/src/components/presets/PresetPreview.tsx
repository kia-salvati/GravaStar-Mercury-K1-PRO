import { colourKind } from '../../utils/colour'
import { colourLabel, type Look } from '../../utils/look'
import { formatSavedAt } from '../../utils/presets'
import LookSwatch from '../LookSwatch'
import Steps from '../Steps'
import Silhouette from './Silhouette'

interface Props {
  name: string
  look: Look
  state: string
  /** The state line is the accent "previewing" line. */
  live: boolean
  savedAt: string | null
}

/** Head, silhouette and one-line readout of the shown look. */
export default function PresetPreview({ name, look, state, live, savedAt }: Props) {
  const single = colourKind(look) === 'single' && look.colourHex !== null
  return (
    <>
      <div className="preview-head">
        <span className="nm" title={name}>{name}</span>
        <span className={live ? 'state live' : 'state'}>{state}</span>
      </div>
      <Silhouette look={look} />
      <div className="readline">
        <span><span className="k">Effect</span> <strong>{look.effect}</strong></span>
        <span><span className="k">Colour</span> <LookSwatch look={look} /> {single ? <span className="mono">{look.colourHex}</span> : <span className="dim">{colourLabel(look)}</span>}</span>
        <span className="stagerow"><em>B</em><Steps label="Brightness" value={look.brightness} min={1} max={4} /></span>
        <span className="stagerow"><em>S</em><Steps label="Speed" value={look.speed} min={0} max={4} /></span>
        {savedAt && <span className="dim">saved {formatSavedAt(savedAt)}</span>}
      </div>
    </>
  )
}

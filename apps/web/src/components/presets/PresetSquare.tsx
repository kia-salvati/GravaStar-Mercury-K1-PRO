import type { Look } from '../../utils/look'
import type { Preset } from '../../utils/presets'
import LookSwatch from '../LookSwatch'

interface Props {
  preset: Preset
  look: Look
  index: number
  selected: boolean
  /** This preset is what the keyboard reports now. */
  current: boolean
  replaceMode: boolean
}

/** One square in the strip. The tooltip takes no pointer events, so entering it cannot leave the square. */
export default function PresetSquare({ preset, look, index, selected, current, replaceMode }: Props) {
  return (
    <button type="button" className="sq" data-id={preset.id} data-fk={`card-${preset.id}`} aria-pressed={selected} aria-label={preset.name}>
      <LookSwatch look={look} grid="md" />
      {current && <span className="cur" title="what the keyboard reports now" />}
      <span className="lbl-n">{index + 1}</span>
      <span className="tip">{preset.name}{replaceMode && ' — replace'}</span>
    </button>
  )
}

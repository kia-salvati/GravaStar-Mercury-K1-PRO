import type { CSSProperties } from 'react'
import { tintColour } from '../utils/colour'
import { brightnessLevel, FIELD_LAYERS, fieldMotion, speedPeriodSeconds } from '../utils/field'
import type { Look } from '../utils/look'

type FieldStyle = CSSProperties & Record<'--c' | '--lvl' | '--dur', string>

/**
 * The ambient field behind the glass: a lighting state rendered slow and soft. Every motion layer
 * stays mounted and animating and `data-fx` picks the visible one, so a preview change never
 * restarts a keyframe animation. Opacity is `--cap × --lvl` in the stylesheet, and `--lvl` never exceeds 1.
 */
export default function Field({ look }: { look: Look | null }) {
  const motion = look ? fieldMotion(look.effect, look.colourMode) : 'off'
  const style: FieldStyle = {
    '--c': tintColour(look),
    '--lvl': String(brightnessLevel(look?.brightness ?? 0)),
    '--dur': `${speedPeriodSeconds(look?.speed ?? 0)}s`,
  }
  return (
    <div className="field" data-fx={motion} style={style} aria-hidden="true">
      {FIELD_LAYERS.map((layer) => <div key={layer} className={`amb ${layer}`} />)}
    </div>
  )
}

import type { CSSProperties } from 'react'
import type { LightingState, RGB } from 'k916'
import { tintColour } from '../utils/colour'
import { brightnessLevel, fieldMotion, speedPeriodSeconds } from '../utils/field'

type FieldStyle = CSSProperties & Record<'--c' | '--lvl' | '--dur', string>

/**
 * The ambient field behind the glass: the keyboard's current effect, rendered slow and soft.
 * Opacity is `--cap × --lvl` in the stylesheet, and `--lvl` never exceeds 1.
 */
export default function Field({ lighting, effectColour }: { lighting: LightingState | null; effectColour: RGB | null }) {
  const motion = lighting ? fieldMotion(lighting.effect, lighting.colourMode) : 'off'
  const style: FieldStyle = {
    '--c': tintColour(lighting, effectColour),
    '--lvl': String(brightnessLevel(lighting?.brightness ?? 0)),
    '--dur': `${speedPeriodSeconds(lighting?.speed ?? 0)}s`,
  }
  return (
    <div className={`field fx-${motion}`} style={style} aria-hidden="true">
      <div className="amb" />
    </div>
  )
}

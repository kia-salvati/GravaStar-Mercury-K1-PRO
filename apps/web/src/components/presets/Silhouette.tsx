import { memo, useLayoutEffect, useRef } from 'react'
import { colourKind } from '../../utils/colour'
import { brightnessLevel } from '../../utils/field'
import type { Look } from '../../utils/look'

/* An 84-key silhouette of the K1 PRO's layout, in 40-unit key cells. */
const UNIT = 40
const GAP = 5
const PAD = 10
const COLUMNS = 16
const ROWS: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 1],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25, 1],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75, 1, 1],
  [1.25, 1.25, 1.25, 6.25, 1, 1, 1, 1, 1, 1],
]
const WIDTH = PAD * 2 + COLUMNS * UNIT
const HEIGHT = PAD * 2 + ROWS.length * UNIT

interface KeyRect {
  x: number
  y: number
  w: number
  h: number
  /** Horizontal position 0..1, for the mixed-colour sweep. */
  column: number
}

const KEY_RECTS: readonly KeyRect[] = ROWS.flatMap((row, r) => {
  let x = PAD
  return row.map((width) => {
    const rect = { x: x + GAP / 2, y: PAD + r * UNIT + GAP / 2, w: width * UNIT - GAP, h: UNIT - GAP, column: (x - PAD) / (COLUMNS * UNIT) }
    x += width * UNIT
    return rect
  })
})

const MIX_STOPS = ['#ff4d4d', '#ffe14d', '#4de07a', '#3ee0e8', '#4d7bff', '#b56bff', '#ff9a2e']
const KEY_SLOTS = 126

/** The colour of silhouette key `index` under a look; null leaves the key unlit. */
const keyFill = (look: Look, index: number): string | null => {
  const kind = colourKind(look)
  if (kind === 'none') return null
  if (kind === 'perKey') return look.keys?.[Math.min(KEY_SLOTS - 1, Math.floor((index * KEY_SLOTS) / KEY_RECTS.length))] ?? null
  if (kind === 'mixed') return MIX_STOPS[Math.floor(KEY_RECTS[index]!.column * MIX_STOPS.length) % MIX_STOPS.length] ?? null
  return look.colourHex
}

// Built once: the same element tree on every render, so React never touches the 84 rects.
const KEYS = KEY_RECTS.map((rect, index) => <rect key={index} className="key" x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={4} />)

/** The keyboard drawing. A look change recolours the existing rects through a ref; nothing re-mounts. */
function Silhouette({ look }: { look: Look }) {
  const svg = useRef<SVGSVGElement>(null)

  useLayoutEffect(() => {
    const rects = svg.current?.querySelectorAll<SVGRectElement>('.key')
    if (!rects) return
    const level = String(brightnessLevel(look.brightness))
    rects.forEach((rect, index) => {
      const fill = keyFill(look, index)
      rect.style.fill = fill ?? ''
      rect.style.fillOpacity = fill ? level : ''
    })
  }, [look])

  return (
    <svg className="kb" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Keyboard preview" ref={svg}>
      <rect className="plate" x=".5" y=".5" width={WIDTH - 1} height={HEIGHT - 1} rx={8} />
      {KEYS}
    </svg>
  )
}

export default memo(Silhouette)

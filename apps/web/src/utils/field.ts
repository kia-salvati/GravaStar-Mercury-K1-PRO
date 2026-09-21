import type { ColourMode } from 'k916'

/** How the ambient field moves for an effect. Each value is an `fx-*` class in app.css. */
type FieldMotion = 'off' | 'solid' | 'reactive' | 'wave' | 'sine' | 'stars' | 'rainbow' | 'windmill' | 'waterfall' | 'bloom' | 'custom'
/** The layers the field keeps mounted; `off` shows none of them. */
export const FIELD_LAYERS: readonly Exclude<FieldMotion, 'off'>[] = ['solid', 'reactive', 'wave', 'sine', 'stars', 'rainbow', 'windmill', 'waterfall', 'bloom', 'custom']

const MOTION_BY_EFFECT: Readonly<Record<string, FieldMotion>> = {
  'Off': 'off',
  'Custom': 'custom',
  'Always On': 'solid',
  'Dream Rainbow': 'rainbow',
  'One Touch': 'reactive',
  'Key Ripple': 'reactive',
  'Stars': 'stars',
  'Wave': 'wave',
  'Shadow': 'reactive',
  'Sine Wave': 'sine',
  'Windmill': 'windmill',
  'Waterfall': 'waterfall',
  'Blooming': 'bloom',
}

/** Effects the K1 PRO does not expose still get a field that matches their colour mode. */
const MOTION_BY_COLOUR_MODE: Readonly<Record<ColourMode, FieldMotion>> = { none: 'off', single: 'solid', perKey: 'custom', mixed: 'rainbow' }

const ANIMATED: ReadonlySet<FieldMotion> = new Set(['rainbow', 'stars', 'wave', 'sine', 'windmill', 'waterfall', 'bloom'])

export function fieldMotion(effect: string, colourMode: ColourMode): FieldMotion {
  return MOTION_BY_EFFECT[effect] ?? MOTION_BY_COLOUR_MODE[colourMode]
}

export function isAnimated(motion: FieldMotion): boolean {
  return ANIMATED.has(motion)
}

/** Brightness stage → share of the theme's ambient cap. Off and Custom read stage 0 and draw nothing. */
const LEVEL_BY_STAGE = [0, 0.4, 0.6, 0.8, 1] as const
/** Speed stage → one animation cycle in seconds. Stage 0 is the slowest the field goes, not stopped. */
const PERIOD_S_BY_STAGE = [60, 45, 30, 20, 12] as const

const atStage = (table: readonly number[], stage: number): number => {
  const index = Math.min(Math.max(Math.round(stage), 0), table.length - 1)
  return table[index] ?? 0
}

export function brightnessLevel(stage: number): number {
  return atStage(LEVEL_BY_STAGE, stage)
}

/** Inverse of `brightnessLevel`; -1 for a level no stage produces. */
export function brightnessStage(level: number): number {
  return LEVEL_BY_STAGE.findIndex((known) => Math.abs(known - level) < 1e-9)
}

/** The field's opacity is the cap scaled by the stage, so it can never exceed the theme's cap. */
export function fieldOpacity(stage: number, cap: number): number {
  return cap * brightnessLevel(stage)
}

export function speedPeriodSeconds(stage: number): number {
  return atStage(PERIOD_S_BY_STAGE, stage)
}

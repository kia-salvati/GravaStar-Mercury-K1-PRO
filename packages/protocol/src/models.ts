/**
 * Lighting speed and brightness are **stages**, not percentages — the vendor UI's sliders are
 * percentage-based only for drawing, and the number shown is the stage.
 *
 * The wire value is `stage * step`. Stage counts vary per model (916_F75 has 9 brightness
 * stages), which is why they live here rather than as module constants.
 */
export interface LightingRange {
  speedStages: number
  speedStep: number
  brightnessStages: number
  brightnessStep: number
}

export interface Capabilities {
  layers: number
  /** Matrix positions in a keymap read. Includes empty positions. */
  slots: number
  /** Positions that carry a binding on the factory default layer. */
  keyCount: number
  macroBytes: number
  hasScreen: boolean
  /**
   * Which connections report battery. Verified on the K1 PRO: the dongle pushes a power packet
   * after every identity read; the cable never sends an input report at all.
   */
  battery: 'none' | 'wireless' | 'always'
  lighting: LightingRange
  /** Effect ids this model offers, in the vendor UI's order. See codec/lighting.ts for names. */
  effectIds: readonly number[]
}

export interface Model {
  uuid: string
  productName: string
  protocolFamily: '916'
  capabilities: Capabilities
}

export const K1_PRO_UUID = '0x030000000197'

/**
 * Models are added here only once verified against real hardware. An unverified entry would be
 * guessing at capabilities nothing can test, and the vendor app's habit of showing SOCD and GIF
 * editors to boards that have neither is exactly what that produces.
 */
const MODELS: readonly Model[] = [
  {
    uuid: K1_PRO_UUID,
    productName: 'GravaStar Mercury K1 PRO',
    protocolFamily: '916',
    capabilities: {
      layers: 3,
      // From the captured default layer: 36 packets × 14 bytes / 4 bytes per slot, 84 non-empty.
      slots: 126,
      keyCount: 84,
      macroBytes: 512,
      hasScreen: false,
      battery: 'wireless',
      // Verified by capture: brightness "1" in the vendor UI is byte 0x01 on the wire and "4" is
      // 0x04, so the step is 1 — the vendor's brightnessStep:5 descriptor does not apply here.
      // Speed reads 0 for Windmill and 1 for a freshly selected effect, so speed is 0-based.
      lighting: { speedStages: 4, speedStep: 1, brightnessStages: 4, brightnessStep: 1 },
      // The 13 effects the vendor UI exposes for this model, by 916-family id.
      effectIds: [0, 277, 1, 3, 4, 7, 8, 11, 12, 13, 15, 16, 17],
    },
  },
]

export function modelForUuid(uuid: string): Model | undefined {
  return MODELS.find((model) => model.uuid === uuid)
}

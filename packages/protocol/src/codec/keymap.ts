import { codeToKey } from '../keycodes.js'

export enum Layer {
  Default = 0,
  Fn = 1,
  Fn1 = 2,
}

/**
 * One key slot, 4 bytes big-endian: [type, modifiers, 0, code]. Every value below was read off the
 * K1 PRO's default layer in test/fixtures/session-1-connect.jsonl.
 *
 *   00 00 00 29   plain key — code is the HID keyboard usage (0x29 = Escape)
 *   00 02 00 00   modifier only — the HID boot-protocol modifier byte (0x02 = ShiftLeft)
 *   02 00 00 e9   consumer page — code is the HID consumer usage (0xE9 = Volume Up)
 *   0d 00 00 00   the Fn key
 *   00 00 00 00   empty slot
 *
 * The type byte is the top byte of the vendor's large keycode values (0x0D000000 = Fn).
 * Types not listed here decode to a visible placeholder rather than a guess.
 */
export interface KeyBinding {
  slot: number
  type: number
  modifiers: number
  code: number
  raw: number
  key: string
}

export const BYTES_PER_SLOT = 4

export const SlotType = {
  Plain: 0x00,
  Consumer: 0x02,
  Fn: 0x0d,
} as const

/** HID boot-protocol modifier bits, in the order the standard defines them. */
const MODIFIER_NAMES = ['ControlLeft', 'ShiftLeft', 'AltLeft', 'MetaLeft', 'ControlRight', 'ShiftRight', 'AltRight', 'MetaRight'] as const

/** HID consumer page usages the keyboard is known to emit. Anything else stays hex. */
const CONSUMER_NAMES: Readonly<Record<number, string>> = {
  0xb5: 'MediaTrackNext',
  0xb6: 'MediaTrackPrevious',
  0xb7: 'MediaStop',
  0xcd: 'MediaPlayPause',
  0xe2: 'AudioVolumeMute',
  0xe9: 'AudioVolumeUp',
  0xea: 'AudioVolumeDown',
  0x6f: 'BrightnessUp',
  0x70: 'BrightnessDown',
}

export function decodeKeymap(data: Uint8Array): KeyBinding[] {
  const bindings: KeyBinding[] = []
  for (let offset = 0; offset + BYTES_PER_SLOT <= data.length; offset += BYTES_PER_SLOT) {
    const type = data[offset]!
    const modifiers = data[offset + 1]!
    const code = data[offset + 3]!
    const raw = ((type << 24) | (modifiers << 16) | (data[offset + 2]! << 8) | code) >>> 0
    bindings.push({ slot: offset / BYTES_PER_SLOT, type, modifiers, code, raw, key: nameFor(type, modifiers, code, raw) })
  }
  return bindings
}

function nameFor(type: number, modifiers: number, code: number, raw: number): string {
  if (raw === 0) return 'None'
  if (type === SlotType.Fn) return 'Fn'
  if (type === SlotType.Consumer) return CONSUMER_NAMES[code] ?? `Consumer(0x${code.toString(16)})`
  if (type === SlotType.Plain) {
    if (code !== 0) return codeToKey(code)
    const names = MODIFIER_NAMES.filter((_, bit) => modifiers & (1 << bit))
    if (names.length > 0) return names.join('+')
  }
  return `Type${type.toString(16).padStart(2, '0')}(0x${raw.toString(16).padStart(8, '0')})`
}

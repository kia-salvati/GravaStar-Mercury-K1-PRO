/**
 * Base keycodes are standard HID Keyboard/Keypad usage page (0x07) IDs.
 *
 * Established by reading the vendor's own tables: their values are 41=Escape, 43=Tab,
 * 53=Backquote, 58..69=F1..F12 and 224..231 for the modifiers, which is the published HID standard
 * exactly. The names in their tables were not usable — the bundle's string obfuscation defeats a
 * clean extraction — but the standard supplies those, and it is the more reliable source anyway.
 *
 * Names follow the DOM `KeyboardEvent.code` convention so the UI layer can map to physical keys
 * without a second translation table.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0']

function buildKeycodes(): Record<string, number> {
  const codes: Record<string, number> = {}

  // 0x04..0x1D — KeyA through KeyZ
  for (let i = 0; i < LETTERS.length; i++) codes[`Key${LETTERS[i]}`] = 0x04 + i
  // 0x1E..0x27 — Digit1..Digit9 then Digit0
  for (let i = 0; i < DIGITS.length; i++) codes[DIGITS[i]!] = 0x1e + i
  // 0x3A..0x45 — F1..F12
  for (let i = 1; i <= 12; i++) codes[`F${i}`] = 0x39 + i
  // 0x59..0x61 — Numpad1..Numpad9
  for (let i = 1; i <= 9; i++) codes[`Numpad${i}`] = 0x58 + i

  return {
    ...codes,
    Enter: 0x28,
    Escape: 0x29,
    Backspace: 0x2a,
    Tab: 0x2b,
    Space: 0x2c,
    Minus: 0x2d,
    Equal: 0x2e,
    BracketLeft: 0x2f,
    BracketRight: 0x30,
    Backslash: 0x31,
    NonUsHash: 0x32,
    Semicolon: 0x33,
    Quote: 0x34,
    Backquote: 0x35,
    Comma: 0x36,
    Period: 0x37,
    Slash: 0x38,
    CapsLock: 0x39,
    PrintScreen: 0x46,
    ScrollLock: 0x47,
    Pause: 0x48,
    Insert: 0x49,
    Home: 0x4a,
    PageUp: 0x4b,
    Delete: 0x4c,
    End: 0x4d,
    PageDown: 0x4e,
    ArrowRight: 0x4f,
    ArrowLeft: 0x50,
    ArrowDown: 0x51,
    ArrowUp: 0x52,
    NumLock: 0x53,
    NumpadDivide: 0x54,
    NumpadMultiply: 0x55,
    NumpadSubtract: 0x56,
    NumpadAdd: 0x57,
    NumpadEnter: 0x58,
    Numpad0: 0x62,
    NumpadDecimal: 0x63,
    IntlBackslash: 0x64,
    ContextMenu: 0x65,
    ControlLeft: 0xe0,
    ShiftLeft: 0xe1,
    AltLeft: 0xe2,
    MetaLeft: 0xe3,
    ControlRight: 0xe4,
    ShiftRight: 0xe5,
    AltRight: 0xe6,
    MetaRight: 0xe7,
  }
}

/** name → wire code, for base keys. */
export const KEYCODES: Readonly<Record<string, number>> = Object.freeze(buildKeycodes())

const CODE_TO_NAME = new Map(Object.entries(KEYCODES).map(([name, code]) => [code, name]))

export function keyToCode(name: string): number | undefined {
  return KEYCODES[name]
}

/**
 * Unknown codes decode to a visible placeholder rather than throwing: one unrecognised key must
 * not fail an entire keymap read, and a placeholder that round-trips shows up in the UI where it
 * will actually get noticed.
 */
export function codeToKey(code: number): string {
  return CODE_TO_NAME.get(code) ?? `Unknown(0x${code.toString(16)})`
}

export function isKnownCode(code: number): boolean {
  return CODE_TO_NAME.has(code)
}

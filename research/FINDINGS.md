# How the GravaStar 1kHub web configurator talks to the keyboard

Source: https://support.gravastar.com/1khub/ (Vue 3 + Vite SPA, "GravaStar Web HubX Pro")
Method: static analysis of the shipped JS bundles (copies in this folder).

## Transport
- **WebHID** (`navigator.hid`). Chrome/Edge only. No native driver, no WebUSB, no Bluetooth GATT.
- Device discovery: `navigator.hid.requestDevice({filters})` on user click; `navigator.hid.getDevices()`
  for already-permitted devices on reload.
- Candidate interfaces are filtered to collections that expose
  `featureReports+inputReports` **or** `outputReports+inputReports`.
- Two transport styles are used depending on protocol family:
  - `sendFeatureReport(reportId, buf)` / `receiveFeatureReport(reportId)` — buffer `Uint8Array(519)`
  - `sendReport(reportId, ...)` + `device.oninputreport` for async/streaming replies
- Disconnect handled via `navigator.hid.addEventListener('disconnect', ...)`.

## Identity
- Vendor ID **9610 = 0x258A (SinoWealth)** for all GravaStar models. Many product IDs.
- Protocol families keyed by VID:PID → `"916"`, `"916_wireLess"`, `"901"`, `"8815"`, `"8815_wireLess"`.
  Each family has its own protocol class.
- After opening, the app calls `getDeviceBasicAttributes()` → `{ uuid, screenSize, version }`.
  The `uuid` is matched against a hard-coded table; that entry is confusingly called `password`.
  It is a **device model identifier, not a secret** — it selects the layout/feature profile.

## Our target
```
model:       916_K1_PRO           (wired)   / 916_K1_PRO_wireLess
name:        GravaStar Mercury K1 PRO
uuid:        0x030000000197
protocolKey: 916 / 916_wireLess
screen:      none (K98 / NP PRO have an LCD; K1 PRO does not)
```

## Feature surface (from lazy-loaded route chunks)
DeviceOverview, BasicChangeKeyCode (remap), BasicFunctions, AdvancedKey (**SOCD** / hall-effect
style settings), MacroConfiguration, LightingEffect + lightingStore, Rhythm, Mural, GifEdit
(screen models only), ConfigurationManagement (profiles), Setting.

## Cloud dependency
- A backend exists at `https://api.hubx.pro` (used by `request-*.js`).
- It is **not** in the device I/O path — HID is direct browser→keyboard. The API appears to serve
  accounts / profile sync / assets. A local app can skip it entirely.

## What is still unknown
The **command opcodes and payload layout** inside those feature reports. The bundle is
string-array-obfuscated (`e(398)` indirection), so opcodes are not readable by grep. Two ways to get
them:
1. Deobfuscate the string table in `index-DvnCopQ8.js` (static, no hardware needed).
2. Live capture: run the official page with the K1 PRO connected and log every
   `sendFeatureReport` / `receiveFeatureReport` while clicking each feature. Fastest and
   ground-truth accurate.

---

# Live inspection with the K1 PRO connected (2026-09-10)

## Battery + charging IS supported (their app never shows it)
Decoded from `deviceStatus(mode, cb)` — polls `inputReport()` every 500ms and matches a
**19-byte input report** with header `0A 01 00 04 02`:

```
byte[5]        = battery percentage        (mode 1 uses it as an online flag instead)
byte[6] & 0x01 = fully charged
byte[6] & 0x10 = charging
```

Their Device Overview screen shows only Connection Type / Device Type / Product Name / Version
and a factory-reset button — **no battery at all**. The firmware reports it; the vendor UI
just never surfaces it. This is the headline feature we add.

Open question: their code only starts this poll when `isWireless` is true. Whether the **wired**
connection also reports battery is untested — verify empirically.

## Frame format (from the profile-write function next to deviceStatus)
```
[ cmd, totalPackets, packetIndex, lenInThisPacket, ...14 data bytes, checksum ]
  = 18 bytes + 1 checksum = 19-byte frames
```
Checksum is computed over `[reportId, ...frame]`. Long payloads are chunked 14 bytes at a time;
the last packet sets byte[3] to the remainder (or 2 when the length is an exact multiple of 14).
The 519-byte feature report is the bulk channel; 19-byte frames are the command channel.

## Actual K1 PRO feature surface — only 4 screens, not 8
The other four routes (BasicFunctions, AdvancedKey/SOCD, Rhythm, GifEdit) belong to other
models and are **not shown for the K1 PRO**. It is a plain mechanical board: no hall-effect,
no SOCD, no LCD.

| Screen | Contents |
|---|---|
| RGB Lighting | 13 effects: Off, Custom, Always On, Dream Rainbow, One Touch, Key Ripple, Stars, Wave, Shadow, Sine Wave, Windmill, Waterfall, Blooming. Speed + Brightness sliders, colour wheel, HEX/RGB entry, "Color Mixing" toggle, monochrome swatches. Per-key selection on a keyboard map. |
| Basic Key Remapping | **3 layers: Default / Fn Layer / Fn1 Layer.** Key picker with "Keyboard" (full 104-key incl. numpad) and "Extended" tabs. Per-layer Reset. |
| Macro Configuration | Macro list with New / Import. **Total macro storage is 512 bytes** — a hard constraint on macro design. |
| Device Overview | Connection Type (showed "Wired"), Device Type, Product Name, Version `0x0100`, Reset to Factory Settings. |

Physical layout is ~75%: F-row, a Del/PgUp/PgDn right column, inverted-T arrows, ~82 keys.

## Deobfuscation is viable
The bundle uses a plain string-array indirection (`Je` returns the array; ~5030 call sites, no
rotation IIFE). The array can be evaluated in node and every `x(1234)` call resolved mechanically —
so the full opcode set can be recovered statically, without needing a live capture for everything.

---

# Deobfuscated command surface (2026-09-10)

`deobfuscate.mjs` resolves the string-array indirection (24 accessors, 24 tables, 4788/5030 call
sites, 0 failures) into `proto.clean.js`. Caveat: alias scoping is approximated by "most recent
declaration wins", so some **property names** in nested scopes resolve wrongly
(`r["reportId"]` where the source said `r.length`). **Numeric opcodes are literals and are
untouched — those are trustworthy.** Verify semantics against live capture regardless.

## Frame
```
[ opcode, arg, 0x00, 0x01, 0x00, ...payload... , checksum ]   // 18 bytes + checksum = 19
checksum = (sum of all preceding bytes) & 0xFF
```
Bulk payloads chunk 14 data bytes per frame via opcode 0x04 with (totalPackets, packetIndex, len).

## Convention: read opcode = write opcode | 0x80
| Concern | Write | Read |
|---|---|---|
| Keymap | `0x03` | `0x83` |
| Battery / power | — | `0x87` |
| Profile (bulk) | `0x04` | — |
| Factory reset | `0x06` | — |
| (unidentified) | `0x11` | — |

Observed literals:
- `getKeyboardPower()` → `[135, 0, 0, 1, 0, 2]`
- `setKeyboardReset(n)` → `[6, 1, 0, n & 255]` zero-padded to 18 + checksum
- `getKeyboardKeys(layer)` → `[131, (layer & 3) | ((system & 1) << 2), 0, 1, 0, 248, 1, ...]`
- `calculateChecksum` → additive sum `& 0xFF`

## Methods

**Reads (non-destructive):** `getDeviceBasicAttributes` (uuid/version/screenSize),
`getKeyboardProfile`, `getKeyboardKeys(layer)`, `getKeyboardLightColor`,
`getKeyboardCustomLightColor`, `getKeyboardCustomColorList`, `getKeyboardPower`,
`getKeyboardSleepTime`, `getKeyboardSystem`, `getKeyBoardMacroKey`, `getKeyBoardMacroKeyList`,
`getKeyBoardMacroNameList`.
Paired parsers: `parseKeysFromResponse`, `parseKeyboardProfile`, `parseKeyboardLight`,
`parseKeyboardCustomLightColor`, `parseKeyboardMacroKey`, `parseKeyboardAdvancedKey`.

**Writes (config only — no firmware/DFU command exists anywhere in the protocol):**
`setKeyboardKeys` (remap, per layer), `setKeyboardCustomLightColor` /
`setKeyboardCustomLightColorArray` (per-key colour), `sendKeyConfiguration`,
`setKeyBoardMacroKey` / `setMacroIndependentKey` (macros), `setKeyboardTglKey` (**toggle/latching
keys**), `setKeyboardMtKey` (**mod-tap**), sleep time, `setKeyboardReset` (factory reset).
Screen-model only, N/A for K1 PRO: `setKeyBoardImg`, `setGifLight`.

**TGL and MT are not exposed in the K1 PRO's own UI** but the firmware supports them — free
feature parity-plus. Helpers `calculateTglBaseAddress` / `calculateMtBaseAddress` show they live
at computed flash offsets.

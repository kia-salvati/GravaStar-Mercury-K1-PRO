# k916 — protocol library design

**Date:** 2026-09-10
**Status:** approved design, not yet implemented
**Scope:** Project 1 of 2. This spec covers the protocol library only. The configurator UI is
Project 2 and gets its own spec once this lands.

## Why this exists

GravaStar's web configurator (`support.gravastar.com/1khub/`) is the only way to configure a
Mercury K1 PRO. It is Chrome-only, depends on a backend that returns 500s, hides the battery level
the firmware already reports, and cannot be extended. We are replacing it.

The replacement is split in two because the protocol has real unknowns and the UI does not. A UI
designed on top of a half-understood protocol gets rewritten; a protocol library with a proven
byte-level contract does not.

## What this package is

A standalone TypeScript package that speaks the GravaStar "916" protocol family. It is consumed by
our web UI first and by a Windows/Linux desktop app later **without modification**.

Named for the protocol family, not the product: the same command set serves the K98, NP, NP PRO,
K1, K1 Lite and K1 PRO. Supporting the family costs nothing extra now and is impossible to retrofit
cheaply later.

### Hard constraints

- **Zero dependencies.** No React, no DOM, no Node built-ins. If it cannot run unchanged in a
  browser, in Node, and inside a Tauri webview, it does not belong here.
- **Everything pure except two files.** `device.ts` holds state; the transport does I/O. Frame
  construction, encoding, decoding and the keycode tables are pure functions. This is not
  aesthetic — it is what lets the entire protocol be tested with no keyboard attached.
- **No invented opcodes.** See *Safety* below.

### Layout

```
packages/protocol/
  src/
    transport/
      transport.ts        # the interface — the only seam the core depends on
      webhid.ts           # navigator.hid implementation
      mock.ts             # replays recorded fixtures; used by every test
    frame.ts              # 19-byte framing, checksum, chunking          (pure)
    codec/
      power.ts  keymap.ts  lighting.ts  macros.ts  profile.ts  system.ts (pure)
    keycodes.ts           # keycode tables + layout descriptors          (pure)
    models.ts             # uuid → model, capabilities, keymap size      (pure)
    device.ts             # K916 class — the only stateful part
    index.ts
  test/
    fixtures/             # captured byte sequences, one file per exchange
```

## Transport

The single seam that makes the core portable. Everything above it is platform-agnostic.

```ts
export interface Transport {
  sendFeatureReport(reportId: number, data: Uint8Array): Promise<void>
  receiveFeatureReport(reportId: number): Promise<DataView>
  onInputReport(handler: (reportId: number, data: DataView) => void): () => void
  readonly info: { vendorId: number; productId: number }
}
```

The core never enumerates or picks devices — it receives an already-open transport. Device
selection is a UI concern and differs per platform (a Chrome permission prompt, a native device
list, a CLI flag), so it stays out of the library.

Implementations: `WebHIDTransport` (v1), `MockTransport` (tests), and later `NodeHIDTransport` /
`RustTransport` for desktop. Adding one is the entire cost of a new platform.

## Wire format

Established from the HID report descriptor and from the vendor bundle. See
`research/FINDINGS.md` for provenance.

- **Transport:** HID **feature report 6** on the vendor collection (usage page `0xFF00`,
  usage `0x01`). The descriptor declares a `0x207`-byte (519) feature report, matching the
  `Uint8Array(519)` buffer in the vendor code. A 7-byte input report on the same report ID
  carries asynchronous notifications.
- **Command frame:** 18 bytes plus a checksum byte = **19 bytes**.

```
[ opcode, arg, 0x00, 0x01, 0x00, ...payload..., checksum ]

checksum = (sum of all preceding bytes, including the report ID) & 0xFF
```

- **Bulk payloads** chunk 14 data bytes per frame under opcode `0x04`, framed as
  `[0x04, totalPackets, packetIndex, lenInThisPacket, ...14 bytes, checksum]`. The final packet
  sets `lenInThisPacket` to the remainder, or to `2` when the total is an exact multiple of 14.
- **Convention:** read opcode = write opcode `| 0x80`.

| Concern | Write | Read |
|---|---|---|
| Keymap | `0x03` | `0x83` |
| Battery / power | — | `0x87` |
| Profile (bulk) | `0x04` | — |
| Factory reset | `0x06` | — |
| Unidentified | `0x11` | — |

## Read commands — full specification

Reads cannot damage the device and are implemented first, in full, before any write exists in the
codebase.

### Public surface

```ts
const kb = await K916.connect(transport)

kb.info          // { model, productName, uuid, firmwareVersion, connection, capabilities }
kb.capabilities  // { layers, keyCount, macroBytes, hasScreen, hasBattery, ... }

await kb.power.read()                 // { percent, charging, full }
kb.power.subscribe(cb)                // push updates decoded from input reports
await kb.keymap.read(layer)           // KeyBinding[] for one layer
await kb.keymap.readAll()             // all layers
await kb.lighting.read()              // { effect, speed, brightness, color, perKey }
                                      // speed and brightness are STAGE indices (1..4 on the
                                      // K1 PRO), not percentages; wire value is stage * step
await kb.macros.list()                // { index, name, bytes }[]
await kb.macros.read(index)           // MacroStep[]
await kb.macros.bytesRemaining()      // of 512
await kb.system.readSleepTimer()      // minutes; wireless only
await kb.profile.dump()               // raw bytes — the backup taken before any write
```

### Command detail

| Method | Frame | Returns |
|---|---|---|
| `getDeviceBasicAttributes` | vendor call | `uuid`, `firmwareVersion`, `screenSize` |
| `power.read` | `[0x87, 0x00, 0x00, 0x01, 0x00, 0x02]` | battery %, charging, full |
| `keymap.read(layer)` | `[0x83, (layer & 3) \| ((system & 1) << 2), 0x00, 0x01, 0x00, 0xF8, 0x01]` | keycodes for the layer |
| `lighting.read` | `getKeyboardLightColor` / `getKeyboardCustomLightColor` | effect, speed, brightness, colours |
| `macros.list` | `getKeyBoardMacroNameList` / `getKeyBoardMacroKeyList` | names, indices, sizes |
| `profile.dump` | `getKeyboardProfile` | raw config blob |

### Battery decoding

The keyboard pushes 19-byte input reports with header `0A 01 00 04 02`:

```
byte[5]        = battery percentage      (mode 1 uses this byte as an online flag)
byte[6] & 0x01 = fully charged
byte[6] & 0x10 = charging
```

`power.subscribe()` decodes these as they arrive rather than polling on a timer, which is what the
vendor app does. Their app also only starts this when connected wirelessly — **whether the wired
connection reports battery is untested and must be verified empirically.** If it does not, the UI
shows battery only on the 2.4G/Bluetooth connection and says so, rather than showing a wrong value.

### Identity and capabilities

`getDeviceBasicAttributes` returns a `uuid` that identifies the model. The K1 PRO is
`0x030000000197`. `models.ts` maps uuid → `{ productName, protocolFamily, layers, keyCount,
macroBytes, hasScreen, hasBattery }`. The K1 PRO resolves to 3 layers, ~82 keys, 512 macro bytes,
no screen. `hasBattery` stays `false` until milestone 1 settles the wired question — the library
reports a capability it has verified, not one it assumes.

Feature availability is driven by this table, never hardcoded per screen — that is how the vendor
app ends up showing SOCD and GIF editors to boards that have neither.

## Write commands — scope and ordering

Everything writable is configuration. **The protocol contains no firmware, DFU, bootloader, flash
or erase command** — verified by exhaustive search of the vendor bundle. The realistic worst case
is a bad config, which factory reset repairs.

### What is writable

| Area | Capability |
|---|---|
| Keys | Remap any key on any of 3 layers (Default / Fn / Fn1), incl. media, mouse, system actions |
| Lighting | Effect (13), speed (4 stages), brightness (4 stages), global colour, per-key colours |
| Macros | Create / name / assign, within a 512-byte total budget |
| Toggle keys (`TGL`) | Latching key — press once to hold until pressed again |
| Mod-tap (`MT`) | Modifier when held, different key when tapped |
| Sleep timer | Idle minutes before sleep; wireless only |
| Factory reset | The escape hatch |

`TGL` and `MT` are supported by the firmware but **not exposed in the K1 PRO's own UI**. They are
free capability beyond the vendor app and are in scope.

Out of scope — LCD-model only, absent on the K1 PRO: `setKeyBoardImg`, `setGifLight`.

### Safety rules

These are requirements, not guidance.

1. **Never send an opcode or frame shape we have not observed the vendor app send.**
   Deobfuscation tells us what a byte *means*; capture proves what the device *accepts*. Only the
   second justifies a write. The one path to a real brick is an unobserved command reaching an
   undocumented firmware routine, and this rule closes it.
2. **Reads land completely before the first write is written.**
3. **Factory reset is the second thing implemented, and is proven before any other write exists.**
   Proof procedure: change a setting in the *vendor's* app, run our reset, observe the revert. The
   escape hatch is demonstrated working before we take any risk with it.
4. **A full `profile.dump()` is captured and committed as a fixture before the first write**, so
   the exact pre-existing configuration can be restored rather than only factory defaults.
5. Writes are implemented one area at a time, each verified against a fixture before the next
   begins.

### Unverified recovery path

SinoWealth-based boards commonly expose a bootloader via a key held during plug-in, which would
cover even a crash-at-boot corruption. **This is unconfirmed for the K1 PRO and must not be
discovered by experiment.** Check the manual or ask GravaStar support. Its absence does not block
the project; it changes how much margin rule 1 is carrying.

## Testing

No hardware required for the suite, which is the point of the purity constraint.

- **Round trip** — `decode(encode(x))` equals `x` for every command and every field. Two lookup
  tables that are meant to be inverses drift silently; a round-trip assertion is what catches it.
- **Golden fixtures** — real captured byte sequences replayed through `MockTransport`. If our
  encoder produces a different frame than the vendor app produced for the same action, the test
  fails. Strictly stronger than "it seemed to work when I clicked it".
- **Checksum and chunking** — property tests across payload lengths, especially the exact-multiple-
  of-14 boundary where the final packet's length byte becomes `2`.
- **Hardware smoke test** — a separate, manually-run script. Never part of the automated suite.

## Milestones

1. **Capture harness** — hook the vendor page's `sendFeatureReport`/`receiveFeatureReport`, walk
   every control, record fixtures. Also settles whether wired reports battery.
2. **Frame + transport** — framing, checksum, chunking, `WebHIDTransport`, `MockTransport`.
3. **Reads** — identity, power, keymap, lighting, macros, profile dump. *Checkpoint: you can see
   your real battery percentage and current keymap.*
4. **Factory reset + proof** — per safety rule 3.
5. **Writes** — keymap, then lighting, then macros, then TGL/MT.

Milestone 3 is the review point where this becomes worth looking at.

## Open questions

- Does the **wired** connection report battery, or only 2.4G/Bluetooth?
- Is there a hardware bootloader recovery combo?
- What is opcode `0x11`?
- Does Bluetooth mode expose the vendor collection at all, or only 2.4G and wired? Affects whether
  the connection-type indicator can work on Bluetooth.

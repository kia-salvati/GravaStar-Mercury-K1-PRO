# Protocol observations

Source of truth for every constant in the k916 package. Each entry says how it was established:
**vendor source** (read out of the deobfuscated bundle), **HID standard** (published usage tables),
or **capture** (observed on real hardware).

Nothing here is guessed. Anything not yet established is listed under *Open* and is absent from the
code rather than filled in with a plausible value.

---

## Capture session 6 — colour, cable, 2026-09-21 — *capture*

Fixture: `packages/protocol/test/fixtures/session-6-colour.jsonl` (151 frames). Eight swatch
clicks on Always On, a typed hex, wheel drags, Color Mixing toggled, then per-key edits on Custom.

### The "colour index" nibble was the colour MODE
The profile pair's low nibble is **7 = Color Mixing on, 0 = monochrome**. Mixed-only effects
carry 7 from the start; a fresh single-colour effect carries 0; it flipped 0 → 7 exactly when
the toggle was pressed. `LightingState.colourIndex` is gone; `mixing: boolean` replaces it.

### Effect colour is real RGB in the light-colour block
Read wired `8a` (483 bytes) / wireless `49` (490, padded); write wired `0a` (**512**).
```
bytes 0..17          constant header (passed through)
bytes 18 + 3*id      RGB for effect id      — Windmill @63 = ff ff ff (its #ffffff on screen)
write = read[0..483] + zeros + 5a a5 at 506..507 + zeros      (18 of 18 captured writes)
```
Swatch clicks, in order, wrote `00 00 00`, `00 00 ff`, `00 ff 00`, `00 ff ff`, `ff 00 00`,
`ff 00 ff`, `ff ff 00`, `ff ff ff`, then the typed `#ff8800` verbatim. Every effect has its own
default colour (One Touch blue, Shadow yellow, Waterfall red…).

### Per-key colour is a planar 378-byte block
Read wired `86`, write wired `06`, 378 = 126 slots × 3, **planar**: R at `slot`, G at
`126 + slot`, B at `252 + slot`. Editing slot 35 changed bytes 35, 161, 287. The vendor app's
first write into an all-zero block seeds its ten-key preset (29 bytes) — not a single-slot edit.

### Write headers differ per block
`04 00 00 01 00 80 00` profile · `0a 00 00 00 00 00 02` light colour (byte 3 is **00**) ·
`06 00 00 01 00 7a 01` per-key. Each is stored per write in `WiredDialect.WRITES`.

### Wireless colour writes: not captured
Both colour blocks were only ever written over cable. `WirelessDialect.writeFrames` refuses
`LightColor` and `CustomColor` until a dongle capture shows their opcodes.

## Capture session 4 — cable, 2026-09-21 — *capture*

Fixture: `packages/protocol/test/fixtures/session-4-wired.jsonl` (40 frames: connect, all three
keymap layers, macros, overview, 30 s idle). Dongle stayed plugged in but idle.

### The wired dialect, verified
- **Transport:** feature report **6**. Requests are **519 bytes**: a 7-byte header, then zero
  padding. **No checksum** on reads. One reply per request, **no chunking, no packet loss**.
- **Request:** `[opcode, arg, 0x00, 0x01, 0x00, lengthLo, lengthHi]` — the request declares
  the payload length it expects, little-endian. `arg` is the layer for keymap reads and a literal
  `01` for identity.
- **Reply** (as WebHID delivers it): `[0x06, …7-byte request header echoed…, payload]`, and
  `reply.length === 8 + declared length` held for all 20 replies.

| Command | wired | wireless | declared length |
|---|---|---|---|
| identity | `82 01` | `05 01` | 10 |
| keymap | `83 <layer>` | `41 00 00 layer<<4` | 504 |
| profile | `84` | `44` | 128 |
| macros | `85` | `43` | 512 |
| light colour | `8a` | `49` | 483 |

Not a `| 0x40` relationship — a lookup table per dialect. Payloads are byte-identical to the
wireless ones (same identity bytes, same keymap, same profile layout), so every codec is shared.

- **Battery is wireless-only.** Zero input reports on the cable across the whole session and
  a 30 s idle. `Capabilities.battery` is `'wireless'`; `K916.reportsBattery` is `false` on cable.
- Unlike the dongle path, the vendor app **re-reads each keymap layer** when its screen opens.
- The 19-byte-plus-checksum shape from the vendor's wired class (`setKeyboardReset`) is an
  **output report** for commands, not the feature-report read path. Stage 2 territory.

## Capture session 1 — 2.4G dongle, 2026-09-21 — *capture*

Fixtures: `packages/protocol/test/fixtures/session-1-connect.jsonl` (554 frames, the connect
handshake and initial bulk reads) and `session-1-screens.jsonl` (181 frames, Fn / Fn1 / macros).
Recorded with `tools/capture/record.js` injected into the vendor page. Nothing was written to the
keyboard; every frame is one their app sends on an ordinary visit.

### The dongle speaks a different dialect
- **Transport:** output report **19** (`0x13`) out, input report 19 in, on usage page `0xFF02`.
  Not feature report 6 — that is the wired interface. The library needs a second transport
  variant; the core stays the same.
- **Frame:** still 19 bytes. **Checksum confirmed on hardware:** `05 01` on report `0x13` carries
  `0x19 = 0x13 + 0x05 + 0x01`. Sum including the report id, masked to a byte — the hypothesis in
  `frame.ts` is now proven. On the wireless dialect the checksum sits at **byte 7**, not byte 18.
- **Read opcodes are `0x4n`** (wired reads are `0x8n`): `41`, `43`, `44`, `49` observed.
- **Bulk replies** are numbered packets: `43 25 <index> 0e …` = opcode, 0x25 = 37 packets total,
  index, 0x0e = 14 data bytes. 37 × 14 = 518 ≈ the 519-byte buffer.

### Identity — settled
```
out:  05 01 00 00 00 00 00 19
in:   05 01 00 0a 03 00 00 00 01 97 17 07 …
                  └─ uuid 03 00 00 00 01 97 = 0x030000000197 ─┘ └ fw 0x1707 ┘
```
Firmware version `0x1707` matches the Device Overview screen exactly.

### Battery — observed on hardware, once
```
in:   0a 01 00 04 05 64 01 00 …      ← arrives immediately after the identity reply
                  └ 0x64 = 100% ┘ └ 0x01 = full ┘
```
- Header is `0a 01 00 04 **05**`. The vendor's decoder checks byte 4 for `02`, so it would never
  match this frame — consistent with their UI never showing battery.
- **It is a one-shot at connect, not a broadcast:** 30 s idle on the dongle produced zero frames.
  Refreshing battery therefore means re-sending `05 01`, which is an observed frame — the
  unverified `0x87` query is not needed.
- `hasBattery` can be set `true` for the **wireless** connection. Wired remains unverified.

### The 2.4G link drops packets — *capture*
Per-read packet coverage at connect, from the fixture:

| Read | declared | received | missing indices |
|---|---|---|---|
| `43` ×4 | 37 | 35, 35, 38, 37 | `[8,34]`, `[1,3]`, none (one duplicate), none |
| `41` ×6 | 36 | 35, 34, 37, 34, 34, 36 | `[13]`, `[1,26]`, none (one dup), `[24,25]`, `[6,26]`, none |
| `49` ×5 | 35 | 36, 34, 35, 30, 35 | none (dup), `[7,9]`, `[7]`, `[15,17,19,21,23,26]`, none |

Arbitrary indices go missing and packets occasionally arrive twice. **This is why the vendor app
fires every bulk read four to six times** — brute-force retry until a complete set lands — and why
its "Loading configuration" bar crawls.

`K916` handles it properly: packets are kept by index, a burst that goes quiet with gaps triggers a
re-send, and new arrivals merge in. Indices are stable across retries, so only the gaps need to
land. Completeness is judged by coverage of `0..total-1`, never by count.

### Keymap slot encoding — *capture*
4 bytes per slot, big-endian: **`[type, modifiers, 0, code]`**. 126 slots per layer
(36 × 14 = 504 bytes), 84 populated on the factory default layer. Column-major: slots 0–5 are
Esc, `~, Tab, Caps, LShift, LCtrl.

| type | meaning | code byte |
|---|---|---|
| `0x00`, code ≠ 0 | plain key | HID keyboard usage (`0x29` = Escape) |
| `0x00`, code = 0 | modifier only | **modifiers byte** is the HID boot-protocol modifier mask: `01` LCtrl, `02` LShift, `04` LAlt, `08` LWin, `20` RShift, `40` RAlt |
| `0x02` | consumer page | HID consumer usage (`0xE9` Volume Up, `0xEA` Volume Down at slots 84/85) |
| `0x0D` | the Fn key | — (slot 59) |
| `0x07` | unmapped | seen at slot 86 (`0x0700001d`) and across the Fn layer; left as a visible placeholder |

The 32-bit value is exactly the vendor's keycode table: `0x0D000000` = 218103808 = "Fn",
`0x00020000` = 131072 = "L_shift", `0x00010000` = 65536 = "L_Ctrl". So the vendor's "extended"
keycodes were never a separate scheme — just this struct read as one integer.

`slot 75` carries HID `0x32` (Non-US # ~), which the ANSI layout renders as `\|`.

### Payload sizes honour the last packet's length nibble — *capture*
| Read | packets | bytes | note |
|---|---|---|---|
| `41` keymap | 36 × 14 | 504 | 126 × 4 |
| `43` macros | 36 × 14 + 8 | **512** | exactly the macro budget their UI reports |
| `44` profile | 9 × 14 + 2 | **128** | lighting effect / speed / brightness live here; offsets pending |
| `49` light colour | 35 × 14 | 490 | per-key colour; `ff ff ff ff` = white |

### Their app loads everything at connect
The four `43`, six `41`, one `44` and five `49` reads at connect fetch all config. Opening the
Default keymap screen sent **nothing**. Fn, Fn1 and the macro screen each re-read with `41 00`.

### Lighting layout in the 128-byte profile — *capture*, sessions 2 and 3
Derived by diffing successive full-profile writes while changing one setting at a time. Every
change touched only the bytes below.

```
bytes 9..10           current effect id, 16-bit BE  (Custom = 277 = 01 15)     — vendor source
bytes 56 + 2*id       per-effect pair: [brightness, speed << 4 | colourIndex]
                      no pair for Off (0), id 19, or Custom (277)              — vendor source
bytes 126..127        trailer 5a a5
```

**Brightness: the firmware has exactly the 4 stages the UI shows — HARDWARE-TESTED 2026-09-21.**
The vendor client only refuses values above 20, which suggested a 0–20 wire scale. On the real
K1 PRO, over the cable, stepping the byte through a ladder:
- **0–4**: distinct levels, as in the vendor UI.
- **5–12**: render identically to 4 — no additional brightness.
- **20**: **the keyboard reset** (LEDs off, re-enumerated, came back). Not a brick — the profile
  block cannot reach firmware — but a value outside the firmware's range is not clamped, it
  crashes the board.

Consequence: `applyLighting` validates every value against the model's declared stages
(`Capabilities.lighting`) and nothing else, before any frame is built. A percentage brightness is
not available from the firmware; for the Custom effect it can be done in software by scaling
per-key RGB. This is the concrete reason the observed-frames rule exists.

| Observation | bytes |
|---|---|
| Windmill (15) as read at connect | `[10]=0f`, pair@86 = `01 07` → brightness 1, speed 0, colour 7 |
| → Always On (1) | `[10]=01`, pair@58 `02`→`04` (vendor default brightness 4) |
| → Waterfall (16) | `[10]=10`, pair@88 `02 10`→`04 17` |
| slider moves | only the current effect's pair changes |

- **Brightness on the wire is the stage** (1 ↔ `01`, 4 ↔ `04`). The vendor descriptor's
  `brightnessStep: 5` does **not** apply on this board; `models.ts` now says step 1.
- **Speed is 0-based** — Windmill sat at 0; a freshly selected effect gets the vendor default 1.
- **Colour for these effects is a palette index**, low nibble of the second byte. `7` observed with
  the UI showing `#ffffff`, and swatch 7 of the vendor's 8-swatch palette is white. Only that one
  value is verified. The colour wheel / hex entry applies to the Custom effect's per-key block
  (`0x49`), not to this byte — which is why "changing the colour" on Windmill does nothing: the
  effect is `mixed`-mode and ignores colour entirely.
- Effect id → name comes from the vendor bundle's 916 table (`codec/lighting.ts`). The K1 PRO
  exposes 13 of the 19 ids: `0, 277, 1, 3, 4, 7, 8, 11, 12, 13, 15, 16, 17`. Mixed-colour effects:
  Dream Rainbow 3, Windmill 15, Waterfall 16, Blooming 17.
- Bytes 0–9, 11–55 and 98–125 are still undecoded. Packet 1 opens `01 00 00 00 01 07 03 00 00 ff`,
  packet 2 `03 06 03 01`; the region from 98 holds `07 47 / 07 44` pairs then a run of `02`.

### The write handshake — *capture*
On any lighting change the vendor app writes the **entire 128-byte profile back** as ten
`0x04` packets — `04 0a <index> <length> <data…> <checksum>` — and the keyboard **echoes each
packet as an input report** to acknowledge it, sometimes twice. That echo is the ack. The last
packet declares its **real** length, `02` (128 = 9 × 14 + 2), zero-padded to the frame. Twelve
complete writes captured; `WirelessDialect.writeFrames` reproduces the vendor's ten packets
byte-for-byte (golden test in `test/write.test.ts`).

**Cable writes — session-5-wired-writes.jsonl, 37 captured.** One 519-byte feature report:
`04 00 00 01 00 80 00` + the 128-byte profile, no checksum. **The keyboard sends nothing back**
(157 requests, 120 replies — the 37 writes are the difference); the vendor app reads the profile
(`84`) straight after each write to confirm. `WiredDialect.writeFrames` reproduces all 37
byte-for-byte, and re-encoding each profile from its predecessor is byte-exact (both golden tests
in `test/write.test.ts`).

### Wireless-only: Sleep Settings
Device Overview on the dongle shows a Sleep panel (0.5–20 min, currently 1 min) that cable mode
hides. Their footnote reads "currently connected via cable" while the panel above says "Wireless"
— a vendor UI bug, noted so nobody chases it as a protocol quirk.

---

## Established

### Transport — *HID descriptor*
Feature report **6** on the vendor collection (usage page `0xFF00`, usage `0x01`), read directly
from the K1 PRO's report descriptor at `/sys/class/hidraw/hidraw8/device/report_descriptor`:

```
Usage Page 0xff00, Usage 0x01, Report ID 6
  Input:   7 bytes       ← asynchronous notifications
  Feature: 0x207 (519)   ← command / bulk channel
```

The 519 matches the `new Uint8Array(519)` buffer in the vendor bundle exactly.

### Frame format — *vendor source*
```
[ opcode, arg, 0x00, 0x01, 0x00, ...payload..., checksum ]   // 18 body bytes + 1 = 19
checksum = (reportId + sum of body bytes) & 0xFF
```
Implemented in `src/frame.ts`. **The checksum algorithm is still a hypothesis** — it reproduces the
vendor's `calculateChecksum` as decompiled, but has not been checked against a frame the keyboard
actually accepted. `test/frame.test.ts` carries a `todo` for that verification.

### Battery — *vendor source*
19-byte input report, header `0A 01 00 04 02`:
```
byte[5]        = battery percentage      (mode 1 reuses this byte as an online flag)
byte[6] & 0x01 = fully charged
byte[6] & 0x10 = charging
```
Read frame: `[0x87, 0x00, 0x00, 0x01, 0x00, 0x02]`. Implemented in `src/codec/power.ts`.

**Confidence: unexercised by the vendor.** `getKeyboardPower` is defined in every protocol family
class but has **zero call sites** in any screen, and `deviceStatus` is only ever invoked with mode
`1` (online check), never mode `2` (battery). Their UI shows no battery on any connection type —
confirmed on the 2.4G dongle on 2026-09-21. The decoding above is what their library *expects*,
not something their app has ever *received*.

Two ways to verify, in order of risk:
1. **Passive** — `deviceStatus` never sends anything; it only listens for input reports the
   keyboard pushes unsolicited. With the dongle connected, the capture harness sees them with no
   command sent. Zero risk. This is plan Task 3 step 3.
2. **Active** — send `0x87` ourselves. This is a frame the vendor app never sends, so it needs an
   explicit decision to step outside the observed-frames rule for a read.

### Base keycodes — *HID standard*
The vendor uses **standard HID Keyboard/Keypad usage page (0x07)** IDs for base keys. Confirmed by
reading their `{ value, name }` tables: `41=Escape`, `43=Tab`, `53=Backquote`, `58..69=F1..F12`,
`224..231` for modifiers — the published standard exactly.

`src/keycodes.ts` is therefore built from the HID standard, **not** from the vendor tables. Their
*names* could not be extracted reliably: the bundle's string-array indirection is scope-local, and
`research/deobfuscate.mjs` resolves aliases by "most recent declaration wins", which drifts onto the
wrong table partway through long array literals. The numeric values are literals and were never
touched, which is what made the identification possible.

To regenerate the raw tables for inspection:
```bash
cd research && node deobfuscate.mjs index-DvnCopQ8.js proto.deobf.js
npx prettier --parser babel proto.deobf.js > proto.clean.js
node extract-keycodes.mjs proto.clean.js     # writes keycode-tables.json
```

### Lighting speed and brightness are stages, not percentages — *vendor source*
Their UI sliders are percentage-based only for **drawing** (`VerticalSlider` clamps to 0..100 and
positions the thumb with `${modelValue}%`). The number displayed above each slider is the stage,
and the vendor's own page converts:

```js
z = 100 / speedAndBrightness.brightness           // slider step % = 100 / stage count
e = e / speedAndBrightness.brightnessStep         // wire -> stage, on read
t.brightness = t.brightness * brightnessStep      // stage -> wire, on write
```

The descriptor is **per model**, so it belongs in `Capabilities.lighting`, not a module constant:

| Model | speed | brightness | speedStep | brightnessStep |
|---|---|---|---|---|
| eight of ten declaring models | 4 | 4 | 0 | 5 |
| `916_F75` | 4 | 9 | 1 | 1 |
| one other | 6 | 6 | 1 | 1 |

With 4 stages and a step of 5, brightness travels the wire as **5, 10, 15 or 20**.

`speedStep: 0` is inert — the vendor multiplies only brightness by its step, never speed, so speed
goes on the wire as the stage index directly.

**`916_K1_PRO` declares no descriptor of its own** and inherits one through the config deep-merge.
`models.ts` currently assumes the common `{4, 4, 0, 5}`; confirm against a capture by comparing the
wire byte with the stage their UI displays.

### Opcode convention — *vendor source*
Read opcode = write opcode `| 0x80`.

| Concern | Write | Read |
|---|---|---|
| Keymap | `0x03` | `0x83` |
| Battery | — | `0x87` |
| Profile (bulk, 14-byte chunks) | `0x04` | — |
| Factory reset | `0x06` | — |
| Unidentified | `0x11` | — |

### No firmware-write capability — *vendor source*
Exhaustive search of the vendor bundle for firmware / upgrade / bootloader / DFU / flash / erase
commands returns nothing but UI translation strings. Their app can change configuration and nothing
else, which bounds the worst realistic failure to a bad config that factory reset repairs.

---

## Open

Each of these blocks a specific task in
`docs/superpowers/plans/2026-09-10-k916-protocol-reads.md` and is answered by a capture session
(plan Task 3).

| Question | Blocks | Why it matters |
|---|---|---|
| Does the **wired** connection report battery, or only 2.4G? | Task 8 | The vendor only polls battery when wireless. If wired is silent, the UI must say so rather than show a stale figure. `hasBattery` stays `false` until proven. |
| Does the checksum hypothesis reproduce a real captured frame? | Task 4 | Everything sent to the keyboard depends on it. |
| Keymap payload: bytes per key, header length, byte order | Task 12 | Cannot decode a keymap without it. |
| Lighting payload offsets for effect / speed / brightness / RGB | Task 13 | Derive by changing one setting per capture and diffing. |
| K1 PRO's inherited `speedAndBrightness` descriptor | Task 13 | It declares none; `models.ts` assumes `{speed:4, brightness:4, speedStep:0, brightnessStep:5}`. Compare the wire byte against the stage their UI shows. |
| Macro list frame and record stride | Task 13 | — |
| True key count for the K1 PRO | Task 9 | `models.ts` currently says 82, counted off a screenshot of their UI. Correct against the real keymap response length. |
| Encoding of media / mouse / Fn bindings | Task 11 | Vendor tables show `0x2000000`-class values for media, `0x10000`/`0x20000` for modifier combinations, `218103808` for Fn. Encoding unresolved, so these are absent from `keycodes.ts`. |
| Chunk reassembly: final packet's length byte | Task 14 | The vendor source computes `2` whenever the payload is an exact multiple of 14, which reads like a bug in their code. Trust captured bytes over that reading. |
| Is there a hardware bootloader recovery combo? | — | Would cover even a crash-at-boot corruption. Check the manual or ask support; do **not** discover by experiment. |

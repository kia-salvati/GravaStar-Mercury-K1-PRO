# GravaStar Mercury K1 PRO — an open configurator

A small, installable web app for the GravaStar Mercury K1 PRO keyboard, plus the protocol
library underneath it. Built by reverse-engineering the vendor's web configurator and verifying
every byte against the real keyboard — because the vendor's app is Chrome-only, phones home to a
backend that returns 500s, hides the battery level the firmware already reports, and cannot be
extended.

Works over the **cable** and the **2.4G dongle**, on Linux and Windows, in Chrome or Edge
(WebHID). Runs offline once installed. Nothing is sent anywhere.

> **Status:** Stage 1 (read everything) is complete and verified on hardware. Stage 2 (writes) is
> in progress: brightness, speed, effect, Color Mixing, effect colour and per-key colour all work
> over the cable; over the dongle only the profile block is writable so far. Key remapping and
> macros are not yet written.

## What it shows and does

| | Read | Write (cable) | Write (dongle) |
|---|---|---|---|
| Battery %, charging, full | dongle only — the cable never reports it | — | — |
| Connection type, firmware | ✓ | — | — |
| Lighting effect (13), brightness 0–4, speed 0–4, Color Mixing | ✓ | ✓ | ✓ |
| Effect colour (24-bit RGB) | ✓ | ✓ | not captured yet |
| Per-key colour (Custom effect, 126 slots) | ✓ | ✓ | not captured yet |
| Keymap, 3 layers | ✓ | — | — |
| Macros (raw, 512-byte block) | ✓ | — | — |

Brightness is **four stages** — that is the firmware's real range. Writing 20 reset the keyboard;
the library refuses anything above the model's declared stages.

## Layout

```
packages/protocol/   k916 — the protocol library. Zero dependencies, pure TypeScript.
apps/web/            the app. Vite + React 19 + TypeScript, installable PWA.
tools/capture/       the recorder that captures the vendor app's HID traffic.
docs/                protocol-observations.md is the spec the firmware does not ship.
research/            reverse-engineering scripts and the HID report descriptors.
setup/               the Linux udev rule.
```

### The library

```ts
import { K916, WebHIDTransport } from 'k916'

const [device] = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x258a }, { vendorId: 0x3554 }] })
const kb = await K916.connect(await WebHIDTransport.open(device))

kb.info                                   // { productName, firmwareVersion, connection: 'wired' | 'wireless' }
await kb.readPower()                      // { percent, charging, full }   (dongle)
await kb.readLighting()                   // { effect, brightness, speed, mixing, ... }
await kb.setLighting({ brightness: 2 })   // read → apply → write → read back → verify
await kb.setEffectColour({ r: 255, g: 136, b: 0 })
await kb.setKeyColour(35, { r: 0, g: 255, b: 0 })
const backup = await kb.backup()          // all three writable blocks
await kb.restore(backup)
```

`K916` is the one service the app talks to. Underneath, a `Dialect` translates intent into the
opcode and framing the current connection expects — the cable uses 519-byte feature reports with
no chunking, the dongle uses 19-byte packets with checksums, acknowledgements, and a lossy link
that drops packets. Neither leaks upward. A `Transport` does raw I/O; `MockTransport` replays
captured traffic so the whole protocol is tested with no keyboard attached.

### Safety rules, because writes touch keyboard flash

1. **Never send a frame shape the vendor app was not observed sending.** Deobfuscation says what
   a byte means; a capture proves what the device accepts. `MockTransport` throws on any frame
   absent from a capture, so a guessed opcode fails a test rather than reaching the board.
2. **Every write is read back and compared.** `setLighting` returns what the keyboard holds, not
   what was intended.
3. **Only mapped bytes change.** Most of every block is still undecoded; a byte we do not
   understand passes through untouched.
4. **Values are clamped to the model's declared ranges**, never the wire's.

## Running it

```bash
npm install
npm run build --workspace=k916
npm run dev --workspace=@keyboard-config/web     # then open http://localhost:5173/
npm test                                          # the protocol suite, no hardware needed
```

Chrome offers **Install** in the address bar; installed, it runs as its own window, offline.

### Linux

WebHID needs permission on the hidraw nodes. Install the udev rule, then unplug and replug:

```bash
sudo install -m 644 setup/60-gravastar-hid.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger --subsystem-match=hidraw
```

The rule must sort **before** systemd's `73-seat-late.rules` for `TAG+="uaccess"` to take
effect — numbering it `99-` silently half-works.

## How the protocol was recovered

1. The vendor bundle's string-array obfuscation is reversed by `research/deobfuscate.mjs`.
2. `tools/capture/record.js`, pasted into the vendor page, records every HID frame while its
   controls are used one setting at a time.
3. Successive writes are diffed; the bytes that move are the bytes that mean something.
4. Every decoder gets a **golden test**: decoding a captured write and re-encoding it from its
   predecessor must reproduce it byte for byte. `packages/protocol/test/fixtures/` holds the
   captures, `docs/protocol-observations.md` records what each one established and how.

The firmware does not describe itself beyond the HID report descriptor; on the vendor usage page
that descriptor says only "a 19-byte box you may send and receive". The observations document is
the contract the firmware never shipped.

## Not affiliated with GravaStar

This is an independent project. It does not use any GravaStar code; the vendor bundle is
downloaded on demand for analysis and is not part of this repository.

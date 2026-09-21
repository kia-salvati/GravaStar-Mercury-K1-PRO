# App — Stage 1 design (status screen)

**Date:** 2026-09-21
**Status:** approved
**Depends on:** `packages/protocol` (k916), Stage 1 reads verified on both connections.
**Design:** `docs/design/2026-09-21-status-screen-glass.html`, design 1 "Frosted cards",
structure D (rail + panel). All three themes. Ambient and Static fields both shipped, user-selectable.

## What it is

A small-window desktop utility, installable as a PWA on Windows and Linux, that shows what the
keyboard is doing. Stage 1 is **read-only**: no control on any screen changes the keyboard.

## Stack

Vite + React 19 + TypeScript in `apps/web`. Follows `/home/kia/Desktop/work/fsg/CLAUDE_FRONTEND_RULES.md`
(layers, naming, readable-by-default, self-review). No component library; the design is bespoke.
No runtime dependency beyond React and `k916`.

## Layers (per the frontend rules)

| Rule layer | Here | One job |
|---|---|---|
| `api/` | the `k916` package | talk HID; the app never touches bytes |
| hook (service) | `useKeyboard()` | own the `K916` instance, connection state, battery, lighting, errors |
| hook (service) | `useSettings()` | theme + field preferences, persisted in `localStorage` |
| `utils/` | pure | stage → field opacity, effect → hue/motion, palette index → hex |
| pages | Device, Settings, and placeholders for Lighting / Keys / Macros | thin |
| components | Rail, StatusCard, Field, ThemeSwitch… | props in, events out |

## Screens

**Rail** (persistent): connection glyph, battery glyph (or "n/a" on cable), effect swatch; buttons
for Device · Lighting · Keys · Macros · Settings. 60 px, widens to 200 px with labels at ≥ 900 px.

**Device** (home): identity (name, firmware, connection), power (percent + charging/full, or the
full-weight "Battery not reported on cable" sentence), lighting (effect, brightness 1–4 and speed
0–4 as discrete blocks, colour as swatch+index or "Mixed colours — set by the effect" / "Per-key"),
sleep timer on wireless only. Values come from `K916` reads; battery from `subscribePower`.

**Settings:** Theme — Follow system (default) / White / Dark / Black. Field — Ambient / Static.
Reduced-motion from the OS freezes the ambient field regardless.

**Lighting / Keys / Macros:** a route each, with one honest panel: "Stage 2". No fake controls.

**Connect:** one button, `navigator.hid.requestDevice` with both vendor ids (0x258a wired,
0x3554 dongle). Remember the granted device via `getDevices()` and reconnect on load. On
`disconnect`, return to the connect state with the reason shown.

## Ambient field

Driven by the real lighting state: effect selects the motion (Windmill rotates, Wave/Sine/Waterfall/
Dream Rainbow slide, Stars twinkle, Blooming pulses, Always On glows, Off is dark), brightness
stage scales opacity (40/60/80/100 % of a per-theme cap), speed stage sets the period. Per-theme
caps are tokens — white 34 %, dark 14 %, black 26 % — and nothing may exceed them: that is what
keeps every text pair ≥ 4.5:1 on glass. The most-muted text tier is never used on glass.

## PWA

`manifest.webmanifest` (name, icons, `display: standalone`, `display_override:
["window-controls-overlay"]`), a minimal service worker (cache the app shell; no offline data
pretence), theme-color per theme. Installable from `localhost` in dev.

## Testing

- Pure `utils/` round-trip tested with Vitest.
- `useKeyboard()` tested against `MockTransport` with the real fixtures from `packages/protocol/test/fixtures`
  (both dongle and cable), asserting the rendered state — battery present on dongle, "not reported"
  on cable, Windmill / Blooming decoded.
- `npx tsc --noEmit` and `vite build` clean. Then the user's browser pass on real hardware.

## Out of scope

Anything that writes to the keyboard. Tray, background running, per-app profiles (desktop shell,
later). Bluetooth. Wired-mode sleep timer (does not exist).

# k916 Protocol Library — Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `k916` TypeScript package to the point where it can connect to a GravaStar Mercury K1 PRO over WebHID and read its identity, battery state, keymap, lighting and macros — with the whole protocol covered by tests that run with no keyboard attached.

**Architecture:** A zero-dependency TypeScript package. Everything is a pure function except `device.ts` (state) and the transports (I/O). The core depends on a single `Transport` interface, so the same code runs in a browser today and in a desktop app later. Correctness comes from replaying byte sequences captured from the vendor's own app through a `MockTransport` — if our encoder produces a different frame than theirs did for the same action, the test fails.

**Tech Stack:** TypeScript 5.9, Node 22, npm workspaces, Vitest. No runtime dependencies.

**Scope:** Milestones 1–3 of the spec (`docs/superpowers/specs/2026-09-10-k916-protocol-design.md`): capture harness, frame/transport layer, and all read commands. **Writes are deliberately excluded** — spec safety rule 2 requires reads to land completely first, and factory-reset proof (milestone 4) precedes any write. Those get their own plan.

**Working agreement:** Per `HOW_WE_WORK.md`, commits are **proposed, not executed**. Each task ends with a commit step showing the exact command and message; the user runs it or authorises it. Never run `git commit` unprompted.

**A note on honesty in this plan:** Tasks 1–3 produce the captured fixtures. Byte offsets for keymap, lighting and macro payloads are *derived from those fixtures* — this plan gives the exact derivation procedure and the exact test structure for each, but cannot pre-state offsets nobody has observed yet. Battery is the exception: its layout is already known from the vendor source and appears here in full. Anywhere a constant must come from a capture, the task says so explicitly rather than inventing a number.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | npm workspace root |
| `packages/protocol/package.json` | the `k916` package; zero runtime deps |
| `packages/protocol/tsconfig.json` | strict TS, ESM output |
| `packages/protocol/vitest.config.ts` | test runner config |
| `packages/protocol/src/frame.ts` | 19-byte framing, checksum, response reassembly (pure) |
| `packages/protocol/src/transport/transport.ts` | the `Transport` interface — the only seam |
| `packages/protocol/src/transport/webhid.ts` | `navigator.hid` implementation |
| `packages/protocol/src/transport/mock.ts` | replays captured fixtures; used by every test |
| `packages/protocol/src/models.ts` | uuid → model + capabilities (pure) |
| `packages/protocol/src/codec/power.ts` | battery decode (pure) |
| `packages/protocol/src/codec/keymap.ts` | keymap encode/decode (pure) |
| `packages/protocol/src/codec/lighting.ts` | lighting decode (pure) |
| `packages/protocol/src/codec/macros.ts` | macro list/decode (pure) |
| `packages/protocol/src/keycodes.ts` | keycode tables + K1 PRO layout (pure) |
| `packages/protocol/src/device.ts` | `K916` class — the only stateful part |
| `packages/protocol/src/index.ts` | public exports |
| `packages/protocol/test/fixtures/*.jsonl` | captured byte sequences |
| `tools/capture/record.js` | browser snippet that records vendor-app traffic |
| `tools/capture/README.md` | how to run a capture session |
| `apps/demo/index.html` | manual smoke test — connect and show live reads |

---

## Task 1: Scaffold the workspace

**Files:**
- Create: `.gitignore`, `package.json`, `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`, `packages/protocol/src/index.ts`, `packages/protocol/test/smoke.test.ts`

- [ ] **Step 1: Initialise the repo**

```bash
cd /home/kia/Desktop/learning/keyboard-config
git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
.superpowers/
*.log
```

`.superpowers/` holds the brainstorming server's scratch files and must not be committed.

- [ ] **Step 3: Write the workspace root `package.json`**

```json
{
  "name": "keyboard-config",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspace=k916",
    "build": "npm run build --workspace=k916"
  }
}
```

- [ ] **Step 4: Write `packages/protocol/package.json`**

Note `"dependencies"` is absent, not empty — the zero-dependency constraint is enforced by review, and an absent field makes an accidental addition obvious in a diff.

```json
{
  "name": "k916",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.0.0",
    "@types/w3c-web-hid": "^1.0.6"
  }
}
```

- [ ] **Step 5: Write `packages/protocol/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["w3c-web-hid"]
  },
  "include": ["src"]
}
```

`noUncheckedIndexedAccess` matters here: this package indexes byte arrays constantly, and it forces every `bytes[5]` to be checked rather than silently assumed present.

- [ ] **Step 6: Write `packages/protocol/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 7: Write a placeholder export so the build has something to compile**

`packages/protocol/src/index.ts`:

```ts
export const VERSION = '0.1.0'
```

- [ ] **Step 8: Write the smoke test**

`packages/protocol/test/smoke.test.ts`:

```ts
import { expect, test } from 'vitest'
import { VERSION } from '../src/index.js'

test('package exports a version', () => {
  expect(VERSION).toBe('0.1.0')
})
```

- [ ] **Step 9: Install and verify**

```bash
cd /home/kia/Desktop/learning/keyboard-config
npm install
npm test
```

Expected: `1 passed`. Then:

```bash
npm run build
```

Expected: exits 0, creates `packages/protocol/dist/index.js` and `index.d.ts`.

- [ ] **Step 10: Propose the commit**

```bash
git add .gitignore package.json package-lock.json packages/ docs/ research/ setup/
git commit -m "chore: scaffold k916 workspace with vitest and strict typescript"
```

---

## Task 2: Build the capture harness

The harness patches `HIDDevice.prototype` so every frame the vendor app exchanges with the keyboard is recorded. Patching the prototype works even though the app is already connected, because their code calls `this.device.sendFeatureReport(...)` fresh each time rather than caching the method.

**Files:**
- Create: `tools/capture/record.js`, `tools/capture/README.md`

- [ ] **Step 1: Write `tools/capture/record.js`**

```js
// Paste into the DevTools console on https://support.gravastar.com/1khub/ .
// Records every HID frame exchanged with the keyboard.
// Stop and download with:  __k916.save()
(() => {
  if (globalThis.__k916) { console.warn('[k916] already recording'); return }

  const events = []
  const hex = (view) => {
    const bytes = view instanceof DataView
      ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      : new Uint8Array(view)
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  }
  const record = (dir, reportId, data) => {
    events.push({ t: Date.now(), dir, reportId, bytes: hex(data), label: globalThis.__k916.label })
  }

  const proto = HIDDevice.prototype
  const origSendFeature = proto.sendFeatureReport
  const origRecvFeature = proto.receiveFeatureReport
  const origSendOutput = proto.sendReport

  proto.sendFeatureReport = function (reportId, data) {
    record('out:feature', reportId, data)
    return origSendFeature.call(this, reportId, data)
  }
  proto.sendReport = function (reportId, data) {
    record('out:output', reportId, data)
    return origSendOutput.call(this, reportId, data)
  }
  proto.receiveFeatureReport = async function (reportId) {
    const result = await origRecvFeature.call(this, reportId)
    record('in:feature', reportId, result)
    return result
  }

  // Their code assigns device.oninputreport = handler; wrap the setter so we see input reports too.
  const desc = Object.getOwnPropertyDescriptor(proto, 'oninputreport')
  Object.defineProperty(proto, 'oninputreport', {
    configurable: true,
    get() { return desc.get.call(this) },
    set(handler) {
      desc.set.call(this, function (event) {
        record('in:input', event.reportId, event.data)
        return handler.apply(this, arguments)
      })
    },
  })

  globalThis.__k916 = {
    label: 'unlabelled',
    mark(label) { this.label = label; console.log('[k916] now labelling:', label) },
    get count() { return events.length },
    save(name = 'capture') {
      const body = events.map((e) => JSON.stringify(e)).join('\n')
      const url = URL.createObjectURL(new Blob([body], { type: 'application/x-ndjson' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.jsonl`
      a.click()
      URL.revokeObjectURL(url)
      console.log(`[k916] saved ${events.length} events`)
    },
  }

  console.log('[k916] recording. __k916.mark("read-keymap") before each action, __k916.save() when done.')
})()
```

- [ ] **Step 2: Write `tools/capture/README.md`**

````markdown
# Capture harness

Records the vendor app's HID traffic so we can verify our own encoder against it.

1. Open <https://support.gravastar.com/1khub/> in Chrome, connect the keyboard.
2. Open DevTools → Console, paste the whole of `record.js`, press Enter.
3. Before each action, label it: `__k916.mark('read-keymap-default')`
4. Perform the action in their UI.
5. When finished: `__k916.save('session-1')`
6. Move the downloaded `session-1.jsonl` into `packages/protocol/test/fixtures/`.

`dir` values: `out:feature`, `out:output`, `in:feature`, `in:input`.
````

- [ ] **Step 3: Propose the commit**

```bash
git add tools/capture/
git commit -m "feat(capture): add HID traffic recorder for vendor app"
```

---

## Task 3: Run a capture session

This is a manual task and it gates everything downstream — the fixtures it produces are what Tasks 5–13 are tested against.

**Files:**
- Create: `packages/protocol/test/fixtures/session-1.jsonl`, `docs/protocol-observations.md`

- [ ] **Step 1: Record the connect handshake**

Load the vendor page with the harness installed, then connect the keyboard. Label it first:
`__k916.mark('connect')`. This captures `getDeviceBasicAttributes` — identity, version, screen size.

- [ ] **Step 2: Record each read, one labelled action at a time**

Visit each screen and label before clicking. Minimum set:

| Label | Action in their UI |
|---|---|
| `read-keymap-default` | Open Basic Key Remapping, Default layer |
| `read-keymap-fn` | Switch to Fn Layer |
| `read-keymap-fn1` | Switch to Fn1 Layer |
| `read-lighting` | Open RGB Lighting |
| `read-macros` | Open Macro Configuration |
| `read-overview` | Open Device Overview |

- [ ] **Step 3: Answer the wired-battery question**

With the keyboard connected **by cable**, run `__k916.mark('battery-wired')` and leave the page
idle for 30 seconds. Then check:

```js
__k916.count
```

Look for any `in:input` event whose bytes start `0a 01 00 04 02`. Record the answer in
`docs/protocol-observations.md`:

- If such events appear → wired reports battery; `hasBattery` is unconditional.
- If none appear → repeat the whole step with the **2.4G dongle** instead of the cable. If they
  appear only then, battery is wireless-only and the UI must say so rather than show a stale value.

- [ ] **Step 4: Save and file the fixtures**

```js
__k916.save('session-1')
```

```bash
mv ~/Downloads/session-1.jsonl /home/kia/Desktop/learning/keyboard-config/packages/protocol/test/fixtures/
```

- [ ] **Step 5: Write `docs/protocol-observations.md`**

Record, from the fixture: the report ID actually used, the opcode observed for each labelled
action, the response length for each, and the wired-battery answer. This document is the source of
truth for every constant in Tasks 5–13.

- [ ] **Step 6: Propose the commit**

```bash
git add packages/protocol/test/fixtures/session-1.jsonl docs/protocol-observations.md
git commit -m "test(fixtures): capture vendor app read traffic for K1 PRO"
```

---

## Task 4: Frame layer — checksum

The spec's hypothesis is that the checksum is the sum of all bytes including the report ID, masked
to a byte. Task 3's fixtures either confirm it or replace it. Test against a **real captured frame**
rather than a made-up one, so this task proves the hypothesis instead of assuming it.

**Files:**
- Create: `packages/protocol/src/frame.ts`, `packages/protocol/test/frame.test.ts`

- [ ] **Step 1: Write the failing test**

Replace `REPORT_ID` and `CAPTURED` with the first `out:feature` frame from `session-1.jsonl`.

```ts
import { expect, test } from 'vitest'
import { checksum } from '../src/frame.js'

// From test/fixtures/session-1.jsonl, label "connect", first out:feature event.
const REPORT_ID = 6
const CAPTURED = [0x87, 0x00, 0x00, 0x01, 0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x90]

test('checksum matches the byte the vendor app sent', () => {
  const body = CAPTURED.slice(0, 18)
  const expected = CAPTURED[18]
  expect(checksum(REPORT_ID, body)).toBe(expected)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/kia/Desktop/learning/keyboard-config/packages/protocol && npx vitest run test/frame.test.ts
```

Expected: FAIL — `checksum is not a function` (the module does not exist yet).

- [ ] **Step 3: Implement `checksum`**

`packages/protocol/src/frame.ts`:

```ts
/** Additive checksum over the report ID followed by the frame body, masked to one byte. */
export function checksum(reportId: number, body: readonly number[] | Uint8Array): number {
  let sum = reportId
  for (const byte of body) sum += byte
  return sum & 0xff
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run test/frame.test.ts
```

Expected: PASS.

If it FAILS, the hypothesis is wrong. Do not adjust the test to match the code — the captured byte
is ground truth. Try, in order: sum excluding the report ID; two's-complement (`(-sum) & 0xff`);
XOR instead of sum. Whichever reproduces the captured byte across **three different** captured
frames is correct. Record the answer in `docs/protocol-observations.md`.

- [ ] **Step 5: Propose the commit**

```bash
git add packages/protocol/src/frame.ts packages/protocol/test/frame.test.ts
git commit -m "feat(frame): add checksum verified against captured vendor frames"
```

---

## Task 5: Frame layer — build a command frame

**Files:**
- Modify: `packages/protocol/src/frame.ts`
- Modify: `packages/protocol/test/frame.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { buildFrame, FRAME_BODY_BYTES, FRAME_BYTES } from '../src/frame.js'

test('buildFrame pads to 18 bytes and appends the checksum', () => {
  const frame = buildFrame(6, [0x87, 0x00, 0x00, 0x01, 0x00, 0x02])

  expect(frame).toHaveLength(FRAME_BYTES)
  expect(frame[0]).toBe(0x87)
  expect(frame[6]).toBe(0)                        // padding
  expect(frame[17]).toBe(0)                       // padding
  expect(frame[18]).toBe(checksum(6, [...frame].slice(0, FRAME_BODY_BYTES)))
})

test('buildFrame reproduces a captured frame exactly', () => {
  expect([...buildFrame(REPORT_ID, [0x87, 0x00, 0x00, 0x01, 0x00, 0x02])]).toEqual(CAPTURED)
})

test('buildFrame rejects a body that will not fit', () => {
  expect(() => buildFrame(6, new Array(19).fill(0))).toThrow(/18/)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/frame.test.ts
```

Expected: FAIL — `buildFrame is not a function`.

- [ ] **Step 3: Implement `buildFrame`**

Append to `packages/protocol/src/frame.ts`:

```ts
/** A command frame is 18 body bytes followed by one checksum byte. */
export const FRAME_BODY_BYTES = 18
export const FRAME_BYTES = FRAME_BODY_BYTES + 1

export function buildFrame(reportId: number, body: readonly number[]): Uint8Array {
  if (body.length > FRAME_BODY_BYTES) {
    throw new RangeError(`frame body is ${body.length} bytes, maximum is ${FRAME_BODY_BYTES}`)
  }
  const frame = new Uint8Array(FRAME_BYTES)
  frame.set(body)
  frame[FRAME_BODY_BYTES] = checksum(reportId, frame.subarray(0, FRAME_BODY_BYTES))
  return frame
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run test/frame.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Propose the commit**

```bash
git add packages/protocol/src/frame.ts packages/protocol/test/frame.test.ts
git commit -m "feat(frame): build padded 19-byte command frames"
```

---

## Task 6: Transport interface and MockTransport

`MockTransport` replays a capture file, so every later test runs the real byte sequences with no
keyboard attached.

**Files:**
- Create: `packages/protocol/src/transport/transport.ts`, `packages/protocol/src/transport/mock.ts`, `packages/protocol/test/mock-transport.test.ts`

- [ ] **Step 1: Write the interface**

`packages/protocol/src/transport/transport.ts`:

```ts
export interface Transport {
  sendFeatureReport(reportId: number, data: Uint8Array): Promise<void>
  receiveFeatureReport(reportId: number): Promise<DataView>
  onInputReport(handler: (reportId: number, data: DataView) => void): () => void
  readonly info: { vendorId: number; productId: number }
}

export interface CaptureEvent {
  t: number
  dir: 'out:feature' | 'out:output' | 'in:feature' | 'in:input'
  reportId: number
  bytes: string
  label: string
}

export function parseCapture(ndjson: string): CaptureEvent[] {
  return ndjson
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as CaptureEvent)
}

export function bytesOf(event: CaptureEvent): Uint8Array {
  return Uint8Array.from(event.bytes.split(' ').map((b) => parseInt(b, 16)))
}
```

- [ ] **Step 2: Write the failing test**

`packages/protocol/test/mock-transport.test.ts`:

```ts
import { expect, test } from 'vitest'
import { MockTransport } from '../src/transport/mock.js'

const CAPTURE = [
  '{"t":1,"dir":"out:feature","reportId":6,"bytes":"87 00","label":"connect"}',
  '{"t":2,"dir":"in:feature","reportId":6,"bytes":"0a 01 00","label":"connect"}',
].join('\n')

test('replays the recorded response for a matching request', async () => {
  const transport = new MockTransport(CAPTURE)
  await transport.sendFeatureReport(6, Uint8Array.from([0x87, 0x00]))
  const reply = await transport.receiveFeatureReport(6)
  expect([...new Uint8Array(reply.buffer)]).toEqual([0x0a, 0x01, 0x00])
})

test('throws when the code sends a frame the vendor app never sent', async () => {
  const transport = new MockTransport(CAPTURE)
  await expect(transport.sendFeatureReport(6, Uint8Array.from([0xff, 0xff]))).rejects.toThrow(/unexpected frame/i)
})

test('delivers input reports to subscribers', () => {
  const capture = '{"t":1,"dir":"in:input","reportId":6,"bytes":"0a 01 00 04 02 5b 10","label":"battery"}'
  const transport = new MockTransport(capture)
  const seen: number[][] = []
  transport.onInputReport((_id, data) => seen.push([...new Uint8Array(data.buffer)]))
  transport.flushInputReports()
  expect(seen).toEqual([[0x0a, 0x01, 0x00, 0x04, 0x02, 0x5b, 0x10]])
})
```

The second test is the one that earns its keep: it makes "we sent a frame the vendor never sent"
a **test failure**, which is spec safety rule 1 enforced mechanically rather than by discipline.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run test/mock-transport.test.ts
```

Expected: FAIL — cannot resolve `../src/transport/mock.js`.

- [ ] **Step 4: Implement `MockTransport`**

`packages/protocol/src/transport/mock.ts`:

```ts
import { bytesOf, parseCapture, type CaptureEvent, type Transport } from './transport.js'

/**
 * Replays a capture file. Sends are matched against what the vendor app actually sent; an
 * unrecognised frame is an error, which is how safety rule 1 ("never send an unobserved frame")
 * becomes a failing test rather than a convention.
 */
export class MockTransport implements Transport {
  readonly info = { vendorId: 0x258a, productId: 0x010c }

  #events: CaptureEvent[]
  #pendingReplies: Uint8Array[] = []
  #inputHandlers = new Set<(reportId: number, data: DataView) => void>()

  constructor(ndjson: string) {
    this.#events = parseCapture(ndjson)
  }

  async sendFeatureReport(reportId: number, data: Uint8Array): Promise<void> {
    const sent = [...data].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const index = this.#events.findIndex(
      (e) => e.dir.startsWith('out:') && e.reportId === reportId && sent.startsWith(e.bytes),
    )
    if (index === -1) throw new Error(`unexpected frame, not present in capture: ${sent}`)

    for (let i = index + 1; i < this.#events.length; i++) {
      const event = this.#events[i]!
      if (event.dir.startsWith('out:')) break
      if (event.dir === 'in:feature') this.#pendingReplies.push(bytesOf(event))
    }
  }

  async receiveFeatureReport(_reportId: number): Promise<DataView> {
    const reply = this.#pendingReplies.shift()
    if (!reply) throw new Error('no recorded reply remaining for this request')
    return new DataView(reply.buffer)
  }

  onInputReport(handler: (reportId: number, data: DataView) => void): () => void {
    this.#inputHandlers.add(handler)
    return () => this.#inputHandlers.delete(handler)
  }

  /** Test hook: deliver every recorded input report to current subscribers. */
  flushInputReports(): void {
    for (const event of this.#events) {
      if (event.dir !== 'in:input') continue
      const data = new DataView(bytesOf(event).buffer)
      for (const handler of this.#inputHandlers) handler(event.reportId, data)
    }
  }
}
```

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run test/mock-transport.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Propose the commit**

```bash
git add packages/protocol/src/transport/ packages/protocol/test/mock-transport.test.ts
git commit -m "feat(transport): add Transport interface and capture-replaying MockTransport"
```

---

## Task 7: WebHIDTransport

**Files:**
- Create: `packages/protocol/src/transport/webhid.ts`, `packages/protocol/test/webhid.test.ts`

- [ ] **Step 1: Write the failing test**

A fake `HIDDevice` is enough — this class is thin, and the real verification is the manual smoke
test in Task 14.

```ts
import { expect, test, vi } from 'vitest'
import { WebHIDTransport } from '../src/transport/webhid.js'

function fakeDevice() {
  return {
    vendorId: 0x258a,
    productId: 0x010c,
    opened: false,
    open: vi.fn(async function (this: any) { this.opened = true }),
    sendFeatureReport: vi.fn(async () => {}),
    receiveFeatureReport: vi.fn(async () => new DataView(Uint8Array.from([1, 2, 3]).buffer)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

test('opens the device only when it is not already open', async () => {
  const device = fakeDevice()
  await WebHIDTransport.open(device as unknown as HIDDevice)
  expect(device.open).toHaveBeenCalledTimes(1)

  await WebHIDTransport.open(device as unknown as HIDDevice)
  expect(device.open).toHaveBeenCalledTimes(1)
})

test('exposes vendor and product ids', async () => {
  const transport = await WebHIDTransport.open(fakeDevice() as unknown as HIDDevice)
  expect(transport.info).toEqual({ vendorId: 0x258a, productId: 0x010c })
})

test('unsubscribing removes the input report listener', async () => {
  const device = fakeDevice()
  const transport = await WebHIDTransport.open(device as unknown as HIDDevice)
  const unsubscribe = transport.onInputReport(() => {})
  expect(device.addEventListener).toHaveBeenCalledWith('inputreport', expect.any(Function))
  unsubscribe()
  expect(device.removeEventListener).toHaveBeenCalledWith('inputreport', expect.any(Function))
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/webhid.test.ts
```

Expected: FAIL — cannot resolve `../src/transport/webhid.js`.

- [ ] **Step 3: Implement it**

`packages/protocol/src/transport/webhid.ts`:

```ts
import type { Transport } from './transport.js'

/** Wraps an HIDDevice the caller has already been granted. Device selection is a UI concern. */
export class WebHIDTransport implements Transport {
  static async open(device: HIDDevice): Promise<WebHIDTransport> {
    if (!device.opened) await device.open()
    return new WebHIDTransport(device)
  }

  readonly info: { vendorId: number; productId: number }

  private constructor(private readonly device: HIDDevice) {
    this.info = { vendorId: device.vendorId, productId: device.productId }
  }

  async sendFeatureReport(reportId: number, data: Uint8Array): Promise<void> {
    await this.device.sendFeatureReport(reportId, data)
  }

  async receiveFeatureReport(reportId: number): Promise<DataView> {
    return this.device.receiveFeatureReport(reportId)
  }

  onInputReport(handler: (reportId: number, data: DataView) => void): () => void {
    const listener = (event: HIDInputReportEvent) => handler(event.reportId, event.data)
    this.device.addEventListener('inputreport', listener)
    return () => this.device.removeEventListener('inputreport', listener)
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run test/webhid.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Propose the commit**

```bash
git add packages/protocol/src/transport/webhid.ts packages/protocol/test/webhid.test.ts
git commit -m "feat(transport): add WebHIDTransport"
```

---

## Task 8: Battery decoding

The one codec whose layout is already known, from the vendor's `deviceStatus` function.

**Files:**
- Create: `packages/protocol/src/codec/power.ts`, `packages/protocol/test/power.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'vitest'
import { decodePowerReport, isPowerReport, POWER_READ_FRAME } from '../src/codec/power.js'

const report = (percent: number, flags: number) =>
  new DataView(Uint8Array.from([0x0a, 0x01, 0x00, 0x04, 0x02, percent, flags,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer)

test('recognises a power report by its header', () => {
  expect(isPowerReport(report(91, 0x10))).toBe(true)
})

test('rejects a report with a different header', () => {
  const other = new DataView(Uint8Array.from([0x0b, 0x01, 0x00, 0x04, 0x02, 0, 0]).buffer)
  expect(isPowerReport(other)).toBe(false)
})

test('decodes percentage, charging and full flags', () => {
  expect(decodePowerReport(report(91, 0x10))).toEqual({ percent: 91, charging: true, full: false })
  expect(decodePowerReport(report(100, 0x01))).toEqual({ percent: 100, charging: false, full: true })
  expect(decodePowerReport(report(47, 0x00))).toEqual({ percent: 47, charging: false, full: false })
})

test('the read frame body matches the vendor opcode', () => {
  expect(POWER_READ_FRAME).toEqual([0x87, 0x00, 0x00, 0x01, 0x00, 0x02])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/power.test.ts
```

Expected: FAIL — cannot resolve `../src/codec/power.js`.

- [ ] **Step 3: Implement it**

`packages/protocol/src/codec/power.ts`:

```ts
export interface PowerState {
  percent: number
  charging: boolean
  full: boolean
}

/** Vendor opcode 0x87 — request current power state. */
export const POWER_READ_FRAME = [0x87, 0x00, 0x00, 0x01, 0x00, 0x02] as const

const HEADER = [0x0a, 0x01, 0x00, 0x04, 0x02] as const
const POWER_REPORT_BYTES = 19
const FLAG_FULL = 0x01
const FLAG_CHARGING = 0x10

export function isPowerReport(data: DataView): boolean {
  if (data.byteLength < POWER_REPORT_BYTES) return false
  return HEADER.every((byte, i) => data.getUint8(i) === byte)
}

export function decodePowerReport(data: DataView): PowerState {
  const flags = data.getUint8(6)
  return {
    percent: data.getUint8(5),
    charging: (flags & FLAG_CHARGING) !== 0,
    full: (flags & FLAG_FULL) !== 0,
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run test/power.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Add a fixture-backed test**

Only if Task 3 recorded real `in:input` battery events. Append to `test/power.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { bytesOf, parseCapture } from '../src/transport/transport.js'

test('decodes every battery report in the real capture', () => {
  const capture = parseCapture(readFileSync('test/fixtures/session-1.jsonl', 'utf8'))
  const reports = capture
    .filter((e) => e.dir === 'in:input')
    .map((e) => new DataView(bytesOf(e).buffer))
    .filter(isPowerReport)

  expect(reports.length).toBeGreaterThan(0)
  for (const report of reports) {
    const state = decodePowerReport(report)
    expect(state.percent).toBeGreaterThanOrEqual(0)
    expect(state.percent).toBeLessThanOrEqual(100)
  }
})
```

If Task 3 found no battery reports on any connection type, **skip this step** and record that
finding in `docs/protocol-observations.md` instead. Do not weaken the assertions to make an empty
result pass — an empty capture is information, not a test to be satisfied.

- [ ] **Step 6: Propose the commit**

```bash
git add packages/protocol/src/codec/power.ts packages/protocol/test/power.test.ts
git commit -m "feat(codec): decode battery percentage and charging state"
```

---

## Task 9: Model and capability table

**Files:**
- Create: `packages/protocol/src/models.ts`, `packages/protocol/test/models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'vitest'
import { modelForUuid, K1_PRO_UUID } from '../src/models.js'

test('resolves the K1 PRO from its uuid', () => {
  const model = modelForUuid(K1_PRO_UUID)
  expect(model?.productName).toBe('GravaStar Mercury K1 PRO')
  expect(model?.capabilities.layers).toBe(3)
  expect(model?.capabilities.macroBytes).toBe(512)
  expect(model?.capabilities.hasScreen).toBe(false)
})

test('reports hasBattery as unverified until a capture proves it', () => {
  expect(modelForUuid(K1_PRO_UUID)?.capabilities.hasBattery).toBe(false)
})

test('returns undefined for an unknown uuid', () => {
  expect(modelForUuid('0xdeadbeef')).toBeUndefined()
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/models.test.ts
```

Expected: FAIL — cannot resolve `../src/models.js`.

- [ ] **Step 3: Implement it**

`packages/protocol/src/models.ts`:

```ts
export interface Capabilities {
  layers: number
  keyCount: number
  macroBytes: number
  hasScreen: boolean
  /** Only true once a capture has proved this model reports battery on this connection. */
  hasBattery: boolean
}

export interface Model {
  uuid: string
  productName: string
  protocolFamily: '916'
  capabilities: Capabilities
}

export const K1_PRO_UUID = '0x030000000197'

const MODELS: readonly Model[] = [
  {
    uuid: K1_PRO_UUID,
    productName: 'GravaStar Mercury K1 PRO',
    protocolFamily: '916',
    capabilities: { layers: 3, keyCount: 82, macroBytes: 512, hasScreen: false, hasBattery: false },
  },
]

export function modelForUuid(uuid: string): Model | undefined {
  return MODELS.find((model) => model.uuid === uuid)
}
```

Other 916-family models (K98, NP, NP PRO, K1, K1 Lite) are added to `MODELS` as each is verified
against real hardware. Adding an unverified entry would be guessing at capabilities we cannot test.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run test/models.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Update `keyCount` from the capture**

The value 82 is counted from a screenshot of their UI. Correct it against the actual keymap
response length observed in `read-keymap-default`, and note the true figure in
`docs/protocol-observations.md`.

- [ ] **Step 6: Propose the commit**

```bash
git add packages/protocol/src/models.ts packages/protocol/test/models.test.ts
git commit -m "feat(models): map device uuid to model capabilities"
```

---

## Task 10: Device connect and identity

**Files:**
- Create: `packages/protocol/src/device.ts`, `packages/protocol/test/device.test.ts`

- [ ] **Step 1: Write the failing test**

Derive `CONNECT_CAPTURE` from the `connect`-labelled events in `session-1.jsonl`.

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { K916 } from '../src/device.js'
import { MockTransport } from '../src/transport/mock.js'

const capture = readFileSync('test/fixtures/session-1.jsonl', 'utf8')

test('connect reads identity and resolves the model', async () => {
  const kb = await K916.connect(new MockTransport(capture))
  expect(kb.info.productName).toBe('GravaStar Mercury K1 PRO')
  expect(kb.info.uuid).toBe('0x030000000197')
  expect(kb.capabilities.layers).toBe(3)
})

test('connect rejects a device whose uuid is not a known model', async () => {
  const foreign = '{"t":1,"dir":"out:feature","reportId":6,"bytes":"01","label":"x"}\n' +
                  '{"t":2,"dir":"in:feature","reportId":6,"bytes":"00 00 00 00 00 00","label":"x"}'
  await expect(K916.connect(new MockTransport(foreign))).rejects.toThrow(/unsupported device/i)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/device.test.ts
```

Expected: FAIL — cannot resolve `../src/device.js`.

- [ ] **Step 3: Implement `K916.connect` and identity reading**

The exact frame for `getDeviceBasicAttributes` and the offsets of uuid and version within its
response come from the `connect` events in the capture. Read them from
`docs/protocol-observations.md`.

`packages/protocol/src/device.ts`:

```ts
import { buildFrame } from './frame.js'
import { modelForUuid, type Capabilities, type Model } from './models.js'
import { decodePowerReport, isPowerReport, POWER_READ_FRAME, type PowerState } from './codec/power.js'
import type { Transport } from './transport/transport.js'

export const REPORT_ID = 6

export interface DeviceInfo {
  uuid: string
  productName: string
  firmwareVersion: string
}

export class K916 {
  static async connect(transport: Transport): Promise<K916> {
    const identity = await readIdentity(transport)
    const model = modelForUuid(identity.uuid)
    if (!model) throw new Error(`unsupported device: uuid ${identity.uuid}`)
    return new K916(transport, model, identity.firmwareVersion)
  }

  private constructor(
    private readonly transport: Transport,
    private readonly model: Model,
    private readonly firmwareVersion: string,
  ) {}

  get info(): DeviceInfo {
    return {
      uuid: this.model.uuid,
      productName: this.model.productName,
      firmwareVersion: this.firmwareVersion,
    }
  }

  get capabilities(): Capabilities {
    return this.model.capabilities
  }

  async readPower(): Promise<PowerState> {
    await this.transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, [...POWER_READ_FRAME]))
    const reply = await this.transport.receiveFeatureReport(REPORT_ID)
    return decodePowerReport(reply)
  }

  /** Battery updates arrive unsolicited; returns an unsubscribe function. */
  subscribePower(handler: (state: PowerState) => void): () => void {
    return this.transport.onInputReport((_reportId, data) => {
      if (isPowerReport(data)) handler(decodePowerReport(data))
    })
  }
}

async function readIdentity(transport: Transport): Promise<{ uuid: string; firmwareVersion: string }> {
  // Frame body and response offsets: see docs/protocol-observations.md, "connect".
  const IDENTITY_FRAME = [0x01, 0x00, 0x00, 0x01, 0x00, 0x01]
  await transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, IDENTITY_FRAME))
  const reply = await transport.receiveFeatureReport(REPORT_ID)

  const uuidBytes = [0, 1, 2, 3, 4, 5].map((i) => reply.getUint8(i))
  const uuid = '0x' + uuidBytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  const firmwareVersion = '0x' + reply.getUint16(6).toString(16).padStart(4, '0')
  return { uuid, firmwareVersion }
}
```

**`IDENTITY_FRAME` and the byte offsets above are placeholders that Task 3's capture replaces.**
Run the first test, read the actual bytes out of the failure output, and correct them. The test is
the specification; the constants serve it.

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run test/device.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Propose the commit**

```bash
git add packages/protocol/src/device.ts packages/protocol/test/device.test.ts
git commit -m "feat(device): connect, read identity and resolve model capabilities"
```

---

## Task 11: Keycode tables

**Files:**
- Create: `packages/protocol/src/keycodes.ts`, `packages/protocol/test/keycodes.test.ts`

- [ ] **Step 1: Write the failing test**

The round-trip test is the important one — two tables meant to be inverses drift silently, exactly
as described in `CLAUDE_FRONTEND_RULES.md` §8.

```ts
import { expect, test } from 'vitest'
import { codeToKey, keyToCode, KEYCODES, K1_PRO_LAYOUT } from '../src/keycodes.js'
import { modelForUuid, K1_PRO_UUID } from '../src/models.js'

test('every keycode round-trips through both tables', () => {
  for (const [name, code] of Object.entries(KEYCODES)) {
    expect(codeToKey(code)).toBe(name)
    expect(keyToCode(name)).toBe(code)
  }
})

test('no two key names share a code', () => {
  const codes = Object.values(KEYCODES)
  expect(new Set(codes).size).toBe(codes.length)
})

test('an unknown code decodes to a stable placeholder rather than throwing', () => {
  expect(codeToKey(0xfffe)).toBe('Unknown(0xfffe)')
})

test('the K1 PRO layout matches the advertised key count', () => {
  // Single source of truth: whatever Task 9 Step 5 corrected keyCount to, the layout must match.
  expect(K1_PRO_LAYOUT.flat().length).toBe(modelForUuid(K1_PRO_UUID)!.capabilities.keyCount)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/keycodes.test.ts
```

Expected: FAIL — cannot resolve `../src/keycodes.js`.

- [ ] **Step 3: Extract the real table from the vendor bundle**

The vendor's string tables already contain the key names (`"Print"`, `"R_WIN"`, `"Num 2"`,
`"LWin + T"`, `"mouse-back"` …). Extract name→code pairs from
`research/proto.clean.js` rather than retyping them:

```bash
cd /home/kia/Desktop/learning/keyboard-config/research
grep -o -E '\{[^{}]*"?(name|key|label)"?:\s*"[^"]+"[^{}]*"?(code|value|keyCode)"?:\s*[0-9]+[^{}]*\}' proto.clean.js | head -40
```

Record the extraction command used in `docs/protocol-observations.md` so the table can be
regenerated when the vendor updates their bundle.

- [ ] **Step 4: Implement it**

`packages/protocol/src/keycodes.ts`:

```ts
/** name → wire code. Extracted from the vendor bundle; see docs/protocol-observations.md. */
export const KEYCODES: Readonly<Record<string, number>> = {
  // populated in Step 3 — e.g. Escape: 0x29, KeyA: 0x04, ...
}

const CODE_TO_NAME = new Map(Object.entries(KEYCODES).map(([name, code]) => [code, name]))

export function keyToCode(name: string): number | undefined {
  return KEYCODES[name]
}

export function codeToKey(code: number): string {
  return CODE_TO_NAME.get(code) ?? `Unknown(0x${code.toString(16)})`
}

/** Physical rows of the K1 PRO, for UI layout. Each entry is a key name from KEYCODES. */
export const K1_PRO_LAYOUT: readonly (readonly string[])[] = [
  // populated in Step 3 from the vendor's rendered layout
]
```

Returning a placeholder for unknown codes rather than throwing is deliberate: a single
unrecognised key must not make an entire keymap read fail, and the placeholder round-trips
visibly in the UI so it gets noticed.

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run test/keycodes.test.ts
```

Expected: 4 passed.

- [ ] **Step 6: Propose the commit**

```bash
git add packages/protocol/src/keycodes.ts packages/protocol/test/keycodes.test.ts
git commit -m "feat(keycodes): add keycode tables and K1 PRO layout"
```

---

## Task 12: Keymap reading

**Files:**
- Create: `packages/protocol/src/codec/keymap.ts`, `packages/protocol/test/keymap.test.ts`
- Modify: `packages/protocol/src/device.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { buildKeymapReadFrame, decodeKeymap, Layer } from '../src/codec/keymap.js'
import { K916 } from '../src/device.js'
import { MockTransport } from '../src/transport/mock.js'

const capture = readFileSync('test/fixtures/session-1.jsonl', 'utf8')

test('the read frame matches the vendor opcode and layer encoding', () => {
  expect(buildKeymapReadFrame(Layer.Default)).toEqual([0x83, 0x00, 0x00, 0x01, 0x00, 0xf8, 0x01])
  expect(buildKeymapReadFrame(Layer.Fn)).toEqual([0x83, 0x01, 0x00, 0x01, 0x00, 0xf8, 0x01])
  expect(buildKeymapReadFrame(Layer.Fn1)).toEqual([0x83, 0x02, 0x00, 0x01, 0x00, 0xf8, 0x01])
})

test('reads the default layer from the real capture', async () => {
  const kb = await K916.connect(new MockTransport(capture))
  const layer = await kb.readKeymap(Layer.Default)

  expect(layer).toHaveLength(kb.capabilities.keyCount)
  expect(layer.every((binding) => typeof binding.key === 'string')).toBe(true)
})

test('decoding is stable — same bytes, same result', () => {
  const bytes = Uint8Array.from({ length: 200 }, (_, i) => i % 256)
  expect(decodeKeymap(new DataView(bytes.buffer), 82)).toEqual(decodeKeymap(new DataView(bytes.buffer), 82))
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/keymap.test.ts
```

Expected: FAIL — cannot resolve `../src/codec/keymap.js`.

- [ ] **Step 3: Determine the payload layout from the capture**

Before writing the decoder, work out three things from the `read-keymap-*` events and write them
into `docs/protocol-observations.md`:

1. **Bytes per key** — divide the total response payload length by the key count. Expect 1 or 2.
2. **Where the payload starts** — how many header bytes precede the first keycode. Compare the
   Default and Fn captures; the header is the part that does not change.
3. **Byte order**, if 2 bytes per key — compare a key you know differs between layers.

Cross-check by finding a key whose binding you can see in their UI and confirming its code appears
at the expected offset.

- [ ] **Step 4: Implement it**

`packages/protocol/src/codec/keymap.ts`, using the values determined in Step 3:

```ts
import { codeToKey } from '../keycodes.js'

export enum Layer { Default = 0, Fn = 1, Fn1 = 2 }

export interface KeyBinding {
  index: number
  code: number
  key: string
}

/** Vendor opcode 0x83 — read one layer. Bit 2 of the arg is a system flag, held at 0. */
export function buildKeymapReadFrame(layer: Layer): number[] {
  return [0x83, layer & 0x03, 0x00, 0x01, 0x00, 0xf8, 0x01]
}

const HEADER_BYTES = 0    // Step 3
const BYTES_PER_KEY = 2   // Step 3

export function decodeKeymap(data: DataView, keyCount: number): KeyBinding[] {
  const bindings: KeyBinding[] = []
  for (let index = 0; index < keyCount; index++) {
    const offset = HEADER_BYTES + index * BYTES_PER_KEY
    if (offset + BYTES_PER_KEY > data.byteLength) break
    const code = BYTES_PER_KEY === 1 ? data.getUint8(offset) : data.getUint16(offset, true)
    bindings.push({ index, code, key: codeToKey(code) })
  }
  return bindings
}
```

- [ ] **Step 5: Add `readKeymap` to the device**

Append to the `K916` class in `packages/protocol/src/device.ts`:

```ts
  async readKeymap(layer: Layer): Promise<KeyBinding[]> {
    await this.transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, buildKeymapReadFrame(layer)))
    const reply = await this.transport.receiveFeatureReport(REPORT_ID)
    return decodeKeymap(reply, this.capabilities.keyCount)
  }

  async readAllLayers(): Promise<Record<Layer, KeyBinding[]>> {
    return {
      [Layer.Default]: await this.readKeymap(Layer.Default),
      [Layer.Fn]: await this.readKeymap(Layer.Fn),
      [Layer.Fn1]: await this.readKeymap(Layer.Fn1),
    }
  }
```

Add to the imports at the top of `device.ts`:

```ts
import { buildKeymapReadFrame, decodeKeymap, Layer, type KeyBinding } from './codec/keymap.js'
```

- [ ] **Step 6: Run it and watch it pass**

```bash
npx vitest run test/keymap.test.ts
```

Expected: 3 passed.

- [ ] **Step 7: Propose the commit**

```bash
git add packages/protocol/src/codec/keymap.ts packages/protocol/src/device.ts packages/protocol/test/keymap.test.ts
git commit -m "feat(codec): read and decode all three keymap layers"
```

---

## Task 13: Lighting and macro reading

**Files:**
- Create: `packages/protocol/src/codec/lighting.ts`, `packages/protocol/src/codec/macros.ts`, `packages/protocol/test/lighting.test.ts`, `packages/protocol/test/macros.test.ts`
- Modify: `packages/protocol/src/device.ts`

- [ ] **Step 1: Write the failing lighting test**

The 13 effect names are read off their UI and confirmed in the capture.

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { EFFECTS, decodeLighting } from '../src/codec/lighting.js'
import { K916 } from '../src/device.js'
import { MockTransport } from '../src/transport/mock.js'

const capture = readFileSync('test/fixtures/session-1.jsonl', 'utf8')

test('all thirteen effects are named', () => {
  expect(Object.keys(EFFECTS)).toHaveLength(13)
  expect(EFFECTS).toHaveProperty('Wave')
  expect(EFFECTS).toHaveProperty('Blooming')
})

test('reads lighting settings from the real capture', async () => {
  const kb = await K916.connect(new MockTransport(capture))
  const { lighting: range } = kb.capabilities
  const lighting = await kb.readLighting()

  // Speed and brightness are STAGE indices, not percentages. The vendor's sliders are
  // percentage-based only for drawing; the number they display is the stage.
  expect(lighting.brightness).toBeGreaterThanOrEqual(1)
  expect(lighting.brightness).toBeLessThanOrEqual(range.brightnessStages)
  expect(lighting.speed).toBeGreaterThanOrEqual(1)
  expect(lighting.speed).toBeLessThanOrEqual(range.speedStages)
  expect(lighting.color).toMatch(/^#[0-9a-f]{6}$/)
})

test('brightness converts between stage and wire value', () => {
  // wire = stage * brightnessStep. With 4 stages and a step of 5: 5, 10, 15, 20.
  expect(toWireBrightness(3, { brightnessStep: 5 })).toBe(15)
  expect(toStageBrightness(15, { brightnessStep: 5 })).toBe(3)
})

test('brightness stage survives a round trip at every stage', () => {
  const range = { brightnessStep: 5 }
  for (let stage = 1; stage <= 4; stage++) {
    expect(toStageBrightness(toWireBrightness(stage, range), range)).toBe(stage)
  }
})

test('an unrecognised effect id decodes without throwing', () => {
  const bytes = new DataView(Uint8Array.from([0xff, 4, 4, 255, 255, 255]).buffer)
  expect(() => decodeLighting(bytes)).not.toThrow()
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/lighting.test.ts
```

Expected: FAIL — cannot resolve `../src/codec/lighting.js`.

- [ ] **Step 3: Implement lighting**

Offsets come from the `read-lighting` capture. Derive them like this, and write the results into
`docs/protocol-observations.md`:

1. In the vendor UI, set a known state: effect **Always On**, brightness to maximum, colour to
   pure red `#ff0000`. Label and capture: `__k916.mark('lighting-red-max')`.
2. Change **only** the colour to pure green `#00ff00`. Capture as `lighting-green-max`.
3. Diff the two payloads. Exactly three bytes should differ — that is the RGB triple, and their
   position gives `OFFSET_RGB`. The order the bytes changed in tells you whether it is RGB or BGR.
4. Repeat changing **only** brightness, then **only** speed, then **only** the effect. Each diff
   isolates one offset.

Changing one variable per capture is what makes each diff unambiguous; changing two at once means
you cannot tell which byte belongs to which setting.

`packages/protocol/src/codec/lighting.ts`:

```ts
export const EFFECTS: Readonly<Record<string, number>> = {
  Off: 0, Custom: 1, AlwaysOn: 2, DreamRainbow: 3, OneTouch: 4, KeyRipple: 5,
  Stars: 6, Wave: 7, Shadow: 8, SineWave: 9, Windmill: 10, Waterfall: 11, Blooming: 12,
}

const ID_TO_EFFECT = new Map(Object.entries(EFFECTS).map(([name, id]) => [id, name]))

export interface LightingState {
  effect: string
  /** Stage index, 1..capabilities.lighting.speedStages — not a percentage. */
  speed: number
  /** Stage index, 1..capabilities.lighting.brightnessStages — not a percentage. */
  brightness: number
  color: string
}

/** The device stores brightness as `stage * step`; on the K1 PRO that is 5, 10, 15 or 20. */
export function toWireBrightness(stage: number, range: { brightnessStep: number }): number {
  return stage * range.brightnessStep
}

export function toStageBrightness(wire: number, range: { brightnessStep: number }): number {
  return Math.round(wire / range.brightnessStep)
}

// Offsets from docs/protocol-observations.md, "read-lighting".
const OFFSET_EFFECT = 0
const OFFSET_SPEED = 1
const OFFSET_BRIGHTNESS = 2
const OFFSET_RGB = 3

export function decodeLighting(data: DataView): LightingState {
  const id = data.getUint8(OFFSET_EFFECT)
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  return {
    effect: ID_TO_EFFECT.get(id) ?? `Unknown(${id})`,
    speed: data.getUint8(OFFSET_SPEED),
    brightness: data.getUint8(OFFSET_BRIGHTNESS),
    color: `#${hex(data.getUint8(OFFSET_RGB))}${hex(data.getUint8(OFFSET_RGB + 1))}${hex(data.getUint8(OFFSET_RGB + 2))}`,
  }
}
```

- [ ] **Step 4: Write the failing macro test**

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { MACRO_BUDGET_BYTES, bytesRemaining } from '../src/codec/macros.js'
import { K916 } from '../src/device.js'
import { MockTransport } from '../src/transport/mock.js'

const capture = readFileSync('test/fixtures/session-1.jsonl', 'utf8')

test('the macro budget matches what their UI reports', () => {
  expect(MACRO_BUDGET_BYTES).toBe(512)
})

test('bytesRemaining subtracts used bytes from the budget', () => {
  expect(bytesRemaining([{ index: 0, name: 'a', bytes: 100 }])).toBe(412)
  expect(bytesRemaining([])).toBe(512)
})

test('lists macros from the real capture', async () => {
  const kb = await K916.connect(new MockTransport(capture))
  const macros = await kb.listMacros()
  expect(Array.isArray(macros)).toBe(true)
})
```

The third test asserts only shape: Task 3's capture is taken against a keyboard with zero macros
stored (their UI showed `0b / 512b`), so an empty list is the correct expected result. Asserting
specific macro contents would require creating one first, which is a write.

- [ ] **Step 5: Implement macros**

`packages/protocol/src/codec/macros.ts`:

```ts
export const MACRO_BUDGET_BYTES = 512

export interface MacroSummary {
  index: number
  name: string
  bytes: number
}

export function bytesRemaining(macros: readonly MacroSummary[]): number {
  const used = macros.reduce((total, macro) => total + macro.bytes, 0)
  return MACRO_BUDGET_BYTES - used
}

// Frame and offsets from docs/protocol-observations.md, "read-macros".
export function buildMacroListFrame(): number[] {
  return [0x00, 0x00, 0x00, 0x01, 0x00, 0x01]
}

export function decodeMacroList(data: DataView): MacroSummary[] {
  const count = data.getUint8(0)
  const macros: MacroSummary[] = []
  for (let index = 0; index < count; index++) {
    const offset = 1 + index * 18
    if (offset + 18 > data.byteLength) break
    const nameBytes: number[] = []
    for (let i = 0; i < 16; i++) {
      const byte = data.getUint8(offset + i)
      if (byte === 0) break
      nameBytes.push(byte)
    }
    macros.push({
      index,
      name: new TextDecoder().decode(Uint8Array.from(nameBytes)),
      bytes: data.getUint16(offset + 16, true),
    })
  }
  return macros
}
```

`buildMacroListFrame` and the 18-byte stride are derived from the capture — correct them from
`docs/protocol-observations.md` before the test will pass.

- [ ] **Step 6: Add both reads to the device**

Append to the `K916` class in `packages/protocol/src/device.ts`:

```ts
  async readLighting(): Promise<LightingState> {
    await this.transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, buildLightingReadFrame()))
    return decodeLighting(await this.transport.receiveFeatureReport(REPORT_ID))
  }

  async listMacros(): Promise<MacroSummary[]> {
    await this.transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, buildMacroListFrame()))
    return decodeMacroList(await this.transport.receiveFeatureReport(REPORT_ID))
  }

  async macroBytesRemaining(): Promise<number> {
    return bytesRemaining(await this.listMacros())
  }
```

Add to the imports in `device.ts`:

```ts
import { buildLightingReadFrame, decodeLighting, type LightingState } from './codec/lighting.js'
import { buildMacroListFrame, bytesRemaining, decodeMacroList, type MacroSummary } from './codec/macros.js'
```

And add `buildLightingReadFrame` to `lighting.ts`, with the frame body taken from the capture:

```ts
export function buildLightingReadFrame(): number[] {
  return [0x82, 0x00, 0x00, 0x01, 0x00, 0x01]
}
```

- [ ] **Step 7: Run the full suite**

```bash
cd /home/kia/Desktop/learning/keyboard-config/packages/protocol && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 8: Propose the commit**

```bash
git add packages/protocol/src/codec/ packages/protocol/src/device.ts packages/protocol/test/
git commit -m "feat(codec): read lighting settings and macro list"
```

---

## Task 14: Profile dump, sleep timer, and individual macro read

The remaining reads from the spec. `profile.dump()` is the most important thing in this plan after
battery: spec safety rule 4 requires a byte-exact backup of the current configuration to exist
**before the first write is ever attempted**, so that recovery means restoring your actual setup
rather than factory defaults.

**Files:**
- Create: `packages/protocol/src/codec/profile.ts`, `packages/protocol/test/profile.test.ts`
- Modify: `packages/protocol/src/codec/macros.ts`, `packages/protocol/src/device.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { reassembleChunks } from '../src/codec/profile.js'
import { K916 } from '../src/device.js'
import { MockTransport } from '../src/transport/mock.js'

const capture = readFileSync('test/fixtures/session-1.jsonl', 'utf8')

test('reassembles a chunked response in packet-index order', () => {
  const chunks = [
    Uint8Array.from([0x04, 2, 1, 14, 9, 9, 9]),
    Uint8Array.from([0x04, 2, 0, 14, 1, 2, 3]),
  ]
  expect([...reassembleChunks(chunks, 3)]).toEqual([1, 2, 3, 9, 9, 9])
})

test('rejects a reassembly with a missing packet', () => {
  const chunks = [Uint8Array.from([0x04, 3, 0, 14, 1])]
  expect(() => reassembleChunks(chunks, 1)).toThrow(/expected 3 packets/i)
})

test('dumps a non-empty profile from the real capture', async () => {
  const kb = await K916.connect(new MockTransport(capture))
  const dump = await kb.dumpProfile()
  expect(dump.byteLength).toBeGreaterThan(0)
})

test('reads the sleep timer as minutes', async () => {
  const kb = await K916.connect(new MockTransport(capture))
  const minutes = await kb.readSleepTimer()
  expect(minutes).toBeGreaterThanOrEqual(0)
  expect(minutes).toBeLessThanOrEqual(255)
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /home/kia/Desktop/learning/keyboard-config/packages/protocol && npx vitest run test/profile.test.ts
```

Expected: FAIL — cannot resolve `../src/codec/profile.js`.

- [ ] **Step 3: Implement chunk reassembly**

The vendor chunks bulk payloads 14 data bytes per frame under opcode `0x04`, framed as
`[0x04, totalPackets, packetIndex, lenInThisPacket, ...14 bytes, checksum]`.

One thing to confirm against the capture: in the vendor source the final packet's length byte
computes to `2` whenever the payload is an exact multiple of 14, which looks like a bug in their
code rather than an intent. **Trust the captured bytes over that reading.** If a real multi-packet
response ends with a length byte of `2`, reproduce it; if it ends with `14`, reproduce that. Record
which in `docs/protocol-observations.md`.

`packages/protocol/src/codec/profile.ts`:

```ts
const CHUNK_DATA_BYTES = 14
const OFFSET_TOTAL = 1
const OFFSET_INDEX = 2
const OFFSET_LENGTH = 3
const OFFSET_DATA = 4

/** Reorders chunked response frames by packet index and concatenates their payloads. */
export function reassembleChunks(chunks: readonly Uint8Array[], expectedBytes: number): Uint8Array {
  if (chunks.length === 0) throw new Error('no chunks to reassemble')

  const total = chunks[0]![OFFSET_TOTAL]!
  if (chunks.length !== total) {
    throw new Error(`expected ${total} packets, received ${chunks.length}`)
  }

  const ordered = [...chunks].sort((a, b) => a[OFFSET_INDEX]! - b[OFFSET_INDEX]!)
  const out = new Uint8Array(expectedBytes)
  let written = 0

  for (const chunk of ordered) {
    const declared = chunk[OFFSET_LENGTH]!
    const length = Math.min(declared === 0 ? CHUNK_DATA_BYTES : declared, expectedBytes - written)
    if (length <= 0) break
    out.set(chunk.subarray(OFFSET_DATA, OFFSET_DATA + length), written)
    written += length
  }

  return out.subarray(0, written)
}
```

- [ ] **Step 4: Add the three reads to the device**

Frame bodies come from the `read-overview` and `read-macros` captures. Append to the `K916` class
in `packages/protocol/src/device.ts`:

```ts
  /** Byte-exact backup of the current configuration. Required before any write. */
  async dumpProfile(): Promise<Uint8Array> {
    await this.transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, [0x84, 0x00, 0x00, 0x01, 0x00, 0x01]))
    const reply = await this.transport.receiveFeatureReport(REPORT_ID)
    return new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength)
  }

  /** Idle minutes before sleep. Wireless only — meaningless on a cabled connection. */
  async readSleepTimer(): Promise<number> {
    await this.transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, [0x91, 0x00, 0x00, 0x01, 0x00, 0x01]))
    const reply = await this.transport.receiveFeatureReport(REPORT_ID)
    return reply.getUint8(0)
  }

  async readMacro(index: number): Promise<MacroSummary & { steps: Uint8Array }> {
    const macros = await this.listMacros()
    const summary = macros.find((macro) => macro.index === index)
    if (!summary) throw new Error(`no macro at index ${index}`)

    await this.transport.sendFeatureReport(REPORT_ID, buildFrame(REPORT_ID, [0x80, index & 0xff, 0x00, 0x01, 0x00, 0x01]))
    const reply = await this.transport.receiveFeatureReport(REPORT_ID)
    return { ...summary, steps: new Uint8Array(reply.buffer, reply.byteOffset, reply.byteLength) }
  }
```

The four opcodes above (`0x84`, `0x91`, `0x80`) are **hypotheses from the read = write | 0x80
convention and must be replaced with the frames actually observed** in the capture. `MockTransport`
enforces this: a frame the vendor never sent throws `unexpected frame`, so a wrong guess fails the
test rather than reaching the keyboard.

`readMacro` returns raw step bytes rather than decoded steps. Decoding the step format needs a
macro to exist on the device, and creating one is a write — so it belongs in the writes plan.

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run test/profile.test.ts
```

Expected: 4 passed.

- [ ] **Step 6: Commit the profile backup as a fixture**

```bash
npx vitest run test/profile.test.ts --reporter=verbose
```

Save the dumped bytes to `packages/protocol/test/fixtures/factory-profile.jsonl`. This is the
restore point referenced by spec safety rule 4.

- [ ] **Step 7: Propose the commit**

```bash
git add packages/protocol/src/codec/profile.ts packages/protocol/test/profile.test.ts packages/protocol/src/device.ts packages/protocol/test/fixtures/factory-profile.jsonl
git commit -m "feat(codec): dump profile, read sleep timer and individual macros"
```

---

## Task 15: Public exports and hardware smoke test

The checkpoint. After this task you can see your real battery percentage and keymap.

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Create: `apps/demo/index.html`

- [ ] **Step 1: Write the public exports**

`packages/protocol/src/index.ts`:

```ts
export { K916, REPORT_ID, type DeviceInfo } from './device.js'
export { WebHIDTransport } from './transport/webhid.js'
export { MockTransport } from './transport/mock.js'
export { type Transport, parseCapture, bytesOf, type CaptureEvent } from './transport/transport.js'
export { Layer, type KeyBinding } from './codec/keymap.js'
export { EFFECTS, type LightingState } from './codec/lighting.js'
export { MACRO_BUDGET_BYTES, type MacroSummary } from './codec/macros.js'
export { reassembleChunks } from './codec/profile.js'
export { type PowerState } from './codec/power.js'
export { modelForUuid, K1_PRO_UUID, type Capabilities, type Model } from './models.js'
export { KEYCODES, K1_PRO_LAYOUT, codeToKey, keyToCode } from './keycodes.js'
export { buildFrame, checksum, FRAME_BYTES, FRAME_BODY_BYTES } from './frame.js'

export const VERSION = '0.1.0'
```

- [ ] **Step 2: Build and confirm the types resolve**

```bash
cd /home/kia/Desktop/learning/keyboard-config && npm run build
```

Expected: exits 0, no type errors.

- [ ] **Step 3: Write the smoke-test page**

`apps/demo/index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>k916 smoke test</title>
<style>
  body { font: 14px system-ui; margin: 2rem; max-width: 60rem }
  button { font: inherit; padding: .5rem 1rem }
  pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; white-space: pre-wrap }
</style>
<h1>k916 smoke test</h1>
<button id="connect">Connect keyboard</button>
<pre id="out">Not connected.</pre>
<script type="module">
  import { K916, WebHIDTransport, Layer } from '../../packages/protocol/dist/index.js'

  const out = document.getElementById('out')
  const log = (label, value) => {
    out.textContent += `\n${label}: ${JSON.stringify(value, null, 2)}`
  }

  document.getElementById('connect').addEventListener('click', async () => {
    try {
      const [device] = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x258a }] })
      if (!device) return
      const kb = await K916.connect(await WebHIDTransport.open(device))

      out.textContent = 'Connected.'
      log('info', kb.info)
      log('capabilities', kb.capabilities)
      log('power', await kb.readPower())
      log('lighting', await kb.readLighting())
      log('macros', await kb.listMacros())
      log('default layer (first 12 keys)', (await kb.readKeymap(Layer.Default)).slice(0, 12))
      log('profile dump size', (await kb.dumpProfile()).byteLength)

      kb.subscribePower((state) => log('power update', state))
    } catch (error) {
      out.textContent += `\nERROR: ${error.message}`
    }
  })
</script>
```

- [ ] **Step 4: Serve it and run the smoke test**

```bash
cd /home/kia/Desktop/learning/keyboard-config && npx --yes serve@14 . -l 5173
```

Open <http://localhost:5173/apps/demo/>, click **Connect keyboard**, pick the vendor interface.

Expected: identity, capabilities, a plausible battery percentage, lighting settings, an empty macro
list, and twelve real key names from the default layer.

This is a **manual** test and must never be added to the automated suite — the suite has to run
with no keyboard attached.

- [ ] **Step 5: Record the result**

Add a "Milestone 3 verification" section to `docs/protocol-observations.md` with the actual output,
including whether battery appeared on cable or only wirelessly.

- [ ] **Step 6: Propose the commit**

```bash
git add packages/protocol/src/index.ts apps/demo/index.html docs/protocol-observations.md
git commit -m "feat: expose public API and add hardware smoke test page"
```

---

## Done when

- `npm test` passes from a clean checkout with no keyboard attached.
- The smoke page reports real identity, battery, lighting, macros and keymap from the keyboard.
- `docs/protocol-observations.md` answers: the checksum algorithm, keymap payload layout, lighting
  offsets, macro list layout, chunk-reassembly length-byte behaviour, the true key count, and
  whether wired reports battery.
- A byte-exact profile backup exists at `packages/protocol/test/fixtures/factory-profile.jsonl`
  (spec safety rule 4).
- No write command exists anywhere in `packages/protocol/src`.

## Next plan

Milestone 4 (factory reset plus the proof procedure in spec safety rule 3) followed by milestone 5
(keymap, lighting, macro, TGL and MT writes). Do not begin either until the reset escape hatch has
been demonstrated working.

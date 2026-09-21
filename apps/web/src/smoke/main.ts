import { decodeLighting, fromHexColour, K916, toHex, toHexColour, type Backup } from 'k916'
import { webHidSource } from '../api/hidSource'

const BACKUP_KEY = 'k1.smoke.backup'

const log = document.getElementById('log') as HTMLPreElement
const button = (id: string) => document.getElementById(id) as HTMLButtonElement
const buttons = {
  connect: button('connect'),
  backup: button('backup'),
  writeback: button('writeback'),
  bright2: button('bright2'),
  bright10: button('bright10'),
  restore: button('restore'),
  down: button('down'),
  up: button('up'),
}

let kb: K916 | undefined
let backup: Backup | undefined

function print(text: string, cls = ''): void {
  const line = document.createElement('span')
  line.className = cls
  line.textContent = `${new Date().toLocaleTimeString()}  ${text}\n`
  log.appendChild(line)
  log.scrollTop = log.scrollHeight
}

function describe(profile: Uint8Array): string {
  const { effect, brightness, speed, mixing } = decodeLighting(profile)
  return `${effect}, brightness ${brightness}, speed ${speed}, ${mixing ? 'mixing' : 'mono'}`
}

function diff(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i)
  return out
}

/** Every control that can write. Disabled together while a step runs; the library refuses anyway. */
const writeControls = () => [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')]

async function step(name: string, run: () => Promise<void>, unlock?: HTMLButtonElement): Promise<void> {
  const wasEnabled = writeControls().filter((el) => !el.disabled)
  for (const el of wasEnabled) el.disabled = true
  document.body.style.cursor = 'progress'
  print(`▶ ${name}`)
  const started = performance.now()
  try {
    await run()
    print(`✓ ${name} (${Math.round(performance.now() - started)} ms)`, 'ok')
    if (unlock) wasEnabled.push(unlock)
  } catch (error) {
    print(`✗ ${name}: ${error instanceof Error ? error.message : String(error)}`, 'err')
  } finally {
    for (const el of wasEnabled) el.disabled = false
    document.body.style.cursor = ''
  }
}

buttons.connect.onclick = () =>
  step('connect', async () => {
    const source = webHidSource()
    const transport = (await source.remembered()) ?? (await source.request())
    if (!transport) throw new Error('no device chosen')
    kb = await K916.connect(transport)
    print(`  ${kb.info.productName} · fw ${kb.info.firmwareVersion} · ${kb.info.connection}`)
    print(`  lighting now: ${describe(await kb.readProfileRaw())}`)
  }, buttons.backup)

buttons.backup.onclick = () =>
  step('backup (profile + effect colours + per-key colours)', async () => {
    backup = await kb!.backup()
    const serialised = { savedAt: new Date().toISOString(), device: kb!.info, profileHex: toHex(backup.profile), lightColourHex: toHex(backup.lightColour), customColourHex: toHex(backup.customColour) }
    localStorage.setItem(BACKUP_KEY, JSON.stringify(serialised))
    print(`  ${describe(backup.profile)}`)
    print(`  profile 128 B · effect colours ${backup.lightColour.length} B · per-key ${backup.customColour.length} B`)
    const url = URL.createObjectURL(new Blob([JSON.stringify(serialised, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'k1-backup.json'
    a.click()
    URL.revokeObjectURL(url)
    print('  downloaded k1-backup.json and stored in localStorage')
    showLevel(decodeLighting(backup.profile).brightness)
    unlockLadder()
    unlockColour()
  }, buttons.writeback)

buttons.writeback.onclick = () =>
  step('write profile back unchanged', async () => {
    await kb!.writeProfile(backup!.profile)
    const readBack = await kb!.readProfileRaw()
    const changed = diff(backup!.profile, readBack)
    if (changed.length > 0) throw new Error(`read-back differs at byte(s) ${changed.join(', ')}`)
    print(`  read-back identical: ${describe(readBack)}`)
  }, buttons.bright2)

buttons.bright2.onclick = () =>
  step('brightness → 2', async () => {
    const before = await kb!.readProfileRaw()
    const result = await kb!.setLighting({ brightness: 2 })
    const after = await kb!.readProfileRaw()
    print(`  keyboard now reports: ${result.effect}, brightness ${result.brightness}, speed ${result.speed}`)
    print(`  bytes changed: [${diff(before, after).join(', ')}]`)
  }, buttons.bright10)

buttons.bright10.onclick = () =>
  step('brightness → 4 (the top stage)', async () => {
    const result = await kb!.setLighting({ brightness: 4 })
    print(`  keyboard now reports brightness ${result.brightness}`)
  }, buttons.restore)

buttons.restore.onclick = () =>
  step('restore backup (all three blocks, each read back)', async () => {
    await kb!.restore(backup!)
    print(`  restored: ${describe(await kb!.readProfileRaw())}`)
    print(`  effect colour ${toHexColour(await kb!.readEffectColour())} · per-key block restored`)
  })

// ---- brightness ladder -------------------------------------------------------------------------

const ladder = document.getElementById('ladder') as HTMLParagraphElement
const current = document.getElementById('current') as HTMLSpanElement
const levelButtons: HTMLButtonElement[] = []
let level = -1
let maxLevel = 0

buttons.down.onclick = () => setLevel(Math.max(0, level - 1))
buttons.up.onclick = () => setLevel(Math.min(maxLevel, level + 1))

/** Built once the model is known: one button per declared stage, and not one more. */
function buildLadder(): void {
  maxLevel = kb!.capabilities.lighting.brightnessStages
  ladder.replaceChildren()
  levelButtons.length = 0
  for (let value = 0; value <= maxLevel; value++) {
    const b = document.createElement('button')
    b.textContent = String(value)
    b.onclick = () => setLevel(value)
    ladder.appendChild(b)
    levelButtons.push(b)
  }
}

function showLevel(value: number): void {
  level = value
  current.textContent = `current level: ${value}`
  levelButtons.forEach((b, i) => b.classList.toggle('active', i === value))
}

function unlockLadder(): void {
  buildLadder()
  buttons.down.disabled = false
  buttons.up.disabled = false
}

function setLevel(value: number): Promise<void> {
  return step(`brightness → ${value}`, async () => {
    const result = await kb!.setLighting({ brightness: value })
    showLevel(result.brightness)
    print(`  keyboard reports brightness ${result.brightness} on ${result.effect}`)
    if (result.brightness !== value) print(`  NOTE: asked for ${value}, kept ${result.brightness}`, 'err')
  })
}

const stored = localStorage.getItem(BACKUP_KEY)
if (stored) print(`a backup from an earlier run is in localStorage: ${stored.slice(0, 32)}…`, 'dim')

// ---- colour ---------------------------------------------------------------------------------------

const colourControls = {
  effectAlwaysOn: button('effectAlwaysOn'),
  effectCustom: button('effectCustom'),
  applyHex: button('applyHex'),
  applyKey: button('applyKey'),
  hex: document.getElementById('hex') as HTMLInputElement,
  keyHex: document.getElementById('keyHex') as HTMLInputElement,
  slot: document.getElementById('slot') as HTMLInputElement,
  effectNow: document.getElementById('effectNow') as HTMLSpanElement,
  swatches: document.getElementById('swatches') as HTMLParagraphElement,
}

const SWATCHES = ['#000000', '#0000ff', '#00ff00', '#00ffff', '#ff0000', '#ff00ff', '#ffff00', '#ffffff']
const ALWAYS_ON = 1
const CUSTOM = 277

for (const hex of SWATCHES) {
  const b = document.createElement('button')
  b.style.background = hex
  b.title = hex
  b.disabled = true
  b.onclick = () => applyEffectColour(hex)
  colourControls.swatches.appendChild(b)
}

async function showEffect(): Promise<void> {
  const lighting = await kb!.readLighting()
  colourControls.effectNow.textContent = `effect: ${lighting.effect} · ${lighting.mixing ? 'mixing' : 'mono'}`
}

function applyEffectColour(hex: string): Promise<void> {
  return step(`effect colour → ${hex}`, async () => {
    const result = await kb!.setEffectColour(fromHexColour(hex))
    print(`  keyboard holds ${toHexColour(result)}`)
  })
}

colourControls.effectAlwaysOn.onclick = () =>
  step('effect → Always On, mixing off', async () => {
    const result = await kb!.setLighting({ effectId: ALWAYS_ON, mixing: false })
    print(`  keyboard reports ${result.effect}, ${result.mixing ? 'mixing' : 'mono'}, brightness ${result.brightness}`)
    print(`  effect colour now ${toHexColour(await kb!.readEffectColour())}`)
    await showEffect()
  })

colourControls.applyHex.onclick = () => applyEffectColour(colourControls.hex.value)

colourControls.effectCustom.onclick = () =>
  step('effect → Custom', async () => {
    const result = await kb!.setLighting({ effectId: CUSTOM })
    print(`  keyboard reports ${result.effect}`)
    await showEffect()
  })

colourControls.applyKey.onclick = () => {
  const slot = Number(colourControls.slot.value)
  const hex = colourControls.keyHex.value
  return step(`key slot ${slot} → ${hex}`, async () => {
    const result = await kb!.setKeyColour(slot, fromHexColour(hex))
    print(`  keyboard holds ${toHexColour(result)} at slot ${slot}`)
  })
}

function unlockColour(): void {
  for (const el of [colourControls.effectAlwaysOn, colourControls.effectCustom, colourControls.applyHex, colourControls.applyKey, colourControls.hex, colourControls.keyHex, colourControls.slot]) {
    el.disabled = false
  }
  for (const b of colourControls.swatches.querySelectorAll('button')) b.disabled = false
  void showEffect()
}

import { decodeIdentity } from './codec/identity.js'
import { decodeKeymap, Layer, type KeyBinding } from './codec/keymap.js'
import { assertCustomColourBlock, assertLightColourBlock, decodeKeyColours, effectColour, keyColour, lightColourWriteBlock, withEffectColour, withKeyColour, type RGB } from './codec/colour.js'
import { applyLighting, assertProfileBlock, decodeLighting, type LightingChange, type LightingState } from './codec/lighting.js'
import { applySleep, decodeSleep, type SleepTimer } from './codec/sleep.js'
import { decodePower, isPowerPacket, type PowerState } from './codec/power.js'
import { Command, missingIndices, reassemble, WriteCommand, type Dialect, type ReplyPacket, type RequestArgs } from './dialect/dialect.js'
import type { Bytes } from './frame.js'
import { connectionTypeFor, dialectFor, type ConnectionType } from './dialect/select.js'
import { modelForUuid, type Capabilities, type Model } from './models.js'
import type { Transport } from './transport/transport.js'

/** How many times a read-back is retried before a mismatch is believed. */
const READ_BACK_ATTEMPTS = 3

/** The blocks a write can target. Everything else is read-only. */
type WritableBlock = Command.Profile | Command.LightColor | Command.CustomColor

/** The sanity check each writable block must pass, both as read and as transformed. */
const BLOCK_CHECKS: Record<WritableBlock, (block: Uint8Array) => void> = {
  [Command.Profile]: assertProfileBlock,
  [Command.LightColor]: assertLightColourBlock,
  [Command.CustomColor]: assertCustomColourBlock,
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i])
}
/** Reads may queue behind an operation in flight, but never more than this many. */
const MAX_QUEUED_READS = 8

/**
 * Thrown — synchronously rejected, never queued — when a write is requested while another
 * operation is in flight. A UI shows this as "busy"; the user's next click after the current
 * operation answers goes through. This is what stops a held-down button from lining up a
 * minute of writes.
 */
export class KeyboardBusyError extends Error {
  constructor(operation: string) {
    super(`keyboard is busy; ${operation} was not started`)
    this.name = 'KeyboardBusyError'
  }
}
/** The settle wait never blocks longer than this, however chatty the link. */
const SETTLE_CAP_MS = 300

export interface DeviceInfo {
  uuid: string
  productName: string
  firmwareVersion: string
  connection: ConnectionType
}

/** The three writable blocks, as read. Serialise with `toHex` if it must survive a reload. */
export interface Backup {
  profile: Uint8Array
  lightColour: Uint8Array
  customColour: Uint8Array
}

export interface ConnectOptions {
  /**
   * How long to wait for the first packet of a reply before treating the request as lost and
   * re-sending. Real replies land within ~20 ms; a long wait here is what made lost requests
   * feel slow. The vendor app uses 3000 ms but fires six copies without waiting.
   */
  timeoutMs?: number
  /** Silence this long after the last packet means the burst is over; missing packets get re-requested. */
  burstIdleMs?: number
  /** How many times a bulk read or write is re-sent to fill gaps. The vendor app fires the same read up to six times. */
  maxAttempts?: number
  /** After the last echo of a write burst, silence this long means the burst is over; unacked packets get re-sent. */
  ackTimeoutMs?: number
  /**
   * Before each request, wait until the link has been quiet this long — the 2.4G link delivers
   * stale packets from earlier exchanges late, and a fresh request must not inherit them.
   */
  settleMs?: number
  /**
   * After every write, send nothing for this long. The keyboard commits each block to flash and
   * the MCU stalls while it does; the vendor app never follows a write within ~300 ms, and
   * following one within a millisecond left the keyboard lit but not typing.
   */
  writeSettleMs?: number
  /** A frame that arrived but failed to parse. Never thrown — a listener has nowhere to throw to. */
  onFrameError?: (error: Error) => void
}

/**
 * The one service the outer layers talk to. It picks a dialect once, from the transport's ids,
 * and from then on every call is expressed as intent — the caller never learns which opcode or
 * report id carried it.
 */
export class K916 {
  static async connect(transport: Transport, options: ConnectOptions = {}): Promise<K916> {
    const connection = connectionTypeFor(transport.info)
    if (!connection) throw new Error(`unsupported device: vendor id 0x${transport.info.vendorId.toString(16)}`)

    const device = new K916(transport, dialectFor(transport.info), connection, options)
    const identity = decodeIdentity(await device.#read(Command.Identity))
    const model = modelForUuid(identity.uuid)
    if (!model) {
      device.close()
      throw new Error(`unsupported device: uuid ${identity.uuid}`)
    }
    device.#model = model
    device.#firmwareVersion = identity.firmwareVersion
    return device
  }

  readonly #transport: Transport
  readonly #dialect: Dialect
  readonly #connection: ConnectionType
  readonly #timeoutMs: number
  readonly #burstIdleMs: number
  readonly #maxAttempts: number
  readonly #ackTimeoutMs: number
  readonly #settleMs: number
  readonly #writeSettleMs: number
  readonly #onFrameError: (error: Error) => void
  /** Operations run one at a time: two overlapping exchanges on one link steal each other's packets. */
  #queue: Promise<unknown> = Promise.resolve()
  /** In flight plus queued. Writes refuse to start when this is non-zero; reads refuse past the cap. */
  #pending = 0
  readonly #powerHandlers = new Set<(state: PowerState) => void>()
  readonly #unsubscribeAmbient: () => void
  #model: Model | undefined
  #firmwareVersion = ''
  #lastPower: PowerState | undefined

  private constructor(transport: Transport, dialect: Dialect, connection: ConnectionType, options: ConnectOptions) {
    this.#transport = transport
    this.#dialect = dialect
    this.#connection = connection
    this.#timeoutMs = options.timeoutMs ?? 500
    this.#burstIdleMs = options.burstIdleMs ?? 80
    this.#maxAttempts = options.maxAttempts ?? 6
    this.#ackTimeoutMs = options.ackTimeoutMs ?? 150
    this.#settleMs = options.settleMs ?? 40
    this.#writeSettleMs = options.writeSettleMs ?? 500
    this.#onFrameError = options.onFrameError ?? ((error) => console.warn('[k916] unparseable frame:', error.message))
    this.#unsubscribeAmbient = transport.onInputReport((reportId, data) => this.#onAmbientFrame(reportId, data))
  }

  get info(): DeviceInfo {
    return {
      uuid: this.#requireModel().uuid,
      productName: this.#requireModel().productName,
      firmwareVersion: this.#firmwareVersion,
      connection: this.#connection,
    }
  }

  get capabilities(): Capabilities {
    return this.#requireModel().capabilities
  }

  /** Whether this connection can report battery at all — so a UI can say "not reported on cable". */
  get reportsBattery(): boolean {
    const { battery } = this.capabilities
    return battery === 'always' || (battery === 'wireless' && this.#connection === 'wireless')
  }

  /** The most recent power packet seen, if any. Arrives unsolicited after every identity read. */
  get lastPower(): PowerState | undefined {
    return this.#lastPower
  }

  /**
   * Battery is not broadcast; the keyboard pushes it once after answering an identity request.
   * So a refresh is: ask for identity again, wait for the power packet that follows.
   */
  /**
   * Battery is not broadcast; the keyboard pushes it once after answering an identity request.
   * So a refresh is: ask for identity again, wait for the power packet that follows.
   */
  readPower(): Promise<PowerState> {
    return this.#exclusive(async () => {
      // Subscribe before sending so the packet cannot slip past. Mark the wait as handled right
      // away: if the send fails (or is slow to fail), the wait can expire first, and a rejection
      // with no handler attached yet is reported as unhandled. The caller still gets it via the
      // return below when the send succeeds.
      const next = this.#nextPower()
      next.catch(() => undefined)
      await this.#read(Command.Identity)
      return next
    })
  }

  subscribePower(handler: (state: PowerState) => void): () => void {
    this.#powerHandlers.add(handler)
    return () => {
      this.#powerHandlers.delete(handler)
    }
  }

  readKeymap(layer: Layer): Promise<KeyBinding[]> {
    return this.#exclusive(async () => decodeKeymap(await this.#read(Command.Keymap, { layer })))
  }

  readAllLayers(): Promise<Record<Layer, KeyBinding[]>> {
    return this.#exclusive(async () => ({
      [Layer.Default]: decodeKeymap(await this.#read(Command.Keymap, { layer: Layer.Default })),
      [Layer.Fn]: decodeKeymap(await this.#read(Command.Keymap, { layer: Layer.Fn })),
      [Layer.Fn1]: decodeKeymap(await this.#read(Command.Keymap, { layer: Layer.Fn1 })),
    }))
  }

  readLighting(): Promise<LightingState> {
    return this.#exclusive(async () => decodeLighting(await this.#read(Command.Profile)))
  }

  /**
   * Read the profile, apply the change, write the whole block back — the vendor app's own
   * sequence — then read it again and confirm the keyboard kept what we sent. Returns the
   * state as the keyboard now reports it, not as we intended it.
   */
  setLighting(change: LightingChange): Promise<LightingState> {
    return this.#exclusiveWrite('setLighting', async () =>
      decodeLighting(await this.#modify(Command.Profile, WriteCommand.Profile, (current) => applyLighting(current, change, this.capabilities.lighting))),
    )
  }

  /** Idle time before the keyboard sleeps. Wireless only — the cable ignores it. */
  readSleepTimer(): Promise<SleepTimer> {
    return this.#exclusive(async () => decodeSleep(await this.#read(Command.Profile)))
  }

  setSleepTimer(minutes: number | null): Promise<SleepTimer> {
    return this.#exclusiveWrite('setSleepTimer', async () => decodeSleep(await this.#modify(Command.Profile, WriteCommand.Profile, (current) => applySleep(current, minutes))))
  }

  /** The single colour an effect uses when not mixing. Defaults to the current effect. */
  readEffectColour(effectId?: number): Promise<RGB> {
    return this.#exclusive(async () => {
      const id = effectId ?? decodeLighting(await this.#read(Command.Profile)).effectId
      return effectColour(await this.#read(Command.LightColor), id)
    })
  }

  setEffectColour(rgb: RGB, effectId?: number): Promise<RGB> {
    return this.#exclusiveWrite('setEffectColour', async () => {
      const id = effectId ?? decodeLighting(await this.#read(Command.Profile)).effectId
      const readBack = await this.#modify(Command.LightColor, WriteCommand.LightColor, (current) => withEffectColour(current, id, rgb))
      return effectColour(readBack, id)
    })
  }

  /** Per-key colours for the Custom effect, indexed by keymap slot. */
  readKeyColours(): Promise<RGB[]> {
    return this.#exclusive(async () => decodeKeyColours(await this.#read(Command.CustomColor)))
  }

  setKeyColour(slot: number, rgb: RGB): Promise<RGB> {
    return this.#exclusiveWrite('setKeyColour', async () => {
      const readBack = await this.#modify(Command.CustomColor, WriteCommand.CustomColor, (current) => withKeyColour(current, slot, rgb))
      return keyColour(readBack, slot)
    })
  }

  /**
   * Everything a write can change, as the keyboard holds it right now. Restore with `restore()`.
   * A backup that covered only the profile would leave colour edits in place — the colour blocks
   * are separate, and the vendor app writes each on its own.
   */
  backup(): Promise<Backup> {
    // A backup is a future write; every block must pass the same trust as a write's base.
    return this.#exclusive(async () => ({
      profile: await this.#readTrusted(Command.Profile),
      lightColour: await this.#readTrusted(Command.LightColor),
      customColour: await this.#readTrusted(Command.CustomColor),
    }))
  }

  /** Writes all three blocks back verbatim and confirms each by read-back. */
  restore(backup: Backup): Promise<void> {
    return this.#exclusiveWrite('restore', async () => {
      await this.#modify(Command.Profile, WriteCommand.Profile, () => backup.profile)
      await this.#modify(Command.LightColor, WriteCommand.LightColor, () => lightColourWriteBlock(backup.lightColour))
      await this.#modify(Command.CustomColor, WriteCommand.CustomColor, () => Uint8Array.from(backup.customColour))
    })
  }

  /** Writes a complete 128-byte profile verbatim. Prefer `restore()` for a full backup. */
  writeProfile(profile: Uint8Array): Promise<void> {
    return this.#exclusiveWrite('writeProfile', async () => {
      assertProfileBlock(profile)
      await this.#write(WriteCommand.Profile, profile)
    })
  }

  /** Raw payloads whose layout is not decoded yet. Kept raw rather than guessed. */
  readMacrosRaw(): Promise<Uint8Array> {
    return this.#exclusive(() => this.#read(Command.Macros))
  }

  readProfileRaw(): Promise<Uint8Array> {
    return this.#exclusive(() => this.#read(Command.Profile))
  }

  readLightColorRaw(): Promise<Uint8Array> {
    return this.#exclusive(() => this.#read(Command.LightColor))
  }

  /** True while any operation is in flight or queued. A UI can disable write controls on this. */
  get busy(): boolean {
    return this.#pending > 0
  }

  /**
   * Reads queue behind whatever is in flight, up to a cap. A failure does not block the next one.
   */
  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#pending >= MAX_QUEUED_READS) {
      return Promise.reject(new Error(`too many operations pending (${this.#pending}); the keyboard cannot keep up`))
    }
    return this.#enqueue(operation)
  }

  /**
   * Writes never queue: if anything is in flight, the caller gets KeyboardBusyError at once and
   * nothing is sent. The click after the current operation answers is the one that goes through.
   */
  #exclusiveWrite<T>(name: string, operation: () => Promise<T>): Promise<T> {
    if (this.#pending > 0) return Promise.reject(new KeyboardBusyError(name))
    return this.#enqueue(operation)
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.#pending++
    const run = this.#queue.then(operation, operation).finally(() => {
      this.#pending--
    })
    this.#queue = run.catch(() => undefined)
    return run
  }

  /**
   * Read a block, transform it, write it, wait for the keyboard to commit, read it again, and
   * confirm every byte we sent came back. The comparison covers the bytes the read returns; a
   * write may legitimately be longer than its read (the light-colour block is 512 out, 483 back).
   *
   * Strictness, in order: the base read must pass the block's sanity check (and on the dongle
   * must read identically twice — the lossy link can merge stale and fresh packets into a block
   * the keyboard never held); the transformed block must pass it too; only then is a frame
   * built. A mismatched read-back is re-read before it is believed.
   */
  async #modify(read: WritableBlock, write: WriteCommand, transform: (current: Uint8Array) => Uint8Array): Promise<Uint8Array> {
    const current = await this.#readTrusted(read)
    const next = transform(current)
    BLOCK_CHECKS[read](next.subarray(0, current.length))
    await this.#write(write, next)

    let mismatch = -1
    let readBack = next
    for (let attempt = 1; attempt <= READ_BACK_ATTEMPTS; attempt++) {
      readBack = await this.#read(read)
      mismatch = [...readBack].findIndex((byte, i) => byte !== next[i])
      if (mismatch === -1) return readBack
    }
    throw new Error(`${write} not retained: byte ${mismatch} is ${readBack[mismatch]}, sent ${next[mismatch]}`)
  }

  /**
   * A read that may become the base of a write. It must pass the block's sanity check, and over
   * the dongle it must come back identical twice; a third read breaks a tie. Otherwise the read
   * is refused — better no write than a write of a block that was never real.
   */
  async #readTrusted(command: WritableBlock): Promise<Uint8Array> {
    const check = BLOCK_CHECKS[command]
    const first = await this.#read(command)
    check(first)
    if (this.#dialect.channel === 'feature') return first

    const second = await this.#read(command)
    check(second)
    if (same(first, second)) return first

    const third = await this.#read(command)
    check(third)
    if (same(third, first) || same(third, second)) return third
    throw new Error(`${command}: three consecutive reads disagree; refusing to write on top of an unstable read`)
  }

  close(): void {
    this.#unsubscribeAmbient()
    this.#powerHandlers.clear()
  }

  #requireModel(): Model {
    if (!this.#model) throw new Error('device not connected')
    return this.#model
  }

  async #read(command: Command, args?: RequestArgs): Promise<Uint8Array> {
    return this.#dialect.channel === 'output'
      ? this.#exchangePushed(command, args)
      : this.#exchangePulled(command, args)
  }

  /**
   * Wireless. The 2.4G link drops packets, so a single send rarely yields a complete bulk reply.
   * Packets are kept by index; when a burst goes quiet with gaps, the request is re-sent and the
   * new arrivals merged in — indices are stable across retries, so only the gaps need to land.
   * The vendor app does the same thing by brute force, firing every read six times regardless.
   */
  async #exchangePushed(command: Command, args?: RequestArgs): Promise<Uint8Array> {
    const opcode = this.#dialect.opcodeFor(command)
    const packets = new Map<number, ReplyPacket>()
    let total: number | undefined

    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      await this.#settle()
      await this.#sendAndCollect(command, args, opcode, packets, (packet) => (total ??= packet.total))
      if (total !== undefined && missingIndices(packets, total).length === 0) {
        return reassemble(packets, total)
      }
    }

    const missing = total === undefined ? 'no packets at all' : `packet(s) ${missingIndices(packets, total).join(', ')} of ${total}`
    throw new Error(`${command}: incomplete after ${this.#maxAttempts} attempt(s), ${missing}`)
  }

  /**
   * One send; resolves when the reply burst completes or goes idle — including total silence,
   * which on the 2.4G link just means the request itself was lost and the caller should re-send.
   */
  #sendAndCollect(
    command: Command,
    args: RequestArgs | undefined,
    opcode: number,
    packets: Map<number, ReplyPacket>,
    onPacket: (packet: ReplyPacket) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let total: number | undefined
      let unsubscribe = () => {}

      const onSilence = (): void => {
        unsubscribe()
        resolve()
      }
      let timer = setTimeout(onSilence, this.#timeoutMs)

      unsubscribe = this.#transport.onInputReport((reportId, data) => {
        if (reportId !== this.#dialect.reportId) return
        let packet: ReplyPacket
        try {
          packet = this.#dialect.parseReply(data)
        } catch {
          return   // reported once by the ambient listener; not this exchange's concern
        }
        if (packet.opcode !== opcode) return

        total ??= packet.total
        onPacket(packet)
        if (!packets.has(packet.index)) packets.set(packet.index, packet)

        clearTimeout(timer)
        if (missingIndices(packets, total).length === 0) {
          unsubscribe()
          resolve()
          return
        }
        timer = setTimeout(onSilence, this.#burstIdleMs)
      })

      this.#transport.sendOutputReport(this.#dialect.reportId, this.#dialect.request(command, args)).catch((error) => {
        clearTimeout(timer)
        unsubscribe()
        reject(error)
      })
    })
  }

  /**
   * Wired writes are a single feature report the keyboard never acknowledges; the read-back in
   * #modify is the confirmation. Wireless writes are pipelined the way the vendor app sends
   * them: every packet goes out back-to-back, the echoes are collected, and only the packets
   * whose echo never came are re-sent — the same index-merge discipline as reads, mirrored.
   */
  async #write(command: WriteCommand, payload: Uint8Array): Promise<void> {
    const frames = this.#dialect.writeFrames(command, payload)
    if (this.#dialect.channel === 'feature') {
      for (const frame of frames) await this.#transport.sendFeatureReport(this.#dialect.reportId, frame)
      await this.#afterWrite()
      return
    }

    const pending = new Map(frames.map((frame) => [frame[2]!, frame]))
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      await this.#settle()
      await this.#sendBurstAndCollectAcks(pending)
      if (pending.size === 0) {
        await this.#afterWrite()
        return
      }
    }
    throw new Error(`${command}: packet(s) ${[...pending.keys()].join(', ')} not acknowledged after ${this.#maxAttempts} attempt(s)`)
  }

  /** The keyboard commits to flash after a write. Nothing is sent until it has had time to. */
  #afterWrite(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.#writeSettleMs))
  }

  /** Sends every pending frame, then removes each one whose echo arrives before the link goes quiet. */
  #sendBurstAndCollectAcks(pending: Map<number, Bytes>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let unsubscribe = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        unsubscribe()
        resolve()
      }
      const armIdle = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(finish, this.#ackTimeoutMs)
      }

      unsubscribe = this.#transport.onInputReport((reportId, data) => {
        if (reportId !== this.#dialect.reportId) return
        let packet: ReplyPacket
        try {
          packet = this.#dialect.parseReply(data)
        } catch {
          return
        }
        for (const [index, frame] of pending) {
          if (this.#dialect.isAck(frame, packet)) {
            pending.delete(index)
            break
          }
        }
        if (pending.size === 0) finish()
        else armIdle()
      })

      const frames = [...pending.values()]
      ;(async () => {
        for (const frame of frames) await this.#transport.sendOutputReport(this.#dialect.reportId, frame)
      })().then(armIdle, (error) => {
        if (timer !== undefined) clearTimeout(timer)
        unsubscribe()
        reject(error)
      })
    })
  }

  /**
   * Resolves once no input report has arrived on our report for `settleMs`, so a fresh request
   * does not inherit late packets from the previous exchange. Capped, so a chatty link cannot
   * stall us forever.
   */
  #settle(): Promise<void> {
    if (this.#settleMs === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let unsubscribe = () => {}
      let quiet: ReturnType<typeof setTimeout> | undefined
      const done = (): void => {
        clearTimeout(cap)
        if (quiet !== undefined) clearTimeout(quiet)
        unsubscribe()
        resolve()
      }
      const cap = setTimeout(done, SETTLE_CAP_MS)
      const rearm = (): void => {
        if (quiet !== undefined) clearTimeout(quiet)
        quiet = setTimeout(done, this.#settleMs)
      }
      unsubscribe = this.#transport.onInputReport((reportId) => {
        if (reportId === this.#dialect.reportId) rearm()
      })
      rearm()
    })
  }

  /** Wired: send, then pull one feature report per packet. */
  async #exchangePulled(command: Command, args?: RequestArgs): Promise<Uint8Array> {
    await this.#transport.sendFeatureReport(this.#dialect.reportId, this.#dialect.request(command, args))
    const packets = new Map<number, ReplyPacket>()
    let total: number
    do {
      const packet = this.#dialect.parseReply(await this.#transport.receiveFeatureReport(this.#dialect.reportId))
      total = packet.total
      packets.set(packet.index, packet)
    } while (packets.size < total)
    return reassemble(packets, total)
  }

  #nextPower(): Promise<PowerState> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error(`power: no packet within ${this.#timeoutMs} ms`))
      }, this.#timeoutMs)
      const unsubscribe = this.subscribePower((state) => {
        clearTimeout(timer)
        unsubscribe()
        resolve(state)
      })
    })
  }

  #onAmbientFrame(reportId: number, data: DataView): void {
    if (reportId !== this.#dialect.reportId) return
    let packet: ReplyPacket
    try {
      packet = this.#dialect.parseReply(data)
    } catch (error) {
      this.#onFrameError(error instanceof Error ? error : new Error(String(error)))
      return
    }
    if (!isPowerPacket(packet)) return
    this.#lastPower = decodePower(packet)
    for (const handler of this.#powerHandlers) handler(this.#lastPower)
  }
}

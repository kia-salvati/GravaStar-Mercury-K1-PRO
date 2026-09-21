import { decodeIdentity } from './codec/identity.js'
import { decodeKeymap, Layer, type KeyBinding } from './codec/keymap.js'
import { decodeKeyColours, effectColour, keyColour, lightColourWriteBlock, withEffectColour, withKeyColour, type RGB } from './codec/colour.js'
import { applyLighting, decodeLighting, type LightingChange, type LightingState } from './codec/lighting.js'
import { decodePower, isPowerPacket, type PowerState } from './codec/power.js'
import { Command, missingIndices, reassemble, WriteCommand, type Dialect, type ReplyPacket, type RequestArgs } from './dialect/dialect.js'
import type { Bytes } from './frame.js'
import { connectionTypeFor, dialectFor, type ConnectionType } from './dialect/select.js'
import { modelForUuid, type Capabilities, type Model } from './models.js'
import type { Transport } from './transport/transport.js'

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
  /** How long to wait for the first packet of a reply before giving up. The vendor app uses 3000 ms. */
  timeoutMs?: number
  /** Silence this long after the last packet means the burst is over; missing packets get re-requested. */
  burstIdleMs?: number
  /** How many times a bulk read is re-sent to fill gaps. The vendor app fires the same read up to six times. */
  maxAttempts?: number
  /** How long to wait for a write packet's echo before re-sending it. Captured echoes arrived within ~20 ms. */
  ackTimeoutMs?: number
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
  readonly #onFrameError: (error: Error) => void
  readonly #powerHandlers = new Set<(state: PowerState) => void>()
  readonly #unsubscribeAmbient: () => void
  #model: Model | undefined
  #firmwareVersion = ''
  #lastPower: PowerState | undefined

  private constructor(transport: Transport, dialect: Dialect, connection: ConnectionType, options: ConnectOptions) {
    this.#transport = transport
    this.#dialect = dialect
    this.#connection = connection
    this.#timeoutMs = options.timeoutMs ?? 3000
    this.#burstIdleMs = options.burstIdleMs ?? 150
    this.#maxAttempts = options.maxAttempts ?? 6
    this.#ackTimeoutMs = options.ackTimeoutMs ?? 300
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
  async readPower(): Promise<PowerState> {
    const next = this.#nextPower()
    await this.#read(Command.Identity)
    return next
  }

  subscribePower(handler: (state: PowerState) => void): () => void {
    this.#powerHandlers.add(handler)
    return () => {
      this.#powerHandlers.delete(handler)
    }
  }

  async readKeymap(layer: Layer): Promise<KeyBinding[]> {
    return decodeKeymap(await this.#read(Command.Keymap, { layer }))
  }

  async readAllLayers(): Promise<Record<Layer, KeyBinding[]>> {
    return {
      [Layer.Default]: await this.readKeymap(Layer.Default),
      [Layer.Fn]: await this.readKeymap(Layer.Fn),
      [Layer.Fn1]: await this.readKeymap(Layer.Fn1),
    }
  }

  async readLighting(): Promise<LightingState> {
    return decodeLighting(await this.#read(Command.Profile))
  }

  /**
   * Read the profile, apply the change, write the whole block back — the vendor app's own
   * sequence — then read it again and confirm the keyboard kept what we sent. Returns the
   * state as the keyboard now reports it, not as we intended it.
   */
  async setLighting(change: LightingChange): Promise<LightingState> {
    const readBack = await this.#modify(Command.Profile, WriteCommand.Profile, (current) =>
      applyLighting(current, change, this.capabilities.lighting),
    )
    return decodeLighting(readBack)
  }

  /** The single colour an effect uses when not mixing. Defaults to the current effect. */
  async readEffectColour(effectId?: number): Promise<RGB> {
    const id = effectId ?? (await this.readLighting()).effectId
    return effectColour(await this.#read(Command.LightColor), id)
  }

  async setEffectColour(rgb: RGB, effectId?: number): Promise<RGB> {
    const id = effectId ?? (await this.readLighting()).effectId
    const readBack = await this.#modify(Command.LightColor, WriteCommand.LightColor, (current) => withEffectColour(current, id, rgb))
    return effectColour(readBack, id)
  }

  /** Per-key colours for the Custom effect, indexed by keymap slot. */
  async readKeyColours(): Promise<RGB[]> {
    return decodeKeyColours(await this.#read(Command.CustomColor))
  }

  async setKeyColour(slot: number, rgb: RGB): Promise<RGB> {
    const readBack = await this.#modify(Command.CustomColor, WriteCommand.CustomColor, (current) => withKeyColour(current, slot, rgb))
    return keyColour(readBack, slot)
  }

  /**
   * Everything a write can change, as the keyboard holds it right now. Restore with `restore()`.
   * A backup that covered only the profile would leave colour edits in place — the colour blocks
   * are separate, and the vendor app writes each on its own.
   */
  async backup(): Promise<Backup> {
    return {
      profile: await this.#read(Command.Profile),
      lightColour: await this.#read(Command.LightColor),
      customColour: await this.#read(Command.CustomColor),
    }
  }

  /** Writes all three blocks back verbatim and confirms each by read-back. */
  async restore(backup: Backup): Promise<void> {
    await this.#modify(Command.Profile, WriteCommand.Profile, () => backup.profile)
    await this.#modify(Command.LightColor, WriteCommand.LightColor, () => lightColourWriteBlock(backup.lightColour))
    await this.#modify(Command.CustomColor, WriteCommand.CustomColor, () => Uint8Array.from(backup.customColour))
  }

  /** Writes a complete 128-byte profile verbatim. Prefer `restore()` for a full backup. */
  async writeProfile(profile: Uint8Array): Promise<void> {
    await this.#write(WriteCommand.Profile, profile)
  }

  /**
   * Read a block, transform it, write it, read it again, and confirm every byte we sent came
   * back. The comparison covers the bytes the read returns; a write may legitimately be longer
   * than its read (the light-colour block is 512 out, 483 back).
   */
  async #modify(read: Command, write: WriteCommand, transform: (current: Uint8Array) => Uint8Array): Promise<Uint8Array> {
    const current = await this.#read(read)
    const next = transform(current)
    await this.#write(write, next)

    const readBack = await this.#read(read)
    const mismatch = [...readBack].findIndex((byte, i) => byte !== next[i])
    if (mismatch !== -1) {
      throw new Error(`${write} not retained: byte ${mismatch} is ${readBack[mismatch]}, sent ${next[mismatch]}`)
    }
    return readBack
  }

  /** Raw payloads whose layout is not decoded yet. Kept raw rather than guessed. */
  async readMacrosRaw(): Promise<Uint8Array> {
    return this.#read(Command.Macros)
  }

  async readProfileRaw(): Promise<Uint8Array> {
    return this.#read(Command.Profile)
  }

  async readLightColorRaw(): Promise<Uint8Array> {
    return this.#read(Command.LightColor)
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
      await this.#sendAndCollect(command, args, opcode, packets, (packet) => (total ??= packet.total))
      if (total !== undefined && missingIndices(packets, total).length === 0) {
        return reassemble(packets, total)
      }
    }

    const missing = total === undefined ? 'no packets at all' : `packet(s) ${missingIndices(packets, total).join(', ')} of ${total}`
    throw new Error(`${command}: incomplete after ${this.#maxAttempts} attempt(s), ${missing}`)
  }

  /** One send; resolves when the reply burst completes or goes idle. Rejects only on a total silence. */
  #sendAndCollect(
    command: Command,
    args: RequestArgs | undefined,
    opcode: number,
    packets: Map<number, ReplyPacket>,
    onPacket: (packet: ReplyPacket) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let total: number | undefined
      let received = 0
      let unsubscribe = () => {}

      const onSilence = (): void => {
        unsubscribe()
        if (received === 0) reject(new Error(`${command}: timed out after ${this.#timeoutMs} ms with no reply`))
        else resolve()
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

        received++
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
   * Wireless writes go one packet at a time: send, wait for the keyboard's echo, then the next.
   * A packet whose echo never arrives is re-sent, up to the same attempt budget as reads.
   * Wired writes are a single feature report the keyboard never acknowledges; the read-back in
   * setLighting is the confirmation on both paths.
   */
  async #write(command: WriteCommand, payload: Uint8Array): Promise<void> {
    const frames = this.#dialect.writeFrames(command, payload)
    if (this.#dialect.channel === 'feature') {
      for (const frame of frames) await this.#transport.sendFeatureReport(this.#dialect.reportId, frame)
      return
    }
    for (const frame of frames) await this.#sendAcked(command, frame)
  }

  async #sendAcked(command: WriteCommand, frame: Bytes): Promise<void> {
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt++) {
      if (await this.#sendAndAwaitAck(frame)) return
    }
    throw new Error(`${command}: packet ${frame[2]} not acknowledged after ${this.#maxAttempts} attempt(s)`)
  }

  #sendAndAwaitAck(frame: Bytes): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let unsubscribe = () => {}
      const timer = setTimeout(() => {
        unsubscribe()
        resolve(false)
      }, this.#ackTimeoutMs)

      unsubscribe = this.#transport.onInputReport((reportId, data) => {
        if (reportId !== this.#dialect.reportId) return
        let packet: ReplyPacket
        try {
          packet = this.#dialect.parseReply(data)
        } catch {
          return
        }
        if (!this.#dialect.isAck(frame, packet)) return
        clearTimeout(timer)
        unsubscribe()
        resolve(true)
      })

      this.#transport.sendOutputReport(this.#dialect.reportId, frame).catch((error) => {
        clearTimeout(timer)
        unsubscribe()
        reject(error)
      })
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

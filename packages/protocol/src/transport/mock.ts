import type { Bytes } from '../frame.js'
import { bytesOf, parseCapture, toHex, type CaptureEvent, type Transport } from './transport.js'

type InputHandler = (reportId: number, data: DataView) => void

/**
 * Replays a capture recorded from the vendor app.
 *
 * A send is matched against what the vendor actually sent; an unrecognised frame throws. That is
 * how the "never send an unobserved frame" rule becomes a failing test instead of a convention we
 * have to remember — a guessed opcode dies here rather than reaching the keyboard's flash.
 *
 * Each recorded exchange is consumed once, so a capture holding six identical reads replays six
 * times and then refuses a seventh — the same as the real keyboard would not be asked twice.
 *
 * Replies follow the dialect the capture was taken on: feature-report replies are queued for
 * `receiveFeatureReport`, input-report replies are pushed to subscribers on the next tick, which
 * is what the dongle does.
 */
export class MockTransport implements Transport {
  readonly info: { vendorId: number; productId: number }

  #events: CaptureEvent[]
  #consumed = new Set<number>()
  #pendingReplies: Bytes[] = []
  #inputHandlers = new Set<InputHandler>()
  /** The simulated keyboard's wireless profile: seeded from the capture, updated by accepted writes. */
  #profile: Uint8Array | undefined
  /** The simulated keyboard's cable blocks by read opcode: profile, light colour, per-key colour. */
  #wiredBlocks: Map<number, Uint8Array>
  #written = false

  /** Every write packet accepted by the simulator, in order — for asserting what was sent. */
  readonly writes: Bytes[] = []

  /** The profile as the simulated keyboard now holds it, or undefined if nothing was written. */
  get writtenProfile(): Uint8Array | undefined {
    if (!this.#written) return undefined
    return this.#wiredBlocks.get(WIRED_PROFILE_READ_OPCODE) ?? this.#profile
  }

  /** Any cable block as the simulated keyboard now holds it, by its read opcode. */
  wiredBlock(readOpcode: number): Uint8Array | undefined {
    return this.#wiredBlocks.get(readOpcode)
  }

  constructor(ndjson: string, info = { vendorId: 0x258a, productId: 0x010c }) {
    this.#events = parseCapture(ndjson)
    this.info = info
    this.#profile = seedProfile(this.#events)
    this.#wiredBlocks = seedWiredBlocks(this.#events)
  }

  async sendFeatureReport(reportId: number, data: Bytes): Promise<void> {
    this.#send('out:feature', reportId, data)
  }

  async sendOutputReport(reportId: number, data: Bytes): Promise<void> {
    this.#send('out:output', reportId, data)
  }

  async receiveFeatureReport(_reportId: number): Promise<DataView> {
    const reply = this.#pendingReplies.shift()
    if (!reply) throw new Error('no recorded reply remaining for this request')
    return new DataView(reply.buffer, reply.byteOffset, reply.byteLength)
  }

  onInputReport(handler: InputHandler): () => void {
    this.#inputHandlers.add(handler)
    return () => {
      this.#inputHandlers.delete(handler)
    }
  }

  /** Test hook: deliver every recorded input report to current subscribers, in order. */
  flushInputReports(): void {
    for (const event of this.#events) {
      if (event.dir === 'in:input') this.#deliver(event)
    }
  }

  #send(dir: 'out:feature' | 'out:output', reportId: number, data: Bytes): void {
    if (this.#simulateWirelessWrite(dir, reportId, data)) return
    if (this.#simulateWiredWrite(dir, reportId, data)) return
    // Once something has been written, the capture's recorded profile is stale — the keyboard
    // keeps what it was sent, so a profile read must come from the simulator from then on.
    if (this.#written && this.#serveSimulatedProfile(dir, reportId, data)) return

    const sent = toHex(data)
    const index = this.#events.findIndex(
      (event, i) =>
        !this.#consumed.has(i) &&
        event.dir === dir &&
        event.reportId === reportId &&
        sent.startsWith(event.bytes),
    )
    if (index === -1) {
      // The capture has run out of this read; if it is the profile, the simulator can still answer.
      if (this.#serveSimulatedProfile(dir, reportId, data)) return
      throw new Error(`unexpected frame, not present in capture: ${sent}`)
    }
    this.#consumed.add(index)

    const replies: CaptureEvent[] = []
    for (let i = index + 1; i < this.#events.length; i++) {
      const event = this.#events[i]!
      if (event.dir.startsWith('out:')) break
      if (this.#consumed.has(i)) continue
      this.#consumed.add(i)
      replies.push(event)
    }

    for (const reply of replies) {
      if (reply.dir === 'in:feature') this.#pendingReplies.push(bytesOf(reply))
    }
    const pushed = replies.filter((reply) => reply.dir === 'in:input')
    if (pushed.length > 0) {
      queueMicrotask(() => {
        for (const reply of pushed) this.#deliver(reply)
      })
    }
  }

  /**
   * A write packet is accepted when its SHAPE matches a write the vendor app was captured
   * sending — same report, length, opcode, packet count and length byte, and a valid checksum —
   * even though its data bytes are new. That is the one relaxation of the observed-frames rule,
   * and it is exactly the relaxation a real write needs: new values in a proven envelope.
   * Accepted chunks build up a simulated profile and are echoed back as the keyboard does.
   */
  #simulateWirelessWrite(dir: 'out:feature' | 'out:output', reportId: number, data: Bytes): boolean {
    if (dir !== 'out:output' || data.length !== WIRELESS_FRAME_BYTES) return false
    const [opcode, total, index, length] = data as unknown as [number, number, number, number]
    // A write packet is numbered: index < total, and carries 1..14 data bytes. Reads are not.
    const isWritePacket = total >= 1 && index < total && length >= 1 && length <= WIRELESS_CHUNK_BYTES
    if (!isWritePacket) return false

    const template = this.#events.find((e) => {
      if (e.dir !== dir || e.reportId !== reportId) return false
      const bytes = bytesOf(e)
      return bytes[0] === opcode && bytes[1] === total && bytes[2] === index && bytes[3] === length
    })
    if (!template) return false

    let sum = reportId
    for (let i = 0; i < WIRELESS_FRAME_BYTES - 1; i++) sum += data[i]!
    if ((sum & 0xff) !== data[WIRELESS_FRAME_BYTES - 1]) {
      throw new Error(`write packet ${index} has a bad checksum: ${toHex(data)}`)
    }

    this.#profile ??= new Uint8Array(PROFILE_BYTES)
    this.#profile.set(data.subarray(4, 4 + length), index * WIRELESS_CHUNK_BYTES)
    this.#written = true
    this.writes.push(Uint8Array.from(data))

    const echo = Uint8Array.from(data)
    queueMicrotask(() => {
      const view = new DataView(echo.buffer, echo.byteOffset, echo.byteLength)
      for (const handler of this.#inputHandlers) handler(reportId, view)
    })
    return true
  }

  /**
   * A cable write is one 519-byte feature report whose 7-byte header matches a captured write of
   * the same block. The keyboard sends nothing back; the block is simply kept, trimmed to what a
   * read returns (the light-colour write is 512 bytes, its read 483).
   */
  #simulateWiredWrite(dir: 'out:feature' | 'out:output', reportId: number, data: Bytes): boolean {
    if (dir !== 'out:feature' || data.length !== WIRED_FRAME_BYTES) return false
    const block = WIRED_BLOCKS_BY_WRITE_OPCODE.get(data[0]!)
    if (!block) return false
    const header = toHex(data.subarray(0, WIRED_HEADER_BYTES))
    const template = this.#events.find((e) => e.dir === dir && e.reportId === reportId && e.bytes.startsWith(header))
    if (!template) return false

    this.#wiredBlocks.set(block.readOpcode, Uint8Array.from(data.subarray(WIRED_HEADER_BYTES, WIRED_HEADER_BYTES + block.readLength)))
    this.#written = true
    this.writes.push(Uint8Array.from(data))
    return true
  }

  /** A block read the capture cannot (or must not) answer is served from the simulator. */
  #serveSimulatedProfile(dir: 'out:feature' | 'out:output', reportId: number, data: Bytes): boolean {
    if (dir === 'out:feature') {
      const block = this.#wiredBlocks.get(data[0]!)
      if (!block) return false
      const reply = new Uint8Array(1 + WIRED_HEADER_BYTES + block.length)
      reply[0] = reportId
      reply.set(data.subarray(0, WIRED_HEADER_BYTES), 1)
      reply.set(block, 1 + WIRED_HEADER_BYTES)
      this.#pendingReplies.push(reply)
      return true
    }
    if (!this.#profile || dir !== 'out:output' || data[0] !== WIRELESS_PROFILE_READ_OPCODE) return false

    const profile = this.#profile
    const total = Math.ceil(PROFILE_BYTES / WIRELESS_CHUNK_BYTES)
    const packets: Bytes[] = []
    for (let index = 0; index < total; index++) {
      const remaining = PROFILE_BYTES - index * WIRELESS_CHUNK_BYTES
      const length = Math.min(WIRELESS_CHUNK_BYTES, remaining)
      const packet = new Uint8Array(WIRELESS_FRAME_BYTES)
      packet.set([WIRELESS_PROFILE_READ_OPCODE, total, index, length])
      packet.set(profile.subarray(index * WIRELESS_CHUNK_BYTES, index * WIRELESS_CHUNK_BYTES + length), 4)
      let sum = reportId
      for (let i = 0; i < WIRELESS_FRAME_BYTES - 1; i++) sum += packet[i]!
      packet[WIRELESS_FRAME_BYTES - 1] = sum & 0xff
      packets.push(packet)
    }
    queueMicrotask(() => {
      for (const packet of packets) {
        const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
        for (const handler of this.#inputHandlers) handler(reportId, view)
      }
    })
    return true
  }

  #deliver(event: CaptureEvent): void {
    const bytes = bytesOf(event)
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (const handler of this.#inputHandlers) handler(event.reportId, data)
  }
}

const WIRELESS_FRAME_BYTES = 19
const WIRELESS_CHUNK_BYTES = 14
const WIRELESS_PROFILE_READ_OPCODE = 0x44
const WIRED_FRAME_BYTES = 519
const WIRED_HEADER_BYTES = 7
const WIRED_PROFILE_READ_OPCODE = 0x84
const PROFILE_BYTES = 128

/** The cable blocks the simulator keeps: write opcode → the read that returns it and its size. */
const WIRED_BLOCKS_BY_WRITE_OPCODE = new Map<number, { readOpcode: number; readLength: number }>([
  [0x04, { readOpcode: WIRED_PROFILE_READ_OPCODE, readLength: PROFILE_BYTES }],
  [0x0a, { readOpcode: 0x8a, readLength: 483 }],
  [0x06, { readOpcode: 0x86, readLength: 378 }],
])

/** Each cable block as first captured, keyed by its read opcode. */
function seedWiredBlocks(events: readonly CaptureEvent[]): Map<number, Uint8Array> {
  const blocks = new Map<number, Uint8Array>()
  for (const { readOpcode, readLength } of WIRED_BLOCKS_BY_WRITE_OPCODE.values()) {
    const reply = events.find((e) => e.dir === 'in:feature' && e.bytes.startsWith(`06 ${readOpcode.toString(16)} `))
    if (reply) blocks.set(readOpcode, Uint8Array.from(bytesOf(reply).subarray(1 + WIRED_HEADER_BYTES, 1 + WIRED_HEADER_BYTES + readLength)))
  }
  return blocks
}

/** The wireless profile as first captured, merged from indexed packets. */
function seedProfile(events: readonly CaptureEvent[]): Uint8Array | undefined {
  const packets = new Map<number, Uint8Array>()
  for (const event of events) {
    if (event.dir !== 'in:input' || !event.bytes.startsWith('44 ')) continue
    const bytes = bytesOf(event)
    if (bytes.length !== WIRELESS_FRAME_BYTES) continue
    if (!packets.has(bytes[2]!)) packets.set(bytes[2]!, bytes)
  }
  if (packets.size === 0) return undefined
  const profile = new Uint8Array(PROFILE_BYTES)
  for (const [index, bytes] of packets) {
    profile.set(bytes.subarray(4, 4 + (bytes[3]! & 0x0f)), index * WIRELESS_CHUNK_BYTES)
  }
  return profile
}

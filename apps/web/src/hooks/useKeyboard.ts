import { useCallback, useEffect, useRef, useState } from 'react'
import { K916, KeyboardBusyError, type Backup, type LightingChange, type RestoreStep, type RGB, type Transport } from 'k916'
import type { DeviceSource } from '../api/hidSource'
import type { Connected, Keyboard, KeyboardState } from '../types/keyboard'

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Custom has no slot in the light-colour block; that is a null reading, not a failed one. */
const readEffectColour = async (kb: K916, effectId: number): Promise<RGB | null> => {
  try {
    return await kb.readEffectColour(effectId)
  } catch (error) {
    if (error instanceof RangeError && /no colour slot/.test(error.message)) return null
    throw error
  }
}

type Readings = Pick<Connected, 'lighting' | 'effectColour' | 'sleepTimer'>

/** Everything the Device screen shows apart from power. The cable ignores the sleep timer, so it is not read there. */
const readReadings = async (kb: K916): Promise<Readings> => {
  const lighting = await kb.readLighting()
  return {
    lighting,
    effectColour: await readEffectColour(kb, lighting.effectId),
    sleepTimer: kb.info.connection === 'wireless' ? await kb.readSleepTimer() : null,
  }
}

const merge = (result: Partial<Connected>, current: Connected): Connected => ({ ...current, ...result })

/**
 * Owns the one `K916` instance: connect on load from a remembered device, connect on demand from
 * the prompt, drop on disconnect. Every device call passes through `run`, so `busy` is true for
 * its whole duration.
 */
export function useKeyboard(source: DeviceSource): Keyboard {
  const [state, setState] = useState<KeyboardState>({ status: source.supported ? 'idle' : 'unsupported', notice: null })
  const [pending, setPending] = useState(0)
  const device = useRef<K916 | null>(null)

  /**
   * The library refuses a write while anything is in flight and sends nothing. That is expected
   * — the user's next click goes through — so it becomes a notice, never an error.
   */
  const run = useCallback(async <T>(name: string, operation: () => Promise<T>): Promise<T | undefined> => {
    setPending((count) => count + 1)
    try {
      return await operation()
    } catch (error) {
      if (!(error instanceof KeyboardBusyError)) throw error
      setState((current) => ({ ...current, notice: `${name} was not sent — the keyboard is still busy. Try again in a moment.` }))
      return undefined
    } finally {
      setPending((count) => count - 1)
    }
  }, [])

  const drop = useCallback((notice: string | null) => {
    device.current?.close()
    device.current = null
    setState({ status: 'idle', notice })
  }, [])

  const open = useCallback(
    async (transport: Transport) => {
      setState({ status: 'connecting', notice: null })
      try {
        await run('Connect', async () => {
          const kb = await K916.connect(transport, source.connectOptions)
          device.current = kb
          kb.subscribePower((power) => setState((current) => (current.status === 'connected' ? { ...current, power } : current)))
          const readings = await readReadings(kb)
          // The dongle pushes its power packet right after identity, so by now it has usually landed.
          setState({ status: 'connected', info: kb.info, capabilities: kb.capabilities, reportsBattery: kb.reportsBattery, power: kb.lastPower ?? null, ...readings, notice: null })
        })
      } catch (error) {
        console.error('[keyboard] connect failed', error)
        drop(`Could not read the keyboard: ${describe(error)}`)
      }
    },
    [source, run, drop],
  )

  useEffect(() => {
    if (!source.supported) return
    let cancelled = false
    source
      .remembered()
      .then((transport) => (transport && !cancelled ? open(transport) : undefined))
      .catch((error: unknown) => {
        console.error('[keyboard] reconnect failed', error)
        setState({ status: 'idle', notice: `Could not reopen the remembered keyboard: ${describe(error)}` })
      })
    const unsubscribe = source.onDisconnect(drop)
    return () => {
      cancelled = true
      unsubscribe()
      device.current?.close()
      device.current = null
    }
  }, [source, open, drop])

  const connect = useCallback(async () => {
    try {
      const transport = await source.request()
      if (!transport) {
        setState({ status: 'idle', notice: 'No keyboard was chosen.' })
        return
      }
      await open(transport)
    } catch (error) {
      console.error('[keyboard] prompt failed', error)
      setState({ status: 'idle', notice: `Could not open the keyboard: ${describe(error)}` })
    }
  }, [source, open])

  /** A call on the connected keyboard whose read-back is folded into the state. A failure keeps the last good reading and says why. */
  const perform = useCallback(
    async <T>(name: string, operation: (kb: K916) => Promise<T>, apply?: (result: T, current: Connected) => Connected): Promise<T | undefined> => {
      const kb = device.current
      if (!kb) return undefined
      try {
        const result = await run(name, () => operation(kb))
        if (result !== undefined && apply) setState((current) => (current.status === 'connected' ? { ...apply(result, current), notice: null } : current))
        return result
      } catch (error) {
        console.error(`[keyboard] ${name} failed`, error)
        setState((current) => (current.status === 'connected' ? { ...current, notice: `${name} failed: ${describe(error)}` } : current))
        return undefined
      }
    },
    [run],
  )

  const refresh = useCallback(async () => {
    await perform('Refresh', async (kb) => ({ ...(await readReadings(kb)), power: kb.reportsBattery ? await kb.readPower() : null }), merge)
  }, [perform])

  // A new effect brings its own colour, so the colour is re-read with it.
  const setLighting = useCallback(
    async (change: LightingChange) => {
      await perform(
        'Lighting change',
        async (kb) => {
          const lighting = await kb.setLighting(change)
          return { lighting, effectColour: await readEffectColour(kb, lighting.effectId) }
        },
        merge,
      )
    },
    [perform],
  )

  const setEffectColour = useCallback(
    async (rgb: RGB) => {
      await perform('Colour change', (kb) => kb.setEffectColour(rgb), (effectColour, current) => ({ ...current, effectColour }))
    },
    [perform],
  )

  const setKeyColour = useCallback((slot: number, rgb: RGB) => perform('Key colour change', (kb) => kb.setKeyColour(slot, rgb)), [perform])

  const setSleepTimer = useCallback(
    async (minutes: number | null) => {
      await perform('Sleep timer change', (kb) => kb.setSleepTimer(minutes), (sleepTimer, current) => ({ ...current, sleepTimer }))
    },
    [perform],
  )

  const backup = useCallback(() => perform('Backup', (kb) => kb.backup()), [perform])

  const restore = useCallback(
    async (saved: Backup, onProgress?: (step: RestoreStep) => void) => {
      const readings = await perform(
        'Restore',
        async (kb) => {
          await kb.restore(saved, onProgress)
          return readReadings(kb)
        },
        merge,
      )
      return readings !== undefined
    },
    [perform],
  )

  return { ...state, busy: pending > 0, connect, refresh, setLighting, setEffectColour, setKeyColour, setSleepTimer, backup, restore }
}

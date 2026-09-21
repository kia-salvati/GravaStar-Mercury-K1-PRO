import { useCallback, useEffect, useRef, useState } from 'react'
import { K916, type RGB, type Transport } from 'k916'
import type { DeviceSource } from '../api/hidSource'
import type { Keyboard, KeyboardState } from '../types/keyboard'

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

/**
 * Owns the one `K916` instance: connect on load from a remembered device, connect on demand from
 * the prompt, drop on disconnect. Stage 1 only ever reads.
 */
export function useKeyboard(source: DeviceSource): Keyboard {
  const [state, setState] = useState<KeyboardState>({ status: source.supported ? 'idle' : 'unsupported', notice: null })
  const device = useRef<K916 | null>(null)

  const drop = useCallback((notice: string | null) => {
    device.current?.close()
    device.current = null
    setState({ status: 'idle', notice })
  }, [])

  const open = useCallback(
    async (transport: Transport) => {
      setState({ status: 'connecting', notice: null })
      try {
        const kb = await K916.connect(transport, source.connectOptions)
        device.current = kb
        kb.subscribePower((power) => setState((current) => (current.status === 'connected' ? { ...current, power } : current)))
        const lighting = await kb.readLighting()
        const effectColour = await readEffectColour(kb, lighting.effectId)
        // The dongle pushes its power packet right after identity, so by now it has usually landed.
        setState({ status: 'connected', info: kb.info, capabilities: kb.capabilities, reportsBattery: kb.reportsBattery, power: kb.lastPower ?? null, lighting, effectColour, notice: null })
      } catch (error) {
        console.error('[keyboard] connect failed', error)
        drop(`Could not read the keyboard: ${describe(error)}`)
      }
    },
    [source, drop],
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

  const refresh = useCallback(async () => {
    const kb = device.current
    if (!kb) return
    try {
      const lighting = await kb.readLighting()
      const effectColour = await readEffectColour(kb, lighting.effectId)
      const power = kb.reportsBattery ? await kb.readPower() : null
      setState((current) => (current.status === 'connected' ? { ...current, lighting, effectColour, power, notice: null } : current))
    } catch (error) {
      console.error('[keyboard] refresh failed', error)
      setState((current) => (current.status === 'connected' ? { ...current, notice: `Refresh failed: ${describe(error)}` } : current))
    }
  }, [])

  return { ...state, connect, refresh }
}

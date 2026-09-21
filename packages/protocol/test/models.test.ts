import { expect, test } from 'vitest'
import { K1_PRO_UUID, modelForUuid } from '../src/models.js'

test('resolves the K1 PRO from its uuid', () => {
  const model = modelForUuid(K1_PRO_UUID)

  expect(model?.productName).toBe('GravaStar Mercury K1 PRO')
  expect(model?.protocolFamily).toBe('916')
  expect(model?.capabilities.layers).toBe(3)
  expect(model?.capabilities.macroBytes).toBe(512)
  expect(model?.capabilities.hasScreen).toBe(false)
})

test('battery is reported over the dongle only — verified on both connections', () => {
  expect(modelForUuid(K1_PRO_UUID)?.capabilities.battery).toBe('wireless')
})

test('lighting is expressed as stages, not percentages', () => {
  const lighting = modelForUuid(K1_PRO_UUID)!.capabilities.lighting

  expect(lighting.brightnessStages).toBe(4)
  expect(lighting.speedStages).toBe(4)
  // Verified by capture: the wire byte is the stage itself, never a percentage.
  expect(lighting.brightnessStep).toBe(1)
})

test('returns undefined for an unknown uuid', () => {
  expect(modelForUuid('0xdeadbeef')).toBeUndefined()
})

test('uuid lookup is exact, not a prefix match', () => {
  expect(modelForUuid('0x03000000019')).toBeUndefined()
  expect(modelForUuid('0x0300000001970')).toBeUndefined()
})

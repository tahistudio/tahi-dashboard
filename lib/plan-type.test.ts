/**
 * lib/plan-type.ts: the one spelling of "no plan" and the closed vocabulary
 * every plan writer (client create, client PATCH, deal conversion, the MCP
 * worker) agrees on.
 */
import { describe, it, expect } from 'vitest'
import {
  NO_PLAN,
  PLAN_TYPES,
  PLAN_TYPE_ERROR,
  isPlanType,
  isRetainerPlanType,
  normalisePlanType,
} from './plan-type'

describe('normalisePlanType', () => {
  it.each([null, undefined, '', 'none'])('folds %j onto the stored no-plan value', (value) => {
    expect(normalisePlanType(value)).toBe(NO_PLAN)
  })

  it.each(PLAN_TYPES.map(p => p.value))('keeps %s as itself', (slug) => {
    expect(normalisePlanType(slug)).toBe(slug)
  })

  it.each(['gold', 'Maintain', 'MAINTAIN', 42, true, {}, []])('refuses %j as undefined', (value) => {
    expect(normalisePlanType(value)).toBeUndefined()
  })
})

describe('the vocabulary', () => {
  it('has exactly the six plans the UI offers, none of them the no-plan value', () => {
    expect(PLAN_TYPES.map(p => p.value)).toEqual(['maintain', 'scale', 'tune', 'launch', 'hourly', 'custom'])
    expect(isPlanType(NO_PLAN)).toBe(false)
  })

  it('names maintain and scale as the retainers that come with a subscription', () => {
    expect(isRetainerPlanType('maintain')).toBe(true)
    expect(isRetainerPlanType('scale')).toBe(true)
    expect(isRetainerPlanType('launch')).toBe(false)
    expect(isRetainerPlanType(NO_PLAN)).toBe(false)
  })

  it('spells out the vocabulary in the error a route answers with', () => {
    for (const p of PLAN_TYPES) expect(PLAN_TYPE_ERROR).toContain(p.value)
    expect(PLAN_TYPE_ERROR).toContain('null')
  })
})

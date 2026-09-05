/**
 * The parser drops rather than coerces, and the plan is one of the rules.
 *
 * The route test covers the vocabularies end to end. What is asserted here is
 * the pure module's own contract, and in particular the one rule that used to
 * live only as a sentence in the prompt: a size the client's plan cannot hold
 * is not a suggestion, it is a value the dialog would rewrite a beat later
 * while the reason kept arguing for it.
 */
import { describe, it, expect } from 'vitest'
import { extractJsonObject, parsePredictions, type ParseContext } from '@/lib/predict/parse'

const BASE: ParseContext = {
  subject: 'request',
  todayIso: '2026-09-05',
  requested: ['dueDate', 'priority', 'size', 'assigneeId', 'estimatedHours', 'category'],
  rosterIds: ['tm_1'],
  filledKeys: [],
  canUseLargeTrack: true,
}

function answer(payload: Record<string, unknown>): string {
  return JSON.stringify(payload)
}

const sized = (size: string) => answer({
  size: { value: size, reason: 'It spans several days.', confidence: 0.9 },
})

describe('the plan gate on size', () => {
  it('keeps large for a client whose plan has a multi-day track', () => {
    expect(parsePredictions(sized('large'), BASE).size?.value).toBe('large')
  })

  it('drops large for a client whose plan has none', () => {
    const out = parsePredictions(sized('large'), { ...BASE, canUseLargeTrack: false })
    expect(out.size).toBeUndefined()
  })

  it('still keeps small on that same plan', () => {
    const out = parsePredictions(sized('small'), { ...BASE, canUseLargeTrack: false })
    expect(out.size?.value).toBe('small')
  })
})

describe('the other three filters', () => {
  it('drops a field that was not asked for', () => {
    const out = parsePredictions(
      answer({ priority: { value: 'high', reason: 'Urgent.', confidence: 0.9 } }),
      { ...BASE, requested: ['dueDate'] },
    )
    expect(out.priority).toBeUndefined()
  })

  it('drops a field the operator already settled', () => {
    const out = parsePredictions(
      answer({ priority: { value: 'high', reason: 'Urgent.', confidence: 0.9 } }),
      { ...BASE, filledKeys: ['priority'] },
    )
    expect(out.priority).toBeUndefined()
  })

  it('drops a suggestion with no reason rather than inventing one', () => {
    const out = parsePredictions(
      answer({ priority: { value: 'high', confidence: 0.9 } }),
      BASE,
    )
    expect(out.priority).toBeUndefined()
  })

  it('rounds an estimate to the quarter hour the control steps in', () => {
    const out = parsePredictions(
      answer({ estimatedHours: { value: 6.31, reason: 'Comparable work.', confidence: 0.8 } }),
      BASE,
    )
    expect(out.estimatedHours?.value).toBe(6.25)
  })
})

describe('extractJsonObject', () => {
  it('reads through a fence', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('reads through a sentence either side', () => {
    expect(extractJsonObject('Sure. {"a":1} Hope that helps.')).toEqual({ a: 1 })
  })

  it('answers null on prose', () => {
    expect(extractJsonObject('Sorry, I cannot.')).toBeNull()
  })

  it('answers null on an array', () => {
    expect(extractJsonObject('[1,2,3]')).toBeNull()
  })
})

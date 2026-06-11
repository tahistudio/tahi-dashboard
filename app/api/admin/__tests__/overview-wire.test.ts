/**
 * Unit tests for the pure Wire event helpers (lib/overview-wire.ts).
 *
 * The route gathers raw rows per source (each in its own try/catch) and
 * hands the flat candidate list to mergeWireEvents. These tests pin the
 * merge/sort/cap contract + the small text formatters so a malformed row
 * can never reorder or break the rail.
 */

import { describe, it, expect } from 'vitest'
import {
  mergeWireEvents,
  wireSince,
  leadScoreText,
  automationRanText,
  WIRE_CAP,
  type WireEvent,
} from '@/lib/overview-wire'

function ev(id: string, at: string, type: WireEvent['type'] = 'ops'): WireEvent {
  return { id, type, text: id, at }
}

describe('mergeWireEvents', () => {
  it('sorts newest first across mixed sources', () => {
    const out = mergeWireEvents([
      ev('a', '2026-06-10T08:00:00.000Z', 'content'),
      ev('b', '2026-06-12T08:00:00.000Z', 'money'),
      ev('c', '2026-06-11T08:00:00.000Z', 'sales'),
    ])
    expect(out.map(e => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('drops candidates with no parseable timestamp', () => {
    const out = mergeWireEvents([
      ev('good', '2026-06-12T08:00:00.000Z'),
      ev('empty', ''),
      ev('garbage', 'not-a-date'),
    ])
    expect(out.map(e => e.id)).toEqual(['good'])
  })

  it('caps to WIRE_CAP by default', () => {
    const many: WireEvent[] = Array.from({ length: WIRE_CAP + 8 }, (_, i) =>
      ev(`e${i}`, new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString()),
    )
    const out = mergeWireEvents(many)
    expect(out).toHaveLength(WIRE_CAP)
    // Newest (highest second) survives the cap.
    expect(out[0].id).toBe(`e${WIRE_CAP + 7}`)
  })

  it('honours an explicit cap and handles cap <= 0', () => {
    const list = [
      ev('a', '2026-06-12T08:00:00.000Z'),
      ev('b', '2026-06-11T08:00:00.000Z'),
    ]
    expect(mergeWireEvents(list, 1).map(e => e.id)).toEqual(['a'])
    expect(mergeWireEvents(list, 0)).toEqual([])
    expect(mergeWireEvents(list, -5)).toEqual([])
  })

  it('keeps incoming order for identical timestamps (stable)', () => {
    const ts = '2026-06-12T08:00:00.000Z'
    const out = mergeWireEvents([ev('first', ts), ev('second', ts), ev('third', ts)])
    expect(out.map(e => e.id)).toEqual(['first', 'second', 'third'])
  })

  it('returns an empty array for no candidates and never throws', () => {
    expect(mergeWireEvents([])).toEqual([])
  })
})

describe('wireSince', () => {
  it('returns the ISO cutoff N days before now (default 7)', () => {
    const now = new Date('2026-06-12T08:00:00.000Z')
    expect(wireSince(now)).toBe('2026-06-05T08:00:00.000Z')
    expect(wireSince(now, 1)).toBe('2026-06-11T08:00:00.000Z')
  })
})

describe('leadScoreText', () => {
  it('formats and rounds within 0..100', () => {
    expect(leadScoreText(85)).toBe('Lead scored 85')
    expect(leadScoreText(84.6)).toBe('Lead scored 85')
    expect(leadScoreText(140)).toBe('Lead scored 100')
    expect(leadScoreText(-3)).toBe('Lead scored 0')
  })
})

describe('automationRanText', () => {
  it('uses the rule name when present, else a generic line', () => {
    expect(automationRanText('overdue nudge')).toBe('Automation ran: overdue nudge')
    expect(automationRanText('  trim me  ')).toBe('Automation ran: trim me')
    expect(automationRanText(null)).toBe('Automation ran')
    expect(automationRanText('')).toBe('Automation ran')
    expect(automationRanText('   ')).toBe('Automation ran')
  })
})

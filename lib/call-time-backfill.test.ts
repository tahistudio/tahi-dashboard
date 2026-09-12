import { describe, expect, it } from 'vitest'
import { planCallTimeBackfill, type CallTimeRow } from './call-time-backfill'

describe('planCallTimeBackfill', () => {
  it('leaves already-canonical rows alone', () => {
    const rows: CallTimeRow[] = [
      { id: '1', table: 'discovery_calls', scheduledAt: '2026-09-14T22:00:00.000Z' },
    ]
    const plan = planCallTimeBackfill(rows)
    expect(plan.fixes).toEqual([])
    expect(plan.refusals).toEqual([])
    expect(plan.alreadyCanonical).toBe(1)
  })

  it('fixes an offset-form row from Google Calendar sync to the equivalent Z instant', () => {
    const rows: CallTimeRow[] = [
      { id: '2', table: 'discovery_calls', scheduledAt: '2026-09-15T10:00:00+12:00' },
    ]
    const plan = planCallTimeBackfill(rows)
    expect(plan.fixes).toEqual([
      { id: '2', table: 'discovery_calls', from: '2026-09-15T10:00:00+12:00', to: '2026-09-14T22:00:00.000Z' },
    ])
    expect(plan.alreadyCanonical).toBe(0)
  })

  it('fixes a naive row by reading it as Pacific/Auckland wall-clock time', () => {
    const rows: CallTimeRow[] = [
      { id: '3', table: 'scheduled_calls', scheduledAt: '2026-09-15T10:00:00' },
    ]
    const plan = planCallTimeBackfill(rows)
    expect(plan.fixes).toEqual([
      { id: '3', table: 'scheduled_calls', from: '2026-09-15T10:00:00', to: '2026-09-14T22:00:00.000Z' },
    ])
  })

  it('refuses an unparseable row instead of silently skipping it', () => {
    const rows: CallTimeRow[] = [
      { id: '4', table: 'discovery_calls', scheduledAt: 'not a date' },
    ]
    const plan = planCallTimeBackfill(rows)
    expect(plan.fixes).toEqual([])
    expect(plan.refusals).toEqual([
      { id: '4', table: 'discovery_calls', scheduledAt: 'not a date', reason: 'unparseable' },
    ])
  })

  it('handles a mixed batch across both tables', () => {
    const rows: CallTimeRow[] = [
      { id: 'a', table: 'discovery_calls', scheduledAt: '2026-09-14T22:00:00.000Z' },
      { id: 'b', table: 'discovery_calls', scheduledAt: '2026-09-15T10:00:00+12:00' },
      { id: 'c', table: 'scheduled_calls', scheduledAt: '2026-09-15T10:00:00' },
      { id: 'd', table: 'scheduled_calls', scheduledAt: 'garbage' },
    ]
    const plan = planCallTimeBackfill(rows)
    expect(plan.alreadyCanonical).toBe(1)
    expect(plan.fixes.map(f => f.id)).toEqual(['b', 'c'])
    expect(plan.refusals.map(r => r.id)).toEqual(['d'])
  })
})

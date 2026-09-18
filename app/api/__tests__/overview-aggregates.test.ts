import { describe, it, expect } from 'vitest'
import {
  overnightCutoff,
  daysPastDue,
  bucketArAging,
  computeRunwayMonths,
  trailingThreeMonthKey,
  activeTimerLabel,
  type ArAgingInput,
} from '@/lib/overview-aggregates'

/**
 * Slice 0 ("The Studio Ledger") — pure aggregation helpers for the admin
 * overview API. These cover the overnight cutoff, AR bucketing, and runway
 * math without needing a live D1.
 */

describe('overnightCutoff', () => {
  it('returns midnight UTC of the prior calendar day', () => {
    const now = new Date('2026-06-11T09:30:00.000Z')
    expect(overnightCutoff(now)).toBe('2026-06-10T00:00:00.000Z')
  })

  it('rolls back across a month boundary', () => {
    const now = new Date('2026-07-01T00:05:00.000Z')
    expect(overnightCutoff(now)).toBe('2026-06-30T00:00:00.000Z')
  })

  it('rolls back across a year boundary', () => {
    const now = new Date('2026-01-01T12:00:00.000Z')
    expect(overnightCutoff(now)).toBe('2025-12-31T00:00:00.000Z')
  })

  it('is stable regardless of the time of day on `now`', () => {
    const morning = overnightCutoff(new Date('2026-06-11T00:00:01.000Z'))
    const evening = overnightCutoff(new Date('2026-06-11T23:59:59.000Z'))
    expect(morning).toBe(evening)
    expect(morning).toBe('2026-06-10T00:00:00.000Z')
  })
})

describe('daysPastDue', () => {
  const now = new Date('2026-06-11T00:00:00.000Z')

  it('returns 0 when there is no due date', () => {
    expect(daysPastDue(null, now)).toBe(0)
  })

  it('returns 0 for an invoice not yet due', () => {
    expect(daysPastDue('2026-06-20', now)).toBe(0)
  })

  it('returns whole days past the due date', () => {
    expect(daysPastDue('2026-06-01', now)).toBe(10)
  })

  it('returns 0 for an unparseable due date', () => {
    expect(daysPastDue('not-a-date', now)).toBe(0)
  })
})

describe('bucketArAging', () => {
  const mk = (amountNzd: number, days: number, clientName: string | null): ArAgingInput => ({
    amountNzd,
    daysPastDue: days,
    hasDueDate: true,
    clientName,
  })

  const mkNoDue = (amountNzd: number, clientName: string | null): ArAgingInput => ({
    amountNzd,
    daysPastDue: 0,
    hasDueDate: false,
    clientName,
  })

  it('returns an all-zero, null-oldest aging for no invoices', () => {
    const aging = bucketArAging([])
    expect(aging).toEqual({
      currentNzd: 0,
      d30Nzd: 0,
      d60Nzd: 0,
      d90Nzd: 0,
      noDueDateNzd: 0,
      noDueDateCount: 0,
      totalNzd: 0,
      oldest: null,
    })
  })

  it('places invoices into the correct buckets by days past due', () => {
    const aging = bucketArAging([
      mk(100, 0, 'A'),    // current: not yet due
      mk(200, 1, 'B'),    // d30 boundary (1..30)
      mk(300, 30, 'F'),   // d30 boundary
      mk(400, 31, 'C'),   // d60 boundary (31..60)
      mk(800, 60, 'D'),   // d60 boundary
      mk(1600, 61, 'E'),  // d90 boundary (61+)
    ])
    expect(aging.currentNzd).toBe(100)
    expect(aging.d30Nzd).toBe(500)
    expect(aging.d60Nzd).toBe(1200)
    expect(aging.d90Nzd).toBe(1600)
    expect(aging.totalNzd).toBe(3400)
  })

  it('never counts a no-due-date invoice as current, buckets it separately', () => {
    const aging = bucketArAging([mk(100, 0, 'Dated Co'), mkNoDue(500, 'Greyhive')])
    expect(aging.currentNzd).toBe(100)
    expect(aging.noDueDateNzd).toBe(500)
    expect(aging.noDueDateCount).toBe(1)
    expect(aging.totalNzd).toBe(600)
  })

  it('reports the single oldest OVERDUE invoice as the callout, ignoring no-due-date rows', () => {
    const aging = bucketArAging([
      mk(100, 5, 'Recent Co'),
      mk(999, 200, 'Stale Co'),
      mk(50, 40, 'Middle Co'),
      mkNoDue(999999, 'Greyhive'),
    ])
    expect(aging.oldest).toEqual({
      clientName: 'Stale Co',
      daysPastDue: 200,
      amountNzd: 999,
    })
  })

  it('rounds bucket totals to whole NZD', () => {
    const aging = bucketArAging([mk(100.4, 0, 'A'), mk(100.4, 0, 'B')])
    // 200.8 rounds to 201
    expect(aging.currentNzd).toBe(201)
    expect(aging.totalNzd).toBe(201)
  })

  it('coerces non-finite amounts to 0', () => {
    const aging = bucketArAging([mk(Number.NaN, 0, 'A'), mk(50, 0, 'B')])
    expect(aging.currentNzd).toBe(50)
    expect(aging.totalNzd).toBe(50)
  })
})

describe('computeRunwayMonths', () => {
  it('divides balance by burn', () => {
    expect(computeRunwayMonths(120000, 10000)).toBe(12)
  })

  it('returns null when burn is zero', () => {
    expect(computeRunwayMonths(120000, 0)).toBeNull()
  })

  it('returns null when burn is negative (net inflow)', () => {
    expect(computeRunwayMonths(120000, -5000)).toBeNull()
  })

  it('returns null when burn is not finite', () => {
    expect(computeRunwayMonths(120000, Number.NaN)).toBeNull()
  })

  it('returns null when balance is not finite', () => {
    expect(computeRunwayMonths(Number.POSITIVE_INFINITY, 10000)).toBeNull()
  })

  it('handles fractional runway', () => {
    expect(computeRunwayMonths(25000, 10000)).toBe(2.5)
  })
})

describe('trailingThreeMonthKey', () => {
  it('returns the YYYY-MM key three months before now', () => {
    expect(trailingThreeMonthKey(new Date('2026-06-11T00:00:00.000Z'))).toBe('2026-03')
  })

  it('rolls back across a year boundary', () => {
    expect(trailingThreeMonthKey(new Date('2026-02-15T00:00:00.000Z'))).toBe('2025-11')
  })
})

describe('activeTimerLabel', () => {
  it('formats sub-hour timers as minutes', () => {
    // 47 minutes = 2820 seconds
    expect(activeTimerLabel(2820, 'Acme')).toBe('47m on Acme')
  })

  it('formats multi-hour timers with hours and minutes', () => {
    // 2h 5m = 7500 seconds
    expect(activeTimerLabel(7500, 'Acme')).toBe('2h 5m on Acme')
  })

  it('floors partial minutes', () => {
    // 47m 59s = 2879 seconds -> still 47m
    expect(activeTimerLabel(2879, 'Acme')).toBe('47m on Acme')
  })

  it('omits the client when there is no target name', () => {
    expect(activeTimerLabel(2820, null)).toBe('47m')
  })

  it('clamps negative elapsed to 0m', () => {
    expect(activeTimerLabel(-100, 'Acme')).toBe('0m on Acme')
  })
})

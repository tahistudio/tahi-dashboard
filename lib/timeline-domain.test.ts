import { describe, it, expect } from 'vitest'
import {
  DAY_MS,
  WEEK_MS,
  TIMELINE_LEAD_DAYS,
  TIMELINE_TRAIL_DAYS,
  TIMELINE_MIN_CHART_WIDTH,
  TIMELINE_PX_PER_DAY,
  parseTimelineDate,
  computeTimelineDomain,
  timelineChartWidth,
  ratioOf,
  todayRatio,
  weekTicks,
  formatTimelineTick,
  doneStatusValues,
  isTimelineOverdue,
  timelinePlot,
  compareTimelineRows,
  type TimelineRange,
} from '@/lib/timeline-domain'

// A fixed "now" so every assertion is deterministic. Built from local
// parts, so the maths holds in any timezone the suite runs in.
const NOW = new Date(2026, 8, 2, 12, 0, 0).getTime() // 2 Sep 2026, midday
const days = (n: number) => n * DAY_MS

describe('parseTimelineDate', () => {
  it('reads an ISO date string', () => {
    const ts = parseTimelineDate('2026-09-02T00:00:00.000Z')
    expect(ts).toBe(Date.parse('2026-09-02T00:00:00.000Z'))
  })

  it('reads a date-only ISO string', () => {
    expect(parseTimelineDate('2026-09-02')).toBe(Date.parse('2026-09-02'))
  })

  it('reads a short month-day label against the year of "now"', () => {
    const ts = parseTimelineDate('May 23', NOW)
    expect(ts).not.toBeNull()
    const d = new Date(ts as number)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(4)
    expect(d.getDate()).toBe(23)
  })

  it('reads a long month name too', () => {
    const d = new Date(parseTimelineDate('September 9', NOW) as number)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(9)
  })

  it('reads "today" as now', () => {
    expect(parseTimelineDate('today', NOW)).toBe(NOW)
  })

  it('returns null for empty or unparseable input', () => {
    expect(parseTimelineDate(undefined)).toBeNull()
    expect(parseTimelineDate(null)).toBeNull()
    expect(parseTimelineDate('')).toBeNull()
    expect(parseTimelineDate('sometime soon')).toBeNull()
  })
})

describe('computeTimelineDomain', () => {
  it('pads an empty dataset around today', () => {
    const d = computeTimelineDomain([], { now: NOW })
    expect(d.start).toBe(NOW - days(TIMELINE_LEAD_DAYS))
    expect(d.end).toBe(NOW + days(TIMELINE_TRAIL_DAYS))
    expect(d.span).toBe(d.end - d.start)
  })

  it('starts 14 days before the earliest start date', () => {
    const ranges: TimelineRange[] = [
      { startTs: NOW - days(30), endTs: NOW - days(10) },
      { startTs: NOW - days(5), endTs: NOW + days(5) },
    ]
    const d = computeTimelineDomain(ranges, { now: NOW })
    expect(d.start).toBe(NOW - days(30) - days(TIMELINE_LEAD_DAYS))
  })

  it('ends 21 days after the latest due date', () => {
    const ranges: TimelineRange[] = [
      { startTs: NOW, endTs: NOW + days(60) },
      { startTs: null, endTs: NOW + days(90) },
    ]
    const d = computeTimelineDomain(ranges, { now: NOW })
    expect(d.end).toBe(NOW + days(90) + days(TIMELINE_TRAIL_DAYS))
  })

  it('always contains today, even when every item is in the future', () => {
    const ranges: TimelineRange[] = [{ startTs: NOW + days(100), endTs: NOW + days(120) }]
    const d = computeTimelineDomain(ranges, { now: NOW })
    expect(d.start).toBe(NOW - days(TIMELINE_LEAD_DAYS))
    expect(NOW).toBeGreaterThanOrEqual(d.start)
    expect(NOW).toBeLessThanOrEqual(d.end)
  })

  it('always contains today, even when every item is in the past', () => {
    const ranges: TimelineRange[] = [{ startTs: NOW - days(120), endTs: NOW - days(100) }]
    const d = computeTimelineDomain(ranges, { now: NOW })
    expect(d.end).toBe(NOW + days(TIMELINE_TRAIL_DAYS))
  })

  it('uses the due date alone for a milestone with no start', () => {
    const ranges: TimelineRange[] = [{ startTs: null, endTs: NOW - days(40) }]
    const d = computeTimelineDomain(ranges, { now: NOW })
    expect(d.start).toBe(NOW - days(40) - days(TIMELINE_LEAD_DAYS))
  })

  it('widens both edges by the scroll extension buffers', () => {
    const base = computeTimelineDomain([], { now: NOW })
    const wider = computeTimelineDomain([], {
      now: NOW,
      pastExtensionDays: 180,
      futureExtensionDays: 360,
    })
    expect(wider.start).toBe(base.start - days(180))
    expect(wider.end).toBe(base.end + days(360))
  })

  it('never returns a zero or negative span', () => {
    const d = computeTimelineDomain([], { now: NOW })
    expect(d.span).toBeGreaterThan(0)
  })
})

describe('timelineChartWidth', () => {
  it('holds a floor so a short dataset does not squash', () => {
    const d = computeTimelineDomain([], { now: NOW })
    // 35 padded days at 2px each would be a sliver, so the floor wins.
    expect(timelineChartWidth(d, { pxPerDay: 2 })).toBe(TIMELINE_MIN_CHART_WIDTH)
  })

  it('scales at the per-day rate once past the floor', () => {
    const d = computeTimelineDomain([{ startTs: NOW, endTs: NOW + days(200) }], { now: NOW })
    const spanDays = d.span / DAY_MS
    expect(timelineChartWidth(d)).toBe(Math.round(spanDays * TIMELINE_PX_PER_DAY))
  })
})

describe('ratioOf and todayRatio', () => {
  const domain = computeTimelineDomain([], { now: NOW })

  it('maps the domain edges to 0 and 1', () => {
    expect(ratioOf(domain.start, domain)).toBe(0)
    expect(ratioOf(domain.end, domain)).toBe(1)
  })

  it('maps the midpoint to 0.5', () => {
    expect(ratioOf(domain.start + domain.span / 2, domain)).toBeCloseTo(0.5, 10)
  })

  it('places today by its share of the padded span', () => {
    // 14 days of lead over a 35 day span.
    expect(todayRatio(domain, NOW)).toBeCloseTo(14 / 35, 10)
  })
})

describe('weekTicks', () => {
  const domain = computeTimelineDomain([{ startTs: NOW, endTs: NOW + days(120) }], { now: NOW })
  const ticks = weekTicks(domain, NOW)

  it('produces at least one tick', () => {
    expect(ticks.length).toBeGreaterThan(0)
  })

  it('spaces every tick exactly one week apart', () => {
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].ts - ticks[i - 1].ts).toBe(WEEK_MS)
    }
  })

  it('aligns the grid to today', () => {
    for (const t of ticks) {
      expect(Math.abs((t.ts - NOW) % WEEK_MS)).toBe(0)
    }
    expect(ticks.some(t => t.ts === NOW)).toBe(true)
  })

  it('keeps every tick inside the domain', () => {
    for (const t of ticks) {
      expect(t.ts).toBeGreaterThanOrEqual(domain.start)
      expect(t.ts).toBeLessThanOrEqual(domain.end)
      expect(t.ratio).toBeGreaterThanOrEqual(0)
      expect(t.ratio).toBeLessThanOrEqual(1)
    }
  })

  it('labels each tick with its day and short month', () => {
    expect(ticks[0].label).toMatch(/^\d{1,2} [A-Z][a-z]{2}$/)
  })
})

describe('formatTimelineTick', () => {
  it('reads day then short month', () => {
    expect(formatTimelineTick(new Date(2026, 8, 5).getTime())).toBe('5 Sep')
    expect(formatTimelineTick(new Date(2026, 0, 31).getTime())).toBe('31 Jan')
  })
})

describe('doneStatusValues', () => {
  it('picks up columns whose value or label reads as finished', () => {
    const set = doneStatusValues([
      { statusValue: 'submitted', label: 'Submitted' },
      { statusValue: 'in_progress', label: 'In Progress' },
      { statusValue: 'delivered', label: 'Delivered' },
    ])
    expect(set.has('delivered')).toBe(true)
    expect(set.has('in_progress')).toBe(false)
  })

  it('falls back to the last column when nothing reads as finished', () => {
    const set = doneStatusValues([
      { statusValue: 'a', label: 'Alpha' },
      { statusValue: 'b', label: 'Beta' },
    ])
    expect(set.has('b')).toBe(true)
    expect(set.has('a')).toBe(false)
  })

  it('always treats the terminal request statuses as finished', () => {
    const set = doneStatusValues([])
    expect(set.has('delivered')).toBe(true)
    expect(set.has('cancelled')).toBe(true)
    expect(set.has('archived')).toBe(true)
  })
})

describe('isTimelineOverdue', () => {
  const doneStatuses = doneStatusValues([
    { statusValue: 'submitted', label: 'Submitted' },
    { statusValue: 'delivered', label: 'Delivered' },
  ])

  it('flags an open item past its due date', () => {
    expect(isTimelineOverdue({
      status: 'submitted', endTs: NOW - days(1), now: NOW, doneStatuses,
    })).toBe(true)
  })

  it('never flags a delivered item, however late', () => {
    expect(isTimelineOverdue({
      status: 'delivered', endTs: NOW - days(90), now: NOW, doneStatuses,
    })).toBe(false)
  })

  it('never flags a cancelled or archived item', () => {
    expect(isTimelineOverdue({
      status: 'cancelled', endTs: NOW - days(9), now: NOW, doneStatuses,
    })).toBe(false)
    expect(isTimelineOverdue({
      status: 'archived', endTs: NOW - days(9), now: NOW, doneStatuses,
    })).toBe(false)
  })

  it('does not flag an item still ahead of its due date', () => {
    expect(isTimelineOverdue({
      status: 'submitted', endTs: NOW + days(1), now: NOW, doneStatuses,
    })).toBe(false)
  })
})

describe('timelinePlot', () => {
  it('draws a bar from the start date to the due date', () => {
    const plot = timelinePlot({
      dueDate: '2026-09-20', startDate: '2026-09-10', createdDate: '2026-09-01', now: NOW,
    })
    expect(plot).toEqual({
      startTs: Date.parse('2026-09-10'),
      endTs: Date.parse('2026-09-20'),
      dated: true,
    })
  })

  it('drops a milestone on the due date when there is no start', () => {
    const plot = timelinePlot({ dueDate: '2026-09-20', createdDate: '2026-09-01', now: NOW })
    expect(plot?.startTs).toBeNull()
    expect(plot?.endTs).toBe(Date.parse('2026-09-20'))
    expect(plot?.dated).toBe(true)
  })

  it('falls back to the created date, as an undated milestone', () => {
    // A start date must not stretch a bar backwards to the created date.
    const plot = timelinePlot({
      dueDate: null, startDate: '2026-09-10', createdDate: '2026-09-01', now: NOW,
    })
    expect(plot).toEqual({ startTs: null, endTs: Date.parse('2026-09-01'), dated: false })
  })

  it('is null when the item carries no date at all', () => {
    expect(timelinePlot({ dueDate: null, startDate: null, createdDate: null, now: NOW })).toBeNull()
  })
})

describe('compareTimelineRows', () => {
  const row = (endTs: number, dated: boolean) => ({ endTs, dated })

  it('puts the soonest deadline first', () => {
    expect(compareTimelineRows(row(NOW, true), row(NOW + days(3), true))).toBeLessThan(0)
    expect(compareTimelineRows(row(NOW + days(3), true), row(NOW, true))).toBeGreaterThan(0)
  })

  it('sinks undated rows below every dated one, however old', () => {
    expect(compareTimelineRows(row(NOW - days(400), false), row(NOW + days(400), true)))
      .toBeGreaterThan(0)
  })

  it('runs the undated tail oldest first', () => {
    expect(compareTimelineRows(row(NOW - days(9), false), row(NOW - days(2), false)))
      .toBeLessThan(0)
  })

  it('sorts a mixed set into deadlines, then the undated tail', () => {
    const rows = [
      { id: 'undated-new', ...row(NOW - days(1), false) },
      { id: 'due-later',   ...row(NOW + days(9), true) },
      { id: 'undated-old', ...row(NOW - days(30), false) },
      { id: 'due-soon',    ...row(NOW + days(1), true) },
    ]
    expect([...rows].sort(compareTimelineRows).map(r => r.id)).toEqual([
      'due-soon', 'due-later', 'undated-old', 'undated-new',
    ])
  })
})

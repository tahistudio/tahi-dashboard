import {
  weekToDate,
  computeRowStatus,
  computeEngagementStatus,
  type LinkedWorkItem,
  type ScheduleRowInput,
} from '@/lib/delivery-status'

const EFF = '2026-01-01' // week 1 starts here
const row = (over: Partial<ScheduleRowInput> = {}): ScheduleRowInput => ({
  id: 'r1', rowType: 'task', startWeek: 1, endWeek: 2, riskFlag: 0, ...over,
})
const req = (status: string, over: Partial<LinkedWorkItem> = {}): LinkedWorkItem =>
  ({ kind: 'request', id: 'q', status, ...over })
const task = (status: string, over: Partial<LinkedWorkItem> = {}): LinkedWorkItem =>
  ({ kind: 'task', id: 't', status, ...over })

describe('weekToDate', () => {
  it('maps 1-based weeks relative to the effective date', () => {
    expect(weekToDate(EFF, 1)).toBe('2026-01-01')
    expect(weekToDate(EFF, 2)).toBe('2026-01-08')
    expect(weekToDate(EFF, 2, { endOfWeek: true })).toBe('2026-01-14')
  })
  it('returns null on missing inputs', () => {
    expect(weekToDate(null, 1)).toBeNull()
    expect(weekToDate(EFF, null)).toBeNull()
  })
})

describe('computeRowStatus', () => {
  const within = '2026-01-05'  // inside weeks 1-2
  const past = '2026-02-01'    // after week-2 end (2026-01-14)

  it('is not_started with no linked work', () => {
    const s = computeRowStatus(row(), [], within, EFF)
    expect(s.status).toBe('not_started')
    expect(s.linkedCount).toBe(0)
  })

  it('blocked outranks everything', () => {
    const s = computeRowStatus(row(), [req('on_hold'), task('done')], within, EFF)
    expect(s.status).toBe('blocked')
  })

  it('scope-flagged request counts as blocked', () => {
    const s = computeRowStatus(row(), [req('in_progress', { scopeFlagged: true })], within, EFF)
    expect(s.status).toBe('blocked')
  })

  it('done when all delivered, even past the planned end', () => {
    const s = computeRowStatus(row(), [req('delivered'), task('done')], past, EFF)
    expect(s.status).toBe('done')
  })

  it('delayed when past planned end and not done', () => {
    const s = computeRowStatus(row(), [req('in_progress')], past, EFF)
    expect(s.status).toBe('delayed')
  })

  it('at_risk on a risk flag within the window', () => {
    const s = computeRowStatus(row({ riskFlag: 1 }), [task('in_progress')], within, EFF)
    expect(s.status).toBe('at_risk')
  })

  it('at_risk on an imminent due date', () => {
    const s = computeRowStatus(row(), [task('todo', { dueDate: '2026-01-06' })], within, EFF)
    expect(s.status).toBe('at_risk')
  })

  it('in_progress when started within the window, no risk', () => {
    const s = computeRowStatus(row(), [task('in_progress')], within, EFF)
    expect(s.status).toBe('in_progress')
  })

  it('ignores cancelled/archived work', () => {
    const s = computeRowStatus(row(), [req('cancelled'), req('archived')], within, EFF)
    expect(s.status).toBe('not_started')
    expect(s.linkedCount).toBe(0)
  })
})

describe('computeEngagementStatus', () => {
  it('is empty when no rows have linked work', () => {
    const r = computeEngagementStatus([computeRowStatus(row(), [], '2026-01-05', EFF)])
    expect(r.rowsTotal).toBe(0)
    expect(r.status).toBe('not_started')
  })

  it('rolls up to the worst status with % complete', () => {
    const rows = [
      computeRowStatus(row({ id: 'a' }), [task('done')], '2026-01-05', EFF),       // done
      computeRowStatus(row({ id: 'b' }), [req('on_hold')], '2026-01-05', EFF),     // blocked
      computeRowStatus(row({ id: 'c' }), [task('in_progress')], '2026-01-05', EFF),// in_progress
    ]
    const r = computeEngagementStatus(rows)
    expect(r.status).toBe('blocked')
    expect(r.rowsTotal).toBe(3)
    expect(r.rowsDone).toBe(1)
    expect(r.pctComplete).toBeCloseTo(1 / 3)
    expect(r.offTrackRowIds).toContain('b')
  })
})

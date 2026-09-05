import { describe, it, expect } from 'vitest'
import {
  buildWeekGroups,
  buildWeekStrip,
  formatHours,
  stripLoad,
  stripRangeLabel,
  weekSummary,
} from './tasks-planner'
import { taskShiftedDayKey, type TaskRow } from './tasks-views'

const WEDNESDAY = new Date(2026, 8, 9, 9, 0, 0) // getDay() === 3
const SUNDAY = new Date(2026, 8, 13, 9, 0, 0)   // getDay() === 0

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    title: 'A task',
    type: 'tahi_internal',
    status: 'todo',
    priority: 'standard',
    orgId: null,
    orgName: null,
    requestId: null,
    assigneeId: 'tm1',
    dueDate: null,
    completedAt: null,
    description: null,
    estimatedHours: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  }
}

function taskOn(dueDate: string | null, estimatedHours: number | null = null): TaskRow {
  return row({ dueDate, estimatedHours })
}

/** Shift a YYYY-MM-DD key by whole days. Built on the production date maths so
 *  the paging assertion cannot drift from what the strip actually writes. */
function shiftKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  return taskShiftedDayKey(new Date(year, month - 1, day), days)
}

describe('formatHours', () => {
  it('prints a bare zero', () => {
    expect(formatHours(0)).toBe('0h')
  })

  it('rounds to the nearest quarter and strips trailing zeros', () => {
    expect(formatHours(1)).toBe('1h')
    expect(formatHours(1.5)).toBe('1.5h')
    expect(formatHours(1.3)).toBe('1.25h')
    expect(formatHours(2.13)).toBe('2.25h')
  })
})

describe('buildWeekGroups', () => {
  it('drops the overdue group when nothing is overdue', () => {
    const groups = buildWeekGroups([row({ dueDate: '2026-09-09' })], WEDNESDAY)
    expect(groups.some(g => g.key === 'overdue')).toBe(false)
  })

  it('opens with overdue then today when something is late', () => {
    const groups = buildWeekGroups(
      [row({ id: 'a', dueDate: '2026-09-07' }), row({ id: 'b', dueDate: '2026-09-09' })],
      WEDNESDAY,
    )
    expect(groups[0].key).toBe('overdue')
    expect(groups[0].tasks.map(t => t.id)).toEqual(['a'])
    expect(groups[0].droppable).toBe(false)
    expect(groups[1].key).toBe('today')
    expect(groups[1].tasks.map(t => t.id)).toEqual(['b'])
  })

  it('runs a day card through the end of the week, then Later and No date', () => {
    const groups = buildWeekGroups([], WEDNESDAY)
    // Wednesday: today plus Thursday, Friday, Saturday, Sunday, then the two tails.
    expect(groups.map(g => g.key)).toEqual(['today', 'd1', 'd2', 'd3', 'd4', 'later', 'none'])
    expect(groups[1].name).toBe('Tomorrow')
    expect(groups[2].name).toBe('Friday')
  })

  it('still offers one day card on a Sunday', () => {
    const groups = buildWeekGroups([], SUNDAY)
    expect(groups.map(g => g.key)).toEqual(['today', 'd1', 'later', 'none'])
  })

  it('puts undated work in the No date group with a null drop target', () => {
    const groups = buildWeekGroups([row({ id: 'x' })], WEDNESDAY)
    const none = groups.find(g => g.key === 'none')
    expect(none?.tasks.map(t => t.id)).toEqual(['x'])
    expect(none?.dueDate).toBeNull()
    expect(none?.droppable).toBe(true)
  })

  it('gives every droppable day the date a drop would write', () => {
    const groups = buildWeekGroups([], WEDNESDAY)
    expect(groups.find(g => g.key === 'today')?.dueDate).toBe('2026-09-09')
    expect(groups.find(g => g.key === 'd1')?.dueDate).toBe('2026-09-10')
    expect(groups.find(g => g.key === 'later')?.dueDate).toBe('2026-09-14')
  })

  it('sums the estimate per group', () => {
    const groups = buildWeekGroups(
      [row({ id: 'a', dueDate: '2026-09-09', estimatedHours: 1.5 }),
       row({ id: 'b', dueDate: '2026-09-09', estimatedHours: 2 })],
      WEDNESDAY,
    )
    expect(groups.find(g => g.key === 'today')?.estimatedHours).toBe(3.5)
  })
})

describe('weekSummary', () => {
  it('counts overdue, today and the coming week and sums their estimate', () => {
    const out = weekSummary(
      [row({ id: 'a', dueDate: '2026-09-07', estimatedHours: 1 }),
       row({ id: 'b', dueDate: '2026-09-09', estimatedHours: 2 }),
       row({ id: 'c', dueDate: '2026-09-15', estimatedHours: 4 }),
       row({ id: 'd' })],
      WEDNESDAY,
    )
    expect(out).toEqual({ overdue: 1, today: 1, week: 2, estimatedHours: 6 })
  })
})

describe('buildWeekStrip', () => {
  it('always returns seven cells, whatever day it is', () => {
    expect(buildWeekStrip([], WEDNESDAY)).toHaveLength(7)
    expect(buildWeekStrip([], SUNDAY)).toHaveLength(7)
  })

  it('starts on Monday every time, so the strip does not slide under you', () => {
    for (const now of [WEDNESDAY, SUNDAY]) {
      const strip = buildWeekStrip([], now)
      expect(strip[0].name).toBe('Monday')
      expect(strip[6].name).toBe('Sunday')
      expect(strip.map(d => d.letter)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
    }
  })

  it('marks exactly one cell as today, and only inside the current week', () => {
    const thisWeek = buildWeekStrip([], WEDNESDAY)
    expect(thisWeek.filter(d => d.isToday)).toHaveLength(1)
    expect(buildWeekStrip([], WEDNESDAY, 1).some(d => d.isToday)).toBe(false)
    expect(buildWeekStrip([], WEDNESDAY, -1).some(d => d.isToday)).toBe(false)
  })

  it('refuses a drop on a day that has already gone', () => {
    const strip = buildWeekStrip([], WEDNESDAY)
    const past = strip.filter(d => d.isPast)
    expect(past.length).toBeGreaterThan(0)
    expect(past.every(d => !d.droppable)).toBe(true)
    expect(strip.filter(d => !d.isPast).every(d => d.droppable)).toBe(true)
  })

  it('counts a task on its own day and nowhere else', () => {
    const strip = buildWeekStrip([taskOn('2026-09-10', 3)], WEDNESDAY)
    const thursday = strip.find(d => d.dayKey === '2026-09-10')!
    expect(thursday.count).toBe(1)
    expect(thursday.estimatedHours).toBe(3)
    expect(strip.filter(d => d.count > 0)).toHaveLength(1)
  })

  it('ignores undated work and anything outside the shown week', () => {
    const strip = buildWeekStrip(
      [taskOn(null), taskOn('2026-10-01'), taskOn('2025-01-01')],
      WEDNESDAY,
    )
    expect(strip.every(d => d.count === 0)).toBe(true)
  })

  it('agrees with buildWeekGroups on every day they both cover', () => {
    const rows = [
      taskOn('2026-09-09', 2), taskOn('2026-09-10', 1.5),
      taskOn('2026-09-10'), taskOn('2026-09-13', 4),
    ]
    const strip = buildWeekStrip(rows, WEDNESDAY)
    const groups = buildWeekGroups(rows, WEDNESDAY)
    for (const group of groups) {
      if (!group.dueDate) continue
      const cell = strip.find(d => d.dayKey === group.dueDate)
      if (!cell) continue
      expect(cell.count).toBe(group.tasks.length)
      expect(cell.estimatedHours).toBeCloseTo(group.estimatedHours, 5)
    }
  })

  it('splits the flat Overdue bucket back out per day', () => {
    const rows = [taskOn('2026-09-07'), taskOn('2026-09-08'), taskOn('2026-09-08')]
    const strip = buildWeekStrip(rows, WEDNESDAY)
    expect(strip.find(d => d.dayKey === '2026-09-07')!.count).toBe(1)
    expect(strip.find(d => d.dayKey === '2026-09-08')!.count).toBe(2)
  })

  it('pages a whole week at a time and writes the dates that page would plan', () => {
    const here = buildWeekStrip([], WEDNESDAY)
    const next = buildWeekStrip([], WEDNESDAY, 1)
    expect(next[0].dayKey).toBe(shiftKey(here[0].dayKey, 7))
    expect(next.every(d => d.droppable)).toBe(true)
  })
})

describe('stripLoad', () => {
  it('scales to the busiest day rather than an invented day length', () => {
    const days = buildWeekStrip(
      [taskOn('2026-09-09', 2), taskOn('2026-09-10', 4)],
      WEDNESDAY,
    )
    const light = days.find(d => d.dayKey === '2026-09-09')!
    const heavy = days.find(d => d.dayKey === '2026-09-10')!
    expect(stripLoad(heavy, days)).toBe(1)
    expect(stripLoad(light, days)).toBeCloseTo(0.5, 5)
  })

  it('falls back to counts when nothing carries an estimate', () => {
    const days = buildWeekStrip([taskOn('2026-09-09'), taskOn('2026-09-10'), taskOn('2026-09-10')], WEDNESDAY)
    expect(stripLoad(days.find(d => d.dayKey === '2026-09-10')!, days)).toBe(1)
    expect(stripLoad(days.find(d => d.dayKey === '2026-09-09')!, days)).toBeCloseTo(0.5, 5)
  })

  it('is zero on an empty week rather than dividing by nothing', () => {
    const days = buildWeekStrip([], WEDNESDAY)
    expect(stripLoad(days[0], days)).toBe(0)
  })
})

describe('stripRangeLabel', () => {
  it('names one month once', () => {
    expect(stripRangeLabel(buildWeekStrip([], WEDNESDAY))).toBe('7 to 13 Sep')
  })

  it('names both months when the week crosses one', () => {
    const label = stripRangeLabel(buildWeekStrip([], new Date(2026, 8, 30)))
    expect(label).toBe('28 Sep to 4 Oct')
  })
})

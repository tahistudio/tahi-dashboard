import { describe, it, expect } from 'vitest'
import { buildWeekGroups, formatHours, weekSummary } from './tasks-planner'
import type { TaskRow } from './tasks-views'

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

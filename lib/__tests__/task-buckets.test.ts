import { describe, it, expect } from 'vitest'
import {
  dayDelta,
  bucketForTask,
  groupTasksByDue,
  TASK_BUCKET_ORDER,
  TASK_BUCKET_LABELS,
} from '@/lib/task-buckets'

const TODAY = '2026-08-19'

describe('dayDelta', () => {
  it('is zero for the same day', () => {
    expect(dayDelta(TODAY, TODAY)).toBe(0)
  })
  it('is negative for a past date', () => {
    expect(dayDelta('2026-08-17', TODAY)).toBe(-2)
  })
  it('is positive for a future date', () => {
    expect(dayDelta('2026-08-26', TODAY)).toBe(7)
  })
})

describe('bucketForTask', () => {
  it('returns no_date when there is no due date', () => {
    expect(bucketForTask({ dueDate: null }, TODAY)).toBe('no_date')
  })
  it('returns overdue for a past due date', () => {
    expect(bucketForTask({ dueDate: '2026-08-18' }, TODAY)).toBe('overdue')
  })
  it('returns today for the current day', () => {
    expect(bucketForTask({ dueDate: '2026-08-19' }, TODAY)).toBe('today')
  })
  it('returns this_week for 1..7 days out', () => {
    expect(bucketForTask({ dueDate: '2026-08-20' }, TODAY)).toBe('this_week')
    expect(bucketForTask({ dueDate: '2026-08-26' }, TODAY)).toBe('this_week')
  })
  it('returns later beyond 7 days', () => {
    expect(bucketForTask({ dueDate: '2026-08-27' }, TODAY)).toBe('later')
  })
  it('tolerates an ISO timestamp by slicing to the date', () => {
    expect(bucketForTask({ dueDate: '2026-08-18T09:30:00Z' }, TODAY)).toBe('overdue')
  })
})

describe('groupTasksByDue', () => {
  it('places every task in exactly one bucket', () => {
    const tasks = [
      { id: 'a', dueDate: '2026-08-10' }, // overdue
      { id: 'b', dueDate: '2026-08-19' }, // today
      { id: 'c', dueDate: '2026-08-22' }, // this_week
      { id: 'd', dueDate: '2026-09-30' }, // later
      { id: 'e', dueDate: null },         // no_date
    ]
    const groups = groupTasksByDue(tasks, TODAY)
    expect(groups.overdue.map(t => t.id)).toEqual(['a'])
    expect(groups.today.map(t => t.id)).toEqual(['b'])
    expect(groups.this_week.map(t => t.id)).toEqual(['c'])
    expect(groups.later.map(t => t.id)).toEqual(['d'])
    expect(groups.no_date.map(t => t.id)).toEqual(['e'])
  })

  it('sorts dated buckets soonest-first', () => {
    const tasks = [
      { id: 'later', dueDate: '2026-08-15' },
      { id: 'earlier', dueDate: '2026-08-12' },
    ]
    const groups = groupTasksByDue(tasks, TODAY)
    expect(groups.overdue.map(t => t.id)).toEqual(['earlier', 'later'])
  })

  it('preserves input order for no_date', () => {
    const tasks = [
      { id: 'x', dueDate: null },
      { id: 'y', dueDate: null },
    ]
    const groups = groupTasksByDue(tasks, TODAY)
    expect(groups.no_date.map(t => t.id)).toEqual(['x', 'y'])
  })

  it('exposes a stable bucket order and labels', () => {
    expect([...TASK_BUCKET_ORDER]).toEqual(['overdue', 'today', 'this_week', 'later', 'no_date'])
    expect(TASK_BUCKET_LABELS.overdue).toBe('Overdue')
    expect(TASK_BUCKET_LABELS.no_date).toBe('No date')
  })
})

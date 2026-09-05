import { describe, it, expect } from 'vitest'
import {
  TASKS_VIEW_KEYS,
  TASK_LEVELS,
  DEFAULT_TASK_FILTERS,
  DEFAULT_TASKS_SORT,
  applyTaskViews,
  compareTasks,
  countTasksSavedViews,
  isTasksSnapshot,
  matchesTaskFilters,
  matchesTaskQuery,
  matchesTasksSavedView,
  migrateLegacyTaskStatusTab,
  migrateLegacyTaskTypeTab,
  migrateLegacyTaskViewMode,
  normaliseTasksViewKey,
  sortTasks,
  taskSortDirLabel,
  tasksSnapshotsEqual,
  type TaskRow,
  type TasksFilters,
} from './tasks-views'

const NOW = new Date(2026, 8, 5) // Saturday 5 September 2026, local

function row(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    title: 'Chase the GA4 access',
    type: 'tahi_internal',
    status: 'todo',
    priority: 'standard',
    orgId: null,
    orgName: null,
    requestId: null,
    assigneeId: null,
    dueDate: null,
    completedAt: null,
    description: null,
    estimatedHours: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-04T00:00:00Z',
    subtaskCount: 0,
    subtaskDone: 0,
    blockedByCount: 0,
    ...over,
  }
}

describe('view keys', () => {
  it('has exactly list, board and week in that order', () => {
    expect(TASKS_VIEW_KEYS).toEqual(['list', 'board', 'week'])
  })

  it('migrates the legacy my_work view onto week', () => {
    expect(normaliseTasksViewKey('my_work')).toBe('week')
  })

  it('falls back to list for anything unknown', () => {
    expect(normaliseTasksViewKey('timeline')).toBe('list')
    expect(normaliseTasksViewKey(undefined)).toBe('list')
  })
})

describe('levels', () => {
  it('maps the three db types onto the three chips in order', () => {
    expect(TASK_LEVELS.map(l => l.value)).toEqual([
      'client_task', 'internal_client_task', 'tahi_internal',
    ])
    expect(TASK_LEVELS.map(l => l.label)).toEqual(['Client', 'Internal', 'Tahi'])
  })
})

describe('saved views', () => {
  it('assigned to me excludes done work', () => {
    const ctx = { assigneeId: 'tm1', now: NOW }
    expect(matchesTasksSavedView(row({ assigneeId: 'tm1' }), 'mine', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ assigneeId: 'tm1', status: 'done' }), 'mine', ctx)).toBe(false)
    expect(matchesTasksSavedView(row({ assigneeId: 'tm2' }), 'mine', ctx)).toBe(false)
  })

  it('overdue needs an open task with a past date', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-04' }), 'overdue', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-05' }), 'overdue', ctx)).toBe(false)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-04', status: 'done' }), 'overdue', ctx)).toBe(false)
  })

  it('due this week spans today through seven days out', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-05' }), 'due_week', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-12' }), 'due_week', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ dueDate: '2026-09-13' }), 'due_week', ctx)).toBe(false)
  })

  it('blocked counts a blocking dependency as well as the status', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ status: 'blocked' }), 'blocked', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ blockedByCount: 1 }), 'blocked', ctx)).toBe(true)
    expect(matchesTasksSavedView(row(), 'blocked', ctx)).toBe(false)
  })

  it('client-linked and internal split on the client link and the level', () => {
    const ctx = { now: NOW }
    expect(matchesTasksSavedView(row({ orgId: 'o1' }), 'client_linked', ctx)).toBe(true)
    expect(matchesTasksSavedView(row(), 'client_linked', ctx)).toBe(false)
    expect(matchesTasksSavedView(row(), 'internal', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ type: 'internal_client_task', orgId: 'o1' }), 'internal', ctx)).toBe(true)
    expect(matchesTasksSavedView(row({ type: 'client_task', orgId: 'o1' }), 'internal', ctx)).toBe(false)
  })

  it('a null key means no narrowing', () => {
    expect(matchesTasksSavedView(row(), null, { now: NOW })).toBe(true)
  })

  it('counts every view plus __all', () => {
    const counts = countTasksSavedViews(
      [row({ status: 'done' }), row({ id: 't2', orgId: 'o1', type: 'client_task' })],
      { assigneeId: 'tm1', now: NOW },
    )
    expect(counts.__all).toBe(2)
    expect(counts.done).toBe(1)
    expect(counts.client_linked).toBe(1)
  })
})

describe('filters', () => {
  const base: TasksFilters = { ...DEFAULT_TASK_FILTERS }

  it('passes everything on the defaults', () => {
    expect(matchesTaskFilters(row(), base, NOW)).toBe(true)
  })

  it('filters by status, priority and level', () => {
    expect(matchesTaskFilters(row(), { ...base, status: 'done' }, NOW)).toBe(false)
    expect(matchesTaskFilters(row(), { ...base, priority: 'urgent' }, NOW)).toBe(false)
    expect(matchesTaskFilters(row(), { ...base, level: 'tahi_internal' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row(), { ...base, level: 'client_task' }, NOW)).toBe(false)
  })

  it('reads none as "has no client" and "has no assignee"', () => {
    expect(matchesTaskFilters(row(), { ...base, client: 'none' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ orgId: 'o1' }), { ...base, client: 'none' }, NOW)).toBe(false)
    expect(matchesTaskFilters(row(), { ...base, assignee: 'none' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ assigneeId: 'tm1' }), { ...base, assignee: 'none' }, NOW)).toBe(false)
  })

  it('buckets the due filter', () => {
    expect(matchesTaskFilters(row({ dueDate: '2026-09-04' }), { ...base, due: 'overdue' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ dueDate: '2026-09-05' }), { ...base, due: 'today' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ dueDate: '2026-09-11' }), { ...base, due: 'week' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row({ dueDate: '2026-09-30' }), { ...base, due: 'later' }, NOW)).toBe(true)
    expect(matchesTaskFilters(row(), { ...base, due: 'none' }, NOW)).toBe(true)
  })
})

describe('search', () => {
  it('matches title, client name and description', () => {
    const r = row({ title: 'Redirect map', orgName: 'Kowtow', description: 'Check the 301s' })
    expect(matchesTaskQuery(r, 'redirect')).toBe(true)
    expect(matchesTaskQuery(r, 'kowtow')).toBe(true)
    expect(matchesTaskQuery(r, '301')).toBe(true)
    expect(matchesTaskQuery(r, 'invoice')).toBe(false)
    expect(matchesTaskQuery(r, '   ')).toBe(true)
  })
})

describe('sort', () => {
  it('always sinks done below open work', () => {
    const done = row({ id: 'a', status: 'done', dueDate: '2026-01-01' })
    const open = row({ id: 'b', dueDate: '2030-01-01' })
    expect(compareTasks(done, open, DEFAULT_TASKS_SORT)).toBeGreaterThan(0)
  })

  it('sorts undated work last when ascending by due', () => {
    const out = sortTasks([row({ id: 'a' }), row({ id: 'b', dueDate: '2026-09-09' })], DEFAULT_TASKS_SORT)
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('ascending priority reads highest first', () => {
    const out = sortTasks(
      [row({ id: 'a', priority: 'standard' }), row({ id: 'b', priority: 'urgent' })],
      { key: 'priority', dir: 'asc' },
    )
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })

  it('labels the direction per key', () => {
    expect(taskSortDirLabel({ key: 'due', dir: 'asc' })).toBe('Soonest first')
    expect(taskSortDirLabel({ key: 'title', dir: 'desc' })).toBe('Z to A')
    expect(taskSortDirLabel({ key: 'updated', dir: 'asc' })).toBe('Newest first')
  })

  it('never mutates the input array', () => {
    const rows = [row({ id: 'a', dueDate: '2030-01-01' }), row({ id: 'b', dueDate: '2020-01-01' })]
    sortTasks(rows, DEFAULT_TASKS_SORT)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })
})

describe('applyTaskViews', () => {
  it('runs saved view, then filters, then search, then sort', () => {
    const rows = [
      row({ id: 'a', assigneeId: 'tm1', dueDate: '2026-09-10', title: 'Alpha' }),
      row({ id: 'b', assigneeId: 'tm1', dueDate: '2026-09-06', title: 'Beta' }),
      row({ id: 'c', assigneeId: 'tm2', dueDate: '2026-09-01', title: 'Gamma' }),
      row({ id: 'd', assigneeId: 'tm1', status: 'done', title: 'Delta' }),
    ]
    const out = applyTaskViews(rows, {
      savedView: 'mine',
      filters: DEFAULT_TASK_FILTERS,
      query: '',
      sort: DEFAULT_TASKS_SORT,
      assigneeId: 'tm1',
      now: NOW,
    })
    expect(out.map(r => r.id)).toEqual(['b', 'a'])
  })
})

describe('snapshots', () => {
  const snap = {
    view: 'board' as const,
    savedView: 'overdue',
    filters: DEFAULT_TASK_FILTERS,
    sort: DEFAULT_TASKS_SORT,
  }

  it('validates a good snapshot and rejects a bad one', () => {
    expect(isTasksSnapshot(snap)).toBe(true)
    expect(isTasksSnapshot({ ...snap, view: 'timeline' })).toBe(false)
    expect(isTasksSnapshot(null)).toBe(false)
  })

  it('accepts the legacy my_work view inside a stored snapshot', () => {
    expect(isTasksSnapshot({ ...snap, view: 'my_work' })).toBe(true)
  })

  it('compares every dimension', () => {
    expect(tasksSnapshotsEqual(snap, snap)).toBe(true)
    expect(tasksSnapshotsEqual(snap, { ...snap, savedView: null })).toBe(false)
    expect(tasksSnapshotsEqual(snap, { ...snap, sort: { key: 'title', dir: 'asc' } })).toBe(false)
    expect(tasksSnapshotsEqual(null, snap)).toBe(false)
  })
})

describe('legacy migrations', () => {
  it('moves my_work onto the week view with the mine saved view', () => {
    expect(migrateLegacyTaskViewMode('my_work')).toEqual({ view: 'week', savedView: 'mine' })
    expect(migrateLegacyTaskViewMode('board')).toEqual({ view: 'board', savedView: null })
    expect(migrateLegacyTaskViewMode('nonsense')).toBeNull()
  })

  it('maps the old type tab onto a saved view', () => {
    expect(migrateLegacyTaskTypeTab('for_client')).toBe('client_linked')
    expect(migrateLegacyTaskTypeTab('for_us')).toBe('internal')
    expect(migrateLegacyTaskTypeTab('all')).toBeNull()
  })

  it('maps the old status tab onto the status filter', () => {
    expect(migrateLegacyTaskStatusTab('blocked')).toBe('blocked')
    expect(migrateLegacyTaskStatusTab('all')).toBeNull()
    expect(migrateLegacyTaskStatusTab('nonsense')).toBeNull()
  })
})

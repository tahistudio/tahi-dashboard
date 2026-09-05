/**
 * lib/tasks-views.ts
 *
 * The pure vocabulary behind the Tasks rail: three peer views, seven saved
 * views, six filter dimensions, four sort keys, and the shapes persisted per
 * user. Structural twin of lib/requests-views.ts, deliberately a separate
 * file rather than a shared generic: the two surfaces share a shape, not a
 * vocabulary, and one parameterised module would be worse than two readable
 * ones.
 *
 * Everything is a plain function over plain data so it runs in the node
 * Vitest environment. Dates compare as YYYY-MM-DD day keys derived from a
 * caller-supplied `now`, which keeps "overdue" free of timezone drift.
 *
 * Tasks are the studio's own list. There is no client audience here, so
 * nothing in this file branches on one.
 */

import { TASK_CLOSED_STATUSES, TASK_STATUSES } from '@/lib/status-config'

// -- Row shape ---------------------------------------------------------------

/** The subset of a task the rail reasons about. The API's enriched row is a
 *  structural superset, so it satisfies this without a cast. */
export interface TaskRow {
  id: string
  title: string
  /** client_task | internal_client_task | tahi_internal */
  type: string
  status: string
  priority: string
  orgId: string | null
  orgName: string | null
  requestId: string | null
  assigneeId: string | null
  dueDate: string | null
  completedAt: string | null
  description: string | null
  estimatedHours: number | null
  createdAt: string | null
  updatedAt: string | null
  subtaskCount?: number
  subtaskDone?: number
  blockedByCount?: number
}

// -- Levels ------------------------------------------------------------------

export type TaskLevel = 'client_task' | 'internal_client_task' | 'tahi_internal'

/** The three-level model, in the prototype's words. `hint` is both the
 *  segmented control's tooltip and the line under the Links card. */
export const TASK_LEVELS: readonly { value: TaskLevel; label: string; hint: string }[] = [
  { value: 'client_task',          label: 'Client',   hint: 'Work for a client. Can become a request.' },
  { value: 'internal_client_task', label: 'Internal', hint: 'About a client, but only the studio sees it.' },
  { value: 'tahi_internal',        label: 'Tahi',     hint: 'Studio housekeeping. No client involved.' },
]

export const TASK_LEVEL_LABELS: Record<string, string> = Object.fromEntries(
  TASK_LEVELS.map(l => [l.value, l.label] as [string, string]),
)

export const TASK_LEVEL_HINTS: Record<string, string> = Object.fromEntries(
  TASK_LEVELS.map(l => [l.value, l.hint] as [string, string]),
)

export function isTaskLevel(value: unknown): value is TaskLevel {
  return TASK_LEVELS.some(l => l.value === value)
}

/** A row whose stored type is missing or unknown still has to land on a chip.
 *  The client link is the tiebreak, matching Decision #046's reading. */
export function levelOf(row: Pick<TaskRow, 'type' | 'orgId'>): TaskLevel {
  if (isTaskLevel(row.type)) return row.type
  return row.orgId ? 'client_task' : 'tahi_internal'
}

// -- Views -------------------------------------------------------------------

export type TasksViewKey = 'list' | 'board' | 'week'

export const TASKS_VIEW_KEYS: readonly TasksViewKey[] = ['list', 'board', 'week']

/** Read a stored view key back safely. The pre-rail `tasks.viewMode` held
 *  'my_work' for what is now My week, so that value migrates rather than
 *  resetting the user. */
export function normaliseTasksViewKey(value: unknown): TasksViewKey {
  const raw = value === 'my_work' ? 'week' : value
  return (TASKS_VIEW_KEYS as readonly unknown[]).includes(raw) ? (raw as TasksViewKey) : 'list'
}

// -- Statuses that sink ------------------------------------------------------

/** A finished task has no deadline worth toning, and always sorts last. Owned
 *  by lib/status-config.ts next to the vocabulary it belongs to, and
 *  re-exported here so a caller of this module never needs a second import to
 *  read one rule. */
export { TASK_CLOSED_STATUSES }

// -- Day-key helpers ---------------------------------------------------------

/** Local YYYY-MM-DD for a Date. Matches how `dueDate` is stored (a date, not
 *  an instant), so the two compare as plain strings with no timezone maths. */
export function taskDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Local YYYY-MM-DD `days` from `date`, negative for the past. */
export function taskShiftedDayKey(date: Date, days: number): string {
  return taskDayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

function dueOf(row: TaskRow): string | null {
  return row.dueDate ? row.dueDate.slice(0, 10) : null
}

export function isTaskOverdue(row: TaskRow, now: Date): boolean {
  const d = dueOf(row)
  if (!d || TASK_CLOSED_STATUSES.includes(row.status)) return false
  return d < taskDayKey(now)
}

export function isTaskDueWithin(row: TaskRow, days: number, now: Date): boolean {
  const d = dueOf(row)
  if (!d || TASK_CLOSED_STATUSES.includes(row.status)) return false
  return d >= taskDayKey(now) && d <= taskShiftedDayKey(now, days)
}

/** Blocked in the sense the rail reads it: the status, or an open blocker.
 *  The `blocked` saved view, the rail's Blocked count and the Tick's dashed
 *  ring all use this one wider reading, so clicking a count of seven cannot
 *  produce a list of three. The BOARD's Blocked column is the one place that
 *  stays narrow (`status === 'blocked'`), because dropping a card into it
 *  writes that status and a column has to mean the value it writes. */
export function isTaskBlocked(row: TaskRow): boolean {
  return row.status === 'blocked' || (row.blockedByCount ?? 0) > 0
}

// -- Saved views -------------------------------------------------------------

export interface TaskViewContext {
  /** The viewer's team member id, for "Assigned to me". */
  assigneeId?: string | null
  /** Injected for deterministic date predicates. Defaults to the wall clock. */
  now?: Date
}

export interface TasksSavedView {
  key: string
  label: string
  test: (row: TaskRow, ctx: TaskViewContext) => boolean
}

/** The prototype's seven, with keys spelled out so `due_week` cannot be read
 *  as the `week` VIEW key. */
export const TASKS_SAVED_VIEWS: readonly TasksSavedView[] = [
  { key: 'mine',          label: 'Assigned to me', test: (r, c) => !!c.assigneeId && r.assigneeId === c.assigneeId && r.status !== 'done' },
  { key: 'due_week',      label: 'Due this week',  test: (r, c) => isTaskDueWithin(r, 7, c.now ?? new Date()) },
  { key: 'overdue',       label: 'Overdue',        test: (r, c) => isTaskOverdue(r, c.now ?? new Date()) },
  { key: 'blocked',       label: 'Blocked',        test: r => isTaskBlocked(r) },
  { key: 'client_linked', label: 'Client-linked',  test: r => !!r.orgId },
  { key: 'internal',      label: 'Internal',       test: r => levelOf(r) !== 'client_task' },
  { key: 'done',          label: 'Done',           test: r => r.status === 'done' },
]

export function matchesTasksSavedView(
  row: TaskRow,
  key: string | null,
  ctx: TaskViewContext = {},
): boolean {
  if (!key) return true
  const view = TASKS_SAVED_VIEWS.find(v => v.key === key)
  return view ? view.test(row, ctx) : true
}

/** Live counts for the rail: one per saved view, plus `__all`. */
export function countTasksSavedViews(
  rows: readonly TaskRow[],
  ctx: TaskViewContext = {},
): Record<string, number> {
  const counts: Record<string, number> = { __all: rows.length }
  for (const view of TASKS_SAVED_VIEWS) {
    let n = 0
    for (const row of rows) if (view.test(row, ctx)) n += 1
    counts[view.key] = n
  }
  return counts
}

// -- Filters -----------------------------------------------------------------

export interface TasksFilters {
  status: string
  priority: string
  level: string
  client: string
  assignee: string
  due: string
}

export const TASK_FILTER_KEYS = ['status', 'priority', 'level', 'client', 'assignee', 'due'] as const
export type TaskFilterKey = (typeof TASK_FILTER_KEYS)[number]

export const DEFAULT_TASK_FILTERS: TasksFilters = {
  status: 'all',
  priority: 'all',
  level: 'all',
  client: 'all',
  assignee: 'all',
  due: 'any',
}

export const TASK_DIMENSION_LABELS: Record<TaskFilterKey, string> = {
  status: 'Status',
  priority: 'Priority',
  level: 'Level',
  client: 'Client',
  assignee: 'Assignee',
  due: 'Due',
}

export interface TaskFilterOption {
  value: string
  label: string
}

export const LEVEL_FILTER_OPTIONS: readonly TaskFilterOption[] = [
  { value: 'all', label: 'All levels' },
  ...TASK_LEVELS.map(l => ({ value: l.value, label: l.label })),
]

export const PRIORITY_FILTER_OPTIONS: readonly TaskFilterOption[] = [
  { value: 'all',      label: 'All priorities' },
  { value: 'urgent',   label: 'Urgent'   },
  { value: 'high',     label: 'High'     },
  { value: 'standard', label: 'Standard' },
]

export const DUE_FILTER_OPTIONS: readonly TaskFilterOption[] = [
  { value: 'any',     label: 'Any time'  },
  { value: 'overdue', label: 'Overdue'   },
  { value: 'today',   label: 'Today'     },
  { value: 'week',    label: 'This week' },
  { value: 'later',   label: 'Later'     },
  { value: 'none',    label: 'No date'   },
]

export function isTaskFilterActive(filters: TasksFilters, key: TaskFilterKey): boolean {
  return filters[key] !== DEFAULT_TASK_FILTERS[key]
}

export function activeTaskFilterKeys(filters: TasksFilters): TaskFilterKey[] {
  return TASK_FILTER_KEYS.filter(k => isTaskFilterActive(filters, k))
}

export function anyTaskFilterActive(filters: TasksFilters): boolean {
  return activeTaskFilterKeys(filters).length > 0
}

export function matchesTaskFilters(
  row: TaskRow,
  filters: TasksFilters,
  now: Date = new Date(),
): boolean {
  if (filters.status !== 'all' && row.status !== filters.status) return false
  if (filters.priority !== 'all' && row.priority !== filters.priority) return false
  if (filters.level !== 'all' && levelOf(row) !== filters.level) return false

  if (filters.client === 'none') {
    if (row.orgId) return false
  } else if (filters.client !== 'all' && (row.orgId ?? '') !== filters.client) {
    return false
  }

  if (filters.assignee === 'none') {
    if (row.assigneeId) return false
  } else if (filters.assignee !== 'all' && (row.assigneeId ?? '') !== filters.assignee) {
    return false
  }

  if (filters.due !== 'any') {
    const d = dueOf(row)
    const today = taskDayKey(now)
    // Every dated bucket reads through the same closed-status guard the
    // Overdue and Due this week SAVED VIEWS use, so the rail cannot answer
    // one question two ways: a done task with a past date is not overdue on
    // the chip either. `none` is the exception, because "no date" is true
    // whatever the status.
    const open = !TASK_CLOSED_STATUSES.includes(row.status)
    switch (filters.due) {
      case 'none':    return d === null
      case 'overdue': return isTaskOverdue(row, now)
      case 'today':   return open && d === today
      case 'week':    return isTaskDueWithin(row, 7, now)
      case 'later':   return open && d !== null && d > taskShiftedDayKey(now, 7)
      default:        return true
    }
  }

  return true
}

// -- Search ------------------------------------------------------------------

/** Title, client name and the note. The prototype also searched the request
 *  number, which the row does not carry; the request link on the row covers
 *  that case by being clickable instead. */
export function matchesTaskQuery(row: TaskRow, query: string): boolean {
  const term = query.trim().toLowerCase()
  if (!term) return true
  return `${row.title} ${row.orgName ?? ''} ${row.description ?? ''}`.toLowerCase().includes(term)
}

// -- Sort --------------------------------------------------------------------

export type TasksSortKey = 'due' | 'priority' | 'updated' | 'title'
export type TasksSortDir = 'asc' | 'desc'

export interface TasksSort {
  key: TasksSortKey
  dir: TasksSortDir
}

export const DEFAULT_TASKS_SORT: TasksSort = { key: 'due', dir: 'asc' }

export const TASK_SORT_KEYS: readonly { value: TasksSortKey; label: string }[] = [
  { value: 'due',      label: 'Due'      },
  { value: 'priority', label: 'Priority' },
  { value: 'updated',  label: 'Updated'  },
  { value: 'title',    label: 'Title'    },
]

/** Direction reads differently per key, so the toggle says what it will do.
 *  [asc, desc]. */
const TASK_SORT_DIR_LABELS: Record<TasksSortKey, readonly [string, string]> = {
  due:      ['Soonest first', 'Latest first'],
  priority: ['Highest first', 'Lowest first'],
  updated:  ['Newest first',  'Oldest first'],
  title:    ['A to Z',        'Z to A'],
}

export function taskSortKeyLabel(sort: TasksSort): string {
  return TASK_SORT_KEYS.find(k => k.value === sort.key)?.label ?? 'Due'
}

export function taskSortDirLabel(sort: TasksSort): string {
  const pair = TASK_SORT_DIR_LABELS[sort.key] ?? TASK_SORT_DIR_LABELS.due
  return sort.dir === 'desc' ? pair[1] : pair[0]
}

/** Repo scale only. Anything unknown ranks with standard rather than sinking
 *  to the bottom, so a legacy `low` row still sorts sanely. */
const TASK_PRIORITY_RANK: Record<string, number> = {
  urgent: 3, high: 2, standard: 1,
}

const NO_DUE_DATE = '9999-12-31'

function taskDueValue(row: TaskRow): string {
  return dueOf(row) ?? NO_DUE_DATE
}

function taskSortValue(row: TaskRow, key: TasksSortKey): string | number {
  if (key === 'updated') {
    // Negated so the newest timestamp is the smallest value: ascending then
    // reads as "Newest first", which is what the direction label promises.
    if (!row.updatedAt) return Number.MAX_SAFE_INTEGER
    const t = Date.parse(row.updatedAt)
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : -t
  }
  if (key === 'priority') {
    return -(TASK_PRIORITY_RANK[row.priority] ?? TASK_PRIORITY_RANK.standard)
  }
  if (key === 'title') return row.title.toLowerCase()
  return taskDueValue(row)
}

/** Done always sinks below open work, whatever the key or direction. Ties
 *  break on the due date. */
export function compareTasks(a: TaskRow, b: TaskRow, sort: TasksSort = DEFAULT_TASKS_SORT): number {
  const rank = (r: TaskRow) => (TASK_CLOSED_STATUSES.includes(r.status) ? 1 : 0)
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank

  const va = taskSortValue(a, sort.key)
  const vb = taskSortValue(b, sort.key)
  let d = typeof va === 'string' && typeof vb === 'string'
    ? va.localeCompare(vb)
    : Number(va) - Number(vb)
  if (sort.dir === 'desc') d = -d
  if (d !== 0) return d

  return taskDueValue(a).localeCompare(taskDueValue(b))
}

/** A sorted copy. Never mutates the caller's array. */
export function sortTasks<T extends TaskRow>(rows: readonly T[], sort: TasksSort = DEFAULT_TASKS_SORT): T[] {
  return rows.slice().sort((a, b) => compareTasks(a, b, sort))
}

// -- The whole pipeline ------------------------------------------------------

export interface TasksViewState {
  savedView: string | null
  filters: TasksFilters
  query: string
  sort: TasksSort
  assigneeId?: string | null
  now?: Date
}

/** Saved view, then filters, then search, then sort. One call so the list and
 *  the board render exactly the same set. My week deliberately does not use
 *  this: it always shows your own open plate. */
export function applyTaskViews<T extends TaskRow>(rows: readonly T[], state: TasksViewState): T[] {
  const now = state.now ?? new Date()
  const ctx: TaskViewContext = { assigneeId: state.assigneeId, now }
  const kept = rows.filter(row =>
    matchesTasksSavedView(row, state.savedView, ctx)
    && matchesTaskFilters(row, state.filters, now)
    && matchesTaskQuery(row, state.query),
  )
  return sortTasks(kept, state.sort)
}

// -- Persisted shapes --------------------------------------------------------

export interface TasksSnapshot {
  view: TasksViewKey
  savedView: string | null
  filters: TasksFilters
  sort: TasksSort
}

export function isTasksFilters(value: unknown): value is TasksFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return TASK_FILTER_KEYS.every(k => typeof o[k] === 'string')
}

export function isTasksSort(value: unknown): value is TasksSort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const knownKey = TASK_SORT_KEYS.some(k => k.value === o.key)
  return knownKey && (o.dir === 'asc' || o.dir === 'desc')
}

export function isTasksSnapshot(value: unknown): value is TasksSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const viewOk = o.view === 'my_work' || (TASKS_VIEW_KEYS as readonly unknown[]).includes(o.view)
  const savedOk = o.savedView === null || typeof o.savedView === 'string'
  return viewOk && savedOk && isTasksFilters(o.filters) && isTasksSort(o.sort)
}

/** True when the live state is exactly what the user saved as their default,
 *  which is what flips the rail from "Save as default" to "Your default". */
export function tasksSnapshotsEqual(a: TasksSnapshot | null, b: TasksSnapshot | null): boolean {
  if (!a || !b) return false
  if (normaliseTasksViewKey(a.view) !== normaliseTasksViewKey(b.view)) return false
  if ((a.savedView ?? null) !== (b.savedView ?? null)) return false
  for (const k of TASK_FILTER_KEYS) {
    if ((a.filters[k] ?? DEFAULT_TASK_FILTERS[k]) !== (b.filters[k] ?? DEFAULT_TASK_FILTERS[k])) return false
  }
  return a.sort.key === b.sort.key && a.sort.dir === b.sort.dir
}

// -- Migration off the pre-rail keys -----------------------------------------

/** `tasks.viewMode` held 'my_work' | 'list' | 'board'. My Work was a lens as
 *  much as a view, so it carries a saved view across with it. */
export function migrateLegacyTaskViewMode(
  mode: unknown,
): { view: TasksViewKey; savedView: string | null } | null {
  switch (mode) {
    case 'my_work': return { view: 'week',  savedView: 'mine' }
    case 'list':    return { view: 'list',  savedView: null   }
    case 'board':   return { view: 'board', savedView: null   }
    default:        return null
  }
}

/** `tasks.typeTab` held 'all' | 'for_us' | 'for_client'. The rail replaced
 *  the tabs with saved views. */
export function migrateLegacyTaskTypeTab(tab: unknown): string | null {
  switch (tab) {
    case 'for_client': return 'client_linked'
    case 'for_us':     return 'internal'
    default:           return null
  }
}

/** `tasks.statusTab` held a server status filter, which is now a rail
 *  dimension rather than a tab. Validated against the one status vocabulary
 *  rather than a fourth copy of the list. */
export function migrateLegacyTaskStatusTab(tab: unknown): string | null {
  if (typeof tab !== 'string') return null
  return TASK_STATUSES.some(s => s.value === tab) ? tab : null
}

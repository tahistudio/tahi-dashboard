/**
 * lib/requests-views.ts
 *
 * The pure vocabulary behind the Requests rail: the four peer views, the
 * saved-view predicates for each audience, the five filter dimensions, the
 * sort comparators, and the shapes we persist per user.
 *
 * Everything here is a plain function over plain data so it runs under the
 * node Vitest environment and can be reasoned about without React. The rail
 * components import the option lists; `request-list.tsx` imports
 * `applyRequestViews` to turn a fetched page of requests into the rows the
 * list, board, workload and timeline all render.
 *
 * Dates are compared as YYYY-MM-DD day keys derived from a caller-supplied
 * `now`, which keeps "overdue" and "due this week" free of timezone drift and
 * makes every predicate deterministic under test.
 */

// ── Row shape ────────────────────────────────────────────────────────────────

/** The subset of a request the rail reasons about. The list's own `Request`
 *  interface is a structural superset, so it satisfies this without a cast. */
export interface RequestRow {
  id: string
  title: string
  status: string
  type: string
  category: string | null
  priority: string | null
  dueDate: string | null
  createdAt: string | null
  updatedAt: string | null
  orgId?: string | null
  orgName?: string | null
  assigneeId?: string | null
  requestNumber?: number | null
  /** Open blockers, counted by the list route. Absent on rows fetched by an
   *  older caller, which reads as not blocked. Never present on a portal
   *  payload: a client does not see a blocker, not even the count. */
  blockedByCount?: number
}

/** Who is looking. `admin` is the Tahi org, `team_member` is a scoped
 *  teammate (the only audience with an "Assigned to me" view), `client` is
 *  the portal. */
export type RequestsAudience = 'admin' | 'team_member' | 'client'

// ── Views ────────────────────────────────────────────────────────────────────

export type RequestsViewKey = 'list' | 'kanban' | 'workload' | 'timeline'

export const REQUESTS_VIEW_KEYS: readonly RequestsViewKey[] = ['list', 'kanban', 'workload', 'timeline']

/** Read a stored view key back safely. The round-one prototype and the
 *  pre-rail `requests.viewMode` preference both stored 'board' for what is
 *  now Kanban, so that value migrates rather than resetting the user. */
export function normaliseViewKey(value: unknown, audience: RequestsAudience): RequestsViewKey {
  const raw = value === 'board' ? 'kanban' : value
  const key = (REQUESTS_VIEW_KEYS as readonly unknown[]).includes(raw)
    ? (raw as RequestsViewKey)
    : 'list'
  if (key === 'workload' && audience !== 'admin') return 'list'
  return key
}

// ── Statuses that sink ───────────────────────────────────────────────────────

/** Statuses that always sort below open work, and that "All active" hides. */
export const TAIL_STATUSES: readonly string[] = ['draft', 'delivered', 'cancelled', 'archived']

/** Statuses where a due date stops meaning anything: a delivered request is
 *  never overdue, however long ago it was due. */
export const CLOSED_STATUSES: readonly string[] = ['delivered', 'cancelled', 'archived']

// ── Day-key helpers ──────────────────────────────────────────────────────────

/** Local YYYY-MM-DD for a Date. Matches how `dueDate` is stored (a date, not
 *  an instant), so the two compare as plain strings with no timezone maths. */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Local YYYY-MM-DD `days` from `date`, negative for the past. */
function shiftedDayKey(date: Date, days: number): string {
  return dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
}

/** Past its due date and still open. */
export function isOverdue(row: RequestRow, now: Date): boolean {
  if (!row.dueDate || CLOSED_STATUSES.includes(row.status)) return false
  return row.dueDate < dayKey(now)
}

/** Due today through `days` days out, inclusive, and still open. */
export function isDueWithin(row: RequestRow, days: number, now: Date): boolean {
  if (!row.dueDate || CLOSED_STATUSES.includes(row.status)) return false
  return row.dueDate >= dayKey(now) && row.dueDate <= shiftedDayKey(now, days)
}

// ── Blocked ──────────────────────────────────────────────────────────────────

/** Blocked in the sense the rail reads it. A request has no `blocked` status
 *  of its own (`on_hold` is a human decision, not a derived one), so unlike
 *  the tasks predicate this is only ever the count. */
export function isRequestBlocked(row: RequestRow): boolean {
  return (row.blockedByCount ?? 0) > 0
}

// ── Saved views ──────────────────────────────────────────────────────────────

export interface SavedViewContext {
  /** The viewer's team member id, for "Assigned to me". */
  assigneeId?: string | null
  /** Injected for deterministic date predicates. Defaults to the wall clock. */
  now?: Date
}

export interface RequestsSavedView {
  key: string
  label: string
  test: (row: RequestRow, ctx: SavedViewContext) => boolean
}

const CLIENT_ACTIVE_STATUSES = ['submitted', 'in_review', 'in_progress']

/** The team vocabulary. "Assigned to me" is filtered out for admins, who see
 *  everyone's work and have the Workload view for the per-person cut. */
export const TEAM_SAVED_VIEWS: readonly RequestsSavedView[] = [
  { key: 'active',    label: 'All active',      test: r => !TAIL_STATUSES.includes(r.status) },
  { key: 'triage',    label: 'Triage',          test: r => r.status === 'submitted' },
  { key: 'mine',      label: 'Assigned to me',  test: (r, c) => !!c.assigneeId && r.assigneeId === c.assigneeId },
  { key: 'overdue',   label: 'Overdue',         test: (r, c) => isOverdue(r, c.now ?? new Date()) },
  { key: 'blocked',   label: 'Blocked',         test: r => isRequestBlocked(r) },
  { key: 'week',      label: 'Due this week',   test: (r, c) => isDueWithin(r, 7, c.now ?? new Date()) },
  { key: 'awaiting',  label: 'Awaiting client', test: r => r.status === 'client_review' },
  { key: 'delivered', label: 'Delivered',       test: r => r.status === 'delivered' },
]

/** The client vocabulary: the same ideas in the client's own language. Keys
 *  are shared with the team set where the meaning matches, so a saved default
 *  survives an audience switch (an impersonation, say). */
export const CLIENT_SAVED_VIEWS: readonly RequestsSavedView[] = [
  { key: 'active',    label: 'In progress',    test: r => CLIENT_ACTIVE_STATUSES.includes(r.status) },
  { key: 'awaiting',  label: 'Waiting on you', test: r => r.status === 'client_review' },
  { key: 'delivered', label: 'Delivered',      test: r => r.status === 'delivered' },
]

export function savedViewsFor(audience: RequestsAudience): readonly RequestsSavedView[] {
  if (audience === 'client') return CLIENT_SAVED_VIEWS
  return TEAM_SAVED_VIEWS.filter(v => v.key !== 'mine' || audience === 'team_member')
}

/** True when the row belongs in the saved view. A null key (All requests) or
 *  a key this audience does not have both mean "no narrowing". */
export function matchesSavedView(
  row: RequestRow,
  key: string | null,
  audience: RequestsAudience,
  ctx: SavedViewContext = {},
): boolean {
  if (!key) return true
  const view = savedViewsFor(audience).find(v => v.key === key)
  return view ? view.test(row, ctx) : true
}

/** Live counts for the rail: one per saved view in the audience set, plus
 *  `__all` for the All requests row. */
export function countSavedViews(
  rows: readonly RequestRow[],
  audience: RequestsAudience,
  ctx: SavedViewContext = {},
): Record<string, number> {
  const counts: Record<string, number> = { __all: rows.length }
  for (const view of savedViewsFor(audience)) {
    let n = 0
    for (const row of rows) if (view.test(row, ctx)) n += 1
    counts[view.key] = n
  }
  return counts
}

// ── Filters ──────────────────────────────────────────────────────────────────

export interface RequestsFilters {
  status: string
  category: string
  client: string
  type: string
  created: string
}

export const REQUEST_FILTER_KEYS = ['status', 'category', 'client', 'type', 'created'] as const
export type RequestFilterKey = (typeof REQUEST_FILTER_KEYS)[number]

export const DEFAULT_REQUEST_FILTERS: RequestsFilters = {
  status: 'all',
  category: 'all',
  client: 'all',
  type: 'all',
  created: 'any',
}

export interface FilterOption {
  value: string
  label: string
}

/** Request type, in the words a client uses about it. */
export const TYPE_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: 'all',        label: 'All types'      },
  { value: 'small_task', label: '1 day or less'  },
  { value: 'large_task', label: 'Multi-day'      },
]

export const CREATED_FILTER_OPTIONS: readonly FilterOption[] = [
  { value: 'any', label: 'Any time'     },
  { value: '7',   label: 'Last 7 days'  },
  { value: '30',  label: 'Last 30 days' },
  { value: '90',  label: 'Last 90 days' },
]

/** Which dimensions this audience gets a control for. Only Tahi sees a
 *  client picker; a portal user has exactly one client. */
export function filterKeysFor(audience: RequestsAudience): readonly RequestFilterKey[] {
  if (audience === 'admin') return REQUEST_FILTER_KEYS
  return REQUEST_FILTER_KEYS.filter(k => k !== 'client')
}

export function isFilterActive(filters: RequestsFilters, key: RequestFilterKey): boolean {
  return filters[key] !== DEFAULT_REQUEST_FILTERS[key]
}

/** The active dimensions in display order, optionally narrowed to the ones
 *  the audience can see (so a stale client filter raises no chip). */
export function activeFilterKeys(
  filters: RequestsFilters,
  audience?: RequestsAudience,
): RequestFilterKey[] {
  const keys = audience ? filterKeysFor(audience) : REQUEST_FILTER_KEYS
  return keys.filter(k => isFilterActive(filters, k))
}

export function anyFilterActive(filters: RequestsFilters, audience?: RequestsAudience): boolean {
  return activeFilterKeys(filters, audience).length > 0
}

export function matchesFilters(
  row: RequestRow,
  filters: RequestsFilters,
  now: Date = new Date(),
): boolean {
  if (filters.status !== 'all' && row.status !== filters.status) return false
  if (filters.category !== 'all' && (row.category ?? '') !== filters.category) return false
  if (filters.client !== 'all' && (row.orgId ?? '') !== filters.client) return false
  if (filters.type !== 'all' && row.type !== filters.type) return false
  if (filters.created !== 'any') {
    const days = Number.parseInt(filters.created, 10)
    if (Number.isFinite(days)) {
      if (!row.createdAt) return false
      if (row.createdAt.slice(0, 10) < shiftedDayKey(now, -days)) return false
    }
  }
  return true
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Title, client name, and both spellings of the request number, so "42" and
 *  "042" find the same row. */
export function matchesQuery(row: RequestRow, query: string): boolean {
  const term = query.trim().toLowerCase()
  if (!term) return true
  const number = row.requestNumber != null
    ? `${row.requestNumber} ${String(row.requestNumber).padStart(3, '0')}`
    : ''
  return `${row.title} ${number} ${row.orgName ?? ''}`.toLowerCase().includes(term)
}

// ── Sort ─────────────────────────────────────────────────────────────────────

export type RequestsSortKey = 'due' | 'updated' | 'created' | 'priority' | 'client'
export type RequestsSortDir = 'asc' | 'desc'

export interface RequestsSort {
  key: RequestsSortKey
  dir: RequestsSortDir
}

export const DEFAULT_REQUEST_SORT: RequestsSort = { key: 'due', dir: 'asc' }

export const REQUEST_SORT_KEYS: readonly { value: RequestsSortKey; label: string }[] = [
  { value: 'due',      label: 'Due'      },
  { value: 'updated',  label: 'Updated'  },
  { value: 'created',  label: 'Created'  },
  { value: 'priority', label: 'Priority' },
  { value: 'client',   label: 'Client'   },
]

/** Direction reads differently per key, so the toggle says what it will do
 *  rather than "ascending". [asc, desc]. */
const SORT_DIR_LABELS: Record<RequestsSortKey, readonly [string, string]> = {
  due:      ['Soonest first', 'Latest first'],
  updated:  ['Newest first',  'Oldest first'],
  created:  ['Newest first',  'Oldest first'],
  priority: ['Highest first', 'Lowest first'],
  client:   ['A to Z',        'Z to A'],
}

export function sortKeyLabel(sort: RequestsSort): string {
  return REQUEST_SORT_KEYS.find(k => k.value === sort.key)?.label ?? 'Due'
}

export function sortDirLabel(sort: RequestsSort): string {
  const pair = SORT_DIR_LABELS[sort.key] ?? SORT_DIR_LABELS.due
  return sort.dir === 'desc' ? pair[1] : pair[0]
}

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4, high: 3, standard: 2, medium: 2, low: 1, none: 0,
}

/** Sorts after every real date, so a request with no due date lands last
 *  under the default ascending order. */
const NO_DUE_DATE = '9999-12-31'

function dueValue(row: RequestRow): string {
  return row.dueDate ?? NO_DUE_DATE
}

function sortValue(row: RequestRow, key: RequestsSortKey): string | number {
  if (key === 'updated' || key === 'created') {
    // Negated so the newest timestamp is the smallest value: ascending then
    // reads as "Newest first", which is what the direction label promises.
    // An unparseable or missing stamp sorts last either way.
    const raw = key === 'created' ? row.createdAt : row.updatedAt
    if (!raw) return Number.MAX_SAFE_INTEGER
    const t = Date.parse(raw)
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : -t
  }
  if (key === 'priority') {
    return -(PRIORITY_RANK[row.priority ?? 'standard'] ?? PRIORITY_RANK.standard)
  }
  if (key === 'client') {
    // U+FFFF sorts after every ordinary name, so "no client" lands last.
    return (row.orgName ?? '').toLowerCase() || '￿'
  }
  return dueValue(row)
}

/** Delivered, cancelled, archived and draft always sink below open work,
 *  whatever the key or direction. Ties break on the due date. */
export function compareRequests(
  a: RequestRow,
  b: RequestRow,
  sort: RequestsSort = DEFAULT_REQUEST_SORT,
): number {
  const rank = (r: RequestRow) => (TAIL_STATUSES.includes(r.status) ? 1 : 0)
  const byRank = rank(a) - rank(b)
  if (byRank !== 0) return byRank

  const va = sortValue(a, sort.key)
  const vb = sortValue(b, sort.key)
  let d = typeof va === 'string' && typeof vb === 'string'
    ? va.localeCompare(vb)
    : Number(va) - Number(vb)
  if (sort.dir === 'desc') d = -d
  if (d !== 0) return d

  return dueValue(a).localeCompare(dueValue(b))
}

/** A sorted copy. Never mutates the caller's array. */
export function sortRequests<T extends RequestRow>(
  rows: readonly T[],
  sort: RequestsSort = DEFAULT_REQUEST_SORT,
): T[] {
  return rows.slice().sort((a, b) => compareRequests(a, b, sort))
}

// ── The whole pipeline ───────────────────────────────────────────────────────

export interface RequestsViewState {
  audience: RequestsAudience
  savedView: string | null
  filters: RequestsFilters
  query: string
  sort: RequestsSort
  /** The viewer's team member id, for the "Assigned to me" view. */
  assigneeId?: string | null
  now?: Date
}

/** Saved view, then filters, then search, then sort. One call so the list,
 *  board, workload and timeline all render exactly the same set. */
export function applyRequestViews<T extends RequestRow>(
  rows: readonly T[],
  state: RequestsViewState,
): T[] {
  const now = state.now ?? new Date()
  const ctx: SavedViewContext = { assigneeId: state.assigneeId, now }
  const kept = rows.filter(row =>
    matchesSavedView(row, state.savedView, state.audience, ctx)
    && matchesFilters(row, state.filters, now)
    && matchesQuery(row, state.query),
  )
  return sortRequests(kept, state.sort)
}

// ── Persisted shapes ─────────────────────────────────────────────────────────

export interface RequestsSnapshot {
  view: RequestsViewKey
  savedView: string | null
  filters: RequestsFilters
  sort: RequestsSort
}

export function isRequestsFilters(value: unknown): value is RequestsFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return REQUEST_FILTER_KEYS.every(k => typeof o[k] === 'string')
}

export function isRequestsSort(value: unknown): value is RequestsSort {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const knownKey = REQUEST_SORT_KEYS.some(k => k.value === o.key)
  return knownKey && (o.dir === 'asc' || o.dir === 'desc')
}

export function isRequestsSnapshot(value: unknown): value is RequestsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  const viewOk = o.view === 'board' || (REQUESTS_VIEW_KEYS as readonly unknown[]).includes(o.view)
  const savedOk = o.savedView === null || typeof o.savedView === 'string'
  return viewOk && savedOk && isRequestsFilters(o.filters) && isRequestsSort(o.sort)
}

/** True when the live state is exactly what the user saved as their default,
 *  which is what flips the rail from a "Save as default" button to the quiet
 *  "Your default" line. */
export function snapshotsEqual(
  a: RequestsSnapshot | null,
  b: RequestsSnapshot | null,
): boolean {
  if (!a || !b) return false
  const view = (s: RequestsSnapshot) => (s.view as string) === 'board' ? 'kanban' : s.view
  if (view(a) !== view(b)) return false
  if ((a.savedView ?? null) !== (b.savedView ?? null)) return false
  for (const k of REQUEST_FILTER_KEYS) {
    if ((a.filters[k] ?? DEFAULT_REQUEST_FILTERS[k]) !== (b.filters[k] ?? DEFAULT_REQUEST_FILTERS[k])) return false
  }
  return a.sort.key === b.sort.key && a.sort.dir === b.sort.dir
}

// ── Migration off the pre-rail keys ──────────────────────────────────────────

/** `requests.activeTab` held a server status filter. The rail replaced it
 *  with saved views, so the four tabs that have a peer carry over and the
 *  rest land on All requests. */
export function migrateLegacyTab(tab: unknown): string | null {
  switch (tab) {
    case 'active':        return 'active'
    case 'submitted':     return 'triage'
    case 'client_review': return 'awaiting'
    case 'delivered':     return 'delivered'
    default:              return null
  }
}

/** `requests.sortKey` held a column name. "status" has no peer in the new
 *  four-key vocabulary, so it migrates to nothing and the default applies. */
export function migrateLegacySortKey(key: unknown): RequestsSort | null {
  switch (key) {
    case 'dueDate':   return { key: 'due',      dir: 'asc' }
    case 'updatedAt': return { key: 'updated',  dir: 'asc' }
    case 'priority':  return { key: 'priority', dir: 'asc' }
    default:          return null
  }
}

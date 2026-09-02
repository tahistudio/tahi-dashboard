import { describe, it, expect } from 'vitest'
import {
  REQUESTS_VIEW_KEYS,
  normaliseViewKey,
  DEFAULT_REQUEST_FILTERS,
  DEFAULT_REQUEST_SORT,
  TAIL_STATUSES,
  TEAM_SAVED_VIEWS,
  CLIENT_SAVED_VIEWS,
  savedViewsFor,
  matchesSavedView,
  countSavedViews,
  matchesFilters,
  matchesQuery,
  compareRequests,
  sortRequests,
  applyRequestViews,
  isFilterActive,
  activeFilterKeys,
  anyFilterActive,
  filterKeysFor,
  isRequestsFilters,
  isRequestsSort,
  isRequestsSnapshot,
  snapshotsEqual,
  sortKeyLabel,
  sortDirLabel,
  migrateLegacyTab,
  migrateLegacySortKey,
  TYPE_FILTER_OPTIONS,
  CREATED_FILTER_OPTIONS,
  type RequestRow,
  type RequestsFilters,
} from './requests-views'

// A fixed "now" in local time so every date assertion is timezone-proof:
// the helpers compare YYYY-MM-DD day keys derived from the same local Date.
const NOW = new Date(2026, 8, 2, 10, 0, 0) // 2026-09-02, local

/** Local YYYY-MM-DD, `offset` days from NOW. */
function day(offset: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

function req(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'r1',
    title: 'A request',
    status: 'in_progress',
    type: 'small_task',
    category: 'design',
    priority: 'standard',
    dueDate: null,
    createdAt: `${day(-1)}T09:00:00.000Z`,
    updatedAt: `${day(-1)}T09:00:00.000Z`,
    orgId: 'org-a',
    orgName: 'Acme',
    assigneeId: null,
    requestNumber: 12,
    ...over,
  }
}

function filters(over: Partial<RequestsFilters> = {}): RequestsFilters {
  return { ...DEFAULT_REQUEST_FILTERS, ...over }
}

// ── View keys ────────────────────────────────────────────────────────────────

describe('normaliseViewKey', () => {
  it('exposes the four peer views in order', () => {
    expect(REQUESTS_VIEW_KEYS).toEqual(['list', 'kanban', 'workload', 'timeline'])
  })

  it('migrates the legacy "board" key to kanban', () => {
    expect(normaliseViewKey('board', 'admin')).toBe('kanban')
  })

  it('passes through every valid key for an admin', () => {
    for (const key of REQUESTS_VIEW_KEYS) {
      expect(normaliseViewKey(key, 'admin')).toBe(key)
    }
  })

  it('falls back to list for anything unrecognised', () => {
    expect(normaliseViewKey('nonsense', 'admin')).toBe('list')
    expect(normaliseViewKey(null, 'admin')).toBe('list')
    expect(normaliseViewKey(7, 'admin')).toBe('list')
  })

  it('drops workload for non-admin audiences', () => {
    expect(normaliseViewKey('workload', 'client')).toBe('list')
    expect(normaliseViewKey('workload', 'team_member')).toBe('list')
    expect(normaliseViewKey('timeline', 'client')).toBe('timeline')
  })
})

// ── Saved view sets ──────────────────────────────────────────────────────────

describe('savedViewsFor', () => {
  it('gives an admin the team set without "Assigned to me"', () => {
    expect(savedViewsFor('admin').map(v => v.key)).toEqual([
      'active', 'triage', 'overdue', 'week', 'awaiting', 'delivered',
    ])
  })

  it('adds "Assigned to me" for a non-admin team member', () => {
    expect(savedViewsFor('team_member').map(v => v.key)).toEqual([
      'active', 'triage', 'mine', 'overdue', 'week', 'awaiting', 'delivered',
    ])
  })

  it('gives a client their own short set in their own language', () => {
    expect(savedViewsFor('client').map(v => v.key)).toEqual(['active', 'awaiting', 'delivered'])
    expect(savedViewsFor('client').map(v => v.label)).toEqual([
      'In progress', 'Waiting on you', 'Delivered',
    ])
  })

  it('shares the keys the team and client sets have in common', () => {
    const team = new Set(TEAM_SAVED_VIEWS.map(v => v.key))
    for (const v of CLIENT_SAVED_VIEWS) expect(team.has(v.key)).toBe(true)
  })
})

// ── Team predicates ──────────────────────────────────────────────────────────

describe('team saved view predicates', () => {
  const ctx = { now: NOW, assigneeId: 'tm-1' }
  const test = (key: string, row: RequestRow) => matchesSavedView(row, key, 'team_member', ctx)

  it('active excludes every tail status', () => {
    expect(TAIL_STATUSES).toEqual(['draft', 'delivered', 'cancelled', 'archived'])
    expect(test('active', req({ status: 'in_progress' }))).toBe(true)
    expect(test('active', req({ status: 'submitted' }))).toBe(true)
    expect(test('active', req({ status: 'on_hold' }))).toBe(true)
    for (const status of TAIL_STATUSES) {
      expect(test('active', req({ status }))).toBe(false)
    }
  })

  it('triage is submitted only', () => {
    expect(test('triage', req({ status: 'submitted' }))).toBe(true)
    expect(test('triage', req({ status: 'in_review' }))).toBe(false)
  })

  it('mine matches the caller assignee and never matches an unassigned row', () => {
    expect(test('mine', req({ assigneeId: 'tm-1' }))).toBe(true)
    expect(test('mine', req({ assigneeId: 'tm-2' }))).toBe(false)
    expect(test('mine', req({ assigneeId: null }))).toBe(false)
    // No caller identity: the view matches nothing rather than everything.
    expect(matchesSavedView(req({ assigneeId: null }), 'mine', 'team_member', { now: NOW })).toBe(false)
  })

  it('overdue is a past due date on an open request', () => {
    expect(test('overdue', req({ dueDate: day(-1) }))).toBe(true)
    expect(test('overdue', req({ dueDate: day(0) }))).toBe(false)
    expect(test('overdue', req({ dueDate: day(3) }))).toBe(false)
    expect(test('overdue', req({ dueDate: null }))).toBe(false)
  })

  it('overdue never fires on a closed request', () => {
    for (const status of ['delivered', 'archived', 'cancelled']) {
      expect(test('overdue', req({ dueDate: day(-5), status }))).toBe(false)
    }
  })

  it('due this week covers today through seven days out, inclusive', () => {
    expect(test('week', req({ dueDate: day(0) }))).toBe(true)
    expect(test('week', req({ dueDate: day(7) }))).toBe(true)
    expect(test('week', req({ dueDate: day(8) }))).toBe(false)
    expect(test('week', req({ dueDate: day(-1) }))).toBe(false)
    expect(test('week', req({ dueDate: day(3), status: 'delivered' }))).toBe(false)
  })

  it('awaiting client is client_review, delivered is delivered', () => {
    expect(test('awaiting', req({ status: 'client_review' }))).toBe(true)
    expect(test('awaiting', req({ status: 'in_progress' }))).toBe(false)
    expect(test('delivered', req({ status: 'delivered' }))).toBe(true)
    expect(test('delivered', req({ status: 'archived' }))).toBe(false)
  })

  it('a null saved view matches everything, and an unknown key does not filter', () => {
    expect(matchesSavedView(req({ status: 'archived' }), null, 'admin', ctx)).toBe(true)
    expect(matchesSavedView(req({ status: 'archived' }), 'not-a-view', 'admin', ctx)).toBe(true)
  })

  it('ignores a saved view the audience does not have', () => {
    // "mine" is not in the admin set, so an admin carrying it sees everything.
    expect(matchesSavedView(req({ assigneeId: 'tm-9' }), 'mine', 'admin', ctx)).toBe(true)
  })
})

// ── Client predicates ────────────────────────────────────────────────────────

describe('client saved view predicates', () => {
  const test = (key: string, row: RequestRow) => matchesSavedView(row, key, 'client', { now: NOW })

  it('in progress covers submitted, in review and in progress', () => {
    for (const status of ['submitted', 'in_review', 'in_progress']) {
      expect(test('active', req({ status }))).toBe(true)
    }
    for (const status of ['client_review', 'on_hold', 'delivered', 'archived']) {
      expect(test('active', req({ status }))).toBe(false)
    }
  })

  it('waiting on you is client review', () => {
    expect(test('awaiting', req({ status: 'client_review' }))).toBe(true)
    expect(test('awaiting', req({ status: 'in_review' }))).toBe(false)
  })

  it('delivered is delivered', () => {
    expect(test('delivered', req({ status: 'delivered' }))).toBe(true)
    expect(test('delivered', req({ status: 'in_progress' }))).toBe(false)
  })
})

// ── Counts ───────────────────────────────────────────────────────────────────

describe('countSavedViews', () => {
  const rows = [
    req({ id: '1', status: 'submitted' }),
    req({ id: '2', status: 'in_progress', dueDate: day(-2) }),
    req({ id: '3', status: 'client_review', dueDate: day(2) }),
    req({ id: '4', status: 'delivered' }),
    req({ id: '5', status: 'archived' }),
  ]

  it('counts every view in the audience set plus the __all total', () => {
    const counts = countSavedViews(rows, 'admin', { now: NOW })
    expect(counts.__all).toBe(5)
    expect(counts.active).toBe(3)
    expect(counts.triage).toBe(1)
    expect(counts.overdue).toBe(1)
    expect(counts.week).toBe(1)
    expect(counts.awaiting).toBe(1)
    expect(counts.delivered).toBe(1)
  })

  it('counts the client vocabulary for a client', () => {
    const counts = countSavedViews(rows, 'client', { now: NOW })
    expect(counts.__all).toBe(5)
    expect(counts.active).toBe(2)
    expect(counts.awaiting).toBe(1)
    expect(counts.delivered).toBe(1)
    expect(counts.triage).toBeUndefined()
  })

  it('returns zeroes rather than gaps for an empty list', () => {
    const counts = countSavedViews([], 'admin', { now: NOW })
    expect(counts.__all).toBe(0)
    expect(counts.active).toBe(0)
  })
})

// ── Filters ──────────────────────────────────────────────────────────────────

describe('matchesFilters', () => {
  it('defaults to letting everything through', () => {
    expect(matchesFilters(req({ status: 'archived' }), DEFAULT_REQUEST_FILTERS, NOW)).toBe(true)
  })

  it('filters by status', () => {
    expect(matchesFilters(req({ status: 'on_hold' }), filters({ status: 'on_hold' }), NOW)).toBe(true)
    expect(matchesFilters(req({ status: 'in_progress' }), filters({ status: 'on_hold' }), NOW)).toBe(false)
  })

  it('filters by category, treating a null category as unmatched', () => {
    expect(matchesFilters(req({ category: 'design' }), filters({ category: 'design' }), NOW)).toBe(true)
    expect(matchesFilters(req({ category: 'bug' }), filters({ category: 'design' }), NOW)).toBe(false)
    expect(matchesFilters(req({ category: null }), filters({ category: 'design' }), NOW)).toBe(false)
  })

  it('filters by client org', () => {
    expect(matchesFilters(req({ orgId: 'org-a' }), filters({ client: 'org-a' }), NOW)).toBe(true)
    expect(matchesFilters(req({ orgId: 'org-b' }), filters({ client: 'org-a' }), NOW)).toBe(false)
  })

  it('filters by type using the stored slugs', () => {
    expect(TYPE_FILTER_OPTIONS.map(o => o.value)).toEqual(['all', 'small_task', 'large_task'])
    expect(TYPE_FILTER_OPTIONS.map(o => o.label)).toEqual(['All types', '1 day or less', 'Multi-day'])
    expect(matchesFilters(req({ type: 'large_task' }), filters({ type: 'large_task' }), NOW)).toBe(true)
    expect(matchesFilters(req({ type: 'small_task' }), filters({ type: 'large_task' }), NOW)).toBe(false)
  })

  it('filters by a created window, inclusive of the cutoff day', () => {
    expect(CREATED_FILTER_OPTIONS.map(o => o.value)).toEqual(['any', '7', '30', '90'])
    const inWindow = req({ createdAt: `${day(-6)}T12:00:00.000Z` })
    const onCutoff = req({ createdAt: `${day(-7)}T12:00:00.000Z` })
    const outside = req({ createdAt: `${day(-8)}T12:00:00.000Z` })
    expect(matchesFilters(inWindow, filters({ created: '7' }), NOW)).toBe(true)
    expect(matchesFilters(onCutoff, filters({ created: '7' }), NOW)).toBe(true)
    expect(matchesFilters(outside, filters({ created: '7' }), NOW)).toBe(false)
    expect(matchesFilters(outside, filters({ created: '30' }), NOW)).toBe(true)
  })

  it('drops rows with no created date once a created window is set', () => {
    expect(matchesFilters(req({ createdAt: null }), filters({ created: '30' }), NOW)).toBe(false)
    expect(matchesFilters(req({ createdAt: null }), DEFAULT_REQUEST_FILTERS, NOW)).toBe(true)
  })

  it('ands the dimensions together', () => {
    const row = req({ status: 'in_progress', category: 'design', type: 'small_task' })
    expect(matchesFilters(row, filters({ status: 'in_progress', category: 'design' }), NOW)).toBe(true)
    expect(matchesFilters(row, filters({ status: 'in_progress', category: 'bug' }), NOW)).toBe(false)
  })
})

describe('filter activity helpers', () => {
  it('reports a dimension as active only when it differs from its default', () => {
    expect(isFilterActive(DEFAULT_REQUEST_FILTERS, 'status')).toBe(false)
    expect(isFilterActive(filters({ status: 'on_hold' }), 'status')).toBe(true)
    expect(isFilterActive(filters({ created: 'any' }), 'created')).toBe(false)
    expect(isFilterActive(filters({ created: '7' }), 'created')).toBe(true)
  })

  it('lists the active keys in dimension order', () => {
    expect(activeFilterKeys(filters({ type: 'large_task', status: 'delivered' }))).toEqual(['status', 'type'])
    expect(anyFilterActive(DEFAULT_REQUEST_FILTERS)).toBe(false)
    expect(anyFilterActive(filters({ client: 'org-a' }))).toBe(true)
  })

  it('hides the client dimension from non-admin audiences', () => {
    expect(filterKeysFor('admin')).toEqual(['status', 'category', 'client', 'type', 'created'])
    expect(filterKeysFor('client')).toEqual(['status', 'category', 'type', 'created'])
    expect(filterKeysFor('team_member')).toEqual(['status', 'category', 'type', 'created'])
  })

  it('ignores a client filter the audience cannot see', () => {
    expect(activeFilterKeys(filters({ client: 'org-a' }), 'client')).toEqual([])
    expect(activeFilterKeys(filters({ client: 'org-a' }), 'admin')).toEqual(['client'])
  })
})

// ── Search ───────────────────────────────────────────────────────────────────

describe('matchesQuery', () => {
  it('matches on title, client name and request number', () => {
    const row = req({ title: 'Homepage hero', orgName: 'Northwind', requestNumber: 42 })
    expect(matchesQuery(row, 'hero')).toBe(true)
    expect(matchesQuery(row, 'NORTH')).toBe(true)
    expect(matchesQuery(row, '042')).toBe(true)
    expect(matchesQuery(row, '42')).toBe(true)
    expect(matchesQuery(row, 'kowtow')).toBe(false)
  })

  it('treats an empty or whitespace query as no filter', () => {
    expect(matchesQuery(req(), '')).toBe(true)
    expect(matchesQuery(req(), '   ')).toBe(true)
  })
})

// ── Sort ─────────────────────────────────────────────────────────────────────

describe('compareRequests', () => {
  const ids = (rows: RequestRow[]) => rows.map(r => r.id)

  it('sinks delivered, cancelled and archived below open work whatever the sort', () => {
    const rows = [
      req({ id: 'delivered', status: 'delivered', dueDate: day(-9) }),
      req({ id: 'open', status: 'in_progress', dueDate: day(9) }),
      req({ id: 'cancelled', status: 'cancelled', dueDate: day(-9) }),
    ]
    expect(ids(sortRequests(rows, { key: 'due', dir: 'asc' }))[0]).toBe('open')
    expect(ids(sortRequests(rows, { key: 'due', dir: 'desc' }))[0]).toBe('open')
    expect(ids(sortRequests(rows, { key: 'priority', dir: 'asc' }))[0]).toBe('open')
  })

  it('sorts by due date soonest first, with no due date last', () => {
    const rows = [
      req({ id: 'late', dueDate: day(10) }),
      req({ id: 'none', dueDate: null }),
      req({ id: 'soon', dueDate: day(1) }),
    ]
    expect(ids(sortRequests(rows, { key: 'due', dir: 'asc' }))).toEqual(['soon', 'late', 'none'])
  })

  it('reverses the due order on desc', () => {
    const rows = [
      req({ id: 'late', dueDate: day(10) }),
      req({ id: 'soon', dueDate: day(1) }),
    ]
    expect(ids(sortRequests(rows, { key: 'due', dir: 'desc' }))).toEqual(['late', 'soon'])
  })

  it('sorts by updated newest first on asc', () => {
    const rows = [
      req({ id: 'old', updatedAt: '2026-08-01T00:00:00.000Z' }),
      req({ id: 'new', updatedAt: '2026-09-01T00:00:00.000Z' }),
      req({ id: 'never', updatedAt: null }),
    ]
    expect(ids(sortRequests(rows, { key: 'updated', dir: 'asc' }))).toEqual(['new', 'old', 'never'])
    expect(ids(sortRequests(rows, { key: 'updated', dir: 'desc' })).slice(0, 2)).toEqual(['never', 'old'])
  })

  it('sorts by priority highest first on asc', () => {
    const rows = [
      req({ id: 'low', priority: 'low' }),
      req({ id: 'urgent', priority: 'urgent' }),
      req({ id: 'standard', priority: 'standard' }),
      req({ id: 'high', priority: 'high' }),
    ]
    expect(ids(sortRequests(rows, { key: 'priority', dir: 'asc' }))).toEqual(['urgent', 'high', 'standard', 'low'])
  })

  it('treats a missing priority as standard', () => {
    const rows = [
      req({ id: 'none', priority: null }),
      req({ id: 'low', priority: 'low' }),
    ]
    expect(ids(sortRequests(rows, { key: 'priority', dir: 'asc' }))).toEqual(['none', 'low'])
  })

  it('sorts by client name A to Z, with no client last', () => {
    const rows = [
      req({ id: 'z', orgName: 'Zephyr' }),
      req({ id: 'none', orgName: null }),
      req({ id: 'a', orgName: 'acme' }),
    ]
    expect(ids(sortRequests(rows, { key: 'client', dir: 'asc' }))).toEqual(['a', 'z', 'none'])
  })

  it('breaks ties on the due date', () => {
    const rows = [
      req({ id: 'later', priority: 'high', dueDate: day(5) }),
      req({ id: 'sooner', priority: 'high', dueDate: day(2) }),
    ]
    expect(ids(sortRequests(rows, { key: 'priority', dir: 'asc' }))).toEqual(['sooner', 'later'])
  })

  it('does not mutate the input array', () => {
    const rows = [req({ id: 'b', dueDate: day(5) }), req({ id: 'a', dueDate: day(1) })]
    sortRequests(rows, DEFAULT_REQUEST_SORT)
    expect(ids(rows)).toEqual(['b', 'a'])
  })

  it('defaults to due ascending', () => {
    expect(DEFAULT_REQUEST_SORT).toEqual({ key: 'due', dir: 'asc' })
    const a = req({ id: 'a', dueDate: day(1) })
    const b = req({ id: 'b', dueDate: day(2) })
    expect(compareRequests(a, b, DEFAULT_REQUEST_SORT)).toBeLessThan(0)
  })
})

describe('sort labels', () => {
  it('names the key', () => {
    expect(sortKeyLabel({ key: 'due', dir: 'asc' })).toBe('Due')
    expect(sortKeyLabel({ key: 'updated', dir: 'asc' })).toBe('Updated')
  })

  it('names the direction per key', () => {
    expect(sortDirLabel({ key: 'due', dir: 'asc' })).toBe('Soonest first')
    expect(sortDirLabel({ key: 'due', dir: 'desc' })).toBe('Latest first')
    expect(sortDirLabel({ key: 'updated', dir: 'asc' })).toBe('Newest first')
    expect(sortDirLabel({ key: 'priority', dir: 'desc' })).toBe('Lowest first')
    expect(sortDirLabel({ key: 'client', dir: 'asc' })).toBe('A to Z')
  })
})

// ── Whole pipeline ───────────────────────────────────────────────────────────

describe('applyRequestViews', () => {
  const rows = [
    req({ id: 'a', status: 'submitted', dueDate: day(3), orgId: 'org-a', title: 'Alpha' }),
    req({ id: 'b', status: 'in_progress', dueDate: day(1), orgId: 'org-b', title: 'Beta' }),
    req({ id: 'c', status: 'delivered', dueDate: day(2), orgId: 'org-a', title: 'Gamma' }),
  ]

  it('applies the saved view, filters, search and sort together', () => {
    const out = applyRequestViews(rows, {
      audience: 'admin',
      savedView: 'active',
      filters: filters({ client: 'org-a' }),
      query: '',
      sort: DEFAULT_REQUEST_SORT,
      now: NOW,
    })
    expect(out.map(r => r.id)).toEqual(['a'])
  })

  it('sorts what survives', () => {
    const out = applyRequestViews(rows, {
      audience: 'admin',
      savedView: null,
      filters: DEFAULT_REQUEST_FILTERS,
      query: '',
      sort: { key: 'due', dir: 'asc' },
      now: NOW,
    })
    // b and a are open (due order), c is delivered so it sinks.
    expect(out.map(r => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('honours the search term', () => {
    const out = applyRequestViews(rows, {
      audience: 'admin',
      savedView: null,
      filters: DEFAULT_REQUEST_FILTERS,
      query: 'gam',
      sort: DEFAULT_REQUEST_SORT,
      now: NOW,
    })
    expect(out.map(r => r.id)).toEqual(['c'])
  })
})

// ── Stored shapes ────────────────────────────────────────────────────────────

describe('stored preference validators', () => {
  it('accepts a full filter object and rejects anything else', () => {
    expect(isRequestsFilters(DEFAULT_REQUEST_FILTERS)).toBe(true)
    expect(isRequestsFilters({ status: 'all' })).toBe(false)
    expect(isRequestsFilters({ ...DEFAULT_REQUEST_FILTERS, status: 3 })).toBe(false)
    expect(isRequestsFilters(null)).toBe(false)
    expect(isRequestsFilters([])).toBe(false)
    expect(isRequestsFilters('all')).toBe(false)
  })

  it('accepts a sort with a known key and direction', () => {
    expect(isRequestsSort({ key: 'due', dir: 'asc' })).toBe(true)
    expect(isRequestsSort({ key: 'due', dir: 'sideways' })).toBe(false)
    expect(isRequestsSort({ key: 'colour', dir: 'asc' })).toBe(false)
    expect(isRequestsSort(null)).toBe(false)
  })

  it('accepts a whole snapshot', () => {
    const snap = {
      view: 'kanban',
      savedView: 'active',
      filters: DEFAULT_REQUEST_FILTERS,
      sort: DEFAULT_REQUEST_SORT,
    }
    expect(isRequestsSnapshot(snap)).toBe(true)
    expect(isRequestsSnapshot({ ...snap, view: 'nope' })).toBe(false)
    expect(isRequestsSnapshot({ ...snap, savedView: 3 })).toBe(false)
    expect(isRequestsSnapshot({ ...snap, filters: {} })).toBe(false)
  })
})

describe('snapshotsEqual', () => {
  const base = {
    view: 'list' as const,
    savedView: null,
    filters: DEFAULT_REQUEST_FILTERS,
    sort: DEFAULT_REQUEST_SORT,
  }

  it('matches an identical snapshot', () => {
    expect(snapshotsEqual(base, { ...base, filters: { ...DEFAULT_REQUEST_FILTERS } })).toBe(true)
  })

  it('rejects a null snapshot', () => {
    expect(snapshotsEqual(null, base)).toBe(false)
    expect(snapshotsEqual(base, null)).toBe(false)
  })

  it('notices any dimension changing', () => {
    expect(snapshotsEqual(base, { ...base, view: 'kanban' })).toBe(false)
    expect(snapshotsEqual(base, { ...base, savedView: 'active' })).toBe(false)
    expect(snapshotsEqual(base, { ...base, filters: filters({ type: 'large_task' }) })).toBe(false)
    expect(snapshotsEqual(base, { ...base, sort: { key: 'due', dir: 'desc' } })).toBe(false)
  })

  it('treats a stored "board" view as kanban', () => {
    expect(snapshotsEqual({ ...base, view: 'board' as never }, { ...base, view: 'kanban' })).toBe(true)
  })
})

// ── Legacy key migration ─────────────────────────────────────────────────────

describe('legacy preference migration', () => {
  it('maps the old status tab onto a saved view', () => {
    expect(migrateLegacyTab('active')).toBe('active')
    expect(migrateLegacyTab('submitted')).toBe('triage')
    expect(migrateLegacyTab('client_review')).toBe('awaiting')
    expect(migrateLegacyTab('delivered')).toBe('delivered')
    expect(migrateLegacyTab('all')).toBeNull()
    expect(migrateLegacyTab('unassigned')).toBeNull()
    expect(migrateLegacyTab(undefined)).toBeNull()
  })

  it('maps the old sort key onto the new sort shape', () => {
    expect(migrateLegacySortKey('dueDate')).toEqual({ key: 'due', dir: 'asc' })
    expect(migrateLegacySortKey('updatedAt')).toEqual({ key: 'updated', dir: 'asc' })
    expect(migrateLegacySortKey('priority')).toEqual({ key: 'priority', dir: 'asc' })
    // "status" has no peer in the new vocabulary, so nothing is migrated.
    expect(migrateLegacySortKey('status')).toBeNull()
    expect(migrateLegacySortKey(null)).toBeNull()
  })
})

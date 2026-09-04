import { describe, it, expect } from 'vitest'
import {
  EMPTY_REQUESTS_URL_NARROW,
  buildRequestsNarrowChips,
  clearRequestsNarrow,
  hasRequestsUrlNarrow,
  matchesRequestsUrlNarrow,
  readRequestsUrlSort,
  readRequestsUrlState,
  readRequestsUrlView,
} from '@/lib/requests-url-state'

/** The helper only needs `.get`, so a plain URLSearchParams is the fixture. */
function params(query: string): URLSearchParams {
  return new URLSearchParams(query)
}

describe('readRequestsUrlState: filters', () => {
  it('names nothing when the URL is empty', () => {
    const state = readRequestsUrlState(params(''))
    expect(state.filters).toEqual({})
    expect(state.narrow).toEqual(EMPTY_REQUESTS_URL_NARROW)
    expect(state.view).toBeNull()
    expect(state.sort).toBeNull()
    expect(state.query).toBeNull()
  })

  it('carries only the dimensions the URL named', () => {
    const state = readRequestsUrlState(params('category=design'))
    expect(state.filters).toEqual({ category: 'design' })
  })

  it('takes a known status and drops an invented one', () => {
    expect(readRequestsUrlState(params('status=in_review')).filters).toEqual({ status: 'in_review' })
    expect(readRequestsUrlState(params('status=not_a_status')).filters).toEqual({})
  })

  it('treats a param that repeats the default as no narrowing', () => {
    expect(readRequestsUrlState(params('status=all&category=all&client=all')).filters).toEqual({})
  })

  it('ignores blank and whitespace-only values', () => {
    expect(readRequestsUrlState(params('category=&client=%20%20')).filters).toEqual({})
  })

  it('trims a padded value', () => {
    expect(readRequestsUrlState(params('category=%20design%20')).filters).toEqual({ category: 'design' })
  })

  it('takes the client filter on its own', () => {
    expect(readRequestsUrlState(params('client=org-7')).filters).toEqual({ client: 'org-7' })
  })

  it('leaves the client filter alone when the URL is opening the new-request dialog', () => {
    // ?new=1&client=<id> has always meant "pre-fill the dialog", not "filter".
    expect(readRequestsUrlState(params('new=1&client=org-7')).filters).toEqual({})
  })

  it('carries the type dimension', () => {
    expect(readRequestsUrlState(params('type=large_task')).filters).toEqual({ type: 'large_task' })
  })
})

describe('readRequestsUrlState: narrow dimensions', () => {
  it('reads priority and assignee', () => {
    const state = readRequestsUrlState(params('priority=high&assignee=tm-1'))
    expect(state.narrow).toEqual({ priority: 'high', assignee: 'tm-1' })
  })

  it('keeps them out of the rail filters', () => {
    expect(readRequestsUrlState(params('priority=high&assignee=tm-1')).filters).toEqual({})
  })
})

describe('readRequestsUrlView', () => {
  it('accepts every rail view key', () => {
    expect(readRequestsUrlView(params('view=list'))).toBe('list')
    expect(readRequestsUrlView(params('view=kanban'))).toBe('kanban')
    expect(readRequestsUrlView(params('view=workload'))).toBe('workload')
    expect(readRequestsUrlView(params('view=timeline'))).toBe('timeline')
  })

  it('migrates the old "board" spelling', () => {
    expect(readRequestsUrlView(params('view=board'))).toBe('kanban')
  })

  it('rejects an unknown view', () => {
    expect(readRequestsUrlView(params('view=gantt'))).toBeNull()
    expect(readRequestsUrlView(params(''))).toBeNull()
  })
})

describe('readRequestsUrlSort', () => {
  it('reads a rail sort key with its direction', () => {
    expect(readRequestsUrlSort(params('sort=due&dir=desc'))).toEqual({ key: 'due', dir: 'desc' })
    expect(readRequestsUrlSort(params('sort=client&dir=asc'))).toEqual({ key: 'client', dir: 'asc' })
  })

  it('defaults an absent or invalid direction to ascending', () => {
    expect(readRequestsUrlSort(params('sort=priority'))).toEqual({ key: 'priority', dir: 'asc' })
    expect(readRequestsUrlSort(params('sort=priority&dir=sideways'))).toEqual({ key: 'priority', dir: 'asc' })
  })

  it('maps sort=created&dir=desc to the rail ordering that reads newest first', () => {
    // `updated` is comparator-negated, so ascending IS newest first. The
    // header's "Created" link promises newest first; this is what delivers it.
    expect(readRequestsUrlSort(params('sort=created&dir=desc'))).toEqual({ key: 'updated', dir: 'asc' })
  })

  it('flips the created alias the other way too', () => {
    expect(readRequestsUrlSort(params('sort=created&dir=asc'))).toEqual({ key: 'updated', dir: 'desc' })
  })

  it('ignores an unknown sort key, and a direction with no key', () => {
    expect(readRequestsUrlSort(params('sort=colour&dir=desc'))).toBeNull()
    expect(readRequestsUrlSort(params('dir=desc'))).toBeNull()
  })
})

describe('readRequestsUrlState: query', () => {
  it('reads the search term', () => {
    expect(readRequestsUrlState(params('q=logo')).query).toBe('logo')
  })

  it('treats a blank term as absent', () => {
    expect(readRequestsUrlState(params('q=%20')).query).toBeNull()
  })
})

describe('readRequestsUrlState: the saved-view stand-down', () => {
  // A stored saved view is a pre-filter with its own opinion about the same
  // rows, so a link that narrows the list has to overrule it or land empty.
  it('stands the saved view down when the URL names a filter', () => {
    expect(readRequestsUrlState(params('status=delivered')).clearsSavedView).toBe(true)
    expect(readRequestsUrlState(params('category=design')).clearsSavedView).toBe(true)
    expect(readRequestsUrlState(params('client=org-7')).clearsSavedView).toBe(true)
    expect(readRequestsUrlState(params('type=large_task')).clearsSavedView).toBe(true)
  })

  it('stands it down for a link-only dimension too', () => {
    expect(readRequestsUrlState(params('priority=high')).clearsSavedView).toBe(true)
    expect(readRequestsUrlState(params('assignee=tm-1')).clearsSavedView).toBe(true)
  })

  it('leaves it alone for anything that removes no rows', () => {
    expect(readRequestsUrlState(params('')).clearsSavedView).toBe(false)
    expect(readRequestsUrlState(params('view=timeline')).clearsSavedView).toBe(false)
    expect(readRequestsUrlState(params('sort=created&dir=desc')).clearsSavedView).toBe(false)
    expect(readRequestsUrlState(params('q=logo')).clearsSavedView).toBe(false)
  })

  it('leaves it alone when the named value is only the default', () => {
    expect(readRequestsUrlState(params('status=all&category=all')).clearsSavedView).toBe(false)
  })

  it('leaves it alone when the client param is only pre-filling the dialog', () => {
    expect(readRequestsUrlState(params('new=1&client=org-7')).clearsSavedView).toBe(false)
  })
})

describe('matchesRequestsUrlNarrow', () => {
  const row = { priority: 'high', assigneeId: 'tm-1' }

  it('keeps every row when nothing is narrowed', () => {
    expect(matchesRequestsUrlNarrow(row, EMPTY_REQUESTS_URL_NARROW)).toBe(true)
    expect(matchesRequestsUrlNarrow({}, EMPTY_REQUESTS_URL_NARROW)).toBe(true)
  })

  it('narrows on priority', () => {
    expect(matchesRequestsUrlNarrow(row, { priority: 'high', assignee: null })).toBe(true)
    expect(matchesRequestsUrlNarrow(row, { priority: 'standard', assignee: null })).toBe(false)
  })

  it('narrows on assignee', () => {
    expect(matchesRequestsUrlNarrow(row, { priority: null, assignee: 'tm-1' })).toBe(true)
    expect(matchesRequestsUrlNarrow(row, { priority: null, assignee: 'tm-2' })).toBe(false)
  })

  it('drops a row with no value on a narrowed dimension', () => {
    expect(matchesRequestsUrlNarrow({ priority: null }, { priority: 'high', assignee: null })).toBe(false)
    expect(matchesRequestsUrlNarrow({}, { priority: null, assignee: 'tm-1' })).toBe(false)
  })

  it('requires every named dimension to match', () => {
    expect(matchesRequestsUrlNarrow(row, { priority: 'high', assignee: 'tm-2' })).toBe(false)
  })
})

describe('narrow chips', () => {
  it('reports whether anything is narrowed', () => {
    expect(hasRequestsUrlNarrow(EMPTY_REQUESTS_URL_NARROW)).toBe(false)
    expect(hasRequestsUrlNarrow({ priority: 'high', assignee: null })).toBe(true)
  })

  it('builds a clearable chip per narrowed dimension', () => {
    const chips = buildRequestsNarrowChips({ priority: 'high', assignee: 'tm-1' }, { 'tm-1': 'Staci Bonnie' })
    expect(chips).toEqual([
      { key: 'priority', dimension: 'Priority', label: 'High' },
      { key: 'assignee', dimension: 'Assignee', label: 'Staci Bonnie' },
    ])
  })

  it('still chips an assignee whose name is not loaded, so it can be cleared', () => {
    const chips = buildRequestsNarrowChips({ priority: null, assignee: 'tm-9' })
    expect(chips).toEqual([{ key: 'assignee', dimension: 'Assignee', label: 'Selected teammate' }])
  })

  it('builds nothing when nothing is narrowed', () => {
    expect(buildRequestsNarrowChips(EMPTY_REQUESTS_URL_NARROW)).toEqual([])
  })

  it('clears one dimension and keeps the other', () => {
    expect(clearRequestsNarrow({ priority: 'high', assignee: 'tm-1' }, 'priority'))
      .toEqual({ priority: null, assignee: 'tm-1' })
  })
})

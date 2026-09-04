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
  requestsUrlStillNarrows,
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
    // `created` is comparator-negated, so ascending IS newest first. The
    // header's "Created" link promises newest first; this is what delivers it,
    // and it orders by creation rather than by last update.
    expect(readRequestsUrlSort(params('sort=created&dir=desc'))).toEqual({ key: 'created', dir: 'asc' })
  })

  it('flips the created direction the other way too', () => {
    expect(readRequestsUrlSort(params('sort=created&dir=asc'))).toEqual({ key: 'created', dir: 'desc' })
  })

  it('leaves the unflipped keys exactly as the URL named them', () => {
    expect(readRequestsUrlSort(params('sort=updated&dir=desc'))).toEqual({ key: 'updated', dir: 'desc' })
    expect(readRequestsUrlSort(params('sort=due&dir=asc'))).toEqual({ key: 'due', dir: 'asc' })
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

  it('narrows on the assignee column', () => {
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

  // The header's people stack links the PM and follower bubbles here too, so
  // an assignee-only match would answer "see everything they are on" with a
  // list that excludes the request the link was clicked from.
  it('keeps a row where the person is the PM rather than the assignee', () => {
    const led = {
      assigneeId: 'tm-9',
      participants: [
        { id: 'tm-1', type: 'team_member' },
        { id: 'tm-9', type: 'team_member' },
      ],
    }
    expect(matchesRequestsUrlNarrow(led, { priority: null, assignee: 'tm-1' })).toBe(true)
  })

  it('keeps a row where the person is only a follower', () => {
    const watched = {
      assigneeId: 'tm-9',
      participants: [{ id: 'tm-4', type: 'team_member' }],
    }
    expect(matchesRequestsUrlNarrow(watched, { priority: null, assignee: 'tm-4' })).toBe(true)
  })

  it('drops a row the person is not on at all', () => {
    const other = {
      assigneeId: 'tm-9',
      participants: [{ id: 'tm-4', type: 'team_member' }],
    }
    expect(matchesRequestsUrlNarrow(other, { priority: null, assignee: 'tm-1' })).toBe(false)
  })

  it('never matches a contact who happens to share an id', () => {
    const row2 = { assigneeId: null, participants: [{ id: 'tm-1', type: 'contact' }] }
    expect(matchesRequestsUrlNarrow(row2, { priority: null, assignee: 'tm-1' })).toBe(false)
  })

  it('still narrows a row whose cast was never filled in', () => {
    expect(matchesRequestsUrlNarrow({ assigneeId: 'tm-1', participants: null }, { priority: null, assignee: 'tm-1' })).toBe(true)
    expect(matchesRequestsUrlNarrow({ assigneeId: 'tm-2', participants: [] }, { priority: null, assignee: 'tm-1' })).toBe(false)
  })
})

describe('narrow chips', () => {
  it('reports whether anything is narrowed', () => {
    expect(hasRequestsUrlNarrow(EMPTY_REQUESTS_URL_NARROW)).toBe(false)
    expect(hasRequestsUrlNarrow({ priority: 'high', assignee: null })).toBe(true)
  })

  it('builds a clearable chip per narrowed dimension', () => {
    // "Person", not "Assignee": the dimension matches anyone on the request.
    const chips = buildRequestsNarrowChips({ priority: 'high', assignee: 'tm-1' }, { 'tm-1': 'Staci Bonnie' })
    expect(chips).toEqual([
      { key: 'priority', dimension: 'Priority', label: 'High' },
      { key: 'assignee', dimension: 'Person', label: 'Staci Bonnie' },
    ])
  })

  it('still chips a person whose name is not loaded, so it can be cleared', () => {
    const chips = buildRequestsNarrowChips({ priority: null, assignee: 'tm-9' })
    expect(chips).toEqual([{ key: 'assignee', dimension: 'Person', label: 'Selected teammate' }])
  })

  it('builds nothing when nothing is narrowed', () => {
    expect(buildRequestsNarrowChips(EMPTY_REQUESTS_URL_NARROW)).toEqual([])
  })

  it('clears one dimension and keeps the other', () => {
    expect(clearRequestsNarrow({ priority: 'high', assignee: 'tm-1' }, 'priority'))
      .toEqual({ priority: null, assignee: 'tm-1' })
  })
})

describe('requestsUrlStillNarrows', () => {
  it('is true while a rail dimension is overridden', () => {
    expect(requestsUrlStillNarrows({ category: 'design' }, EMPTY_REQUESTS_URL_NARROW)).toBe(true)
  })

  it('is true while a link-only dimension is set', () => {
    expect(requestsUrlStillNarrows({}, { priority: 'high', assignee: null })).toBe(true)
    expect(requestsUrlStillNarrows({}, { priority: null, assignee: 'tm-1' })).toBe(true)
  })

  // This is what lifts the saved-view stand-down: clear the last chip the link
  // raised and the user's stored saved view is the only opinion left.
  it('is false once the last narrowing has been cleared', () => {
    expect(requestsUrlStillNarrows({}, EMPTY_REQUESTS_URL_NARROW)).toBe(false)
    expect(requestsUrlStillNarrows({}, clearRequestsNarrow({ priority: 'high', assignee: null }, 'priority')))
      .toBe(false)
  })

  it('stays true while the other half is still narrowing', () => {
    expect(requestsUrlStillNarrows({}, clearRequestsNarrow({ priority: 'high', assignee: 'tm-1' }, 'priority')))
      .toBe(true)
    expect(requestsUrlStillNarrows({ status: 'delivered' }, EMPTY_REQUESTS_URL_NARROW)).toBe(true)
  })
})

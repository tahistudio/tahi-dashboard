/**
 * applyStoredRequestDefault: the reader for the `requests.default` snapshot.
 *
 * The store is localStorage, so these tests stand a minimal `window` up before
 * the module under test is imported. What they pin down is the rule the
 * function actually follows: fill only the keys the browser is missing, never
 * overwrite a choice already sitting in storage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const PREFIX = 'tahi-pref:'
const store = new Map<string, string>()

vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k) as string : null),
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  },
})

const { applyStoredRequestDefault } = await import('../requests/requests-rail-layout')

function write(key: string, value: unknown) {
  store.set(`${PREFIX}${key}`, JSON.stringify(value))
}
function read(key: string): unknown {
  const raw = store.get(`${PREFIX}${key}`)
  return raw === undefined ? undefined : JSON.parse(raw)
}

const SNAPSHOT = {
  view: 'kanban',
  savedView: 'overdue',
  filters: { status: 'all', category: 'design', client: 'all', type: 'all', created: 'any' },
  sort: { key: 'due', dir: 'asc' },
}

describe('applyStoredRequestDefault', () => {
  beforeEach(() => { store.clear() })

  it('does nothing when no default has been saved', () => {
    applyStoredRequestDefault()
    expect(store.size).toBe(0)
  })

  it('does nothing when the stored default is not a valid snapshot', () => {
    write('requests.default', { view: 'not-a-view' })
    applyStoredRequestDefault()
    expect(read('requests.view')).toBeUndefined()
  })

  it('fills every rail key the browser is missing', () => {
    write('requests.default', SNAPSHOT)
    applyStoredRequestDefault()
    expect(read('requests.view')).toBe('kanban')
    expect(read('requests.savedView')).toBe('overdue')
    expect(read('requests.sort')).toEqual(SNAPSHOT.sort)
    expect(read('requests.filters')).toEqual(SNAPSHOT.filters)
  })

  it('never overwrites a key the user has already set', () => {
    write('requests.default', SNAPSHOT)
    write('requests.view', 'timeline')
    applyStoredRequestDefault()
    expect(read('requests.view')).toBe('timeline')
    // The keys that were missing are still filled in.
    expect(read('requests.savedView')).toBe('overdue')
  })

  it('is safe to run twice', () => {
    write('requests.default', SNAPSHOT)
    applyStoredRequestDefault()
    write('requests.view', 'list')
    applyStoredRequestDefault()
    expect(read('requests.view')).toBe('list')
  })

  it('only ever reads storage this browser already holds', () => {
    // The snapshot lives in localStorage and nowhere else, so a browser that
    // has never seen this user has no default to apply. This is the documented
    // gap: a server-side settings key is what would close it.
    applyStoredRequestDefault()
    expect(read('requests.view')).toBeUndefined()
    expect(read('requests.savedView')).toBeUndefined()
  })
})

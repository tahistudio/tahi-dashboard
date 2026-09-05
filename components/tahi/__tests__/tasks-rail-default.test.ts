/**
 * applyStoredTaskDefault and migrateLegacyTaskPreferences: the two writers
 * that run during the first client render, before useUserPreference hydrates.
 *
 * The store is localStorage, so these stand a minimal `window` up before the
 * module under test is imported. What they pin down is the rule both
 * functions follow: fill only the keys the browser is missing, never
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

const { applyStoredTaskDefault, migrateLegacyTaskPreferences } =
  await import('../tasks/use-tasks-rail-state')

function write(key: string, value: unknown) {
  store.set(`${PREFIX}${key}`, JSON.stringify(value))
}
function read(key: string): unknown {
  const raw = store.get(`${PREFIX}${key}`)
  return raw === undefined ? undefined : JSON.parse(raw)
}

const SNAPSHOT = {
  view: 'board',
  savedView: 'overdue',
  filters: { status: 'all', priority: 'urgent', level: 'all', client: 'all', assignee: 'all', due: 'any' },
  sort: { key: 'due', dir: 'asc' },
}

describe('applyStoredTaskDefault', () => {
  beforeEach(() => { store.clear() })

  it('does nothing when no default has been saved', () => {
    applyStoredTaskDefault()
    expect(store.size).toBe(0)
  })

  it('does nothing when the stored default is not a valid snapshot', () => {
    write('tasks.default', { view: 'not-a-view' })
    applyStoredTaskDefault()
    expect(read('tasks.view')).toBeUndefined()
  })

  it('fills every rail key the browser is missing', () => {
    write('tasks.default', SNAPSHOT)
    applyStoredTaskDefault()
    expect(read('tasks.view')).toBe('board')
    expect(read('tasks.savedView')).toBe('overdue')
    expect(read('tasks.filters')).toEqual(SNAPSHOT.filters)
    expect(read('tasks.sort')).toEqual(SNAPSHOT.sort)
  })

  it('never overwrites a key the user has already set', () => {
    write('tasks.default', SNAPSHOT)
    write('tasks.view', 'week')
    applyStoredTaskDefault()
    expect(read('tasks.view')).toBe('week')
    expect(read('tasks.savedView')).toBe('overdue')
  })
})

describe('migrateLegacyTaskPreferences', () => {
  beforeEach(() => { store.clear() })

  it('carries my_work over as the week view with the mine saved view', () => {
    write('tasks.viewMode', 'my_work')
    migrateLegacyTaskPreferences()
    expect(read('tasks.view')).toBe('week')
    expect(read('tasks.savedView')).toBe('mine')
    expect(read('tasks.railMigrated')).toBe(true)
  })

  it('carries the old type tab over as a saved view', () => {
    write('tasks.typeTab', 'for_client')
    migrateLegacyTaskPreferences()
    expect(read('tasks.savedView')).toBe('client_linked')
  })

  it('carries the old status tab into the status filter', () => {
    write('tasks.statusTab', 'blocked')
    migrateLegacyTaskPreferences()
    expect((read('tasks.filters') as { status: string }).status).toBe('blocked')
  })

  it('runs once and never again', () => {
    write('tasks.viewMode', 'my_work')
    migrateLegacyTaskPreferences()
    store.delete(`${PREFIX}tasks.view`)
    migrateLegacyTaskPreferences()
    expect(read('tasks.view')).toBeUndefined()
  })

  it('never overwrites a key the user has already set on the new surface', () => {
    write('tasks.viewMode', 'my_work')
    write('tasks.view', 'list')
    migrateLegacyTaskPreferences()
    expect(read('tasks.view')).toBe('list')
  })

  it('leaves the legacy keys in place', () => {
    write('tasks.viewMode', 'board')
    migrateLegacyTaskPreferences()
    expect(read('tasks.viewMode')).toBe('board')
  })
})

'use client'

/**
 * The per-user preference layer behind the Tasks rail: `tasks.view`,
 * `tasks.savedView`, `tasks.filters`, `tasks.sort` and the `tasks.default`
 * snapshot, plus a one-time migration off the pre-rail `tasks.viewMode` /
 * `tasks.typeTab` / `tasks.statusTab` keys so nobody loses the view they had.
 *
 * The namespace was already partly occupied: the legacy tasks-content.tsx
 * wrote all three of those keys through useUserPreference. They are migrated
 * rather than claimed, and they are left in place afterwards rather than
 * deleted, so a rollback still finds them.
 *
 * The Tasks surface has no URL-override layer, unlike Requests: nothing links
 * into a pre-filtered task list. If that changes, the shape to copy is
 * lib/requests-url-state.ts, not a second ad-hoc reader here.
 *
 * Known limitation, inherited knowingly: the saved default lives in
 * localStorage, so it does not follow the user to a second machine and dies
 * with a storage clear. Persisting it server-side is open work on the API
 * side for both surfaces.
 */

import * as React from 'react'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'
import {
  DEFAULT_TASKS_SORT,
  DEFAULT_TASK_FILTERS,
  TASKS_VIEW_KEYS,
  TASKS_SAVED_VIEWS,
  isTasksFilters,
  isTasksSnapshot,
  isTasksSort,
  migrateLegacyTaskStatusTab,
  migrateLegacyTaskTypeTab,
  migrateLegacyTaskViewMode,
  normaliseTasksViewKey,
  tasksSnapshotsEqual,
  type TasksFilters,
  type TasksSnapshot,
  type TasksSort,
  type TasksViewKey,
} from '@/lib/tasks-views'

const PREF_PREFIX = 'tahi-pref:'
const MIGRATION_KEY = 'tasks.railMigrated'

function readPref(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(`${PREF_PREFIX}${key}`)
    return raw === null ? undefined : JSON.parse(raw)
  } catch {
    return undefined
  }
}

function writePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`${PREF_PREFIX}${key}`, JSON.stringify(value))
  } catch {
    // Private mode or quota. The preference just will not persist.
  }
}

/**
 * Apply the saved default snapshot to any rail key this browser does not
 * already hold. Runs once during the first client render, after the legacy
 * migration and before `useUserPreference` hydrates, so a key the user has
 * set since always wins.
 */
export function applyStoredTaskDefault(): void {
  if (typeof window === 'undefined') return
  const stored = readPref('tasks.default')
  if (!isTasksSnapshot(stored)) return
  if (readPref('tasks.view') === undefined) writePref('tasks.view', normaliseTasksViewKey(stored.view))
  if (readPref('tasks.savedView') === undefined) writePref('tasks.savedView', stored.savedView)
  if (readPref('tasks.filters') === undefined) writePref('tasks.filters', stored.filters)
  if (readPref('tasks.sort') === undefined) writePref('tasks.sort', stored.sort)
}

/**
 * Carry the pre-rail preferences over to the new keys, once. Guarded by its
 * own flag so it never overwrites a choice the user has since made. The old
 * keys are left in place rather than deleted.
 */
export function migrateLegacyTaskPreferences(): void {
  if (typeof window === 'undefined') return
  if (readPref(MIGRATION_KEY) === true) return

  const legacyView = migrateLegacyTaskViewMode(readPref('tasks.viewMode'))
  if (legacyView) {
    if (readPref('tasks.view') === undefined) writePref('tasks.view', legacyView.view)
    if (legacyView.savedView && readPref('tasks.savedView') === undefined) {
      writePref('tasks.savedView', legacyView.savedView)
    }
  }

  const legacySaved = migrateLegacyTaskTypeTab(readPref('tasks.typeTab'))
  if (legacySaved && readPref('tasks.savedView') === undefined) {
    writePref('tasks.savedView', legacySaved)
  }

  const legacyStatus = migrateLegacyTaskStatusTab(readPref('tasks.statusTab'))
  if (legacyStatus && readPref('tasks.filters') === undefined) {
    writePref('tasks.filters', { ...DEFAULT_TASK_FILTERS, status: legacyStatus })
  }

  writePref(MIGRATION_KEY, true)
}

const isSavedViewKey = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isSnapshot = (v: unknown): v is TasksSnapshot | null => v === null || isTasksSnapshot(v)

export interface TasksRailState {
  view: TasksViewKey
  setView: (next: TasksViewKey) => void
  savedView: string | null
  setSavedView: (next: string | null) => void
  filters: TasksFilters
  setFilters: (next: TasksFilters) => void
  sort: TasksSort
  setSort: (next: TasksSort) => void
  query: string
  setQuery: (next: string) => void
  /** True when the live state matches the saved default exactly. */
  isDefault: boolean
  saveDefault: () => void
  /** True once a default has been saved, so a reset has somewhere to go. */
  hasDefault: boolean
  resetToDefault: () => void
}

export function useTasksRailState(): TasksRailState {
  // Runs during the first client render, ahead of every hydration effect
  // below: the legacy keys are carried over first, then the saved default
  // fills whatever is still unset.
  React.useState(() => {
    migrateLegacyTaskPreferences()
    applyStoredTaskDefault()
    return null
  })

  const [storedView, setStoredView] = useUserPreference<TasksViewKey>(
    'tasks.view',
    'list',
    { validator: oneOf<TasksViewKey>(TASKS_VIEW_KEYS) },
  )
  const [storedSavedView, setStoredSavedView] = useUserPreference<string | null>(
    'tasks.savedView',
    null,
    { validator: isSavedViewKey },
  )
  const [storedFilters, setStoredFilters] = useUserPreference<TasksFilters>(
    'tasks.filters',
    DEFAULT_TASK_FILTERS,
    { validator: isTasksFilters },
  )
  const [storedSort, setStoredSort] = useUserPreference<TasksSort>(
    'tasks.sort',
    DEFAULT_TASKS_SORT,
    { validator: isTasksSort },
  )
  const [storedDefault, setStoredDefault] = useUserPreference<TasksSnapshot | null>(
    'tasks.default',
    null,
    { validator: isSnapshot },
  )
  const [query, setQuery] = React.useState('')

  const view = normaliseTasksViewKey(storedView)
  // A saved view key that no longer exists means All tasks, not nothing.
  const savedView = storedSavedView && TASKS_SAVED_VIEWS.some(v => v.key === storedSavedView)
    ? storedSavedView
    : null

  const isDefault = tasksSnapshotsEqual(storedDefault, { view, savedView, filters: storedFilters, sort: storedSort })

  const saveDefault = React.useCallback(() => {
    setStoredDefault({ view, savedView, filters: storedFilters, sort: storedSort })
  }, [setStoredDefault, view, savedView, storedFilters, storedSort])

  const resetToDefault = React.useCallback(() => {
    if (!storedDefault) return
    setStoredView(normaliseTasksViewKey(storedDefault.view))
    setStoredSavedView(storedDefault.savedView)
    setStoredFilters(storedDefault.filters)
    setStoredSort(storedDefault.sort)
  }, [storedDefault, setStoredView, setStoredSavedView, setStoredFilters, setStoredSort])

  return {
    view,
    setView: setStoredView,
    savedView,
    setSavedView: setStoredSavedView,
    filters: storedFilters,
    setFilters: setStoredFilters,
    sort: storedSort,
    setSort: setStoredSort,
    query,
    setQuery,
    isDefault,
    saveDefault,
    hasDefault: storedDefault !== null,
    resetToDefault,
  }
}

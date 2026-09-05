'use client'

/**
 * The per-user preference layer behind the Clients rail: `clients.view`,
 * `clients.savedView`, `clients.filters`, `clients.sort` and the
 * `clients.default` snapshot, all under the shared `tahi-pref:` namespace
 * through useUserPreference, exactly as the Requests and Tasks rails do.
 *
 * There is no legacy migration branch: the pre-rail Clients page persisted
 * nothing, so there is nothing to carry over.
 *
 * The URL still gets a say. `/clients?status=archived` is a link people have,
 * so an inbound status sits OVER the stored filter for that one dimension
 * until the user touches a control, at which point what is on screen becomes
 * the preference. That is what makes the resulting chip clearable.
 *
 * Known limitation, inherited knowingly from the other two rails: the saved
 * default lives in localStorage, so it fills a gap in one browser and does
 * not travel to a second machine. Persisting it server side is open work on
 * the API side for all three surfaces.
 */

import * as React from 'react'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'
import {
  CLIENTS_VIEW_KEYS,
  CLIENTS_SAVED_VIEWS,
  DEFAULT_CLIENTS_SORT,
  DEFAULT_CLIENT_FILTERS,
  clientsSnapshotsEqual,
  isClientsFilters,
  isClientsSnapshot,
  isClientsSort,
  normaliseClientsSort,
  normaliseClientsViewKey,
  type ClientsFilters,
  type ClientsSnapshot,
  type ClientsSort,
  type ClientsViewKey,
} from './clients-views'

const PREF_PREFIX = 'tahi-pref:'

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
 * already hold. Runs once during the first client render, before
 * `useUserPreference` hydrates, so a key the user has set since always wins.
 */
export function applyStoredClientDefault(): void {
  if (typeof window === 'undefined') return
  const stored = readPref('clients.default')
  if (!isClientsSnapshot(stored)) return
  if (readPref('clients.view') === undefined) writePref('clients.view', normaliseClientsViewKey(stored.view))
  if (readPref('clients.savedView') === undefined) writePref('clients.savedView', stored.savedView)
  if (readPref('clients.filters') === undefined) writePref('clients.filters', stored.filters)
  if (readPref('clients.sort') === undefined) writePref('clients.sort', stored.sort)
}

const isSavedViewKey = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isSnapshot = (v: unknown): v is ClientsSnapshot | null => v === null || isClientsSnapshot(v)

export interface ClientsRailState {
  view: ClientsViewKey
  setView: (next: ClientsViewKey) => void
  savedView: string | null
  setSavedView: (next: string | null) => void
  filters: ClientsFilters
  setFilters: (next: ClientsFilters) => void
  sort: ClientsSort
  setSort: (next: ClientsSort) => void
  query: string
  setQuery: (next: string) => void
  /** True when the live state matches the saved default exactly. */
  isDefault: boolean
  saveDefault: () => void
  /** True once a default has been saved, so a reset has somewhere to go. */
  hasDefault: boolean
  resetToDefault: () => void
}

export function useClientsRailState({
  canSeeMoney,
  initialQuery = '',
  initialStatus,
}: {
  /** Drops the MRR sort key for anyone who cannot see money. */
  canSeeMoney: boolean
  initialQuery?: string
  /** The status a link asked for, read once on the first render. */
  initialStatus?: string
}): ClientsRailState {
  // Runs during the first client render, ahead of every hydration effect
  // below, so the saved default fills whatever is still unset.
  React.useState(() => {
    applyStoredClientDefault()
    return null
  })

  // The URL's share of the state, held separately from the stored keys so it
  // can win for one dimension without ever being written to localStorage on
  // its own. Cleared the moment the user sets a filter by hand.
  const [urlStatus, setUrlStatus] = React.useState<string | null>(
    () => (initialStatus && initialStatus !== DEFAULT_CLIENT_FILTERS.status ? initialStatus : null),
  )

  const [storedView, setStoredView] = useUserPreference<ClientsViewKey>(
    'clients.view',
    'list',
    { validator: oneOf<ClientsViewKey>(CLIENTS_VIEW_KEYS) },
  )
  const [storedSavedView, setStoredSavedView] = useUserPreference<string | null>(
    'clients.savedView',
    null,
    { validator: isSavedViewKey },
  )
  const [storedFilters, setStoredFilters] = useUserPreference<ClientsFilters>(
    'clients.filters',
    DEFAULT_CLIENT_FILTERS,
    { validator: isClientsFilters },
  )
  const [storedSort, setStoredSort] = useUserPreference<ClientsSort>(
    'clients.sort',
    DEFAULT_CLIENTS_SORT,
    { validator: isClientsSort },
  )
  const [storedDefault, setStoredDefault] = useUserPreference<ClientsSnapshot | null>(
    'clients.default',
    null,
    { validator: isSnapshot },
  )
  const [query, setQuery] = React.useState(initialQuery)

  const view = normaliseClientsViewKey(storedView)

  // A saved view key that no longer exists means All clients, not nothing.
  const savedView = storedSavedView && CLIENTS_SAVED_VIEWS.some(v => v.key === storedSavedView)
    ? storedSavedView
    : null

  const filters = React.useMemo<ClientsFilters>(
    () => (urlStatus ? { ...storedFilters, status: urlStatus } : storedFilters),
    [storedFilters, urlStatus],
  )

  const sort = normaliseClientsSort(storedSort, canSeeMoney)

  // Setting a filter by hand persists what is on screen (the URL value
  // included) and drops the override, so the control, the chip and the stored
  // preference cannot disagree afterwards.
  const setFilters = React.useCallback((next: ClientsFilters) => {
    setUrlStatus(null)
    setStoredFilters(next)
  }, [setStoredFilters])

  const setSort = React.useCallback((next: ClientsSort) => {
    setStoredSort(normaliseClientsSort(next, canSeeMoney))
  }, [setStoredSort, canSeeMoney])

  const isDefault = clientsSnapshotsEqual(storedDefault, { view, savedView, filters, sort })

  // Saving is the user adopting what is on screen, so the URL's share of it
  // stops being an override and becomes the preference. Writing only the
  // snapshot would record the link's status while `clients.filters` still
  // said something else, and the next plain visit would open on the old
  // filters with "Reset to default" as the only tell that the save never took.
  const saveDefault = React.useCallback(() => {
    setStoredDefault({ view, savedView, filters, sort })
    setStoredView(view)
    setStoredSavedView(savedView)
    setStoredFilters(filters)
    setStoredSort(sort)
    setUrlStatus(null)
  }, [setStoredDefault, setStoredView, setStoredSavedView, setStoredFilters, setStoredSort, view, savedView, filters, sort])

  // The snapshot's other reader: put everything back where the user saved it,
  // so wandering off the default is recoverable without rebuilding it by hand.
  const resetToDefault = React.useCallback(() => {
    if (!storedDefault) return
    setUrlStatus(null)
    setStoredView(normaliseClientsViewKey(storedDefault.view))
    setStoredSavedView(storedDefault.savedView)
    setStoredFilters(storedDefault.filters)
    setStoredSort(normaliseClientsSort(storedDefault.sort, canSeeMoney))
  }, [storedDefault, setStoredView, setStoredSavedView, setStoredFilters, setStoredSort, canSeeMoney])

  return {
    view,
    setView: setStoredView,
    savedView,
    setSavedView: setStoredSavedView,
    filters,
    setFilters,
    sort,
    setSort,
    query,
    setQuery,
    isDefault,
    saveDefault,
    hasDefault: storedDefault !== null,
    resetToDefault,
  }
}

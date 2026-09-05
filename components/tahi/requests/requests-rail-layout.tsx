'use client'

/**
 * The Requests reading of the rail frame. The frame itself now lives in
 * components/tahi/rail/rail-layout.tsx, which the Tasks page composes too;
 * <RequestsRailLayout> is a thin wrapper over it that supplies the Requests
 * rail, the counted noun and the merged chip row. Its props and behaviour are
 * unchanged.
 *
 * Also owns `useRequestsRailState`, the per-user preference layer behind it:
 * `requests.view`, `requests.savedView`, `requests.filters`, `requests.sort`
 * and the `requests.default` snapshot, plus a one-time migration off the
 * pre-rail `requests.viewMode` / `requests.activeTab` / `requests.sortKey`
 * keys so nobody loses the view they had. The URL's share of the state lives
 * there too, both the per-dimension overrides and the link-only narrowing
 * (priority, person), because the saved-view stand-down needs to see all of
 * it at once to know when it can lift.
 *
 * The main column is `min-width: 0`, so the kanban and timeline scroll inside
 * it and the page header above keeps the same width in every view.
 */

import * as React from 'react'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'
import {
  DEFAULT_REQUEST_FILTERS,
  DEFAULT_REQUEST_SORT,
  REQUESTS_VIEW_KEYS,
  isRequestsFilters,
  isRequestsSnapshot,
  isRequestsSort,
  migrateLegacySortKey,
  migrateLegacyTab,
  normaliseViewKey,
  savedViewsFor,
  snapshotsEqual,
  type RequestsAudience,
  type RequestsFilters,
  type RequestsSnapshot,
  type RequestsSort,
  type RequestsViewKey,
} from '@/lib/requests-views'
import {
  RequestsRail,
  SaveDefaultControl,
  type RequestsFilterChip,
  type RequestsRailProps,
} from '@/components/tahi/requests/requests-rail'
import { RailLayout } from '@/components/tahi/rail/rail-layout'
import type { RailFilterChip } from '@/components/tahi/rail/rail-controls'
import {
  EMPTY_REQUESTS_URL_NARROW,
  clearRequestsNarrow,
  requestsUrlStillNarrows,
  type RequestsNarrowChip,
  type RequestsNarrowKey,
  type RequestsUrlNarrow,
  type RequestsUrlState,
} from '@/lib/requests-url-state'

// ── Preference migration ─────────────────────────────────────────────────────

const PREF_PREFIX = 'tahi-pref:'
const MIGRATION_KEY = 'requests.railMigrated'

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
 *
 * Scope, stated plainly so nobody reads more into it. Both the snapshot and
 * the rail keys live in localStorage, so this fills a GAP IN ONE BROWSER: a
 * key the user never touched, or one that has been cleared while the snapshot
 * survived. It cannot carry a default to a second machine, and clearing
 * storage takes the snapshot with it, so a fresh browser still opens on the
 * built-in List / All requests view. Reaching further needs the snapshot
 * persisted server-side (a settings key), which is open work on the API side.
 * The Reset to default control is what applies the snapshot on demand.
 */
export function applyStoredRequestDefault(): void {
  if (typeof window === 'undefined') return
  const stored = readPref('requests.default')
  if (!isRequestsSnapshot(stored)) return
  if (readPref('requests.view') === undefined) writePref('requests.view', stored.view)
  if (readPref('requests.savedView') === undefined) writePref('requests.savedView', stored.savedView)
  if (readPref('requests.filters') === undefined) writePref('requests.filters', stored.filters)
  if (readPref('requests.sort') === undefined) writePref('requests.sort', stored.sort)
}

/**
 * Carry the pre-rail preferences over to the new keys, once. Runs during the
 * first client render (before `useUserPreference` hydrates on mount), guarded
 * by its own flag so it never overwrites a choice the user has since made. The
 * old keys are left in place rather than deleted: they still drive the legacy
 * toolbar for everyone who is not on the rail.
 */
export function migrateLegacyRequestPreferences(): void {
  if (typeof window === 'undefined') return
  if (readPref(MIGRATION_KEY) === true) return

  const legacyView = readPref('requests.viewMode')
  if (legacyView !== undefined && readPref('requests.view') === undefined) {
    writePref('requests.view', legacyView === 'board' ? 'kanban' : legacyView)
  }

  const legacyTab = readPref('requests.activeTab')
  if (legacyTab !== undefined && readPref('requests.savedView') === undefined) {
    writePref('requests.savedView', migrateLegacyTab(legacyTab))
  }

  const legacySort = migrateLegacySortKey(readPref('requests.sortKey'))
  if (legacySort && readPref('requests.sort') === undefined) {
    writePref('requests.sort', legacySort)
  }

  writePref(MIGRATION_KEY, true)
}

// ── Preference state ─────────────────────────────────────────────────────────

const isSavedViewKey = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isSnapshot = (v: unknown): v is RequestsSnapshot | null => v === null || isRequestsSnapshot(v)

export interface RequestsRailState {
  view: RequestsViewKey
  setView: (next: RequestsViewKey) => void
  savedView: string | null
  setSavedView: (next: string | null) => void
  filters: RequestsFilters
  setFilters: (next: RequestsFilters) => void
  sort: RequestsSort
  setSort: (next: RequestsSort) => void
  query: string
  setQuery: (next: string) => void
  /**
   * The link-only dimensions (priority, person). Held here rather than in the
   * page, because they are half of what stands the saved view down: the
   * stand-down has to lift when the LAST url-derived narrowing goes, and only
   * the hook can see both halves at once.
   */
  narrow: RequestsUrlNarrow
  /** Drop one link-only dimension, keeping the other. */
  clearNarrow: (key: RequestsNarrowKey) => void
  /** Drop both, e.g. from the chip row's Clear all. */
  clearAllNarrow: () => void
  /** True when the live state matches the saved default exactly. */
  isDefault: boolean
  saveDefault: () => void
  /** True once a default has been saved, so a reset has somewhere to go. */
  hasDefault: boolean
  /** Put the view, saved view, filters and sort back to the saved default. */
  resetToDefault: () => void
}

/**
 * Every piece of rail state the user gets to keep. Values are normalised for
 * the current audience on read rather than in an effect, so a client carrying
 * a stored Workload view or a stored client filter simply never sees it, with
 * no extra render and no write back over their admin preference.
 */
export function useRequestsRailState({
  audience,
  initialQuery = '',
  enabled = true,
  initialUrlState,
}: {
  audience: RequestsAudience
  initialQuery?: string
  /** Only users actually on the rail get their pre-rail keys migrated. */
  enabled?: boolean
  /**
   * What the URL asked for, read once on the first render (see
   * `lib/requests-url-state.ts`). Each named dimension sits OVER the stored
   * preference rather than replacing it, so `?category=design` narrows the
   * category and leaves the user's status, client and sort exactly as they
   * left them. Touching a control drops the override for that dimension and
   * persists what is on screen, which is what makes a chip clearable.
   *
   * Read in a state initialiser, so a later render passing a different object
   * changes nothing: this is the entry state, not a controlled prop.
   */
  initialUrlState?: RequestsUrlState
}): RequestsRailState {
  // Runs during the first client render, ahead of every hydration effect
  // below: the legacy keys are carried over first, then the saved default
  // fills whatever is still unset.
  React.useState(() => {
    if (enabled) {
      migrateLegacyRequestPreferences()
      applyStoredRequestDefault()
    }
    return null
  })

  // The URL's share of the state, held separately from the stored keys so it
  // can win per dimension without ever being written to localStorage on its
  // own. Cleared the moment the user sets that dimension by hand.
  const [urlOverrides, setUrlOverrides] = React.useState<{
    filters: Partial<RequestsFilters>
    view: RequestsViewKey | null
    sort: RequestsSort | null
    /** A URL that narrows the list stands the stored saved view down, so a
     *  link cannot land on a pre-filter that hides the very rows it named.
     *  See `clearsSavedView` in lib/requests-url-state.ts. Held with the rest
     *  of the URL's share, and only ever consulted while a URL-derived
     *  narrowing is still on screen (see `savedView` below). */
    clearSavedView: boolean
  }>(() => ({
    filters: initialUrlState?.filters ?? {},
    view: initialUrlState?.view ?? null,
    sort: initialUrlState?.sort ?? null,
    clearSavedView: initialUrlState?.clearsSavedView ?? false,
  }))

  // Priority and person have no rail control, so they narrow the rows on
  // their own and raise their own clearable chips. They live here rather than
  // in the page because they are the other half of the stand-down above.
  const [narrow, setNarrow] = React.useState<RequestsUrlNarrow>(
    () => initialUrlState?.narrow ?? EMPTY_REQUESTS_URL_NARROW,
  )

  const [storedView, setStoredView] = useUserPreference<RequestsViewKey>(
    'requests.view',
    'list',
    { validator: oneOf<RequestsViewKey>(REQUESTS_VIEW_KEYS) },
  )
  const [storedSavedView, setStoredSavedView] = useUserPreference<string | null>(
    'requests.savedView',
    null,
    { validator: isSavedViewKey },
  )
  const [storedFilters, setStoredFilters] = useUserPreference<RequestsFilters>(
    'requests.filters',
    DEFAULT_REQUEST_FILTERS,
    { validator: isRequestsFilters },
  )
  const [storedSort, setStoredSort] = useUserPreference<RequestsSort>(
    'requests.sort',
    DEFAULT_REQUEST_SORT,
    { validator: isRequestsSort },
  )
  const [storedDefault, setStoredDefault] = useUserPreference<RequestsSnapshot | null>(
    'requests.default',
    null,
    { validator: isSnapshot },
  )
  const [query, setQuery] = React.useState(initialQuery)

  const view = normaliseViewKey(urlOverrides.view ?? storedView, audience)

  // A saved view this audience does not have means All requests, not nothing.
  // So does one the URL stood down: a link that names a status or a person is
  // the more specific instruction, and a stored pre-filter that hides those
  // rows would answer it with an empty list.
  //
  // The stand-down lasts exactly as long as the narrowing that caused it.
  // Clear the last URL-derived chip and the user's saved view comes back on
  // its own, rather than staying quietly suppressed for the rest of the page
  // with nothing on screen to explain it.
  const stillNarrowed = requestsUrlStillNarrows(urlOverrides.filters, narrow)
  const activeSavedView = urlOverrides.clearSavedView && stillNarrowed ? null : storedSavedView
  const savedView = activeSavedView && savedViewsFor(audience).some(v => v.key === activeSavedView)
    ? activeSavedView
    : null

  // Only Tahi has a client picker, so nobody else can be narrowed by one,
  // whether the narrowing came from storage or from the URL.
  const filters = React.useMemo<RequestsFilters>(
    () => {
      const merged = { ...storedFilters, ...urlOverrides.filters }
      return audience === 'admin' ? merged : { ...merged, client: 'all' }
    },
    [audience, storedFilters, urlOverrides.filters],
  )

  const sort = urlOverrides.sort ?? storedSort

  // Setting a dimension by hand persists what is on screen (URL value
  // included) and drops the override, so the control, the chip and the stored
  // preference cannot disagree afterwards.
  const setView = React.useCallback((next: RequestsViewKey) => {
    setUrlOverrides(o => (o.view === null ? o : { ...o, view: null }))
    setStoredView(next)
  }, [setStoredView])

  const setFilters = React.useCallback((next: RequestsFilters) => {
    setUrlOverrides(o => (Object.keys(o.filters).length === 0 ? o : { ...o, filters: {} }))
    setStoredFilters(next)
  }, [setStoredFilters])

  const setSort = React.useCallback((next: RequestsSort) => {
    setUrlOverrides(o => (o.sort === null ? o : { ...o, sort: null }))
    setStoredSort(next)
  }, [setStoredSort])

  // Picking a saved view by hand is the user overruling the link, so the
  // stand-down lifts and the stored key is authoritative again. Without this,
  // choosing "All active" after following a status link would write the key
  // and still render All requests.
  const setSavedView = React.useCallback((next: string | null) => {
    setUrlOverrides(o => (o.clearSavedView ? { ...o, clearSavedView: false } : o))
    setStoredSavedView(next)
  }, [setStoredSavedView])

  const clearNarrow = React.useCallback((key: RequestsNarrowKey) => {
    setNarrow(n => clearRequestsNarrow(n, key))
  }, [])

  const clearAllNarrow = React.useCallback(() => {
    setNarrow(EMPTY_REQUESTS_URL_NARROW)
  }, [])

  const isDefault = snapshotsEqual(storedDefault, { view, savedView, filters, sort })

  // Saving is the user adopting what is on screen, so the URL's share of it
  // stops being an override and becomes the preference. Writing only the
  // snapshot would record `?category=design` while `requests.filters` still
  // said `all`, and because `applyStoredRequestDefault` only fills keys that
  // are unset, the next plain visit would open on the OLD filters with
  // "Reset to default" as the sole tell that the save never took.
  const saveDefault = React.useCallback(() => {
    setStoredDefault({ view, savedView, filters, sort })
    setStoredView(view)
    setStoredSavedView(savedView)
    setStoredFilters(filters)
    setStoredSort(sort)
    setUrlOverrides({ filters: {}, view: null, sort: null, clearSavedView: false })
  }, [
    setStoredDefault, setStoredView, setStoredSavedView, setStoredFilters, setStoredSort,
    view, savedView, filters, sort,
  ])

  // The snapshot's other reader: put everything back where the user saved it,
  // so wandering off the default is recoverable without rebuilding it by hand.
  // Every override goes too, the link-only dimensions included, or the URL
  // would keep overruling the reset.
  const resetToDefault = React.useCallback(() => {
    if (!storedDefault) return
    setUrlOverrides({ filters: {}, view: null, sort: null, clearSavedView: false })
    setNarrow(EMPTY_REQUESTS_URL_NARROW)
    setStoredView(storedDefault.view)
    setStoredSavedView(storedDefault.savedView)
    setStoredFilters(storedDefault.filters)
    setStoredSort(storedDefault.sort)
  }, [storedDefault, setStoredView, setStoredSavedView, setStoredFilters, setStoredSort])

  return {
    view,
    setView,
    savedView,
    setSavedView,
    filters,
    setFilters,
    sort,
    setSort,
    query,
    setQuery,
    narrow,
    clearNarrow,
    clearAllNarrow,
    isDefault,
    saveDefault,
    hasDefault: storedDefault !== null,
    resetToDefault,
  }
}

// ── The frame ────────────────────────────────────────────────────────────────

export interface RequestsRailLayoutProps {
  /** Everything the rail needs. Rendered twice: the desktop rail and the
   *  mobile sheet, the second with 44px targets. */
  railProps: RequestsRailProps
  /** The four-view switcher. */
  switcher: React.ReactNode
  chips: readonly RequestsFilterChip[]
  onClearChip: (chip: RequestsFilterChip) => void
  /** Chips for the dimensions only a link can set (priority, assignee). They
   *  sit after the rail's own so the row reads rail first, URL second. */
  narrowChips?: readonly RequestsNarrowChip[]
  onClearNarrowChip?: (chip: RequestsNarrowChip) => void
  onClearAll: () => void
  /** Put the view back to the saved default. Omitted when there is no saved
   *  default, or when the view already matches it. */
  onResetDefault?: () => void
  query: string
  onQueryChange: (next: string) => void
  searchPlaceholder: string
  /** Rows after the saved view, filters and search have been applied. */
  total: number
  /** Shows a quiet loading word in place of the count on the first fetch. */
  loading?: boolean
  children: React.ReactNode
}

/**
 * A thin wrapper over the generic <RailLayout>. Its props and its behaviour
 * are unchanged; what it adds is the Requests reading of them: the two chip
 * key spaces merged into one row, the counted noun, and the saved view's
 * contribution to the mobile Filters badge.
 */
export function RequestsRailLayout({
  railProps,
  switcher,
  chips,
  onClearChip,
  narrowChips = [],
  onClearNarrowChip,
  onClearAll,
  onResetDefault,
  query,
  onQueryChange,
  searchPlaceholder,
  total,
  loading = false,
  children,
}: RequestsRailLayoutProps) {
  // The URL-only dimensions have no rail control, so they ride the same chip
  // row prefixed to keep the two key spaces apart. Merging them here keeps
  // the mobile Filters badge at the same number it was before the split:
  // chips + narrowChips + (savedView ? 1 : 0).
  const allChips = React.useMemo<RailFilterChip[]>(
    () => [
      ...chips.map(c => ({ key: c.key as string, dimension: c.dimension, label: c.label, dot: c.dot })),
      // A narrow chip carries no dot: none of its dimensions is a status.
      ...narrowChips.map(c => ({ key: `narrow-${c.key}`, dimension: c.dimension, label: c.label })),
    ],
    [chips, narrowChips],
  )

  const handleClearChip = React.useCallback((chip: RailFilterChip) => {
    if (chip.key.startsWith('narrow-')) {
      const original = narrowChips.find(c => `narrow-${c.key}` === chip.key)
      if (original) onClearNarrowChip?.(original)
      return
    }
    const original = chips.find(c => c.key === chip.key)
    if (original) onClearChip(original)
  }, [chips, narrowChips, onClearChip, onClearNarrowChip])

  return (
    <RailLayout
      rail={<RequestsRail {...railProps} />}
      railTouch={<RequestsRail {...railProps} touch />}
      switcher={switcher}
      chips={allChips}
      onClearChip={handleClearChip}
      onClearAll={onClearAll}
      onResetDefault={onResetDefault}
      query={query}
      onQueryChange={onQueryChange}
      searchPlaceholder={searchPlaceholder}
      total={total}
      itemNoun="request"
      loading={loading}
      extraActiveCount={railProps.savedView ? 1 : 0}
      saveDefaultTouch={
        <SaveDefaultControl isDefault={railProps.isDefault} onSave={railProps.onSaveDefault} touch />
      }
    >
      {children}
    </RailLayout>
  )
}


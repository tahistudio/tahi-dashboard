'use client'

/**
 * The Requests rail frame: the 232px rail beside the main column, the view
 * switcher / search / count row, the active-filter chips, and the mobile
 * Filters sheet that stands in for the rail below 1024px.
 *
 * Also owns `useRequestsRailState`, the per-user preference layer behind it:
 * `requests.view`, `requests.savedView`, `requests.filters`, `requests.sort`
 * and the `requests.default` snapshot, plus a one-time migration off the
 * pre-rail `requests.viewMode` / `requests.activeTab` / `requests.sortKey`
 * keys so nobody loses the view they had.
 *
 * The main column is `min-width: 0`, so the kanban and timeline scroll inside
 * it and the page header above keeps the same width in every view.
 */

import * as React from 'react'
import { Filter, Search, X } from 'lucide-react'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
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
  /** True when the live state matches the saved default exactly. */
  isDefault: boolean
  saveDefault: () => void
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
}: {
  audience: RequestsAudience
  initialQuery?: string
  /** Only users actually on the rail get their pre-rail keys migrated. */
  enabled?: boolean
}): RequestsRailState {
  // Runs during the first client render, ahead of every hydration effect below.
  React.useState(() => { if (enabled) migrateLegacyRequestPreferences(); return null })

  const [storedView, setStoredView] = useUserPreference<RequestsViewKey>(
    'requests.view',
    'list',
    { validator: oneOf<RequestsViewKey>(REQUESTS_VIEW_KEYS) },
  )
  const [storedSavedView, setSavedView] = useUserPreference<string | null>(
    'requests.savedView',
    null,
    { validator: isSavedViewKey },
  )
  const [storedFilters, setFilters] = useUserPreference<RequestsFilters>(
    'requests.filters',
    DEFAULT_REQUEST_FILTERS,
    { validator: isRequestsFilters },
  )
  const [sort, setSort] = useUserPreference<RequestsSort>(
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

  const view = normaliseViewKey(storedView, audience)

  // A saved view this audience does not have means All requests, not nothing.
  const savedView = storedSavedView && savedViewsFor(audience).some(v => v.key === storedSavedView)
    ? storedSavedView
    : null

  // Only Tahi has a client picker, so nobody else can be narrowed by one.
  const filters = React.useMemo<RequestsFilters>(
    () => (audience === 'admin' ? storedFilters : { ...storedFilters, client: 'all' }),
    [audience, storedFilters],
  )

  const isDefault = snapshotsEqual(storedDefault, { view, savedView, filters, sort })

  const saveDefault = React.useCallback(() => {
    setStoredDefault({ view, savedView, filters, sort })
  }, [setStoredDefault, view, savedView, filters, sort])

  return {
    view,
    setView: setStoredView,
    savedView,
    setSavedView,
    filters,
    setFilters,
    sort,
    setSort,
    query,
    setQuery,
    isDefault,
    saveDefault,
  }
}

// ── Chips ────────────────────────────────────────────────────────────────────

function FilterChip({ chip, onClear }: { chip: RequestsFilterChip; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center h-11 lg:h-8"
      style={{
        gap: '0.375rem',
        padding: '0 0 0 0.5625rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg)',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'var(--color-text)',
        whiteSpace: 'nowrap',
      }}
    >
      {chip.dot && (
        <span
          aria-hidden="true"
          style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: 'var(--radius-full)', background: chip.dot, flexShrink: 0 }}
        />
      )}
      <span style={{ color: 'var(--color-text-subtle)' }}>{chip.dimension}</span>
      <span>{chip.label}</span>
      <button
        type="button"
        onClick={onClear}
        className="tahi-focus-ring inline-flex items-center justify-center h-11 w-11 lg:h-6 lg:w-6"
        aria-label={`Clear the ${chip.dimension.toLowerCase()} filter`}
        style={{
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--color-text-subtle)',
          cursor: 'pointer',
          transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--color-bg-tertiary)'
          e.currentTarget.style.color = 'var(--color-text)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-subtle)'
        }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  )
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
  onClearAll: () => void
  query: string
  onQueryChange: (next: string) => void
  searchPlaceholder: string
  /** Rows after the saved view, filters and search have been applied. */
  total: number
  /** Shows a quiet loading word in place of the count on the first fetch. */
  loading?: boolean
  children: React.ReactNode
}

export function RequestsRailLayout({
  railProps,
  switcher,
  chips,
  onClearChip,
  onClearAll,
  query,
  onQueryChange,
  searchPlaceholder,
  total,
  loading = false,
  children,
}: RequestsRailLayoutProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const activeCount = chips.length + (railProps.savedView ? 1 : 0)

  return (
    <div className="flex" style={{ gap: '1.25rem' }}>
      <aside
        className="hidden lg:block"
        aria-label="Saved views, filters and sort"
        style={{ width: '14.5rem', flexShrink: 0 }}
      >
        <RequestsRail {...railProps} />
      </aside>

      <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '0.75rem' }}>
        <div className="flex items-center flex-wrap" style={{ gap: '0.625rem' }}>
          {switcher}

          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="tahi-focus-ring lg:hidden inline-flex items-center h-11 px-3.5 flex-shrink-0"
            aria-expanded={sheetOpen}
            style={{
              gap: '0.5rem',
              border: `1px solid ${activeCount > 0 ? 'var(--color-brand)' : 'var(--color-border)'}`,
              borderRadius: 'var(--radius-md)',
              background: activeCount > 0 ? 'var(--color-brand-50)' : 'var(--color-bg)',
              fontFamily: 'inherit',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: activeCount > 0 ? 'var(--color-brand-dark)' : 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            <Filter size={16} aria-hidden="true" />
            Filters
            {activeCount > 0 && (
              <span
                style={{
                  minWidth: '1.125rem',
                  padding: '0 0.25rem',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-brand)',
                  color: 'var(--color-text-on-dark)',
                  fontSize: '0.6875rem',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: '1.125rem',
                  textAlign: 'center',
                }}
              >
                {activeCount}
              </span>
            )}
          </button>

          <div className="hidden lg:block" style={{ flex: 1, minWidth: 0 }} />

          <div
            className="tahi-input-group tahi-focus-within flex items-center h-11 lg:h-8"
            style={{
              flex: '1 1 12rem',
              maxWidth: '20rem',
              minWidth: '9rem',
              gap: '0.4375rem',
              padding: '0 0.625rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg)',
            }}
          >
            <Search size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: '0.8125rem',
                color: 'var(--color-text)',
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                className="tahi-focus-ring inline-flex items-center justify-center h-11 w-11 lg:h-6 lg:w-6 flex-shrink-0"
                aria-label="Clear search"
                style={{
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          <span
            aria-live="polite"
            style={{
              flexShrink: 0,
              fontSize: '0.75rem',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--color-text-subtle)',
            }}
          >
            {loading ? 'Loading' : `${total} ${total === 1 ? 'request' : 'requests'}`}
          </span>
        </div>

        {chips.length > 0 && (
          <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
            {chips.map(chip => (
              <FilterChip key={chip.key} chip={chip} onClear={() => onClearChip(chip)} />
            ))}
          </div>
        )}

        {children}
      </div>

      <SlideOver
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Filters and sort"
        icon={<Filter size={15} />}
        maxWidth="22rem"
      >
        <SlideOver.Body>
          <RequestsRail {...railProps} touch />
        </SlideOver.Body>
        <SlideOver.Footer>
          <TahiButton variant="secondary" size="md" style={{ minHeight: '2.75rem' }} onClick={onClearAll}>
            Clear all
          </TahiButton>
          <SaveDefaultControl isDefault={railProps.isDefault} onSave={railProps.onSaveDefault} touch />
          <div style={{ flex: 1 }} />
          <TahiButton variant="primary" size="md" style={{ minHeight: '2.75rem' }} onClick={() => setSheetOpen(false)}>
            Show {total}
          </TahiButton>
        </SlideOver.Footer>
      </SlideOver>
    </div>
  )
}

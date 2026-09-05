'use client'

/**
 * <RequestsRail>. The left rail on the Requests page: saved views with live
 * counts, one select-style control per filter dimension, sort with a direction
 * toggle, Clear filters, and Save as default.
 *
 * The same component fills the desktop rail and the mobile Filters sheet; the
 * sheet passes `touch` so every control and every option is a 44px target.
 *
 * The controls themselves live in components/tahi/rail/rail-controls.tsx,
 * which the Tasks rail composes too. What stays here is the Requests
 * vocabulary: the dimension labels, the status option list and the chip
 * builder. SaveDefaultControl and RailOption are re-exported below so the
 * existing importers keep their paths.
 */

import * as React from 'react'
import { ArrowDownUp } from 'lucide-react'
import { REQUEST_STATUSES, REQUEST_STATUS_CONFIG } from '@/lib/status-config'
import {
  DEFAULT_REQUEST_FILTERS,
  REQUEST_SORT_KEYS,
  TYPE_FILTER_OPTIONS,
  CREATED_FILTER_OPTIONS,
  filterKeysFor,
  isFilterActive,
  savedViewsFor,
  sortDirLabel,
  sortKeyLabel,
  type RequestFilterKey,
  type RequestsAudience,
  type RequestsFilters,
  type RequestsSort,
  type RequestsSortKey,
} from '@/lib/requests-views'
import {
  RailSelect,
  RailViewItem,
  RailGroupLabel,
  SaveDefaultControl,
  type RailOption,
} from '@/components/tahi/rail/rail-controls'

// Re-exported so the existing importers (requests-rail-layout.tsx,
// request-list.tsx) keep working without a path change.
export { SaveDefaultControl }
export type { RailOption }

// ── Option shapes ────────────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<RequestFilterKey, string> = {
  status: 'Status',
  category: 'Category',
  client: 'Client',
  type: 'Type',
  created: 'Created',
}

/** Status options carry their pipeline dot so the control and the menu read
 *  the same as every other status surface. `draft` sits off the pipeline and
 *  is deliberately absent from REQUEST_STATUSES (it is not a status anyone
 *  moves work into), but requests do carry it, so the filter offers it last. */
const STATUS_OPTIONS: readonly RailOption[] = [
  { value: 'all', label: 'All statuses' },
  ...REQUEST_STATUSES.map(s => ({
    value: s.value,
    label: s.label,
    dot: REQUEST_STATUS_CONFIG[s.value]?.dot,
  })),
  {
    value: 'draft',
    label: REQUEST_STATUS_CONFIG.draft?.label ?? 'Draft',
    dot: REQUEST_STATUS_CONFIG.draft?.dot,
  },
]

/** One active filter, ready to render as a clearable chip under the view
 *  switcher. Built from the same option lists the controls use, so a chip can
 *  never disagree with the control that set it. */
export interface RequestsFilterChip {
  key: RequestFilterKey
  dimension: string
  label: string
  dot?: string
}

export function buildFilterChips(
  filters: RequestsFilters,
  audience: RequestsAudience,
  options: { categoryOptions: readonly RailOption[]; clientOptions: readonly RailOption[] },
): RequestsFilterChip[] {
  const lists: Record<RequestFilterKey, readonly RailOption[]> = {
    status: STATUS_OPTIONS,
    category: options.categoryOptions,
    client: options.clientOptions,
    type: TYPE_FILTER_OPTIONS,
    created: CREATED_FILTER_OPTIONS,
  }
  return filterKeysFor(audience)
    .filter(key => isFilterActive(filters, key))
    .map(key => {
      const match = lists[key].find(o => o.value === filters[key])
      return {
        key,
        dimension: DIMENSION_LABELS[key],
        label: match?.label ?? filters[key],
        dot: match?.dot,
      }
    })
}

// ── The rail ─────────────────────────────────────────────────────────────────

export interface RequestsRailProps {
  audience: RequestsAudience
  savedView: string | null
  onSavedViewChange: (next: string | null) => void
  counts: Record<string, number>
  filters: RequestsFilters
  onFiltersChange: (next: RequestsFilters) => void
  sort: RequestsSort
  onSortChange: (next: RequestsSort) => void
  /** Built from the loaded rows so a filter can only ever pick a real value. */
  categoryOptions: readonly RailOption[]
  clientOptions: readonly RailOption[]
  isDefault: boolean
  onSaveDefault: () => void
  /** 44px targets. Set inside the mobile sheet. */
  touch?: boolean
}

export function RequestsRail({
  audience,
  savedView,
  onSavedViewChange,
  counts,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  categoryOptions,
  clientOptions,
  isDefault,
  onSaveDefault,
  touch = false,
}: RequestsRailProps) {
  // One open menu at a time, the rail included, so a second click elsewhere
  // never leaves two floating panels on screen.
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  const close = React.useCallback(() => setOpenKey(null), [])
  const toggle = React.useCallback((key: string) => {
    setOpenKey(current => (current === key ? null : key))
  }, [])

  const views = savedViewsFor(audience)
  const dimensions = filterKeysFor(audience)
  const showClear = dimensions.some(k => isFilterActive(filters, k))

  const optionsFor = (key: RequestFilterKey): readonly RailOption[] => {
    switch (key) {
      case 'status':   return STATUS_OPTIONS
      case 'category': return categoryOptions
      case 'client':   return clientOptions
      case 'type':     return TYPE_FILTER_OPTIONS
      case 'created':  return CREATED_FILTER_OPTIONS
    }
  }

  const setFilter = (key: RequestFilterKey, value: string) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
      <div>
        <RailGroupLabel>Views</RailGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          <RailViewItem
            label="All requests"
            count={counts.__all ?? 0}
            active={!savedView}
            onClick={() => onSavedViewChange(null)}
            touch={touch}
          />
          {views.map(view => (
            <RailViewItem
              key={view.key}
              label={view.label}
              count={counts[view.key] ?? 0}
              active={savedView === view.key}
              onClick={() => onSavedViewChange(view.key)}
              touch={touch}
            />
          ))}
        </div>
      </div>

      <div>
        <RailGroupLabel>Filters</RailGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: touch ? '0.5rem' : '0.375rem' }}>
          {dimensions.map(key => (
            <RailSelect
              key={key}
              label={DIMENSION_LABELS[key]}
              options={optionsFor(key)}
              value={filters[key]}
              onChange={value => setFilter(key, value)}
              open={openKey === key}
              onToggle={() => toggle(key)}
              onClose={close}
              active={isFilterActive(filters, key)}
              onClear={() => setFilter(key, DEFAULT_REQUEST_FILTERS[key])}
              searchable={key === 'client'}
              searchLabel="Search clients"
              touch={touch}
            />
          ))}
        </div>
      </div>

      <div>
        <RailGroupLabel>Sort</RailGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: touch ? '0.5rem' : '0.375rem' }}>
          <RailSelect
            label="Sort"
            options={REQUEST_SORT_KEYS.map(k => ({ value: k.value, label: k.label }))}
            value={sort.key}
            onChange={value => onSortChange({ key: value as RequestsSortKey, dir: sort.dir })}
            open={openKey === 'sort'}
            onToggle={() => toggle('sort')}
            onClose={close}
            touch={touch}
          />
          <button
            type="button"
            onClick={() => onSortChange({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            className="tahi-focus-ring"
            title="Reverse the sort order"
            aria-label={`Sort order: ${sortDirLabel(sort)}. Reverse it.`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4375rem',
              width: '100%',
              minHeight: touch ? '2.75rem' : '1.9375rem',
              padding: '0 0.625rem',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg)',
              fontFamily: 'inherit',
              fontSize: '0.71875rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.color = 'var(--color-text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            <ArrowDownUp size={13} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }} />
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sortDirLabel(sort)}
            </span>
          </button>
          <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            Sorted by {sortKeyLabel(sort).toLowerCase()}. Delivered and archived work always sits last.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
        {showClear && (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...DEFAULT_REQUEST_FILTERS })}
            className="tahi-focus-ring"
            style={{
              minHeight: touch ? '2.75rem' : '2rem',
              padding: '0 0.5rem',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-text)'
              e.currentTarget.style.background = 'var(--color-bg-secondary)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-muted)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            Clear filters
          </button>
        )}
        <SaveDefaultControl isDefault={isDefault} onSave={onSaveDefault} touch={touch} />
      </div>
    </div>
  )
}

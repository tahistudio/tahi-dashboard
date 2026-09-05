'use client'

/**
 * <ClientsRail>. The left rail on the Clients page: the saved views with live
 * counts, one select-style control per filter dimension, sort with a
 * direction toggle, Clear filters, and Save as default.
 *
 * The same component fills the desktop rail and the mobile Filters sheet; the
 * sheet passes `touch` so every control and every option is a 2.75rem target.
 * Every control is RailSelect from components/tahi/rail, which is the same one
 * the Requests and Tasks rails use, so the three surfaces read as one.
 */

import * as React from 'react'
import { ArrowDownUp } from 'lucide-react'
import {
  RailSelect,
  RailViewItem,
  RailGroupLabel,
  SaveDefaultControl,
  buildRailChips,
  type RailOption,
  type RailFilterChip,
} from '@/components/tahi/rail/rail-controls'
import {
  CLIENTS_SAVED_VIEWS,
  CLIENT_DIMENSION_LABELS,
  CLIENT_FILTER_KEYS,
  CLIENT_HEALTH_KEYS,
  CLIENT_HEALTH_LABELS,
  CLIENT_PLANS,
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  CLIENT_TRACK_OPTIONS,
  DEFAULT_CLIENT_FILTERS,
  UNASSIGNED_OWNER,
  clientSortDirLabel,
  clientSortKeyLabel,
  clientSortKeys,
  isClientFilterActive,
  type ClientFilterKey,
  type ClientOwner,
  type ClientsFilters,
  type ClientsSort,
  type ClientsSortKey,
} from './clients-views'

/** Health options carry their dot so the control, the chip and the badge in
 *  the row all read the same. */
const HEALTH_DOTS: Record<string, string> = {
  red: 'var(--badge-danger-dot)',
  amber: 'var(--badge-warning-dot)',
  green: 'var(--badge-positive-dot)',
  none: 'var(--badge-neutral-dot)',
}

const STATUS_DOTS: Record<string, string> = {
  active: 'var(--badge-positive-dot)',
  paused: 'var(--badge-warning-dot)',
  churned: 'var(--badge-danger-dot)',
  archived: 'var(--badge-neutral-dot)',
}

const STATUS_OPTIONS: readonly RailOption[] = [
  { value: 'all', label: 'All statuses' },
  ...CLIENT_STATUSES.map(s => ({
    value: s,
    label: CLIENT_STATUS_LABELS[s] ?? s,
    dot: STATUS_DOTS[s],
  })),
]

const PLAN_OPTIONS: readonly RailOption[] = [
  { value: 'all', label: 'All plans' },
  ...CLIENT_PLANS.map(p => ({ value: p.value, label: p.label })),
]

const HEALTH_OPTIONS: readonly RailOption[] = [
  { value: 'all', label: 'Any health' },
  ...CLIENT_HEALTH_KEYS.map(k => ({ value: k, label: CLIENT_HEALTH_LABELS[k], dot: HEALTH_DOTS[k] })),
]

const TRACK_OPTIONS: readonly RailOption[] = CLIENT_TRACK_OPTIONS.map(o => ({ value: o.value, label: o.label }))

/** Tag options are built from the loaded rows, so a filter can only ever pick
 *  a label that exists on a client today. */
export function clientTagOptions(tags: readonly string[]): RailOption[] {
  return [{ value: 'all', label: 'Any tag' }, ...tags.map(t => ({ value: t, label: t }))]
}

/**
 * Owner options come from the access rules rather than the loaded page, so the
 * control can name a project manager whose clients all sit on page two.
 * "Nobody assigned" is offered whenever the owner index was readable at all,
 * because an account with no owner is the thing this filter is most often
 * looking for.
 */
export function clientOwnerOptions(owners: readonly ClientOwner[], known: boolean): RailOption[] {
  const out: RailOption[] = [{ value: 'all', label: 'Anyone' }]
  if (known) out.push({ value: UNASSIGNED_OWNER, label: 'Nobody assigned' })
  for (const owner of owners) out.push({ value: owner.id, label: owner.name })
  return out
}

/** The chip builder the shell reads, kept beside the option lists the controls
 *  use so a chip can never disagree with the control that set it. */
export function buildClientChips(
  filters: ClientsFilters,
  tagOptions: readonly RailOption[],
  ownerOptions: readonly RailOption[],
): RailFilterChip[] {
  const lists: Record<ClientFilterKey, readonly RailOption[]> = {
    status: STATUS_OPTIONS,
    plan: PLAN_OPTIONS,
    health: HEALTH_OPTIONS,
    owner: ownerOptions,
    tag: tagOptions,
    tracks: TRACK_OPTIONS,
  }
  return buildRailChips(
    filters as unknown as Record<string, string>,
    DEFAULT_CLIENT_FILTERS as unknown as Record<string, string>,
    CLIENT_FILTER_KEYS.map(key => ({
      key,
      label: CLIENT_DIMENSION_LABELS[key],
      options: lists[key],
    })),
  )
}

export interface ClientsRailProps {
  savedView: string | null
  onSavedViewChange: (next: string | null) => void
  counts: Record<string, number>
  filters: ClientsFilters
  onFiltersChange: (next: ClientsFilters) => void
  sort: ClientsSort
  onSortChange: (next: ClientsSort) => void
  /** Built from the loaded rows, already carrying its "Any tag" entry. */
  tagOptions: readonly RailOption[]
  /** Built from the access rules, already carrying its "Anyone" entry. */
  ownerOptions: readonly RailOption[]
  /** Hides the MRR sort key from anyone who cannot see money. */
  canSeeMoney: boolean
  /**
   * What the counts beside the saved views actually cover. The endpoint pages
   * at 50 and returns no total, so once there is more than one page the counts
   * describe the clients loaded rather than the roster, and saying so is the
   * difference between a count and a claim.
   */
  countsNote?: string | null
  isDefault: boolean
  onSaveDefault: () => void
  /** 2.75rem targets. Set inside the mobile Filters sheet. */
  touch?: boolean
}

export function ClientsRail({
  savedView,
  onSavedViewChange,
  counts,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  tagOptions,
  ownerOptions,
  canSeeMoney,
  countsNote = null,
  isDefault,
  onSaveDefault,
  touch = false,
}: ClientsRailProps): React.ReactElement {
  // One open menu at a time, the rail included, so a second click elsewhere
  // never leaves two floating panels on screen.
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  const close = React.useCallback(() => setOpenKey(null), [])
  const toggle = React.useCallback((key: string) => {
    setOpenKey(current => (current === key ? null : key))
  }, [])

  const showClear = CLIENT_FILTER_KEYS.some(k => isClientFilterActive(filters, k))

  // A total switch, so a sixth dimension cannot be added to
  // CLIENT_FILTER_KEYS without a control to drive it.
  const optionsFor = (key: ClientFilterKey): readonly RailOption[] => {
    switch (key) {
      case 'status': return STATUS_OPTIONS
      case 'plan': return PLAN_OPTIONS
      case 'health': return HEALTH_OPTIONS
      case 'owner': return ownerOptions
      case 'tag': return tagOptions
      case 'tracks': return TRACK_OPTIONS
    }
  }

  const setFilter = (key: ClientFilterKey, value: string) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  const sortOptions = clientSortKeys(canSeeMoney)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
      <div>
        <RailGroupLabel>Views</RailGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          <RailViewItem
            label="All clients"
            count={counts.__all ?? 0}
            active={!savedView}
            onClick={() => onSavedViewChange(null)}
            touch={touch}
          />
          {CLIENTS_SAVED_VIEWS.map(view => (
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
        {countsNote && (
          <p style={{ margin: '0.375rem 0 0', fontSize: '0.6875rem', lineHeight: 1.35, color: 'var(--color-text-subtle)' }}>
            {countsNote}
          </p>
        )}
      </div>

      <div>
        <RailGroupLabel>Filters</RailGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: touch ? '0.5rem' : '0.375rem' }}>
          {CLIENT_FILTER_KEYS.map(key => (
            <RailSelect
              key={key}
              label={CLIENT_DIMENSION_LABELS[key]}
              options={optionsFor(key)}
              value={filters[key]}
              onChange={value => setFilter(key, value)}
              open={openKey === key}
              onToggle={() => toggle(key)}
              onClose={close}
              active={isClientFilterActive(filters, key)}
              onClear={() => setFilter(key, DEFAULT_CLIENT_FILTERS[key])}
              searchable={key === 'tag' || key === 'owner'}
              searchLabel={key === 'owner' ? 'Search people' : 'Search tags'}
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
            options={sortOptions.map(k => ({ value: k.value, label: k.label }))}
            value={sort.key}
            onChange={value => onSortChange({ key: value as ClientsSortKey, dir: sort.dir })}
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
            aria-label={`Sort order: ${clientSortDirLabel(sort)}. Reverse it.`}
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
              {clientSortDirLabel(sort)}
            </span>
          </button>
          <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            Sorted by {clientSortKeyLabel(sort).toLowerCase()}.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
        {showClear && (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...DEFAULT_CLIENT_FILTERS })}
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

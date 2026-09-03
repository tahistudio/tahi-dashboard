'use client'

/**
 * <RequestsRail>. The left rail on the Requests page: saved views with live
 * counts, one select-style control per filter dimension, sort with a direction
 * toggle, Clear filters, and Save as default.
 *
 * The same component fills the desktop rail and the mobile Filters sheet; the
 * sheet passes `touch` so every control and every option is a 44px target.
 *
 * Each control is a 36px full-width button (label left, value right, chevron
 * far right) whose options open in a portaled <Popover>, so the rail's own
 * scroll box can never clip a menu. An active control takes a brand border and
 * grows a clear button that sits inside it, just before the chevron.
 */

import * as React from 'react'
import { Check, ChevronDown, ArrowDownUp, Search, X, Bookmark } from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
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
  type FilterOption,
  type RequestFilterKey,
  type RequestsAudience,
  type RequestsFilters,
  type RequestsSort,
  type RequestsSortKey,
} from '@/lib/requests-views'

// ── Option shapes ────────────────────────────────────────────────────────────

export interface RailOption extends FilterOption {
  /** Colour token for a leading status dot. */
  dot?: string
}

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

// ── The select control ───────────────────────────────────────────────────────

interface RailSelectProps {
  label: string
  options: readonly RailOption[]
  value: string
  onChange: (next: string) => void
  open: boolean
  onToggle: () => void
  onClose: () => void
  /** Shows the clear button and paints the brand border. */
  active?: boolean
  onClear?: () => void
  /** Adds a filter field above the options. The client list keeps growing. */
  searchable?: boolean
  searchLabel?: string
  /** 44px targets for the mobile sheet. */
  touch?: boolean
}

function RailSelect({
  label,
  options,
  value,
  onChange,
  open,
  onToggle,
  onClose,
  active = false,
  onClear,
  searchable = false,
  searchLabel = 'Search',
  touch = false,
}: RailSelectProps) {
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const [term, setTerm] = React.useState('')

  // A stale search term would hide the options the next time the menu opens.
  React.useEffect(() => { if (!open) setTerm('') }, [open])

  const current = options.find(o => o.value === value)
  const needle = term.trim().toLowerCase()
  const visible = searchable && needle
    ? options.filter(o => o.label.toLowerCase().includes(needle))
    : options

  const height = touch ? '2.75rem' : '2.25rem'
  const optionHeight = touch ? '2.75rem' : '2.125rem'
  // The chevron stays pinned to the right edge in every state, so a row of
  // controls keeps one vertical line down the rail. The clear button is laid
  // over the gap just before it, and the value simply keeps clear of both.
  const clearSize = touch ? '2rem' : '1.25rem'
  const valueGutter = active ? (touch ? '3.125rem' : '2.375rem') : '0'

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        className="tahi-focus-ring"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? value}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '100%',
          minHeight: height,
          padding: '0 0.5rem 0 0.625rem',
          border: `1px solid ${active || open ? 'var(--color-brand)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg)',
          fontSize: touch ? '0.84375rem' : '0.78125rem',
          fontWeight: 600,
          fontFamily: 'inherit',
          color: 'var(--color-text)',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'border-color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--color-brand)'
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = active || open ? 'var(--color-brand)' : 'var(--color-border)'
          e.currentTarget.style.background = 'var(--color-bg)'
        }}
      >
        <span style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }}>{label}</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            minWidth: 0,
            marginLeft: 'auto',
            marginRight: valueGutter,
            color: active ? 'var(--color-brand-dark)' : 'var(--color-text)',
          }}
        >
          {current?.dot && (
            <span
              aria-hidden="true"
              style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: 'var(--radius-full)', background: current.dot, flexShrink: 0 }}
            />
          )}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {current?.label ?? value}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: 'var(--color-text-subtle)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--motion-quick) var(--ease-out)',
          }}
        />
      </button>

      {active && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="tahi-focus-ring"
          title={`Clear the ${label.toLowerCase()} filter`}
          aria-label={`Clear the ${label.toLowerCase()} filter`}
          style={{
            position: 'absolute',
            top: '50%',
            right: '1.625rem',
            transform: 'translateY(-50%)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: clearSize,
            height: clearSize,
            padding: 0,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-brand)'
            e.currentTarget.style.color = 'var(--color-text-on-dark)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--color-bg-tertiary)'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          <X size={touch ? 14 : 11} aria-hidden="true" />
        </button>
      )}

      <Popover
        anchorRef={triggerRef}
        open={open}
        onClose={onClose}
        width="15rem"
        maxHeight="22rem"
      >
        {searchable && (
          <div
            className="tahi-focus-within"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4375rem',
              minHeight: touch ? '2.75rem' : '2.25rem',
              padding: '0 0.625rem',
              flexShrink: 0,
            }}
          >
            <Search size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            <input
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder={searchLabel}
              aria-label={searchLabel}
              autoFocus
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: touch ? '1rem' : '0.8125rem',
                color: 'var(--color-text)',
              }}
            />
          </div>
        )}
        {searchable && (
          <div
            role="separator"
            aria-orientation="horizontal"
            style={{ height: '1px', background: 'var(--color-border-subtle)', flexShrink: 0 }}
          />
        )}
        <div role="listbox" aria-label={label} style={{ overflowY: 'auto', padding: '0.25rem', minHeight: 0 }}>
          {visible.length === 0 && (
            <p style={{ margin: 0, padding: '0.5rem 0.5625rem', fontSize: '0.78125rem', color: 'var(--color-text-subtle)' }}>
              No matches
            </p>
          )}
          {visible.map(option => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className="tahi-focus-ring"
                onClick={() => { onChange(option.value); onClose() }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  minHeight: optionHeight,
                  padding: '0 0.5rem',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  fontSize: '0.78125rem',
                  fontWeight: selected ? 600 : 500,
                  color: 'var(--color-text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background-color var(--motion-quick) var(--ease-out)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {option.dot && (
                  <span
                    aria-hidden="true"
                    style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: 'var(--radius-full)', background: option.dot, flexShrink: 0 }}
                  />
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {option.label}
                </span>
                {selected && <Check size={14} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-brand)' }} />}
              </button>
            )
          })}
        </div>
      </Popover>
    </div>
  )
}

// ── Saved view row ───────────────────────────────────────────────────────────

function ViewItem({
  label,
  count,
  active,
  onClick,
  touch,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  touch: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tahi-focus-ring"
      aria-pressed={active}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        width: '100%',
        minHeight: touch ? '2.75rem' : '2.125rem',
        padding: '0 0.625rem',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--color-brand-50)' : 'transparent',
        fontFamily: 'inherit',
        fontSize: touch ? '0.84375rem' : '0.78125rem',
        fontWeight: 600,
        color: active ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        if (active) return
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
        e.currentTarget.style.color = 'var(--color-text)'
      }}
      onMouseLeave={e => {
        if (active) return
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-text-muted)'
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span
        style={{
          flexShrink: 0,
          fontSize: '0.6875rem',
          fontVariantNumeric: 'tabular-nums',
          color: active ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
          opacity: active ? 0.75 : 1,
        }}
      >
        {count}
      </span>
    </button>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.625rem',
        fontWeight: 700,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
        marginBottom: '0.5rem',
      }}
    >
      {children}
    </div>
  )
}

// ── Save as default ──────────────────────────────────────────────────────────

export function SaveDefaultControl({ isDefault, onSave, touch = false }: {
  isDefault: boolean
  onSave: () => void
  touch?: boolean
}) {
  const shared: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    minHeight: touch ? '2.75rem' : '2rem',
    padding: '0 0.5rem',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    fontFamily: 'inherit',
    fontSize: '0.75rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  }

  // One element across both states. Swapping the button for a <span> once the
  // view was saved destroyed the element holding focus, so a keyboard user who
  // pressed Enter here landed back on <body> and the next Tab restarted at the
  // top of the document. `aria-disabled` rather than `disabled` keeps the
  // settled control focusable and the label live, so the change announces in
  // place instead of vanishing silently.
  return (
    <button
      type="button"
      onClick={() => { if (!isDefault) onSave() }}
      aria-disabled={isDefault || undefined}
      className="tahi-focus-ring"
      title={isDefault
        ? 'This view, these filters, and this sort are already your default'
        : 'Remember this view, these filters, and this sort'}
      style={{
        ...shared,
        color: isDefault ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
        cursor: isDefault ? 'default' : 'pointer',
        transition: 'color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        if (isDefault) return
        e.currentTarget.style.color = 'var(--color-brand-dark)'
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
      }}
      onMouseLeave={e => {
        if (isDefault) return
        e.currentTarget.style.color = 'var(--color-text-muted)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {isDefault
        ? <Check size={13} aria-hidden="true" />
        : <Bookmark size={13} aria-hidden="true" />}
      <span aria-live="polite">{isDefault ? 'Your default' : 'Save as default'}</span>
    </button>
  )
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
        <GroupLabel>Views</GroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          <ViewItem
            label="All requests"
            count={counts.__all ?? 0}
            active={!savedView}
            onClick={() => onSavedViewChange(null)}
            touch={touch}
          />
          {views.map(view => (
            <ViewItem
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
        <GroupLabel>Filters</GroupLabel>
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
        <GroupLabel>Sort</GroupLabel>
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

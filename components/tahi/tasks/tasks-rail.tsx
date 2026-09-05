'use client'

/**
 * <TasksRail>. The left rail on the Tasks page: seven saved views with live
 * counts, one select-style control per filter dimension, sort with a
 * direction toggle, Clear filters, and Save as default.
 *
 * The same component fills the desktop rail and the mobile Filters sheet;
 * the sheet passes `touch` so every control and every option is a 44px
 * target. Every control is RailSelect from components/tahi/rail, which is
 * the same one the Requests rail uses.
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
import { TASK_STATUSES, TASK_STATUS_CONFIG } from '@/lib/status-config'
import {
  DEFAULT_TASK_FILTERS,
  DUE_FILTER_OPTIONS,
  LEVEL_FILTER_OPTIONS,
  PRIORITY_FILTER_OPTIONS,
  TASKS_SAVED_VIEWS,
  TASK_DIMENSION_LABELS,
  TASK_FILTER_KEYS,
  TASK_SORT_KEYS,
  isTaskFilterActive,
  taskSortDirLabel,
  taskSortKeyLabel,
  type TaskFilterKey,
  type TasksFilters,
  type TasksSort,
  type TasksSortKey,
} from '@/lib/tasks-views'

/** Status options carry their dot so the control, the chip and the board
 *  column header all read the same. */
const STATUS_OPTIONS: readonly RailOption[] = [
  { value: 'all', label: 'All statuses' },
  ...TASK_STATUSES.map(s => ({
    value: s.value,
    label: s.label,
    dot: TASK_STATUS_CONFIG[s.value]?.dot,
  })),
]

export interface TasksRailProps {
  savedView: string | null
  onSavedViewChange: (next: string | null) => void
  counts: Record<string, number>
  filters: TasksFilters
  onFiltersChange: (next: TasksFilters) => void
  sort: TasksSort
  onSortChange: (next: TasksSort) => void
  /** Built from the loaded rows, so a filter can only ever pick a real
   *  value. Both already carry their "No client" / "Unassigned" entry. */
  clientOptions: readonly RailOption[]
  assigneeOptions: readonly RailOption[]
  isDefault: boolean
  onSaveDefault: () => void
  /** Set when the view on screen does not read the rail, so a control that
   *  cannot answer says why instead of sitting inert. My week is the one that
   *  does this: it draws the viewer's own open plate and nothing else. */
  note?: string
  /** 44px targets. Set inside the mobile sheet. */
  touch?: boolean
}

/** The chip builder the shell reads, kept beside the option lists the
 *  controls use so a chip can never disagree with the control that set it. */
export function buildTaskChips(
  filters: TasksFilters,
  options: { clientOptions: readonly RailOption[]; assigneeOptions: readonly RailOption[] },
): RailFilterChip[] {
  const lists: Record<TaskFilterKey, readonly RailOption[]> = {
    status: STATUS_OPTIONS,
    priority: PRIORITY_FILTER_OPTIONS,
    level: LEVEL_FILTER_OPTIONS,
    client: options.clientOptions,
    assignee: options.assigneeOptions,
    due: DUE_FILTER_OPTIONS,
  }
  return buildRailChips(
    filters as unknown as Record<string, string>,
    DEFAULT_TASK_FILTERS as unknown as Record<string, string>,
    TASK_FILTER_KEYS.map(key => ({
      key,
      label: TASK_DIMENSION_LABELS[key],
      options: lists[key],
    })),
  )
}

export function TasksRail({
  savedView,
  onSavedViewChange,
  counts,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  clientOptions,
  assigneeOptions,
  isDefault,
  onSaveDefault,
  note,
  touch = false,
}: TasksRailProps): React.ReactElement {
  // One open menu at a time, the rail included, so a second click elsewhere
  // never leaves two floating panels on screen.
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  const close = React.useCallback(() => setOpenKey(null), [])
  const toggle = React.useCallback((key: string) => {
    setOpenKey(current => (current === key ? null : key))
  }, [])

  const showClear = TASK_FILTER_KEYS.some(k => isTaskFilterActive(filters, k))

  // A total switch, so a seventh dimension cannot be added to
  // TASK_FILTER_KEYS without a control to drive it.
  const optionsFor = (key: TaskFilterKey): readonly RailOption[] => {
    switch (key) {
      case 'status':   return STATUS_OPTIONS
      case 'priority': return PRIORITY_FILTER_OPTIONS
      case 'level':    return LEVEL_FILTER_OPTIONS
      case 'client':   return clientOptions
      case 'assignee': return assigneeOptions
      case 'due':      return DUE_FILTER_OPTIONS
    }
  }

  const setFilter = (key: TaskFilterKey, value: string) => {
    onFiltersChange({ ...filters, [key]: value })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
      {note && (
        <p
          style={{
            margin: 0,
            padding: '0.5rem 0.625rem',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg-secondary)',
            fontSize: '0.6875rem',
            lineHeight: 1.5,
            color: 'var(--color-text-muted)',
          }}
        >
          {note}
        </p>
      )}

      <div>
        <RailGroupLabel>Views</RailGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          <RailViewItem
            label="All tasks"
            count={counts.__all ?? 0}
            active={!savedView}
            onClick={() => onSavedViewChange(null)}
            touch={touch}
          />
          {TASKS_SAVED_VIEWS.map(view => (
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
          {TASK_FILTER_KEYS.map(key => (
            <RailSelect
              key={key}
              label={TASK_DIMENSION_LABELS[key]}
              options={optionsFor(key)}
              value={filters[key]}
              onChange={value => setFilter(key, value)}
              open={openKey === key}
              onToggle={() => toggle(key)}
              onClose={close}
              active={isTaskFilterActive(filters, key)}
              onClear={() => setFilter(key, DEFAULT_TASK_FILTERS[key])}
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
            options={TASK_SORT_KEYS.map(k => ({ value: k.value, label: k.label }))}
            value={sort.key}
            onChange={value => onSortChange({ key: value as TasksSortKey, dir: sort.dir })}
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
            aria-label={`Sort order: ${taskSortDirLabel(sort)}. Reverse it.`}
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
              {taskSortDirLabel(sort)}
            </span>
          </button>
          <p style={{ margin: 0, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            Sorted by {taskSortKeyLabel(sort).toLowerCase()}. Done always sits last.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
        {showClear && (
          <button
            type="button"
            onClick={() => onFiltersChange({ ...DEFAULT_TASK_FILTERS })}
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

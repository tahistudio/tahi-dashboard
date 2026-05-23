'use client'

/**
 * <BoardView>. Multi-view shell that wraps Kanban / Table / Timeline
 * tabs around the same dataset.
 *
 *   <BoardView
 *     title="Engineering · Tasks"
 *     items={tasks}
 *     columns={taskColumns}
 *     defaultView="kanban"
 *     onMove={(id, status) => api.move(id, status)}
 *     onNest={(child, parent) => api.nest(child, parent)}
 *     onAdd={(status) => openDialog(status)}
 *     onToggleSubtask={(id, st) => api.toggle(id, st)}
 *     onItemClick={(item) => router.push(`/tasks/${item.id}`)}
 *   />
 *
 * Each view renderer receives the same BoardItem[] from kanban-board.tsx.
 * The shell handles the header (title, view tabs, search input,
 * filter button, "+ New") and lets the active view decide how to
 * render. State is owned outside — the shell is presentational.
 */

import * as React from 'react'
import {
  LayoutGrid, Rows, CalendarRange, Plus, Filter,
  Calendar,
} from 'lucide-react'
import { Input } from '@/components/tahi/input'
import { Avatar } from '@/components/tahi/avatar'
import {
  KanbanBoard,
  type BoardItem,
  type BoardColumn,
  type ColumnAction,
} from '@/components/tahi/kanban-board'

// Re-export so consumers only need to import board-view.
export type { BoardItem, BoardColumn, ColumnAction } from '@/components/tahi/kanban-board'

export type BoardViewKey = 'kanban' | 'table' | 'timeline'

interface BoardViewProps {
  title?: string
  intro?: string
  columns: ReadonlyArray<BoardColumn>
  items: ReadonlyArray<BoardItem>
  /** Initial active view. Default 'kanban'. */
  defaultView?: BoardViewKey
  /** Controlled active view. When set, the shell defers to the
   *  caller for view changes (pair with onViewChange). */
  view?: BoardViewKey
  onViewChange?: (next: BoardViewKey) => void
  /** Limit which views are exposed (e.g. omit timeline if no dates). */
  views?: ReadonlyArray<BoardViewKey>
  /** Header search input. Filters items by title client-side. */
  searchPlaceholder?: string
  /** Header filter button click. Caller wires the popover. */
  onFilterClick?: () => void
  /** Header "+ New" CTA. */
  onNew?: () => void
  newLabel?: string
  /** Kanban behaviours. */
  onMove?: (itemId: string, toStatus: string, position: number) => void
  onNest?: (childId: string, parentId: string) => void
  onAdd?: (status: string) => void
  onToggleSubtask?: (itemId: string, subtaskId: string) => void
  onItemClick?: (item: BoardItem) => void
  columnActions?: ReadonlyArray<ColumnAction>
  readOnly?: boolean
  className?: string
}

const VIEW_META: Record<BoardViewKey, { label: string; Icon: typeof LayoutGrid }> = {
  kanban:   { label: 'Kanban',   Icon: LayoutGrid },
  table:    { label: 'Table',    Icon: Rows },
  timeline: { label: 'Timeline', Icon: CalendarRange },
}

export function BoardView({
  title,
  intro,
  columns,
  items,
  defaultView = 'kanban',
  view,
  onViewChange,
  views = ['kanban', 'table', 'timeline'],
  searchPlaceholder = 'Search…',
  onFilterClick,
  onNew,
  newLabel = 'New',
  onMove,
  onNest,
  onAdd,
  onToggleSubtask,
  onItemClick,
  columnActions,
  readOnly,
  className,
}: BoardViewProps) {
  const [internalView, setInternalView] = React.useState<BoardViewKey>(defaultView)
  const activeView = view ?? internalView
  const setView = (next: BoardViewKey) => {
    if (onViewChange) onViewChange(next)
    else setInternalView(next)
  }

  const [query, setQuery] = React.useState('')
  const filteredItems = React.useMemo(() => {
    if (!query.trim()) return items
    const q = query.trim().toLowerCase()
    return items.filter(it =>
      it.title.toLowerCase().includes(q) ||
      (it.description ?? '').toLowerCase().includes(q) ||
      (it.tags ?? []).some(t => t.label.toLowerCase().includes(q))
    )
  }, [items, query])

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', flexWrap: 'wrap' }}>
        {(title || intro) && (
          <div style={{ flex: 1, minWidth: '12rem' }}>
            {title && (
              <h3 style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--color-text)',
                letterSpacing: '-0.01em',
              }}>{title}</h3>
            )}
            {intro && (
              <p style={{
                margin: '0.125rem 0 0',
                fontSize: '0.8125rem',
                color: 'var(--color-text-muted)',
                lineHeight: 1.45,
              }}>{intro}</p>
            )}
          </div>
        )}
        {!title && !intro && <div style={{ flex: 1 }} />}

        {/* View tabs. Full WAI-ARIA tab pattern: roving tabindex,
            arrow-key cycling, id/aria-controls matchup so the panel
            below is wired back to the active tab. */}
        <div
          role="tablist"
          aria-label="View"
          style={{
            display: 'inline-flex',
            padding: '0.1875rem',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            gap: '0.0625rem',
          }}
        >
          {views.map((key, i) => {
            const meta = VIEW_META[key]
            const active = activeView === key
            const Icon = meta.Icon
            const onTabKeyDown = (e: React.KeyboardEvent) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                const dir = e.key === 'ArrowRight' ? 1 : -1
                const next = views[(i + dir + views.length) % views.length]
                setView(next)
              } else if (e.key === 'Home') {
                e.preventDefault()
                setView(views[0])
              } else if (e.key === 'End') {
                e.preventDefault()
                setView(views[views.length - 1])
              }
            }
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`view-tab-${key}`}
                aria-selected={active}
                aria-controls={`view-panel-${key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setView(key)}
                onKeyDown={onTabKeyDown}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3125rem',
                  padding: '0.25rem 0.5625rem',
                  background: active ? 'var(--color-bg)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  boxShadow: active ? 'var(--shadow-xs)' : undefined,
                  transition: 'background-color 120ms ease, color 120ms ease',
                }}
              >
                <Icon size={12} aria-hidden="true" />
                {meta.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Controls row. Everything sits on a single 1.875rem baseline
          so search / filter / +New visually line up regardless of
          which combination is active. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 18rem', minWidth: '12rem', maxWidth: '28rem' }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            inputSize="sm"
          />
        </div>
        {onFilterClick && (
          <button
            type="button"
            onClick={onFilterClick}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3125rem',
              height: '1.875rem',
              padding: '0 0.75rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--color-text)',
              cursor: 'pointer',
              transition: 'background-color 120ms ease, border-color 120ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-bg-secondary)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
          >
            <Filter size={12} aria-hidden="true" />
            Filter
          </button>
        )}
        <div style={{ flex: 1 }} />
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3125rem',
              height: '1.875rem',
              padding: '0 0.875rem',
              background: 'var(--color-brand)',
              border: '1px solid var(--color-brand)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'background-color 120ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-brand-dark)'
              e.currentTarget.style.borderColor = 'var(--color-brand-dark)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--color-brand)'
              e.currentTarget.style.borderColor = 'var(--color-brand)'
            }}
          >
            <Plus size={12} aria-hidden="true" />
            {newLabel}
          </button>
        )}
      </div>

      {/* Active view. Wrapped in role="tabpanel" so the active panel
          is announced as the disclosed region for the selected tab. */}
      <div
        role="tabpanel"
        id={`view-panel-${activeView}`}
        aria-labelledby={`view-tab-${activeView}`}
        tabIndex={0}
      >
        {activeView === 'kanban' && (
          <KanbanBoard
            columns={columns}
            items={filteredItems}
            onMove={onMove}
            onNest={onNest}
            onAdd={onAdd}
            onToggleSubtask={onToggleSubtask}
            onItemClick={onItemClick}
            columnActions={columnActions}
            readOnly={readOnly}
          />
        )}
        {activeView === 'table' && (
          <BoardTable
            columns={columns}
            items={filteredItems}
            onItemClick={onItemClick}
          />
        )}
        {activeView === 'timeline' && (
          <BoardTimeline
            columns={columns}
            items={filteredItems}
            onItemClick={onItemClick}
          />
        )}
      </div>
    </div>
  )
}

// ── Table view ───────────────────────────────────────────────────────

function BoardTable({
  columns,
  items,
  onItemClick,
}: {
  columns: ReadonlyArray<BoardColumn>
  items: ReadonlyArray<BoardItem>
  onItemClick?: (item: BoardItem) => void
}) {
  const colByStatus = React.useMemo(() => {
    const m = new Map<string, BoardColumn>()
    columns.forEach(c => m.set(c.statusValue, c))
    return m
  }, [columns])

  // Flatten: top-level + nested children rendered as indented rows.
  const childIds = new Set<string>()
  items.forEach(it => it.children?.forEach(c => childIds.add(c.id)))
  const rows: Array<{ item: BoardItem; depth: number }> = []
  for (const it of items) {
    if (childIds.has(it.id)) continue
    rows.push({ item: it, depth: 0 })
    for (const c of it.children ?? []) {
      rows.push({ item: c, depth: 1 })
    }
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: '2.5rem 1rem',
          textAlign: 'center',
          background: 'var(--color-bg-secondary)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-muted)',
          fontSize: '0.8125rem',
        }}
      >
        No items match.
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(14rem, 2fr) 7rem 9rem 6rem 7rem',
          padding: '0.5rem 0.875rem',
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
        }}
      >
        <span>Title</span>
        <span>Status</span>
        <span>Progress</span>
        <span>Due</span>
        <span style={{ textAlign: 'right' }}>Assignees</span>
      </div>
      {/* Rows */}
      {rows.map((row, i) => {
        const it = row.item
        const col = colByStatus.get(it.status)
        const hasProgress = !!it.progress && it.progress.total > 0
        const ratio = hasProgress ? Math.min(1, Math.max(0, it.progress!.current / Math.max(1, it.progress!.total))) : 0
        return (
          <div
            key={it.id}
            className="tahi-focus-ring"
            role={onItemClick ? 'button' : undefined}
            tabIndex={onItemClick ? 0 : undefined}
            aria-label={onItemClick ? `Open ${it.title}` : undefined}
            onClick={() => onItemClick?.(it)}
            onKeyDown={(e) => {
              if (!onItemClick) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onItemClick(it)
              }
            }}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(14rem, 2fr) 7rem 9rem 6rem 7rem',
              alignItems: 'center',
              padding: '0.5rem 0.875rem',
              borderBottom: i < rows.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              cursor: onItemClick ? 'pointer' : 'default',
              transition: 'background-color 120ms ease',
            }}
            onMouseEnter={e => { if (onItemClick) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {/* Title cell with indent + nested marker */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4375rem',
              paddingLeft: `${row.depth * 1.25}rem`,
              minWidth: 0,
            }}>
              {row.depth > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    width: '0.75rem',
                    height: '1px',
                    background: 'var(--color-border)',
                    flexShrink: 0,
                  }}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: row.depth === 0 ? 600 : 500,
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  letterSpacing: '-0.005em',
                }}>{it.title}</div>
                {it.tags && it.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.125rem', flexWrap: 'wrap' }}>
                    {it.tags.slice(0, 3).map(t => (
                      <span
                        key={t.id}
                        style={{
                          fontSize: '0.625rem',
                          fontWeight: 600,
                          color: t.color ?? 'var(--color-text-muted)',
                          padding: '0.0625rem 0.3125rem',
                          background: 'var(--color-bg-secondary)',
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >{t.label}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Status pill */}
            <div>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3125rem',
                padding: '0.0625rem 0.4375rem',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: col?.color ?? 'var(--color-text-muted)',
              }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: '0.3125rem',
                    height: '0.3125rem',
                    borderRadius: 999,
                    background: col?.color ?? 'var(--color-text-muted)',
                  }}
                />
                {col?.label ?? it.status}
              </span>
            </div>
            {/* Progress */}
            <div>
              {hasProgress ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem' }}>
                  <div style={{
                    flex: 1,
                    maxWidth: '5rem',
                    height: '0.25rem',
                    borderRadius: 999,
                    background: 'var(--color-bg-tertiary)',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${ratio * 100}%`,
                      height: '100%',
                      background: 'var(--color-brand)',
                      borderRadius: 999,
                    }} />
                  </div>
                  <span style={{
                    fontSize: '0.6875rem',
                    color: 'var(--color-text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {it.progress!.current}/{it.progress!.total}
                  </span>
                </div>
              ) : (
                <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}></span>
              )}
            </div>
            {/* Due */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.1875rem',
              fontSize: '0.6875rem',
              color: it.isOverdue ? 'var(--color-danger)' : 'var(--color-text-muted)',
            }}>
              {it.dueDate && <><Calendar size={10} aria-hidden="true" />{it.dueDate}</>}
            </div>
            {/* Assignees */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {it.assignees && it.assignees.length > 0 ? (
                <Avatar.Stack spacing="tight">
                  {it.assignees.slice(0, 3).map(a => (
                    <Avatar key={a.id} name={a.name} src={a.avatarUrl} size="xs" />
                  ))}
                  {it.assignees.length > 3 && <Avatar.Overflow count={it.assignees.length - 3} size="xs" />}
                </Avatar.Stack>
              ) : <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}></span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Timeline view (Gantt-style) ──────────────────────────────────────
//
// Higher-level view: one row per item, horizontal bars colored by
// status. Status tells the story — explicit "to do / in progress /
// done" labels aren't needed because the color encodes them. Past +
// not done = red (overdue). Past + done = silent. Future = brand.
// Today line marker. If an item has startDate we draw a bar across
// the range; otherwise a milestone diamond at dueDate.

interface TimelineDatum {
  item: BoardItem
  startTs: number | null
  endTs: number
  state: 'done' | 'overdue' | 'active' | 'upcoming'
}

function BoardTimeline({
  columns,
  items,
  onItemClick,
}: {
  columns: ReadonlyArray<BoardColumn>
  items: ReadonlyArray<BoardItem>
  onItemClick?: (item: BoardItem) => void
}) {
  const now = Date.now()
  const doneStatuses = React.useMemo(() => {
    // The last column in the chronological flow is treated as "done".
    // Callers can override by naming a column whose statusValue
    // contains 'done' or 'complete'.
    const explicit = columns
      .filter(c => /done|complete|deliver|ship/i.test(c.statusValue) || /done|complete|deliver|ship/i.test(c.label))
      .map(c => c.statusValue)
    if (explicit.length) return new Set(explicit)
    return new Set(columns.length ? [columns[columns.length - 1].statusValue] : [])
  }, [columns])

  const activeStatuses = React.useMemo(() => {
    return new Set(
      columns
        .filter(c => /progress|review|active|wip|doing/i.test(c.statusValue) || /progress|review|active|wip|doing/i.test(c.label))
        .map(c => c.statusValue),
    )
  }, [columns])

  const data: TimelineDatum[] = items
    .map((item): TimelineDatum | null => {
      const endTs = parseDate(item.dueDate)
      if (!endTs) return null
      const startTs = parseDate(item.startDate)
      const isDone = doneStatuses.has(item.status)
      const isActive = activeStatuses.has(item.status)
      const state: TimelineDatum['state'] = isDone
        ? 'done'
        : endTs < now
          ? 'overdue'
          : isActive
            ? 'active'
            : 'upcoming'
      return { item, startTs, endTs, state }
    })
    .filter((x): x is TimelineDatum => !!x)
    // Earliest first.
    .sort((a, b) => (a.startTs ?? a.endTs) - (b.startTs ?? b.endTs))

  if (data.length === 0) {
    return (
      <div
        style={{
          padding: '2.5rem 1rem',
          textAlign: 'center',
          background: 'var(--color-bg-secondary)',
          border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--color-text-muted)',
          fontSize: '0.8125rem',
        }}
      >
        No items with a due date to plot.
      </div>
    )
  }

  // Domain spans the earliest start (or dueDate) → latest dueDate,
  // padded so the bars don't kiss the axis edges and today fits in.
  const tsValues = data.flatMap(d => d.startTs ? [d.startTs, d.endTs] : [d.endTs])
  const minTs = Math.min(...tsValues, now)
  const maxTs = Math.max(...tsValues, now)
  const padMs = Math.max(5 * 86_400_000, (maxTs - minTs) * 0.06)
  const start = minTs - padMs
  const end = maxTs + padMs
  const span = Math.max(1, end - start)
  const pct = (ts: number) => ((ts - start) / span) * 100
  const todayPct = pct(now)

  // Six evenly spaced ticks across the range.
  const tickCount = 6
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const t = start + (span * i) / (tickCount - 1)
    return { ratio: i / (tickCount - 1), label: formatTickDate(new Date(t)) }
  })

  const labelWidth = '11rem'
  const rowHeight = 28

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '0.875rem',
        overflowX: 'auto',
      }}
    >
      {/* Legend */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginBottom: '0.75rem',
        fontSize: '0.6875rem',
        color: 'var(--color-text-muted)',
        fontWeight: 500,
      }}>
        <LegendSwatch color={STATE_COLOR.upcoming.bar} label="Upcoming" />
        <LegendSwatch color={STATE_COLOR.active.bar} label="In flight" />
        <LegendSwatch color={STATE_COLOR.overdue.bar} label="Overdue" />
        <LegendSwatch color={STATE_COLOR.done.bar} label="Done" />
      </div>

      {/* Header: axis ticks aligned with the bar track */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${labelWidth} 1fr`,
        gap: '0.625rem',
        alignItems: 'center',
        marginBottom: '0.4375rem',
      }}>
        <div />
        <div style={{ position: 'relative', height: '1rem' }}>
          {ticks.map((tk, i) => (
            <span
              key={i}
              style={{
                position: 'absolute',
                left: `${tk.ratio * 100}%`,
                transform: 'translateX(-50%)',
                fontSize: '0.625rem',
                fontWeight: 600,
                color: 'var(--color-text-subtle)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              {tk.label}
            </span>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {data.map(d => (
          <TimelineRow
            key={d.item.id}
            datum={d}
            pct={pct}
            todayPct={todayPct}
            labelWidth={labelWidth}
            rowHeight={rowHeight}
            ticks={ticks}
            onClick={onItemClick}
          />
        ))}
      </div>
    </div>
  )
}

// Bars carry inline 10px labels, so foreground/background must clear
// AA 4.5:1. Active + overdue fills are the darkened variants so the
// white text passes (brand → brand-dark, #ef4444 → #b91c1c).
const STATE_COLOR: Record<TimelineDatum['state'], { bar: string; ring: string; text: string }> = {
  upcoming: { bar: '#5a6657',              ring: 'var(--color-border)',  text: '#ffffff' },
  active:   { bar: 'var(--color-brand-dark)', ring: '#2e4427',           text: '#ffffff' },
  overdue:  { bar: '#b91c1c',              ring: '#7f1d1d',              text: '#ffffff' },
  done:     { bar: '#4ade80',              ring: '#16a34a',              text: '#052e16' },
}

function TimelineRow({
  datum,
  pct,
  todayPct,
  labelWidth,
  rowHeight,
  ticks,
  onClick,
}: {
  datum: TimelineDatum
  pct: (ts: number) => number
  todayPct: number
  labelWidth: string
  rowHeight: number
  ticks: Array<{ ratio: number; label: string }>
  onClick?: (item: BoardItem) => void
}) {
  const tone = STATE_COLOR[datum.state]
  const rangeMode = datum.startTs != null
  const leftPct = rangeMode ? pct(datum.startTs!) : pct(datum.endTs)
  const rightPct = pct(datum.endTs)
  const widthPct = rangeMode ? Math.max(1.5, rightPct - leftPct) : 0

  return (
    <div
      className="tahi-focus-ring"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Open ${datum.item.title}` : undefined}
      onClick={() => onClick?.(datum.item)}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(datum.item)
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: `${labelWidth} 1fr`,
        gap: '0.625rem',
        alignItems: 'center',
        height: rowHeight,
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 'var(--radius-sm)',
        transition: 'background-color 120ms ease',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Label */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.3125rem',
        minWidth: 0,
      }}>
        <span
          aria-hidden="true"
          style={{
            width: '0.4375rem',
            height: '0.4375rem',
            borderRadius: 999,
            background: tone.bar,
            flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: '0.75rem',
          fontWeight: 500,
          color: 'var(--color-text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {datum.item.title}
        </span>
      </div>

      {/* Track */}
      <div style={{
        position: 'relative',
        height: '100%',
      }}>
        {/* Tick guide lines */}
        {ticks.map((tk, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${tk.ratio * 100}%`,
              width: 1,
              background: 'var(--color-border-subtle)',
              opacity: 0.6,
            }}
          />
        ))}

        {/* Today line */}
        {todayPct >= 0 && todayPct <= 100 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${todayPct}%`,
              width: 1.5,
              background: 'var(--color-brand)',
              opacity: 0.55,
            }}
          />
        )}

        {/* Bar or milestone */}
        {rangeMode ? (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${leftPct}%`,
              transform: 'translateY(-50%)',
              width: `${widthPct}%`,
              minWidth: '0.875rem',
              height: '0.875rem',
              background: tone.bar,
              border: `1px solid ${tone.ring}`,
              borderRadius: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: '0.3125rem',
              fontSize: '0.625rem',
              fontWeight: 600,
              color: tone.text,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
            title={`${datum.item.title} · ${datum.item.dueDate ?? ''}`}
          >
            {widthPct > 8 && datum.item.dueDate}
          </div>
        ) : (
          <span
            aria-hidden="true"
            title={`${datum.item.title} · ${datum.item.dueDate ?? ''}`}
            style={{
              position: 'absolute',
              top: '50%',
              left: `${rightPct}%`,
              transform: 'translate(-50%, -50%) rotate(45deg)',
              width: '0.625rem',
              height: '0.625rem',
              background: tone.bar,
              border: `1.5px solid ${tone.ring}`,
              boxShadow: '0 1px 2px rgba(15, 20, 16, 0.10)',
            }}
          />
        )}
      </div>
    </div>
  )
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3125rem' }}>
      <span
        aria-hidden="true"
        style={{
          width: '0.625rem',
          height: '0.625rem',
          background: color,
          borderRadius: '0.1875rem',
        }}
      />
      {label}
    </span>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseDate(d?: string): number | null {
  if (!d) return null
  // Try ISO first.
  const iso = Date.parse(d)
  if (!Number.isNaN(iso)) return iso
  // Fall back to short month-day strings ("May 23", "Apr 18").
  const m = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})$/i.exec(d.trim())
  if (m) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    }
    const month = months[m[1].toLowerCase()]
    const day = parseInt(m[2], 10)
    const year = new Date().getFullYear()
    return new Date(year, month, day).getTime()
  }
  if (/^today$/i.test(d.trim())) return Date.now()
  return null
}

function formatTickDate(d: Date): string {
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

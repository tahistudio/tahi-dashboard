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
  Calendar, MessageCircle, Paperclip,
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

        {/* View tabs */}
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
          {views.map(key => {
            const meta = VIEW_META[key]
            const active = activeView === key
            const Icon = meta.Icon
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setView(key)}
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

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '12rem', maxWidth: '20rem' }}>
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
              padding: '0.3125rem 0.625rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontWeight: 500,
              color: 'var(--color-text)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
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
              padding: '0.3125rem 0.75rem',
              background: 'var(--color-brand)',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'background-color 120ms ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-dark)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-brand)' }}
          >
            <Plus size={12} aria-hidden="true" />
            {newLabel}
          </button>
        )}
      </div>

      {/* Active view */}
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
            onClick={() => onItemClick?.(it)}
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

// ── Timeline view ────────────────────────────────────────────────────
//
// Lightweight horizontal date axis with one row per item. Items with
// dueDate render as dots; items with a date range render as bars.
// Group by status column.

function BoardTimeline({
  columns,
  items,
  onItemClick,
}: {
  columns: ReadonlyArray<BoardColumn>
  items: ReadonlyArray<BoardItem>
  onItemClick?: (item: BoardItem) => void
}) {
  // Parse dueDate into a ms timestamp; skip items with no date.
  const dated = items
    .map(it => {
      const ts = parseDate(it.dueDate)
      return ts ? { item: it, ts } : null
    })
    .filter((x): x is { item: BoardItem; ts: number } => !!x)

  if (dated.length === 0) {
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

  const minTs = Math.min(...dated.map(d => d.ts))
  const maxTs = Math.max(...dated.map(d => d.ts))
  // Pad the range slightly so the first and last marker don't sit on the edges.
  const padMs = Math.max(7 * 86_400_000, (maxTs - minTs) * 0.08)
  const start = minTs - padMs
  const end = maxTs + padMs
  const span = Math.max(1, end - start)
  const ratio = (ts: number) => Math.min(1, Math.max(0, (ts - start) / span))

  // Generate tick labels (5 ticks across the range).
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const t = start + (span * i) / 4
    return { ratio: i / 4, label: formatTickDate(new Date(t)) }
  })

  // Group by status column.
  const byStatus = new Map<string, Array<{ item: BoardItem; ts: number }>>()
  dated.forEach(d => {
    const list = byStatus.get(d.item.status) ?? []
    list.push(d)
    byStatus.set(d.item.status, list)
  })

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
      {/* Axis ticks */}
      <div style={{ position: 'relative', height: '1.25rem', marginBottom: '0.625rem' }}>
        {ticks.map((tk, i) => (
          <div
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
          </div>
        ))}
      </div>
      {/* Rows */}
      {columns
        .filter(col => (byStatus.get(col.statusValue) ?? []).length > 0)
        .map(col => {
          const rows = byStatus.get(col.statusValue) ?? []
          return (
            <div key={col.id} style={{ marginBottom: '0.875rem' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3125rem',
                marginBottom: '0.4375rem',
                fontSize: '0.6875rem',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--color-text-muted)',
              }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: '0.375rem',
                    height: '0.375rem',
                    borderRadius: 999,
                    background: col.color ?? 'var(--color-text-muted)',
                  }}
                />
                {col.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {rows.map(({ item, ts }) => {
                  const r = ratio(ts)
                  return (
                    <div
                      key={item.id}
                      onClick={() => onItemClick?.(item)}
                      style={{
                        position: 'relative',
                        height: '1.5rem',
                        background: 'var(--color-bg-secondary)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: onItemClick ? 'pointer' : 'default',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Marker */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${r * 100}%`,
                          transform: 'translateX(-50%)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.3125rem',
                          paddingLeft: '0.4375rem',
                          paddingRight: '0.4375rem',
                          background: 'var(--color-brand-50)',
                          border: '1px solid var(--color-brand-100)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: '0.375rem',
                            height: '0.375rem',
                            borderRadius: 999,
                            background: 'var(--color-brand)',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          color: 'var(--color-text)',
                          whiteSpace: 'nowrap',
                          maxWidth: '12rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {item.title}
                        </span>
                        {(item.commentCount || item.attachmentCount) && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.1875rem',
                            color: 'var(--color-text-muted)',
                            fontSize: '0.625rem',
                          }}>
                            {!!item.commentCount && <><MessageCircle size={9} aria-hidden="true" />{item.commentCount}</>}
                            {!!item.attachmentCount && <><Paperclip size={9} aria-hidden="true" />{item.attachmentCount}</>}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
    </div>
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

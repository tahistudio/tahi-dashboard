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
  LayoutGrid, Rows, CalendarRange, Plus, Filter, Search,
  Calendar, X,
} from 'lucide-react'
import { Input } from '@/components/tahi/input'
import { Avatar } from '@/components/tahi/avatar'
import { RequestsTimeline } from '@/components/tahi/requests/requests-timeline'
import {
  KanbanBoard,
  type BoardItem,
  type BoardColumn,
  type ColumnAction,
  type BoardAssignee,
  type BoardTag,
  type BoardPriority,
} from '@/components/tahi/kanban-board'

// Re-export so consumers only need to import board-view.
export type {
  BoardItem,
  BoardColumn,
  ColumnAction,
  BoardAssignee,
  BoardTag,
  BoardPriority,
  BoardPerson,
  BoardSubRequest,
} from '@/components/tahi/kanban-board'

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
  /** Inline quick-add in the kanban column footer. See <KanbanBoard>. */
  onQuickAdd?: (status: string, title: string) => void
  onToggleChecklist?: (itemId: string, checklistItemId: string) => void
  onItemClick?: (item: BoardItem) => void
  /** Click an assignee avatar → caller routes to their profile. */
  onAssigneeClick?: (assignee: BoardAssignee) => void
  /** Click a tag chip. By default the shell toggles the tag in its
   *  active filter set (so clicking "Marketing" on a card narrows
   *  the visible list to just Marketing items). Pass your own handler
   *  to override (e.g. navigate to a global filter page). */
  onTagClick?: (tag: BoardTag) => void
  /** Click the priority chip. Defaults to filtering by that priority. */
  onPriorityClick?: (priority: BoardPriority) => void
  columnActions?: ReadonlyArray<ColumnAction>
  readOnly?: boolean
  /** Kanban: render priority as an icon with a tooltip instead of a
   *  labelled chip, so a narrow card's top row stays one line. */
  iconOnlyPriority?: boolean
  /** Kanban: endpoint for a card's sub-requests. When it returns a URL
   *  and the item has `subtasks`, the card's subtask bar expands into a
   *  lazily fetched, SWR-cached list. */
  subtaskUrl?: (item: BoardItem) => string | null
  /** Kanban: id for the horizontal scroller, wired to the proxy
   *  scrollbar's aria-controls. */
  boardId?: string
  /** Suppress the board's own view tabs and controls row. For callers that
   *  already render a view switcher and a search field above it (the requests
   *  rail). Off by default, so every existing consumer is unchanged.
   *
   *  It also switches off the shell's own chip filter model: with no tabs
   *  and no search of its own, a second set of active-filter chips over
   *  the board would contradict the ones the caller is already showing.
   *  Chip clicks then reach `onTagClick` / `onPriorityClick` or nothing. */
  hideHeader?: boolean
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
  onQuickAdd,
  onToggleChecklist,
  onItemClick,
  onAssigneeClick,
  onTagClick,
  onPriorityClick,
  columnActions,
  readOnly,
  iconOnlyPriority,
  subtaskUrl,
  boardId,
  hideHeader = false,
  className,
}: BoardViewProps) {
  const [internalView, setInternalView] = React.useState<BoardViewKey>(defaultView)
  const activeView = view ?? internalView
  const setView = (next: BoardViewKey) => {
    if (onViewChange) onViewChange(next)
    else setInternalView(next)
  }

  const [query, setQuery] = React.useState('')

  // Active filter state. When a tag chip on a card is clicked the
  // shell toggles it here; matching items then survive the filter.
  // Same for priority.
  const [activeTagIds, setActiveTagIds] = React.useState<Set<string>>(new Set())
  const [activePriorities, setActivePriorities] = React.useState<Set<BoardPriority>>(new Set())
  const [filterPanelOpen, setFilterPanelOpen] = React.useState(false)
  const filterButtonRef = React.useRef<HTMLButtonElement | null>(null)

  // Tag label lookup so the active-filter chips below the controls
  // show the human label even if items use shared ids.
  const tagLabelById = React.useMemo(() => {
    const m = new Map<string, BoardTag>()
    for (const it of items) for (const t of it.tags ?? []) if (!m.has(t.id)) m.set(t.id, t)
    return m
  }, [items])

  // With the header hidden the shell owns no filter UI, so it must not own
  // filter state either: chip clicks either reach the caller's model or do
  // nothing at all. Passing undefined down renders the chip as plain text
  // rather than a button that filters a set nobody can see.
  const localChipFilters = !hideHeader

  const toggleTag = (tag: BoardTag) => {
    if (onTagClick) { onTagClick(tag); return }
    setActiveTagIds(prev => {
      const next = new Set(prev)
      if (next.has(tag.id)) next.delete(tag.id); else next.add(tag.id)
      return next
    })
  }
  const togglePriority = (p: BoardPriority) => {
    if (onPriorityClick) { onPriorityClick(p); return }
    setActivePriorities(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })
  }
  const handleTagClick = localChipFilters ? toggleTag : onTagClick
  const handlePriorityClick = localChipFilters ? togglePriority : onPriorityClick
  const clearFilters = () => {
    setActiveTagIds(new Set())
    setActivePriorities(new Set())
  }

  const filteredItems = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(it => {
      if (q) {
        const matches =
          it.title.toLowerCase().includes(q) ||
          (it.description ?? '').toLowerCase().includes(q) ||
          (it.tags ?? []).some(t => t.label.toLowerCase().includes(q))
        if (!matches) return false
      }
      if (activeTagIds.size > 0) {
        const ids = (it.tags ?? []).map(t => t.id)
        if (!ids.some(id => activeTagIds.has(id))) return false
      }
      if (activePriorities.size > 0) {
        if (!it.priority || !activePriorities.has(it.priority)) return false
      }
      return true
    })
  }, [items, query, activeTagIds, activePriorities])

  const filterCount = localChipFilters ? activeTagIds.size + activePriorities.size : 0

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Header */}
      {!hideHeader && (
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
                className="tahi-viewtab"
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
      )}

      {/* Controls row. Search input and the filter pill are direct
          siblings (no nested wrapper) so the filter sits glued to the
          right edge of the search with a single 6px gap. +New sits at
          the far right of the row, pushed by a flex spacer. The
          search uses Input's leadingIcon variant so the inner input
          flexes to fill the wrapper — without it, a bare <input>
          sits at its browser-default ~150px and leaves dead space
          between it and the filter pill. */}
      {!hideHeader && (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          inputSize="sm"
          leadingIcon={<Search size={13} aria-hidden="true" />}
          style={{ flex: '0 1 22rem', minWidth: '12rem' }}
        />
        <button
          ref={filterButtonRef}
          type="button"
          onClick={() => {
            if (onFilterClick) onFilterClick()
            else setFilterPanelOpen(o => !o)
          }}
          aria-pressed={filterCount > 0 || filterPanelOpen}
          aria-expanded={filterPanelOpen}
          className="tahi-focus-ring"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3125rem',
            height: '1.875rem',
            padding: '0 0.625rem',
            background: filterCount > 0 ? 'var(--color-brand-50)' : 'var(--color-bg)',
            border: `1px solid ${filterCount > 0 ? 'var(--color-brand)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: filterCount > 0 ? 'var(--color-text-active)' : 'var(--color-text)',
            cursor: 'pointer',
            transition: 'background-color 120ms ease, border-color 120ms ease',
            flexShrink: 0,
          }}
          onMouseEnter={e => { if (filterCount === 0) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
          onMouseLeave={e => { if (filterCount === 0) e.currentTarget.style.background = 'var(--color-bg)' }}
        >
          <Filter size={12} aria-hidden="true" />
          Filter
          {filterCount > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '1.125rem',
                height: '1.125rem',
                padding: '0 0.3125rem',
                background: 'var(--color-brand)',
                borderRadius: 999,
                color: '#ffffff',
                fontSize: '0.625rem',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {filterCount}
            </span>
          )}
        </button>
        <div style={{ flex: 1 }} />
        {onNew && (
          <button
            type="button"
            onClick={onNew}
            className="tahi-focus-ring"
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
      )}

      {/* Active filter chips. Render only when filters are present. */}
      {filterCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.3125rem',
        }}>
          <span style={{
            fontSize: '0.625rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-subtle)',
          }}>Filters</span>
          {Array.from(activeTagIds).map(id => {
            const tag = tagLabelById.get(id)
            const label = tag?.label ?? id
            return (
              <FilterChip
                key={`tag-${id}`}
                label={label}
                color={tag?.color}
                onRemove={() => toggleTag(tag ?? { id, label })}
              />
            )
          })}
          {Array.from(activePriorities).map(p => (
            <FilterChip
              key={`prio-${p}`}
              label={`Priority: ${p}`}
              onRemove={() => togglePriority(p)}
            />
          ))}
          <button
            type="button"
            onClick={clearFilters}
            className="tahi-focus-ring"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '0.125rem 0.3125rem',
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-sm)',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Active view. Wrapped in role="tabpanel" so the active panel is
          announced as the disclosed region for the selected tab. With the
          header hidden there is no tablist here to be labelled by, so the
          panel role, the tab stop and the dangling aria-labelledby all go
          with it and the wrapper is a plain box. */}
      <div
        {...(hideHeader ? {} : {
          role: 'tabpanel',
          id: `view-panel-${activeView}`,
          'aria-labelledby': `view-tab-${activeView}`,
          tabIndex: 0,
          className: 'tahi-focus-inset',
        })}
      >
        {activeView === 'kanban' && (
          <KanbanBoard
            columns={columns}
            items={filteredItems}
            onMove={onMove}
            onNest={onNest}
            onAdd={onAdd}
            onQuickAdd={onQuickAdd}
            onToggleChecklist={onToggleChecklist}
            onItemClick={onItemClick}
            onAssigneeClick={onAssigneeClick}
            onTagClick={handleTagClick}
            onPriorityClick={handlePriorityClick}
            columnActions={columnActions}
            readOnly={readOnly}
            iconOnlyPriority={iconOnlyPriority}
            subtaskUrl={subtaskUrl}
            boardId={boardId}
          />
        )}
        {activeView === 'table' && (
          <BoardTable
            columns={columns}
            items={filteredItems}
            onItemClick={onItemClick}
            onAssigneeClick={onAssigneeClick}
            onTagClick={handleTagClick}
          />
        )}
        {activeView === 'timeline' && (
          <RequestsTimeline
            columns={columns}
            items={filteredItems}
            onOpen={onItemClick}
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
  onAssigneeClick,
  onTagClick,
}: {
  columns: ReadonlyArray<BoardColumn>
  items: ReadonlyArray<BoardItem>
  onItemClick?: (item: BoardItem) => void
  onAssigneeClick?: (assignee: BoardAssignee) => void
  onTagClick?: (tag: BoardTag) => void
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
        overflowX: 'auto',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(18rem, 2fr) 8rem 10rem 7rem 8rem',
          padding: '0.5rem 0.875rem',
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          minWidth: '54rem',
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
              gridTemplateColumns: 'minmax(18rem, 2fr) 8rem 10rem 7rem 8rem',
              alignItems: 'center',
              padding: '0.5rem 0.875rem',
              borderBottom: i < rows.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              cursor: onItemClick ? 'pointer' : 'default',
              transition: 'background-color 120ms ease',
              minWidth: '54rem',
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
                <div data-private style={{
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
                      <TableTagChip
                        key={t.id}
                        tag={t}
                        onClick={onTagClick ? () => onTagClick(t) : undefined}
                      />
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
                color: 'var(--color-text)',
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
                    <Avatar
                      key={a.id}
                      name={a.name}
                      src={a.avatarUrl}
                      size="xs"
                      onClick={onAssigneeClick ? () => onAssigneeClick(a) : undefined}
                    />
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


// ── Shared sub-components ───────────────────────────────────────────

function FilterChip({
  label,
  color,
  onRemove,
}: {
  label: string
  color?: string
  onRemove: () => void
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
        padding: '0.125rem 0.3125rem 0.125rem 0.4375rem',
        background: 'var(--color-brand-50)',
        border: '1px solid var(--color-brand-100)',
        borderRadius: 999,
        fontSize: '0.6875rem',
        fontWeight: 600,
        color: color ?? 'var(--color-text-active)',
      }}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="tahi-focus-ring"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '0.875rem',
          height: '0.875rem',
          background: 'transparent',
          border: 'none',
          borderRadius: 999,
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--color-brand-100)'
          e.currentTarget.style.color = 'var(--color-text)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }}
      >
        <X size={9} aria-hidden="true" />
      </button>
    </span>
  )
}

function TableTagChip({
  tag,
  onClick,
}: {
  tag: BoardTag
  onClick?: () => void
}) {
  const baseStyle: React.CSSProperties = {
    fontSize: '0.625rem',
    fontWeight: 600,
    color: tag.color ?? 'var(--color-text-muted)',
    padding: '0.0625rem 0.3125rem',
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-sm)',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'background-color 120ms ease, border-color 120ms ease',
  }
  if (!onClick) return <span style={baseStyle}>{tag.label}</span>
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={`Filter by ${tag.label}`}
      className="tahi-focus-ring"
      style={baseStyle}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--color-bg)'
        e.currentTarget.style.borderColor = 'var(--color-border)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
      }}
    >
      {tag.label}
    </button>
  )
}


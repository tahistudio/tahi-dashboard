'use client'

/**
 * <KanbanBoard>. Rich-card kanban primitive.
 *
 * One self-contained primitive used by the design system showcase
 * and (when productised) by the requests / tasks pages. Drives
 * everything visible on a card from the data object — see BoardItem.
 *
 *   <KanbanBoard
 *     columns={[{ id: 'todo', label: 'To do', statusValue: 'todo', color: '#94a3b8' }, ...]}
 *     items={tasks}
 *     onMove={(itemId, toStatus, position) => api.move(itemId, toStatus, position)}
 *     onNest={(childId, parentId) => api.nest(childId, parentId)}
 *     onAdd={(status) => openNewTaskDialog(status)}
 *     onToggleSubtask={(itemId, subtaskId) => api.toggle(itemId, subtaskId)}
 *     onItemClick={(item) => router.push(`/tasks/${item.id}`)}
 *     columnActions={[{ label: 'Rename', icon: <Pencil/>, onClick: ... }]}
 *   />
 *
 * Card visuals: optional gradient cover, multi-tag row, priority chip,
 * title, progress bar, subtask checklist with running count, nested
 * children (rendered as compact sub-cards inline), meta footer (date,
 * comments, attachments, assignee stack), hover lift.
 *
 * Drag/drop:
 *   - Drag a card onto a column → moves status
 *   - Drag a card onto another card → fires onNest (the parent
 *     screen typically confirms via dialog before persisting)
 *
 * The board never owns state: parents pass items, the board emits
 * intent callbacks. That keeps it usable with any backend / query lib.
 */

import * as React from 'react'
import useSWR from 'swr'
import {
  Plus, MoreHorizontal, Calendar, MessageCircle, Paperclip,
  ChevronDown, ChevronRight, ChevronsUp, ChevronUp, Minus,
  GripVertical, AlertTriangle, User,
} from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Popover } from '@/components/tahi/popover'
import { Tooltip } from '@/components/tahi/tooltip'
import { BoardScrollbar } from '@/components/tahi/board-scrollbar'
import { swrFetcher } from '@/lib/swr-fetcher'

// ── Types ────────────────────────────────────────────────────────────

export interface BoardAssignee {
  id: string
  name: string
  avatarUrl?: string | null
}

/** One person on a card's people row, with the role the tooltip names. */
export interface BoardPerson extends BoardAssignee {
  /** Human role label, e.g. "Project manager", "Assignee", "Follower". */
  role: string
}

/** A row in the inline sub-request preview a card expands to. */
export interface BoardSubRequest {
  id: string
  title: string
  status?: string | null
  assigneeName?: string | null
  assigneeAvatarUrl?: string | null
}

export interface BoardTag {
  id: string
  label: string
  /** Hex or var() string. Used for the chip tint + text. If omitted,
   *  the chip falls back to neutral grey. */
  color?: string
}

export interface BoardChecklistItem {
  id: string
  label: string
  done: boolean
}

export type BoardPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface BoardItem {
  id: string
  /** Status value that maps to a column's statusValue. */
  status: string
  title: string
  /** Optional plain-text description, shown muted under the title. */
  description?: string

  /** Priority chip. Maps to a fixed colour. */
  priority?: BoardPriority

  /** Additional tag chips (category, project, etc.). */
  tags?: ReadonlyArray<BoardTag>

  /** Progress bar. */
  progress?: { current: number; total: number }

  /** Checklist of toggleable items inside the card. Distinct from
   *  sub-tasks: this is "things to tick off", not nested cards. */
  checklist?: ReadonlyArray<BoardChecklistItem>

  /** Nested sub-tasks, rendered as compact cards inside the parent. */
  children?: ReadonlyArray<BoardItem>

  /** Meta footer. */
  dueDate?: string  // ISO or display string
  /** Optional start date. When set alongside dueDate the timeline
   *  view renders a bar spanning the range; otherwise the timeline
   *  drops a milestone marker at dueDate. */
  startDate?: string
  /** Surfaces an overdue tone when set. */
  isOverdue?: boolean
  /** Suppress the kanban card's due chip while keeping `dueDate` itself.
   *  Finished work needs no deadline on the card, but the timeline still
   *  needs the date to place its bar. */
  hideDueChip?: boolean
  commentCount?: number
  attachmentCount?: number
  assignees?: ReadonlyArray<BoardAssignee>

  /** Short reference pinned to the top right of the card, e.g. "#014". */
  reference?: string
  /** Warning marker beside the chips. The string is the tooltip text
   *  (a scope-creep reason, a blocked note). */
  warning?: string
  /** Client-side avatar on the left of the people row. Omit it for
   *  audiences that should not see which client a card belongs to. */
  client?: BoardAssignee
  /** People row on the right: project manager, assignee, followers, in
   *  that order. Three show; the rest fold into a "+N" chip. */
  people?: ReadonlyArray<BoardPerson>
  /** Renders an "Unassigned" placeholder at the end of the people row. */
  unassigned?: boolean
  /** Sub-request rollup. Drives the subtask bar under the people row. */
  subtasks?: { done: number; total: number }
}

export interface BoardColumn {
  id: string
  label: string
  /** Matches BoardItem.status. */
  statusValue: string
  /** Header dot colour. */
  color?: string
}

export interface ColumnAction {
  label: string
  icon?: React.ReactNode
  tone?: 'default' | 'danger'
  onClick: (column: BoardColumn) => void
}

interface KanbanBoardProps {
  columns: ReadonlyArray<BoardColumn>
  items: ReadonlyArray<BoardItem>
  /** Fires when a card is dropped on a different column. position is
   *  the visual index inside the target column (0 = top). */
  onMove?: (itemId: string, toStatus: string, position: number) => void
  /** Fires when a card is dragged onto another card — caller decides
   *  whether to nest (prompt + persist parentId). */
  onNest?: (childId: string, parentId: string) => void
  /** "+ Add card" button at the bottom of each column. */
  onAdd?: (status: string) => void
  /** Click a checklist checkbox. */
  onToggleChecklist?: (itemId: string, checklistItemId: string) => void
  /** Click a card body (not the chips / checkboxes). */
  onItemClick?: (item: BoardItem) => void
  /** Click an assignee avatar. Caller routes to their profile. */
  onAssigneeClick?: (assignee: BoardAssignee) => void
  /** Click a tag chip. Caller typically opens a filtered list. */
  onTagClick?: (tag: BoardTag) => void
  /** Click the priority chip. Caller opens a filtered list. */
  onPriorityClick?: (priority: BoardPriority) => void
  /** Per-column ⋯ menu items. */
  columnActions?: ReadonlyArray<ColumnAction>
  /** Disable drag interactions (e.g. read-only viewers). */
  readOnly?: boolean
  /** Render the priority as an icon with a tooltip instead of a labelled
   *  chip. Keeps a narrow card's top row to one line. */
  iconOnlyPriority?: boolean
  /** Endpoint for an item's sub-requests. When it returns a URL and the
   *  item has `subtasks`, the subtask bar becomes an expand toggle that
   *  lazy-loads the rows (SWR-cached, so a re-expand is instant).
   *  Return null to leave the bar as a static rollup. */
  subtaskUrl?: (item: BoardItem) => string | null
  /** id given to the horizontal scroller, wired to the proxy
   *  scrollbar's aria-controls. */
  boardId?: string
  className?: string
}

// ── Styles that inline style objects cannot express ──────────────────
// Hover, focus, media queries and keyframes. Kept as one block so a
// card's own inline style stays layout-only and never fights a hover
// rule on specificity.

const KANBAN_CSS = `
.tahi-board-card{
  border: 1px solid var(--color-border-subtle);
  box-shadow: var(--shadow-xs);
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease, opacity 150ms ease;
}
.tahi-board-card:hover{
  border-color: var(--color-brand);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}
.tahi-board-card[data-drop-target="true"]{ border-color: var(--color-brand); }
.tahi-board-card[data-dragging="true"],
.tahi-board-card[data-dragging="true"]:hover{
  border-color: var(--color-brand);
  box-shadow: var(--shadow-md);
  transform: rotate(-1.5deg);
}
.tahi-board-person{ position: relative; display: inline-flex; border-radius: 9999px; }
.tahi-board-person:hover, .tahi-board-person:focus-visible{ z-index: 3; }
.tahi-board-subs-bar:hover .tahi-board-subs-label,
.tahi-board-subs-bar:hover .tahi-board-subs-chevron{ color: var(--color-brand-dark); }
.tahi-board-subs-chevron{ transition: transform 180ms ease, color 150ms ease; }
.tahi-board-subs-bar[aria-expanded="true"] .tahi-board-subs-chevron{ transform: rotate(180deg); }
.tahi-board-sublist{ animation: tahi-board-subs-in 160ms ease both; }
@keyframes tahi-board-subs-in{
  from{ opacity: 0; transform: translateY(-3px); }
  to{ opacity: 1; transform: none; }
}
@media (max-width: 47.9375rem){
  .tahi-kanban-scroller{ scroll-snap-type: x mandatory; scroll-padding-left: 0.25rem; }
  .tahi-kanban-scroller > [data-board-column]{ scroll-snap-align: start; }
  .tahi-board-subs-bar{ min-height: 2.75rem; }
  .tahi-board-sub-row{ min-height: 1.875rem; }
}
@media (prefers-reduced-motion: reduce){
  .tahi-board-card:hover{ transform: none; }
  .tahi-board-sublist{ animation: none; }
  .tahi-board-subs-chevron{ transition: color 150ms ease; }
}
`

// ── Component ────────────────────────────────────────────────────────

export function KanbanBoard({
  columns,
  items,
  onMove,
  onNest,
  onAdd,
  onToggleChecklist,
  onItemClick,
  onAssigneeClick,
  onTagClick,
  onPriorityClick,
  columnActions,
  readOnly = false,
  iconOnlyPriority = false,
  subtaskUrl,
  boardId,
  className,
}: KanbanBoardProps) {
  // A page can hold more than one board (the design system showcase
  // does), so the default id is per-instance and stable across SSR.
  const generatedId = React.useId()
  const scrollerId = boardId ?? `tahi-kanban-board-${generatedId}`
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropColumn, setDropColumn] = React.useState<string | null>(null)
  const [dropOnCard, setDropOnCard] = React.useState<string | null>(null)
  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  // Which cards have their sub-request preview open. Keyed by id so a
  // re-render, a status move or a filter change does not collapse them.
  const [openSubtasks, setOpenSubtasks] = React.useState<ReadonlySet<string>>(() => new Set())
  const toggleSubtasks = React.useCallback((id: string) => {
    setOpenSubtasks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // Group top-level items by status; index children by parent.
  const { byStatus, childrenByParent } = React.useMemo(() => {
    const topByStatus = new Map<string, BoardItem[]>()
    const kidsByParent = new Map<string, BoardItem[]>()
    const childIds = new Set<string>()
    for (const item of items) {
      if (item.children?.length) {
        for (const c of item.children) {
          childIds.add(c.id)
          const list = kidsByParent.get(item.id) ?? []
          list.push(c)
          kidsByParent.set(item.id, list)
        }
      }
    }
    for (const item of items) {
      if (childIds.has(item.id)) continue
      const list = topByStatus.get(item.status) ?? []
      list.push(item)
      topByStatus.set(item.status, list)
    }
    return { byStatus: topByStatus, childrenByParent: kidsByParent }
  }, [items])

  const onCardDragStart = (e: React.DragEvent, id: string) => {
    if (readOnly) return
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onCardDragEnd = () => {
    setDragId(null)
    setDropColumn(null)
    setDropOnCard(null)
  }

  const onColumnDragOver = (e: React.DragEvent, col: BoardColumn) => {
    if (readOnly || !dragId) return
    e.preventDefault()
    setDropColumn(col.statusValue)
  }

  const onColumnDrop = (e: React.DragEvent, col: BoardColumn) => {
    if (readOnly) return
    e.preventDefault()
    const id = dragId ?? e.dataTransfer.getData('text/plain')
    if (id) onMove?.(id, col.statusValue, byStatus.get(col.statusValue)?.length ?? 0)
    onCardDragEnd()
  }

  // The scrollbar only needs to re-measure when the shape of the board
  // changes, which is exactly when a column's card count changes.
  const signature = columns.map(c => (byStatus.get(c.statusValue)?.length ?? 0)).join(',')

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <style>{KANBAN_CSS}</style>
      <BoardScrollbar scrollerRef={scrollerRef} signature={signature} controlsId={scrollerId} />
      <div
        id={scrollerId}
        ref={scrollerRef}
        className="tahi-kanban-scroller"
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'nowrap',
          gap: '0.875rem',
          alignItems: 'flex-start',
          overflowX: 'auto',
          overscrollBehaviorX: 'contain',
          paddingBottom: '0.25rem',  // room for the native scrollbar
        }}
      >
      {columns.map(col => {
        const cards = byStatus.get(col.statusValue) ?? []
        const isDropTarget = dropColumn === col.statusValue
        return (
          <Column
            key={col.id}
            column={col}
            count={cards.length}
            isDropTarget={isDropTarget}
            actions={columnActions}
            onAdd={onAdd}
            onDragOver={(e) => onColumnDragOver(e, col)}
            onDragLeave={() => setDropColumn(null)}
            onDrop={(e) => onColumnDrop(e, col)}
          >
            {cards.length === 0 ? (
              <EmptySlot onAdd={onAdd ? () => onAdd(col.statusValue) : undefined} />
            ) : (
              cards.map(card => (
                <BoardCard
                  key={card.id}
                  item={card}
                  dragging={dragId === card.id}
                  dropOnCard={dropOnCard === card.id}
                  readOnly={readOnly}
                  nestedChildren={childrenByParent.get(card.id) ?? []}
                  onDragStart={(e) => onCardDragStart(e, card.id)}
                  onDragEnd={onCardDragEnd}
                  onCardDragOver={(e) => {
                    if (readOnly || !dragId || dragId === card.id) return
                    e.preventDefault()
                    e.stopPropagation()
                    setDropOnCard(card.id)
                    setDropColumn(null)
                  }}
                  onCardDragLeave={() => setDropOnCard(null)}
                  onCardDrop={(e) => {
                    if (readOnly) return
                    e.preventDefault()
                    e.stopPropagation()
                    const childId = dragId ?? e.dataTransfer.getData('text/plain')
                    if (childId && childId !== card.id) {
                      onNest?.(childId, card.id)
                    }
                    onCardDragEnd()
                  }}
                  onToggleChecklist={onToggleChecklist}
                  onAssigneeClick={onAssigneeClick}
                  onTagClick={onTagClick}
                  onPriorityClick={onPriorityClick}
                  onClick={onItemClick}
                  iconOnlyPriority={iconOnlyPriority}
                  subtaskUrl={subtaskUrl?.(card) ?? null}
                  subtasksOpen={openSubtasks.has(card.id)}
                  onToggleSubtasks={toggleSubtasks}
                />
              ))
            )}
          </Column>
        )
      })}
      </div>
    </div>
  )
}

// ── Column ────────────────────────────────────────────────────────────

function Column({
  column,
  count,
  isDropTarget,
  actions,
  onAdd,
  onDragOver,
  onDragLeave,
  onDrop,
  children,
}: {
  column: BoardColumn
  count: number
  isDropTarget: boolean
  actions?: ReadonlyArray<ColumnAction>
  onAdd?: (status: string) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  children: React.ReactNode
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLButtonElement | null>(null)
  return (
    <div
      data-board-column
      style={{
        flex: '0 0 16.5rem',
        width: '16.5rem',
        minWidth: '16.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4375rem',
        padding: '0.625rem',
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${isDropTarget ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 150ms ease, background 150ms ease',
        minHeight: '12rem',
        // A column never scrolls: it grows with its cards and the page
        // takes the vertical scroll.
        maxHeight: 'none',
        overflow: 'visible',
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4375rem',
          padding: '0.125rem 0.25rem 0.5rem',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: '0.4375rem',
            height: '0.4375rem',
            borderRadius: 999,
            background: column.color ?? 'var(--color-text-muted)',
            flexShrink: 0,
          }}
        />
        <span style={{
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: 'var(--color-text)',
          letterSpacing: '-0.005em',
        }}>
          {column.label}
        </span>
        <span style={{
          marginLeft: '0.0625rem',
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: 'var(--color-text-subtle)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {count}
        </span>
        <div style={{ flex: 1 }} />
        {onAdd && (
          <button
            type="button"
            onClick={() => onAdd(column.statusValue)}
            aria-label={`Add card to ${column.label}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '1.375rem',
              height: '1.375rem',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-subtle)',
              cursor: 'pointer',
              transition: 'background-color 120ms ease, color 120ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-bg)'
              e.currentTarget.style.color = 'var(--color-text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--color-text-subtle)'
            }}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        )}
        {actions && actions.length > 0 && (
          <>
            <button
              ref={menuRef}
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-label={`${column.label} actions`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '1.375rem',
                height: '1.375rem',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-subtle)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-bg)'
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--color-text-subtle)'
              }}
            >
              <MoreHorizontal size={13} aria-hidden="true" />
            </button>
            <Popover
              anchorRef={menuRef}
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              align="end"
              width="11rem"
            >
              <div role="menu">
                {actions.map((a, i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    onClick={() => { a.onClick(column); setMenuOpen(false) }}
                    className="w-full inline-flex items-center"
                    style={{
                      gap: '0.4375rem',
                      padding: '0.4375rem 0.625rem',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--text-sm)',
                      color: a.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = a.tone === 'danger'
                        ? 'var(--color-danger-bg, rgba(220, 38, 38, 0.10))'
                        : 'var(--color-bg-secondary)'
                    }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {a.icon && (
                      <span style={{
                        color: a.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-muted)',
                        display: 'inline-flex',
                      }}>
                        {a.icon}
                      </span>
                    )}
                    {a.label}
                  </button>
                ))}
              </div>
            </Popover>
          </>
        )}
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4375rem', flex: 1 }}>
        {children}
      </div>

      {/* "+ Add card" footer */}
      {onAdd && (
        <button
          type="button"
          onClick={() => onAdd(column.statusValue)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3125rem',
            padding: '0.4375rem 0.5rem',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'var(--color-text-subtle)',
            cursor: 'pointer',
            transition: 'background-color 120ms ease, color 120ms ease',
            textAlign: 'left',
            width: '100%',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-bg)'
            e.currentTarget.style.color = 'var(--color-text)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-subtle)'
          }}
        >
          <Plus size={11} aria-hidden="true" />
          Add card
        </button>
      )}
    </div>
  )
}

// ── Empty column slot ────────────────────────────────────────────────

function EmptySlot({ onAdd }: { onAdd?: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={!onAdd}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.3125rem',
        padding: '1.5rem 0.75rem',
        background: 'transparent',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-md)',
        fontSize: '0.75rem',
        color: 'var(--color-text-subtle)',
        cursor: onAdd ? 'pointer' : 'default',
        transition: 'border-color 120ms ease, background-color 120ms ease',
      }}
      onMouseEnter={e => {
        if (!onAdd) return
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.background = 'var(--color-brand-50)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {onAdd ? <><Plus size={11} aria-hidden="true" />Drop a card or add one</> : 'No cards'}
    </button>
  )
}

// ── Card ─────────────────────────────────────────────────────────────

const PRIORITY_TONE: Record<BoardPriority, { bg: string; text: string; dot: string }> = {
  urgent: { bg: 'rgba(248, 113, 113, 0.12)', text: '#b91c1c', dot: '#ef4444' },
  high:   { bg: 'rgba(251, 146, 60, 0.12)',  text: '#c2410c', dot: '#fb923c' },
  medium: { bg: 'rgba(250, 204, 21, 0.18)',  text: '#854d0e', dot: '#f59e0b' },
  low:    { bg: 'var(--color-bg-secondary)', text: 'var(--color-text-muted)', dot: 'var(--color-text-muted)' },
}

function BoardCard({
  item,
  dragging,
  dropOnCard,
  readOnly,
  nestedChildren,
  onDragStart,
  onDragEnd,
  onCardDragOver,
  onCardDragLeave,
  onCardDrop,
  onToggleChecklist,
  onClick,
  onAssigneeClick,
  onTagClick,
  onPriorityClick,
  compact = false,
  iconOnlyPriority = false,
  subtaskUrl = null,
  subtasksOpen = false,
  onToggleSubtasks,
}: {
  item: BoardItem
  dragging?: boolean
  dropOnCard?: boolean
  readOnly?: boolean
  nestedChildren?: ReadonlyArray<BoardItem>
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onCardDragOver?: (e: React.DragEvent) => void
  onCardDragLeave?: (e: React.DragEvent) => void
  onCardDrop?: (e: React.DragEvent) => void
  onToggleChecklist?: (itemId: string, checklistItemId: string) => void
  onClick?: (item: BoardItem) => void
  onAssigneeClick?: (assignee: BoardAssignee) => void
  onTagClick?: (tag: BoardTag) => void
  onPriorityClick?: (priority: BoardPriority) => void
  compact?: boolean
  iconOnlyPriority?: boolean
  subtaskUrl?: string | null
  subtasksOpen?: boolean
  onToggleSubtasks?: (itemId: string) => void
}) {
  const [checklistOpen, setChecklistOpen] = React.useState(false)
  const checklist = item.checklist ?? []
  const doneCount = checklist.filter(s => s.done).length
  const hasProgress = !!item.progress && item.progress.total > 0
  const progressRatio = item.progress
    ? Math.min(1, Math.max(0, item.progress.current / Math.max(1, item.progress.total)))
    : 0
  const people = item.people ?? []
  const hasPeopleRow = !!item.client || people.length > 0 || !!item.unassigned
  const subtasks = item.subtasks && item.subtasks.total > 0 ? item.subtasks : null
  const showDue = !!item.dueDate && !item.hideDueChip
  const hasFooterMeta = showDue || !!item.commentCount || !!item.attachmentCount ||
    (!hasPeopleRow && !!item.assignees && item.assignees.length > 0)

  return (
    <div
      className="tahi-focus-ring tahi-board-card"
      data-dragging={dragging ? 'true' : 'false'}
      data-drop-target={dropOnCard ? 'true' : 'false'}
      draggable={!readOnly && !!onDragStart}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Open ${item.title}` : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onCardDragOver}
      onDragLeave={onCardDragLeave}
      onDrop={onCardDrop}
      onClick={(e) => {
        // Only fire if the click was on the card body itself, not on
        // an interactive child (checkbox, button).
        const t = e.target as HTMLElement
        if (t.closest('button, input, a, [role="button"]:not([data-card-root])')) return
        onClick?.(item)
      }}
      onKeyDown={(e) => {
        if (!onClick) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(item)
        }
      }}
      data-card-root
      style={{
        position: 'relative',
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-md)',
        opacity: dragging ? 0.45 : 1,
        cursor: onClick ? 'pointer' : (readOnly ? 'default' : 'grab'),
        overflow: 'hidden',
      }}
    >
      <div style={{
        padding: compact ? '0.5rem 0.625rem' : '0.625rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '0.3125rem' : '0.4375rem',
      }}>
        {/* Top row: category and priority chips on the left, the scope
            warning beside them, the reference pinned right. Each chip is
            clickable when a handler is provided — the caller routes to a
            filtered list (e.g. "all high-priority tasks"). */}
        {(item.priority || (item.tags && item.tags.length > 0) || item.warning || item.reference) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
            {item.priority && (
              <PriorityChip
                priority={item.priority}
                iconOnly={iconOnlyPriority}
                onClick={onPriorityClick ? () => onPriorityClick(item.priority!) : undefined}
              />
            )}
            {item.tags?.map(tag => (
              <TagChip
                key={tag.id}
                tag={tag}
                onClick={onTagClick ? () => onTagClick(tag) : undefined}
              />
            ))}
            {item.warning && (
              <Tooltip label={item.warning}>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={item.warning}
                  className="tahi-focus-ring"
                  style={{ display: 'inline-flex', color: 'var(--color-warning)', borderRadius: 'var(--radius-sm)' }}
                >
                  <AlertTriangle size={13} aria-hidden="true" />
                </span>
              </Tooltip>
            )}
            {item.reference && (
              <span style={{
                marginLeft: 'auto',
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--color-text-subtle)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {item.reference}
              </span>
            )}
          </div>
        )}

        {/* Title + optional description */}
        <div>
          <div
            title={item.title}
            style={{
              fontSize: compact ? '0.8125rem' : 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
              lineHeight: 1.35,
              letterSpacing: '-0.005em',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              overflowWrap: 'break-word',
            }}
          >
            {item.title}
          </div>
          {item.description && !compact && (
            <div style={{
              marginTop: '0.1875rem',
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {item.description}
            </div>
          )}
        </div>

        {/* People row: client on the left, the delivery people stacked
            on the right. One row, so a narrow card reads at a glance. */}
        {hasPeopleRow && (
          <CardPeople client={item.client} people={people} unassigned={item.unassigned} />
        )}

        {/* Sub-request rollup. Expands inline when the caller supplies a
            URL; otherwise it stays a static count. */}
        {subtasks && (
          <CardSubtasks
            itemId={item.id}
            reference={item.reference}
            done={subtasks.done}
            total={subtasks.total}
            url={subtaskUrl}
            open={subtasksOpen}
            onToggle={onToggleSubtasks}
          />
        )}

        {/* Progress bar. Subtasks already carry their own bar, so an
            in-flight card shows one or the other, never both. */}
        {hasProgress && !subtasks && (
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '0.1875rem',
            }}>
              <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Progress
              </span>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {item.progress!.current}/{item.progress!.total}
              </span>
            </div>
            <div style={{
              height: '0.25rem',
              borderRadius: 999,
              background: 'var(--color-bg-tertiary)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${progressRatio * 100}%`,
                height: '100%',
                background: 'var(--color-brand)',
                borderRadius: 999,
                transition: 'width 200ms ease',
              }} />
            </div>
          </div>
        )}

        {/* Checklist: tickable items. Distinct from sub-tasks below. */}
        {checklist.length > 0 && (
          <div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setChecklistOpen(o => !o) }}
              aria-expanded={checklistOpen}
              aria-controls={`checklist-${item.id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.1875rem',
                padding: '0.0625rem 0.1875rem 0.0625rem 0',
                margin: '0 0 0.1875rem',
                background: 'transparent',
                border: 'none',
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                letterSpacing: '0.02em',
              }}
            >
              {checklistOpen
                ? <ChevronDown size={11} aria-hidden="true" />
                : <ChevronRight size={11} aria-hidden="true" />}
              Checklist · {doneCount}/{checklist.length}
            </button>
            {checklistOpen && (
              <div id={`checklist-${item.id}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.1875rem', paddingLeft: '0.0625rem' }}>
                {checklist.map(st => (
                  <ChecklistRow
                    key={st.id}
                    item={st}
                    onToggle={() => onToggleChecklist?.(item.id, st.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Nested sub-tasks (child cards). Indented; no side border. */}
        {nestedChildren && nestedChildren.length > 0 && (
          <div style={{ marginTop: '0.0625rem' }}>
            <div style={{
              fontSize: '0.625rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-text-subtle)',
              marginBottom: '0.25rem',
            }}>
              Sub-tasks · {nestedChildren.length}
            </div>
            <div style={{
              paddingLeft: '0.625rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.3125rem',
            }}>
              {nestedChildren.map(child => (
                <BoardCard
                  key={child.id}
                  item={child}
                  readOnly
                  compact
                  onToggleChecklist={onToggleChecklist}
                  onClick={onClick}
                  onAssigneeClick={onAssigneeClick}
                  onTagClick={onTagClick}
                  onPriorityClick={onPriorityClick}
                />
              ))}
            </div>
          </div>
        )}

        {/* Meta footer */}
        {hasFooterMeta && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            paddingTop: hasProgress || !!subtasks || checklist.length > 0 || (nestedChildren && nestedChildren.length > 0) ? '0.1875rem' : 0,
            color: 'var(--color-text-subtle)',
            fontSize: '0.6875rem',
            fontWeight: 500,
          }}>
            {showDue && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.1875rem',
                color: item.isOverdue ? 'var(--color-danger)' : 'var(--color-text-subtle)',
              }}>
                <Calendar size={10} aria-hidden="true" />
                {item.dueDate}
              </span>
            )}
            {!!item.commentCount && item.commentCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.1875rem' }}>
                <MessageCircle size={10} aria-hidden="true" />
                {item.commentCount}
              </span>
            )}
            {!!item.attachmentCount && item.attachmentCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.1875rem' }}>
                <Paperclip size={10} aria-hidden="true" />
                {item.attachmentCount}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {!hasPeopleRow && item.assignees && item.assignees.length > 0 && (
              <Avatar.Stack spacing="tight">
                {item.assignees.slice(0, 3).map(a => (
                  <Avatar
                    key={a.id}
                    name={a.name}
                    src={a.avatarUrl}
                    size="xs"
                    onClick={onAssigneeClick ? () => onAssigneeClick(a) : undefined}
                  />
                ))}
                {item.assignees.length > 3 && <Avatar.Overflow count={item.assignees.length - 3} size="xs" />}
              </Avatar.Stack>
            )}
          </div>
        )}
      </div>

      {/* Drag handle hint (subtle, top-right) */}
      {!readOnly && onDragStart && (
        <span
          aria-hidden="true"
          className="tahi-kanban-grip"
          style={{
            position: 'absolute',
            top: '0.3125rem',
            right: '0.3125rem',
            color: 'var(--color-text-subtle)',
            opacity: 0,
            transition: 'opacity 120ms ease',
            pointerEvents: 'none',
          }}
        >
          <GripVertical size={11} />
        </span>
      )}
    </div>
  )
}

// ── People row ───────────────────────────────────────────────────────

const STACK_AVATAR_PX = 18
const CLIENT_AVATAR_PX = 20
/** How many people show before the rest fold into a "+N" chip. */
const PEOPLE_VISIBLE = 3

/** One focusable dot in the people row. tabIndex 0 so the tooltip is
 *  reachable by keyboard, not just by hover. */
function PersonDot({
  name,
  avatarUrl,
  role,
  size,
  overlap,
}: {
  name: string
  avatarUrl?: string | null
  role: string
  size: number
  overlap?: boolean
}) {
  return (
    <Tooltip label={`${name} · ${role}`}>
      <span
        tabIndex={0}
        role="img"
        aria-label={`${name}, ${role}`}
        className="tahi-board-person tahi-focus-ring"
        style={{
          marginLeft: overlap ? '-0.4375rem' : 0,
          boxShadow: '0 0 0 2px var(--color-bg)',
        }}
      >
        <Avatar name={name} src={avatarUrl} size={size} tooltip={false} noRing />
      </span>
    </Tooltip>
  )
}

function CardPeople({
  client,
  people,
  unassigned,
}: {
  client?: BoardAssignee
  people: ReadonlyArray<BoardPerson>
  unassigned?: boolean
}) {
  const visible = people.slice(0, PEOPLE_VISIBLE)
  const rest = people.slice(PEOPLE_VISIBLE)
  const restNames = rest.map(p => p.name).join(', ')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minHeight: '1.5rem' }}>
      {client && (
        <PersonDot name={client.name} avatarUrl={client.avatarUrl} role="Client" size={CLIENT_AVATAR_PX} />
      )}
      <div style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}>
        {visible.map((person, i) => (
          <PersonDot
            key={person.id}
            name={person.name}
            avatarUrl={person.avatarUrl}
            role={person.role}
            size={STACK_AVATAR_PX}
            overlap={i > 0}
          />
        ))}
        {unassigned && (
          <Tooltip label="Unassigned · No one is on this yet">
            <span
              tabIndex={0}
              role="img"
              aria-label="Unassigned"
              className="tahi-board-person tahi-focus-ring"
              style={{
                marginLeft: visible.length > 0 ? '-0.4375rem' : 0,
                alignItems: 'center',
                justifyContent: 'center',
                width: `${STACK_AVATAR_PX}px`,
                height: `${STACK_AVATAR_PX}px`,
                border: '1px dashed var(--color-border)',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text-subtle)',
                boxShadow: '0 0 0 2px var(--color-bg)',
              }}
            >
              <User size={11} aria-hidden="true" />
            </span>
          </Tooltip>
        )}
        {rest.length > 0 && (
          <Tooltip label={`${rest.length} more · ${restNames}`}>
            <span
              tabIndex={0}
              role="img"
              aria-label={`${rest.length} more: ${restNames}`}
              className="tahi-board-person tahi-focus-ring"
              style={{
                marginLeft: '-0.4375rem',
                alignItems: 'center',
                justifyContent: 'center',
                width: `${STACK_AVATAR_PX}px`,
                height: `${STACK_AVATAR_PX}px`,
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-muted)',
                fontSize: '0.5625rem',
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                boxShadow: '0 0 0 2px var(--color-bg)',
              }}
            >
              +{rest.length}
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

// ── Sub-request preview ──────────────────────────────────────────────

function statusDot(status?: string | null): string {
  if (!status) return 'var(--color-text-subtle)'
  return `var(--status-${status.replace(/_/g, '-')}-dot, var(--color-text-subtle))`
}

function MiniProgress({ value, tone }: { value: number; tone: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        height: '0.25rem',
        borderRadius: 999,
        background: 'var(--color-bg-tertiary)',
        overflow: 'hidden',
      }}
    >
      <span style={{
        display: 'block',
        width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
        height: '100%',
        borderRadius: 999,
        background: tone,
        transition: 'width 200ms ease',
      }} />
    </span>
  )
}

/** Lazy-loads a card's sub-requests. SWR keys on the URL, so collapsing
 *  and re-expanding a card is instant and two cards never refetch each
 *  other's rows. */
function SubtaskList({ url }: { url: string }) {
  const { data, error, isLoading } = useSWR<{ subRequests?: BoardSubRequest[]; items?: BoardSubRequest[] }>(
    url,
    swrFetcher,
  )
  const rows = data?.subRequests ?? data?.items ?? []

  const message = (text: string) => (
    <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{text}</span>
  )

  return (
    <div
      className="tahi-board-sublist"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.125rem',
        marginTop: '0.0625rem',
        padding: '0.375rem 0.4375rem',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      {isLoading && message('Loading sub-requests…')}
      {!isLoading && error && message('Could not load sub-requests')}
      {!isLoading && !error && rows.length === 0 && message('No sub-requests yet')}
      {rows.map(row => {
        const done = row.status === 'delivered'
        return (
          <div
            key={row.id}
            className="tahi-board-sub-row"
            style={{ display: 'flex', alignItems: 'center', gap: '0.4375rem', minHeight: '1.5rem' }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '0.375rem',
                height: '0.375rem',
                borderRadius: 999,
                background: statusDot(row.status),
                flexShrink: 0,
              }}
            />
            <span style={{
              flex: 1,
              minWidth: 0,
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: done ? 'var(--color-text-subtle)' : 'var(--color-text)',
              textDecoration: done ? 'line-through' : 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {row.title}
            </span>
            {row.assigneeName ? (
              <Avatar name={row.assigneeName} src={row.assigneeAvatarUrl} size={STACK_AVATAR_PX} noRing />
            ) : 'assigneeName' in row ? (
              // The key present but empty means genuinely unassigned. The
              // portal payload omits it entirely, so clients see no slot.
              <span
                title="Unassigned"
                style={{
                  width: `${STACK_AVATAR_PX}px`,
                  height: `${STACK_AVATAR_PX}px`,
                  borderRadius: 999,
                  border: '1px dashed var(--color-border)',
                  background: 'var(--color-bg)',
                  flexShrink: 0,
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function CardSubtasks({
  itemId,
  reference,
  done,
  total,
  url,
  open,
  onToggle,
}: {
  itemId: string
  reference?: string
  done: number
  total: number
  url: string | null
  open: boolean
  onToggle?: (itemId: string) => void
}) {
  const ratio = total > 0 ? done / total : 0
  const tone = done >= total ? 'var(--status-delivered-dot)' : 'var(--color-brand)'
  const label = `${done} of ${total} subtask${total === 1 ? '' : 's'}`
  const expandable = !!url && !!onToggle

  const bar = (
    <>
      <MiniProgress value={ratio} tone={tone} />
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <span
          className="tahi-board-subs-label"
          style={{
            fontSize: '0.65625rem',
            fontWeight: 600,
            color: 'var(--color-text-subtle)',
            fontVariantNumeric: 'tabular-nums',
            transition: 'color 150ms ease',
          }}
        >
          {label}
        </span>
        {expandable && (
          <span className="tahi-board-subs-chevron" style={{ marginLeft: 'auto', display: 'inline-flex', color: 'var(--color-text-subtle)' }}>
            <ChevronDown size={14} aria-hidden="true" />
          </span>
        )}
      </span>
    </>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginTop: '0.125rem' }}>
      {expandable ? (
        <button
          type="button"
          className="tahi-board-subs-bar tahi-focus-ring"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} the ${total} subtask${total === 1 ? '' : 's'}${reference ? ` on ${reference}` : ''}`}
          draggable={false}
          // The card is the drag source. Without this, pressing the bar
          // and moving would drag the card instead of toggling.
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation() }}
          onClick={(e) => { e.stopPropagation(); onToggle?.(itemId) }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.3125rem',
            width: '100%',
            margin: 0,
            padding: '0.125rem 0',
            border: 'none',
            background: 'none',
            textAlign: 'left',
            color: 'inherit',
            font: 'inherit',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
        >
          {bar}
        </button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3125rem', padding: '0.125rem 0' }}>
          {bar}
        </div>
      )}
      {expandable && open && url && <SubtaskList url={url} />}
    </div>
  )
}

// ── Chips ────────────────────────────────────────────────────────────

const PRIORITY_ICON: Record<BoardPriority, typeof ChevronsUp> = {
  urgent: ChevronsUp,
  high:   ChevronUp,
  medium: Minus,
  low:    ChevronDown,
}

function PriorityChip({
  priority,
  onClick,
  iconOnly = false,
}: {
  priority: BoardPriority
  onClick?: () => void
  iconOnly?: boolean
}) {
  const tone = PRIORITY_TONE[priority]

  if (iconOnly) {
    const PriorityIcon = PRIORITY_ICON[priority]
    const label = `${priority.charAt(0).toUpperCase()}${priority.slice(1)} priority`
    const iconStyle: React.CSSProperties = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '1rem',
      height: '1rem',
      padding: 0,
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      background: 'transparent',
      color: tone.dot,
      cursor: onClick ? 'pointer' : 'default',
    }
    return (
      <Tooltip label={label}>
        {onClick ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick() }}
            aria-label={`Filter by ${priority} priority`}
            className="tahi-focus-ring"
            style={iconStyle}
          >
            <PriorityIcon size={14} aria-hidden="true" />
          </button>
        ) : (
          <span tabIndex={0} role="img" aria-label={label} className="tahi-focus-ring" style={iconStyle}>
            <PriorityIcon size={14} aria-hidden="true" />
          </span>
        )}
      </Tooltip>
    )
  }

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.0625rem 0.4375rem 0.0625rem 0.375rem',
    background: tone.bg,
    border: 'none',
    borderRadius: 999,
    color: tone.text,
    fontSize: '0.625rem',
    fontWeight: 600,
    letterSpacing: '0.01em',
    textTransform: 'capitalize',
    cursor: onClick ? 'pointer' : 'default',
    transition: 'filter 120ms ease',
  }
  const inner = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: '0.3125rem',
          height: '0.3125rem',
          borderRadius: 999,
          background: tone.dot,
          flexShrink: 0,
        }}
      />
      {priority}
    </>
  )
  if (!onClick) return <span style={baseStyle}>{inner}</span>
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={`Filter by ${priority} priority`}
      className="tahi-focus-ring"
      style={baseStyle}
      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.95)' }}
      onMouseLeave={e => { e.currentTarget.style.filter = 'none' }}
    >
      {inner}
    </button>
  )
}

function TagChip({
  tag,
  onClick,
}: {
  tag: BoardTag
  onClick?: () => void
}) {
  const color = tag.color ?? 'var(--color-text-muted)'
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.0625rem 0.4375rem',
    background: 'var(--color-bg-secondary)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 'var(--radius-sm)',
    color,
    fontSize: '0.625rem',
    fontWeight: 600,
    letterSpacing: '0.01em',
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

// ── Checklist row ─────────────────────────────────────────────────────

function ChecklistRow({
  item,
  onToggle,
}: {
  item: BoardChecklistItem
  onToggle: () => void
}) {
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.3125rem',
        cursor: 'pointer',
        fontSize: '0.75rem',
        color: item.done ? 'var(--color-text-subtle)' : 'var(--color-text)',
        textDecoration: item.done ? 'line-through' : 'none',
      }}
    >
      <input
        type="checkbox"
        checked={item.done}
        onChange={onToggle}
        style={{
          width: '0.875rem',
          height: '0.875rem',
          accentColor: 'var(--color-brand)',
          cursor: 'pointer',
        }}
      />
      <span style={{ flex: 1, lineHeight: 1.35 }}>{item.label}</span>
    </label>
  )
}

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
import {
  Plus, MoreHorizontal, Calendar, MessageCircle, Paperclip,
  ChevronDown, ChevronRight, GripVertical,
} from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Popover } from '@/components/tahi/popover'
import { Tooltip } from '@/components/tahi/tooltip'

// ── Types ────────────────────────────────────────────────────────────

export interface BoardAssignee {
  id: string
  name: string
  avatarUrl?: string | null
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
  commentCount?: number
  attachmentCount?: number
  assignees?: ReadonlyArray<BoardAssignee>
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
  className?: string
}

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
  className,
}: KanbanBoardProps) {
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropColumn, setDropColumn] = React.useState<string | null>(null)
  const [dropOnCard, setDropOnCard] = React.useState<string | null>(null)

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

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'flex-start',
        overflowX: 'auto',
        paddingBottom: '0.25rem',  // room for the scrollbar
        scrollSnapType: 'x proximity',
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
                />
              ))
            )}
          </Column>
        )
      })}
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
      style={{
        flex: '0 0 17rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4375rem',
        padding: '0.625rem',
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${isDropTarget ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 150ms ease, background 150ms ease',
        minHeight: '12rem',
        scrollSnapAlign: 'start',
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
          color: column.color ?? 'var(--color-text)',
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
}) {
  const [checklistOpen, setChecklistOpen] = React.useState(false)
  const checklist = item.checklist ?? []
  const doneCount = checklist.filter(s => s.done).length
  const hasProgress = !!item.progress && item.progress.total > 0
  const progressRatio = item.progress
    ? Math.min(1, Math.max(0, item.progress.current / Math.max(1, item.progress.total)))
    : 0

  return (
    <div
      className="tahi-focus-ring"
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
        border: `1px solid ${dropOnCard ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        boxShadow: dragging ? 'var(--shadow-md)' : 'var(--shadow-xs)',
        opacity: dragging ? 0.45 : 1,
        transform: dragging ? 'rotate(-1.5deg)' : 'none',
        cursor: onClick ? 'pointer' : (readOnly ? 'default' : 'grab'),
        overflow: 'hidden',
        transition: 'border-color 120ms ease, box-shadow 150ms ease, transform 100ms ease',
      }}
      onMouseEnter={e => {
        if (dragging) return
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
        e.currentTarget.style.borderColor = 'var(--color-border)'
      }}
      onMouseLeave={e => {
        if (dragging) return
        e.currentTarget.style.boxShadow = 'var(--shadow-xs)'
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
      }}
    >
      <div style={{
        padding: compact ? '0.5rem 0.625rem' : '0.625rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '0.3125rem' : '0.4375rem',
      }}>
        {/* Tag row: priority + custom tags. Each chip is clickable
            when a handler is provided — caller routes to a filtered
            list (e.g. "all high-priority tasks", "all Marketing"). */}
        {(item.priority || (item.tags && item.tags.length > 0)) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }}>
            {item.priority && (
              <PriorityChip
                priority={item.priority}
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
          </div>
        )}

        {/* Title + optional description */}
        <div>
          <div style={{
            fontSize: compact ? '0.8125rem' : 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text)',
            lineHeight: 1.35,
            letterSpacing: '-0.005em',
          }}>
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

        {/* Progress bar */}
        {hasProgress && (
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
        {(item.dueDate || item.commentCount || item.attachmentCount || (item.assignees && item.assignees.length > 0)) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            paddingTop: hasProgress || checklist.length > 0 || (nestedChildren && nestedChildren.length > 0) ? '0.1875rem' : 0,
            color: 'var(--color-text-subtle)',
            fontSize: '0.6875rem',
            fontWeight: 500,
          }}>
            {item.dueDate && (
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
            {item.assignees && item.assignees.length > 0 && (
              <Avatar.Stack spacing="tight">
                {item.assignees.slice(0, 3).map(a => (
                  <AssigneeAvatar key={a.id} assignee={a} onClick={onAssigneeClick} />
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

// ── Chips ────────────────────────────────────────────────────────────

function PriorityChip({
  priority,
  onClick,
}: {
  priority: BoardPriority
  onClick?: () => void
}) {
  const tone = PRIORITY_TONE[priority]
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

// ── Assignee avatar (tooltip + click) ────────────────────────────────

function AssigneeAvatar({
  assignee,
  onClick,
}: {
  assignee: BoardAssignee
  onClick?: (assignee: BoardAssignee) => void
}) {
  const node = (
    <Avatar
      name={assignee.name}
      src={assignee.avatarUrl}
      size="xs"
    />
  )
  if (!onClick) {
    return (
      <Tooltip label={assignee.name} side="top">
        <span style={{ display: 'inline-flex' }}>{node}</span>
      </Tooltip>
    )
  }
  return (
    <Tooltip label={assignee.name} side="top">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(assignee) }}
        aria-label={`Open ${assignee.name}'s profile`}
        className="tahi-focus-ring"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          borderRadius: '50%',
          cursor: 'pointer',
          display: 'inline-flex',
        }}
      >
        {node}
      </button>
    </Tooltip>
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

'use client'

/**
 * TrackQueueView
 *
 * Client portal component that shows a client's tracks with active tasks
 * and a draggable queue. Each track is rendered as a card with its active
 * request highlighted and queued items listed below with drag-to-reorder.
 *
 * Features:
 *   - Per-track cards with active task + queue
 *   - HTML5 drag-and-drop reorder on queue items
 *   - Upsell banner when queue depth >= 3
 *   - High-priority confirmation modal
 */

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  GripVertical, Layers, AlignLeft, Clock, ArrowRight,
  ArrowUpRight, AlertTriangle, X, Inbox,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrackActiveRequest {
  id: string
  title: string
  type: string
  status: string
  priority: string
  assigneeName?: string | null
  assigneeInitials?: string | null
  dueDate?: string | null
}

export interface TrackQueueItem {
  id: string
  title: string
  type: string
  priority: string
  queueOrder: number | null
  dueDate?: string | null
}

export interface TrackWithQueue {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: boolean | null
  activeRequest: TrackActiveRequest | null
  queue: TrackQueueItem[]
}

export interface TrackQueueViewProps {
  tracks: TrackWithQueue[]
  basePath?: string
  onReorder?: (trackId: string, orderedRequestIds: string[]) => Promise<void>
  onUpgradeClick?: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDueDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / 86400000)
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`
    if (diffDays === 0) return 'Due today'
    if (diffDays === 1) return 'Due tomorrow'
    if (diffDays <= 7) return `Due in ${diffDays}d`
    return `Due ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
  } catch { return null }
}

function dueDateStyle(dateStr: string | null | undefined): React.CSSProperties {
  if (!dateStr) return {}
  try {
    const d = new Date(dateStr)
    const diffDays = Math.ceil((d.getTime() - Date.now()) / 86400000)
    if (diffDays < 0) return { color: 'var(--color-danger)', background: 'var(--color-danger-bg, #fef2f2)' }
    if (diffDays <= 3) return { color: 'var(--color-warning)', background: 'var(--color-warning-bg, #fff7ed)' }
    return { color: 'var(--color-success)', background: 'var(--color-success-bg, #f0fdf4)' }
  } catch { return {} }
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// ── Priority confirmation modal ──────────────────────────────────────────────

interface PriorityModalProps {
  currentTopTitle: string
  onConfirm: () => void
  onCancel: () => void
}

function PriorityConfirmModal({ currentTopTitle, onConfirm, onCancel }: PriorityModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.4)',
        padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
          maxWidth: '28rem',
          width: '100%',
          boxShadow: '0 1.25rem 3.75rem rgba(0,0,0,0.15)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{
            width: '2.5rem', height: '2.5rem', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '0 1rem 0 1rem',
            background: 'var(--color-warning-bg, #fff7ed)',
          }}>
            <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{
              fontSize: '1rem', fontWeight: 700,
              color: 'var(--color-text)', margin: 0,
            }}>
              Move to top of queue?
            </h3>
            <p style={{
              fontSize: '0.8125rem', color: 'var(--color-text-muted)',
              margin: '0.375rem 0 0 0', lineHeight: 1.5,
            }}>
              This will move the task to the top of your queue, pushing &ldquo;{currentTopTitle}&rdquo; down. Continue?
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'none', border: 'none', padding: '0.25rem',
              cursor: 'pointer', color: 'var(--color-text-subtle)',
              borderRadius: 'var(--radius-button)',
              flexShrink: 0,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8125rem', fontWeight: 600,
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8125rem', fontWeight: 600,
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'var(--color-brand)',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Active task card ─────────────────────────────────────────────────────────

function ActiveTask({ request, basePath }: { request: TrackActiveRequest; basePath: string }) {
  const [hovered, setHovered] = useState(false)
  const dueLabel = formatDueDate(request.dueDate)

  return (
    <Link
      href={`${basePath}/${request.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.75rem',
        textDecoration: 'none',
        borderRadius: 'var(--radius-button)',
        border: '2px solid var(--color-brand)',
        background: hovered ? 'var(--color-brand-50)' : 'var(--color-bg)',
        transition: 'background 0.15s',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Active dot */}
      <div style={{
        width: '0.5rem', height: '0.5rem', borderRadius: '50%', flexShrink: 0,
        background: 'var(--color-brand)',
      }} />

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: '0.875rem', fontWeight: 600,
          color: 'var(--color-text)',
          margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {request.title}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '0.6875rem', fontWeight: 500,
            padding: '0.0625rem 0.375rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-muted)',
            textTransform: 'capitalize',
          }}>
            {request.status.replace(/_/g, ' ')}
          </span>
          {dueLabel && (
            <span style={{
              fontSize: '0.6875rem', fontWeight: 500,
              padding: '0.0625rem 0.375rem',
              borderRadius: 'var(--radius-full)',
              ...dueDateStyle(request.dueDate),
            }}>
              {dueLabel}
            </span>
          )}
        </div>
      </div>

      {/* Assignee avatar */}
      {request.assigneeName && (
        <div
          style={{
            width: '1.75rem', height: '1.75rem', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '0 0.625rem 0 0.625rem',
            background: 'var(--color-brand)',
            color: '#ffffff',
            fontSize: '0.625rem', fontWeight: 700,
          }}
          title={request.assigneeName}
        >
          {request.assigneeInitials ?? getInitials(request.assigneeName)}
        </div>
      )}

      <ArrowRight size={14} style={{ color: 'var(--color-brand)', flexShrink: 0 }} />
    </Link>
  )
}

// ── Draggable queue item ─────────────────────────────────────────────────────

interface DraggableQueueItemProps {
  item: TrackQueueItem
  position: number
  basePath: string
  isDragging: boolean
  isDragOver: boolean
  onDragStart: (e: React.DragEvent, id: string) => void
  onDragOver: (e: React.DragEvent, id: string) => void
  onDragEnd: () => void
  onDrop: (e: React.DragEvent, id: string) => void
}

function DraggableQueueItem({
  item, position, basePath,
  isDragging, isDragOver,
  onDragStart, onDragOver, onDragEnd, onDrop,
}: DraggableQueueItemProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, item.id)}
      onDragOver={e => onDragOver(e, item.id)}
      onDragEnd={onDragEnd}
      onDrop={e => onDrop(e, item.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        borderRadius: 'var(--radius-button)',
        opacity: isDragging ? 0.4 : 1,
        background: isDragOver
          ? 'var(--color-brand-50)'
          : hovered
            ? 'var(--color-bg-tertiary)'
            : 'transparent',
        borderTop: isDragOver ? '2px solid var(--color-brand)' : '2px solid transparent',
        transition: 'background 0.1s, opacity 0.15s',
        cursor: 'grab',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <GripVertical
        size={14}
        style={{ color: 'var(--color-border)', flexShrink: 0, cursor: 'grab' }}
      />
      <span style={{
        fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-subtle)',
        minWidth: '1.125rem', textAlign: 'right', flexShrink: 0,
      }}>
        {position}
      </span>
      <Link
        href={`${basePath}/${item.id}`}
        style={{
          flex: 1, minWidth: 0,
          fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: 'none',
          cursor: 'pointer',
        }}
        onClick={e => e.stopPropagation()}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
      >
        {item.title}
      </Link>
      {item.priority === 'high' && (
        <span style={{
          fontSize: '0.6875rem', fontWeight: 600,
          padding: '0.0625rem 0.375rem',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-danger-bg, #fef2f2)',
          color: 'var(--color-danger)',
          flexShrink: 0,
        }}>
          High
        </span>
      )}
    </div>
  )
}

// ── Upsell banner ────────────────────────────────────────────────────────────

function UpsellBanner({ onUpgradeClick }: { onUpgradeClick?: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.625rem',
      padding: '0.75rem',
      borderRadius: 'var(--radius-button)',
      background: 'var(--color-brand-50)',
      border: '1px solid var(--color-brand-100)',
      marginTop: '0.5rem',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: '0.8125rem', fontWeight: 600,
          color: 'var(--color-brand-dark)',
          margin: 0,
        }}>
          Your queue is growing!
        </p>
        <p style={{
          fontSize: '0.75rem', color: 'var(--color-text-muted)',
          margin: '0.125rem 0 0 0',
        }}>
          Upgrade for more tracks to get work done faster.
        </p>
      </div>
      <button
        type="button"
        onClick={onUpgradeClick}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          padding: '0.375rem 0.75rem',
          fontSize: '0.75rem', fontWeight: 600,
          borderRadius: 'var(--radius-button)',
          border: 'none',
          background: hovered ? 'var(--color-brand-dark)' : 'var(--color-brand)',
          color: '#ffffff',
          cursor: 'pointer',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        Upgrade
        <ArrowUpRight size={12} />
      </button>
    </div>
  )
}

// ── Track card ───────────────────────────────────────────────────────────────

function TrackCard({
  track, basePath, onReorder, onUpgradeClick,
}: {
  track: TrackWithQueue
  basePath: string
  onReorder?: (trackId: string, orderedRequestIds: string[]) => Promise<void>
  onUpgradeClick?: () => void
}) {
  const isLarge = track.type === 'large'
  const Icon = isLarge ? Layers : AlignLeft
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [localQueue, setLocalQueue] = useState(track.queue)
  const [priorityModal, setPriorityModal] = useState<{ itemId: string; currentTopTitle: string } | null>(null)

  // Keep localQueue in sync when prop changes
  const prevQueueRef = useRef(track.queue)
  if (prevQueueRef.current !== track.queue) {
    prevQueueRef.current = track.queue
    setLocalQueue(track.queue)
  }

  const handleDragStart = useCallback((_e: React.DragEvent, id: string) => {
    setDragId(id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault()
    setDragOverId(id)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragId(null)
    setDragOverId(null)
  }, [])

  const reorderQueue = useCallback((fromId: string, toId: string) => {
    setLocalQueue(prev => {
      const items = [...prev]
      const fromIdx = items.findIndex(i => i.id === fromId)
      const toIdx = items.findIndex(i => i.id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const [moved] = items.splice(fromIdx, 1)
      items.splice(toIdx, 0, moved)
      return items
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!dragId || dragId === targetId) {
      handleDragEnd()
      return
    }

    // Check if dragged item is high priority and moving to top
    const draggedItem = localQueue.find(i => i.id === dragId)
    const targetIdx = localQueue.findIndex(i => i.id === targetId)

    if (draggedItem?.priority === 'high' && targetIdx === 0 && localQueue.length > 0) {
      setPriorityModal({
        itemId: dragId,
        currentTopTitle: localQueue[0].title,
      })
      handleDragEnd()
      return
    }

    reorderQueue(dragId, targetId)
    handleDragEnd()

    // Compute new order and notify parent
    const newItems = [...localQueue]
    const fromIdx = newItems.findIndex(i => i.id === dragId)
    const toIdx = newItems.findIndex(i => i.id === targetId)
    if (fromIdx !== -1 && toIdx !== -1) {
      const [moved] = newItems.splice(fromIdx, 1)
      newItems.splice(toIdx, 0, moved)
      onReorder?.(track.id, newItems.map(i => i.id))
    }
  }, [dragId, localQueue, reorderQueue, handleDragEnd, onReorder, track.id])

  const handlePriorityConfirm = useCallback(() => {
    if (!priorityModal) return
    const { itemId } = priorityModal
    // Move to top
    setLocalQueue(prev => {
      const items = [...prev]
      const idx = items.findIndex(i => i.id === itemId)
      if (idx === -1) return prev
      const [moved] = items.splice(idx, 1)
      items.unshift(moved)
      onReorder?.(track.id, items.map(i => i.id))
      return items
    })
    setPriorityModal(null)
  }, [priorityModal, onReorder, track.id])

  const showUpsell = localQueue.length >= 3

  return (
    <>
      <div style={{
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        overflow: 'hidden',
      }}>
        {/* Track header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}>
          <div style={{
            width: '1.75rem', height: '1.75rem', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '0 0.625rem 0 0.625rem',
            background: isLarge ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)',
          }}>
            <Icon size={14} style={{ color: isLarge ? 'var(--color-brand)' : 'var(--color-text-muted)' }} />
          </div>
          <span style={{
            fontSize: '0.8125rem', fontWeight: 700,
            color: 'var(--color-text)',
          }}>
            {isLarge ? 'Large Track' : 'Small Track'}
          </span>
          {track.isPriorityTrack && (
            <span style={{
              fontSize: '0.625rem', fontWeight: 600,
              padding: '0.0625rem 0.375rem',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-brand-50)',
              color: 'var(--color-brand-dark)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              Priority
            </span>
          )}
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.6875rem', fontWeight: 600,
            padding: '0.125rem 0.5rem',
            borderRadius: 'var(--radius-full)',
            background: track.activeRequest ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)',
            color: track.activeRequest ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
          }}>
            {track.activeRequest ? 'Active' : 'Open'}
          </span>
        </div>

        {/* Active task */}
        <div style={{ padding: '0.75rem' }}>
          {track.activeRequest ? (
            <ActiveTask request={track.activeRequest} basePath={basePath} />
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.75rem',
              borderRadius: 'var(--radius-button)',
              border: '1px dashed var(--color-border)',
              background: 'var(--color-bg-secondary)',
            }}>
              <Clock size={14} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>
                Waiting for next {isLarge ? 'task' : 'small task'}
              </span>
            </div>
          )}
        </div>

        {/* Queue section */}
        {localQueue.length > 0 && (
          <div style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.5rem 1rem',
              background: 'var(--color-bg-secondary)',
            }}>
              <span style={{
                fontSize: '0.6875rem', fontWeight: 600,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                Queue
              </span>
              <span style={{
                fontSize: '0.625rem', fontWeight: 700,
                padding: '0.0625rem 0.375rem',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-muted)',
              }}>
                {localQueue.length}
              </span>
            </div>
            <div style={{ padding: '0.25rem 0.25rem' }}>
              {localQueue.map((item, i) => (
                <DraggableQueueItem
                  key={item.id}
                  item={item}
                  position={i + 1}
                  basePath={basePath}
                  isDragging={dragId === item.id}
                  isDragOver={dragOverId === item.id}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty queue state */}
        {localQueue.length === 0 && !track.activeRequest && (
          <div style={{
            padding: '1.5rem 1rem',
            textAlign: 'center',
          }}>
            <div style={{
              width: '2.5rem', height: '2.5rem',
              margin: '0 auto 0.5rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '0 1rem 0 1rem',
              background: 'var(--color-bg-tertiary)',
            }}>
              <Inbox size={18} style={{ color: 'var(--color-text-subtle)' }} />
            </div>
            <p style={{
              fontSize: '0.8125rem', fontWeight: 600,
              color: 'var(--color-text-muted)', margin: 0,
            }}>
              No tasks in this track
            </p>
            <p style={{
              fontSize: '0.75rem', color: 'var(--color-text-subtle)',
              margin: '0.25rem 0 0 0',
            }}>
              Submit a request to get started
            </p>
          </div>
        )}

        {/* Upsell banner */}
        {showUpsell && (
          <div style={{ padding: '0 0.75rem 0.75rem' }}>
            <UpsellBanner onUpgradeClick={onUpgradeClick} />
          </div>
        )}
      </div>

      {/* Priority confirmation modal */}
      {priorityModal && (
        <PriorityConfirmModal
          currentTopTitle={priorityModal.currentTopTitle}
          onConfirm={handlePriorityConfirm}
          onCancel={() => setPriorityModal(null)}
        />
      )}
    </>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function TrackQueueView({
  tracks,
  basePath = '/requests',
  onReorder,
  onUpgradeClick,
}: TrackQueueViewProps) {
  if (tracks.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '3rem 1.5rem',
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <div style={{
          width: '3rem', height: '3rem',
          margin: '0 auto 0.75rem',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '0 1rem 0 1rem',
          background: 'linear-gradient(135deg, var(--color-brand-50), var(--color-brand-100))',
        }}>
          <Layers size={20} style={{ color: 'var(--color-brand)' }} />
        </div>
        <h3 style={{
          fontSize: '1rem', fontWeight: 700,
          color: 'var(--color-text)', margin: '0 0 0.25rem 0',
        }}>
          No tracks yet
        </h3>
        <p style={{
          fontSize: '0.8125rem', color: 'var(--color-text-muted)',
          margin: '0 0 1rem 0',
        }}>
          Your subscription tracks will appear here once your plan is active.
        </p>
        <Link
          href="/requests?new=1"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.5rem 1rem',
            fontSize: '0.8125rem', fontWeight: 600,
            borderRadius: 'var(--radius-button)',
            background: 'var(--color-brand)',
            color: '#ffffff',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          Submit a request
          <ArrowRight size={14} />
        </Link>
      </div>
    )
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 22rem), 1fr))',
      gap: '1rem',
    }}>
      {tracks.map(track => (
        <TrackCard
          key={track.id}
          track={track}
          basePath={basePath}
          onReorder={onReorder}
          onUpgradeClick={onUpgradeClick}
        />
      ))}
    </div>
  )
}

'use client'

/**
 * TrackQueueView — client portal track visualization (per-track mini-kanban).
 *
 * Each track is a card laid out as a compact kanban with four lanes:
 *   Up next (queued, drag-to-reorder) -> In progress (the active slot, WIP=1)
 *   -> Review (needs the client's input) -> Delivered (last 30 days).
 * The header tells the "what you're paying for" story (slot status, delivered
 * count, avg turnaround). Greyed-out ghost cards show the tracks the client
 * would gain by upgrading (capability-led), so the upgrade path is visual.
 *
 * Only the Up next lane is interactive (drag-reorder + high-priority bump);
 * Tahi controls status, so the other lanes are read-only. Mobile-first: lanes
 * stack on phones.
 */

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  GripVertical, Layers, AlignLeft, Clock, ArrowRight, ArrowUpRight,
  AlertTriangle, X, Sparkles, Lock,
} from 'lucide-react'
import type { GhostTrack } from '@/lib/plan-utils'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrackLaneItem {
  id: string
  title: string
  type: string
  status: string
  priority: string
  queueOrder?: number | null
  dueDate?: string | null
  assigneeName?: string | null
  deliveredAt?: string | null
}

export interface TrackLanes {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: boolean | null
  upNext: TrackLaneItem[]
  inProgress: TrackLaneItem[]
  review: TrackLaneItem[]
  delivered: TrackLaneItem[]
  /** Delivered in the last 30 days (header stat). */
  deliveredCount: number
  /** Average turnaround in days, or null. */
  avgTurnaroundDays: number | null
}

export interface TrackQueueViewProps {
  tracks: TrackLanes[]
  ghosts?: GhostTrack[]
  basePath?: string
  onReorder?: (trackId: string, orderedRequestIds: string[]) => Promise<void>
  onUpgradeClick?: () => void
  /** Unified (tracks-off) mode: one full-width board, no slot/track framing. */
  unified?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDueDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    const diffDays = Math.ceil((d.getTime() - Date.now()) / 86400000)
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
    const diffDays = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
    if (diffDays < 0) return { color: 'var(--color-danger)', background: 'var(--color-danger-bg)' }
    if (diffDays <= 3) return { color: 'var(--color-warning)', background: 'var(--color-warning-bg)' }
    return { color: 'var(--color-success)', background: 'var(--color-success-bg)' }
  } catch { return {} }
}

const LANE_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))',
  gap: '0.625rem',
  padding: '0.75rem',
}

// ── Priority confirmation modal ──────────────────────────────────────────────

function PriorityConfirmModal({ currentTopTitle, onConfirm, onCancel }: {
  currentTopTitle: string; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', padding: '1rem' }}
      onClick={onCancel}
    >
      <div
        style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.5rem', maxWidth: '28rem', width: '100%', boxShadow: '0 1.25rem 3.75rem rgba(0,0,0,0.15)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ width: '2.5rem', height: '2.5rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 1rem 0 1rem', background: 'var(--color-warning-bg)' }}>
            <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Move to top of queue?</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0 0', lineHeight: 1.5 }}>
              This moves the task to the top of your queue, pushing &ldquo;{currentTopTitle}&rdquo; down. Continue?
            </p>
          </div>
          <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', padding: '0.25rem', cursor: 'pointer', color: 'var(--color-text-subtle)', flexShrink: 0 }} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem', fontWeight: 600, borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', cursor: 'pointer' }}>Cancel</button>
          <button type="button" onClick={onConfirm} style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem', fontWeight: 600, borderRadius: 'var(--radius-button)', border: 'none', background: 'var(--color-brand)', color: '#ffffff', cursor: 'pointer' }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ── Lane card (read-only request) ─────────────────────────────────────────────

function LaneCard({ item, basePath, accent }: { item: TrackLaneItem; basePath: string; accent?: 'brand' | 'review' | 'done' }) {
  const [hovered, setHovered] = useState(false)
  const dueLabel = formatDueDate(item.dueDate)
  const borderColor = accent === 'brand' ? 'var(--color-brand)' : accent === 'review' ? 'var(--color-warning)' : 'var(--color-border)'
  return (
    <Link
      href={`${basePath}/${item.id}`}
      style={{
        display: 'block', textDecoration: 'none', padding: '0.5rem 0.625rem',
        borderRadius: 'var(--radius-button)',
        border: `1px solid ${borderColor}`,
        background: hovered ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
        transition: 'background 0.15s', marginBottom: '0.375rem',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.title}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
        {accent === 'done' && item.deliveredAt && (
          <span style={{ fontSize: '0.625rem', fontWeight: 500, color: 'var(--color-success)' }}>
            {new Date(item.deliveredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {dueLabel && accent !== 'done' && (
          <span style={{ fontSize: '0.625rem', fontWeight: 500, padding: '0.0625rem 0.375rem', borderRadius: 'var(--radius-full)', ...dueDateStyle(item.dueDate) }}>
            {dueLabel}
          </span>
        )}
        {item.priority === 'high' && accent !== 'done' && (
          <span style={{ fontSize: '0.625rem', fontWeight: 600, padding: '0.0625rem 0.375rem', borderRadius: 'var(--radius-full)', background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>High</span>
        )}
      </div>
    </Link>
  )
}

// ── Lane header ───────────────────────────────────────────────────────────────

function LaneHeader({ label, count, tone }: { label: string; count: number; tone?: 'brand' | 'review' | 'done' }) {
  const color = tone === 'brand' ? 'var(--color-brand-dark)' : tone === 'review' ? 'var(--color-warning)' : tone === 'done' ? 'var(--color-success)' : 'var(--color-text-muted)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
      <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color }}>{label}</span>
      <span style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)' }}>{count}</span>
    </div>
  )
}

// ── Draggable Up-next item ────────────────────────────────────────────────────

function DraggableItem({ item, position, basePath, isDragging, isDragOver, onDragStart, onDragOver, onDragEnd, onDrop }: {
  item: TrackLaneItem; position: number; basePath: string; isDragging: boolean; isDragOver: boolean
  onDragStart: (e: React.DragEvent, id: string) => void; onDragOver: (e: React.DragEvent, id: string) => void
  onDragEnd: () => void; onDrop: (e: React.DragEvent, id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, item.id)}
      onDragOver={e => onDragOver(e, item.id)}
      onDragEnd={onDragEnd}
      onDrop={e => onDrop(e, item.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.5rem 0.5rem',
        borderRadius: 'var(--radius-button)', marginBottom: '0.375rem',
        opacity: isDragging ? 0.4 : 1,
        background: isDragOver ? 'var(--color-brand-50)' : hovered ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderTop: isDragOver ? '2px solid var(--color-brand)' : '1px solid var(--color-border)',
        transition: 'background 0.1s, opacity 0.15s', cursor: 'grab',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <GripVertical size={13} style={{ color: 'var(--color-border)', flexShrink: 0 }} />
      <span style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', minWidth: '1rem', textAlign: 'right', flexShrink: 0 }}>{position}</span>
      <Link
        href={`${basePath}/${item.id}`}
        style={{ flex: 1, minWidth: 0, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
        onClick={e => e.stopPropagation()}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
      >
        {item.title}
      </Link>
      {item.priority === 'high' && (
        <span style={{ fontSize: '0.625rem', fontWeight: 600, padding: '0.0625rem 0.375rem', borderRadius: 'var(--radius-full)', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', flexShrink: 0 }}>High</span>
      )}
    </div>
  )
}

// ── Empty lane hint ────────────────────────────────────────────────────────────

function EmptyLane({ label }: { label: string }) {
  return (
    <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', fontStyle: 'italic', margin: '0.25rem 0' }}>{label}</p>
  )
}

// ── Track card ───────────────────────────────────────────────────────────────

function TrackCard({ track, basePath, onReorder, onUpgradeClick, unified }: {
  track: TrackLanes; basePath: string
  onReorder?: (trackId: string, orderedRequestIds: string[]) => Promise<void>
  onUpgradeClick?: () => void
  unified?: boolean
}) {
  const isLarge = track.type === 'large'
  const Icon = unified ? Layers : isLarge ? Layers : AlignLeft
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [localQueue, setLocalQueue] = useState(track.upNext)
  const [priorityModal, setPriorityModal] = useState<{ itemId: string; currentTopTitle: string } | null>(null)

  const prevRef = useRef(track.upNext)
  if (prevRef.current !== track.upNext) { prevRef.current = track.upNext; setLocalQueue(track.upNext) }

  const handleDragStart = useCallback((_e: React.DragEvent, id: string) => setDragId(id), [])
  const handleDragOver = useCallback((e: React.DragEvent, id: string) => { e.preventDefault(); setDragOverId(id) }, [])
  const handleDragEnd = useCallback(() => { setDragId(null); setDragOverId(null) }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!dragId || dragId === targetId) { handleDragEnd(); return }
    const dragged = localQueue.find(i => i.id === dragId)
    const targetIdx = localQueue.findIndex(i => i.id === targetId)
    if (dragged?.priority === 'high' && targetIdx === 0 && localQueue.length > 0) {
      setPriorityModal({ itemId: dragId, currentTopTitle: localQueue[0].title })
      handleDragEnd(); return
    }
    setLocalQueue(prev => {
      const items = [...prev]
      const from = items.findIndex(i => i.id === dragId)
      const to = items.findIndex(i => i.id === targetId)
      if (from === -1 || to === -1) return prev
      const [moved] = items.splice(from, 1)
      items.splice(to, 0, moved)
      onReorder?.(track.id, items.map(i => i.id))
      return items
    })
    handleDragEnd()
  }, [dragId, localQueue, handleDragEnd, onReorder, track.id])

  const handlePriorityConfirm = useCallback(() => {
    if (!priorityModal) return
    const { itemId } = priorityModal
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

  const showUpsell = !unified && localQueue.length >= 3
  const slotActive = track.inProgress.length > 0 || track.review.length > 0
  const statBits: string[] = []
  if (track.deliveredCount > 0) statBits.push(`${track.deliveredCount} delivered (30d)`)
  if (track.avgTurnaroundDays != null) statBits.push(`~${track.avgTurnaroundDays}d avg`)

  return (
    <>
      <div style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-secondary)', flexWrap: 'wrap' }}>
          <div style={{ width: '1.75rem', height: '1.75rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 0.625rem 0 0.625rem', background: isLarge ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)' }}>
            <Icon size={14} style={{ color: isLarge ? 'var(--color-brand)' : 'var(--color-text-muted)' }} />
          </div>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text)' }}>{unified ? 'Your work' : isLarge ? 'Large track' : 'Small track'}</span>
          {!unified && track.isPriorityTrack && (
            <span style={{ fontSize: '0.625rem', fontWeight: 600, padding: '0.0625rem 0.375rem', borderRadius: 'var(--radius-full)', background: 'var(--color-brand-50)', color: 'var(--color-brand-dark)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Priority</span>
          )}
          {!unified && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3125rem', marginLeft: 'auto', fontSize: '0.6875rem', fontWeight: 600, color: slotActive ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)' }}>
              <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: slotActive ? 'var(--color-brand)' : 'var(--color-border)' }} />
              {slotActive ? 'Active' : 'Open'}
            </span>
          )}
        </div>

        {/* Stat strip */}
        {statBits.length > 0 && (
          <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--color-border-subtle)', fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
            {statBits.join(' · ')}
          </div>
        )}

        {/* Lanes */}
        <div style={LANE_GRID}>
          {/* Up next */}
          <div>
            <LaneHeader label="Up next" count={localQueue.length} />
            {localQueue.length === 0 ? <EmptyLane label="Nothing queued" /> : localQueue.map((item, i) => (
              <DraggableItem
                key={item.id} item={item} position={i + 1} basePath={basePath}
                isDragging={dragId === item.id} isDragOver={dragOverId === item.id}
                onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDrop={handleDrop}
              />
            ))}
          </div>
          {/* In progress */}
          <div>
            <LaneHeader label="In progress" count={track.inProgress.length} tone="brand" />
            {track.inProgress.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.5rem', borderRadius: 'var(--radius-button)', border: '1px dashed var(--color-border)' }}>
                <Clock size={12} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{unified ? 'Nothing in progress' : 'Your slot is open'}</span>
              </div>
            ) : track.inProgress.map(item => <LaneCard key={item.id} item={item} basePath={basePath} accent="brand" />)}
          </div>
          {/* Review */}
          <div>
            <LaneHeader label="Review" count={track.review.length} tone="review" />
            {track.review.length === 0 ? <EmptyLane label="Nothing to review" /> : track.review.map(item => <LaneCard key={item.id} item={item} basePath={basePath} accent="review" />)}
          </div>
          {/* Delivered */}
          <div>
            <LaneHeader label="Delivered" count={track.delivered.length} tone="done" />
            {track.delivered.length === 0 ? <EmptyLane label="None yet (30d)" /> : (
              <>
                {track.delivered.slice(0, 5).map(item => <LaneCard key={item.id} item={item} basePath={basePath} accent="done" />)}
                <Link href={`${basePath}?status=delivered`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-brand)', textDecoration: 'none', marginTop: '0.125rem' }}>
                  View all delivered <ArrowRight size={11} />
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Upsell */}
        {showUpsell && (
          <div style={{ padding: '0 0.75rem 0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-button)', background: 'var(--color-brand-50)', border: '1px solid var(--color-brand-100)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-brand-dark)', margin: 0 }}>Your queue is growing</p>
                <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', margin: '0.125rem 0 0 0' }}>Add a track to get more done at once.</p>
              </div>
              <button type="button" onClick={onUpgradeClick} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.375rem 0.625rem', fontSize: '0.6875rem', fontWeight: 600, borderRadius: 'var(--radius-button)', border: 'none', background: 'var(--color-brand)', color: '#ffffff', cursor: 'pointer', flexShrink: 0 }}>
                Upgrade <ArrowUpRight size={11} />
              </button>
            </div>
          </div>
        )}
      </div>

      {priorityModal && (
        <PriorityConfirmModal currentTopTitle={priorityModal.currentTopTitle} onConfirm={handlePriorityConfirm} onCancel={() => setPriorityModal(null)} />
      )}
    </>
  )
}

// ── Ghost (upsell) track card ──────────────────────────────────────────────────

function GhostCard({ ghost, onUpgradeClick }: { ghost: GhostTrack; onUpgradeClick?: () => void }) {
  const [hovered, setHovered] = useState(false)
  const isLarge = ghost.type === 'large'
  const Icon = isLarge ? Layers : AlignLeft
  return (
    <button
      type="button"
      onClick={onUpgradeClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textAlign: 'left', cursor: 'pointer', width: '100%',
        borderRadius: 'var(--radius-card)',
        border: '1px dashed var(--color-border)',
        background: hovered ? 'var(--color-bg-secondary)' : 'var(--color-bg-secondary)',
        opacity: hovered ? 1 : 0.7,
        transition: 'opacity 0.15s, transform 0.15s, box-shadow 0.15s',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? 'var(--shadow-sm, 0 4px 12px rgba(0,0,0,0.06))' : 'none',
        padding: '1rem',
        display: 'flex', flexDirection: 'column', gap: '0.625rem',
        minHeight: '11rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ width: '1.75rem', height: '1.75rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 0.625rem 0 0.625rem', background: 'var(--color-bg-tertiary)', position: 'relative' }}>
          <Icon size={14} style={{ color: 'var(--color-text-subtle)' }} />
        </div>
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {isLarge ? 'Large track' : 'Small track'}
        </span>
        <Lock size={12} style={{ color: 'var(--color-text-subtle)', marginLeft: 'auto' }} />
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <Sparkles size={14} style={{ color: 'var(--color-brand)' }} />
          {ghost.headline}
        </p>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.375rem 0 0 0', lineHeight: 1.5 }}>
          {ghost.subline}
        </p>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-brand)' }}>
        {ghost.cta} <ArrowUpRight size={13} />
      </span>
    </button>
  )
}

// ── Main ────────────────────────────────────────────────────────────────────

export function TrackQueueView({ tracks, ghosts = [], basePath = '/requests', onReorder, onUpgradeClick, unified }: TrackQueueViewProps) {
  if (tracks.length === 0 && ghosts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1.5rem', background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border-subtle)' }}>
        <div style={{ width: '3rem', height: '3rem', margin: '0 auto 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '0 1rem 0 1rem', background: 'linear-gradient(135deg, var(--color-brand-50), var(--color-brand-100))' }}>
          <Layers size={20} style={{ color: 'var(--color-brand)' }} />
        </div>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 0.25rem 0' }}>No tracks yet</h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0 0 1rem 0' }}>Your subscription tracks will appear here once your plan is active.</p>
        <Link href={`${basePath}?new=1`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', padding: '0.5rem 1rem', fontSize: '0.8125rem', fontWeight: 600, borderRadius: 'var(--radius-button)', background: 'var(--color-brand)', color: '#ffffff', textDecoration: 'none' }}>
          Submit a request <ArrowRight size={14} />
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: unified ? '1fr' : 'repeat(auto-fill, minmax(min(100%, 30rem), 1fr))', gap: '1rem' }}>
      {tracks.map(track => (
        <TrackCard key={track.id} track={track} basePath={basePath} onReorder={onReorder} onUpgradeClick={onUpgradeClick} unified={unified} />
      ))}
      {!unified && ghosts.map((ghost, i) => (
        <GhostCard key={`ghost-${ghost.type}-${i}`} ghost={ghost} onUpgradeClick={onUpgradeClick} />
      ))}
    </div>
  )
}

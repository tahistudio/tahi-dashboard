'use client'

/**
 * TrackQueuePanel
 *
 * Visualises a client's subscription tracks and request queue.
 * Used on both the client overview page and admin client detail.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │  [Track badge] Large track                  │
 *   │  ┌─────────────────────────────────────┐   │
 *   │  │  ● ACTIVE  Website redesign         │   │
 *   │  └─────────────────────────────────────┘   │
 *   │                                             │
 *   │  [Track badge] Small track                  │
 *   │  ┌─────────────────────────────────────┐   │
 *   │  │  ─ OPEN  (waiting for next task)    │   │
 *   │  └─────────────────────────────────────┘   │
 *   │                                             │
 *   │  QUEUE  (3)                                 │
 *   │  1. New landing page         large • due… │
 *   │  2. Fix mobile menu          small         │
 *   │  3. Update blog copy         small         │
 *   └─────────────────────────────────────────────┘
 */

import Link from 'next/link'
import { ArrowRight, Layers, AlignLeft, Clock, GripVertical } from 'lucide-react'
// trackCanHandle reserved for future per-track type filtering

// ── Types ──────────────────────────────────────────────────────────────────────

interface ActiveRequest {
  id: string
  title: string
  type: string
  status: string
  priority: string
  dueDate?: string | null
}

interface Track {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: boolean | null
  currentRequestId: string | null
  currentRequest: ActiveRequest | null
}

interface QueuedRequest {
  id: string
  title: string
  type: string
  status: string
  priority: string
  queueOrder: number | null
  dueDate?: string | null
  createdAt: string
}

interface TrackQueuePanelProps {
  tracks: Track[]
  queue: QueuedRequest[]
  summary: string
  /** If true, shows drag handles and allows admin to reorder */
  isAdmin?: boolean
  onReorder?: (requestId: string, newOrder: number) => void
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
    if (diffDays < 0) return { color: 'var(--color-overdue-text)', background: 'var(--color-overdue-bg)' }
    if (diffDays <= 3) return { color: 'var(--color-due-soon-text)', background: 'var(--color-due-soon-bg)' }
    return { color: 'var(--color-on-track-text)', background: 'var(--color-on-track-bg)' }
  } catch { return {} }
}

const TYPE_LABEL: Record<string, string> = {
  small_task: 'Small',
  large_task: 'Large',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TrackSlot({ track, basePath = '/requests' }: { track: Track; basePath?: string }) {
  const isLarge = track.type === 'large'
  const Icon = isLarge ? Layers : AlignLeft
  const active = track.currentRequest

  return (
    <div style={{
      borderRadius: 'var(--radius-card)',
      border: `1px solid ${active ? 'var(--color-brand-200)' : 'var(--color-border-subtle)'}`,
      background: active ? 'var(--color-brand-50)' : 'var(--color-bg-secondary)',
      overflow: 'hidden',
    }}>
      {/* Track label row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.375rem',
        padding: '0.5rem 0.75rem',
        borderBottom: `1px solid ${active ? 'var(--color-brand-100)' : 'var(--color-border-subtle)'}`,
      }}>
        <Icon size={12} style={{ color: isLarge ? 'var(--color-brand)' : 'var(--color-text-muted)', flexShrink: 0 }} />
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {isLarge ? 'Large track' : 'Small track'}
          {track.isPriorityTrack ? ' · Priority' : ''}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontSize: '0.625rem', fontWeight: 600,
          padding: '0.125rem 0.4375rem',
          borderRadius: 'var(--radius-full)',
          ...(active
            ? { background: 'var(--status-in-progress-bg)', color: 'var(--status-in-progress-text)' }
            : { background: 'var(--color-bg-tertiary)', color: 'var(--color-text-subtle)' }
          ),
        }}>
          {active ? 'Active' : 'Open'}
        </span>
      </div>

      {/* Content */}
      {active ? (
        <Link
          href={`${basePath}/${active.id}`}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.625rem',
            padding: '0.75rem',
            textDecoration: 'none',
          }}
        >
          <div style={{
            width: '0.5rem', height: '0.5rem', borderRadius: '50%', flexShrink: 0,
            background: 'var(--status-in-progress-dot)',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontSize: '0.8125rem', fontWeight: 600,
              color: 'var(--color-text)',
              margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {active.title}
            </p>
            {active.dueDate && (
              <span style={{
                fontSize: '0.6875rem', fontWeight: 500,
                padding: '0.0625rem 0.375rem',
                borderRadius: 'var(--radius-full)',
                marginTop: '0.1875rem',
                display: 'inline-block',
                ...dueDateStyle(active.dueDate),
              }}>
                {formatDueDate(active.dueDate)}
              </span>
            )}
          </div>
          <ArrowRight size={13} style={{ color: 'var(--color-brand)', flexShrink: 0 }} />
        </Link>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.75rem',
          color: 'var(--color-text-subtle)',
          fontSize: '0.8125rem',
        }}>
          <Clock size={13} style={{ flexShrink: 0 }} />
          Waiting for next {isLarge ? 'large or small' : 'small'} task
        </div>
      )}
    </div>
  )
}

function QueueItem({
  req, position, isAdmin, basePath = '/requests',
}: {
  req: QueuedRequest
  position: number
  isAdmin?: boolean
  basePath?: string
}) {
  const dueLabel = formatDueDate(req.dueDate)
  const dueStyle = dueDateStyle(req.dueDate)

  return (
    <Link
      href={`${basePath}/${req.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.625rem',
        padding: '0.625rem 0.75rem',
        textDecoration: 'none',
        borderRadius: 'var(--radius-button)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {isAdmin && (
        <GripVertical size={12} style={{ color: 'var(--color-border)', flexShrink: 0, cursor: 'grab' }} />
      )}
      <span style={{
        fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-subtle)',
        minWidth: '1.125rem', textAlign: 'right', flexShrink: 0,
      }}>
        {position}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)',
          margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {req.title}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
        <span style={{
          fontSize: '0.6875rem', fontWeight: 500,
          padding: '0.125rem 0.4375rem',
          borderRadius: 'var(--radius-full)',
          background: req.type === 'large_task' ? 'var(--cat-strategy-bg)' : 'var(--color-bg-tertiary)',
          color: req.type === 'large_task' ? 'var(--cat-strategy-text)' : 'var(--color-text-muted)',
        }}>
          {TYPE_LABEL[req.type] ?? req.type}
        </span>
        {dueLabel && (
          <span style={{
            fontSize: '0.6875rem', fontWeight: 500,
            padding: '0.125rem 0.4375rem',
            borderRadius: 'var(--radius-full)',
            ...dueStyle,
          }}>
            {dueLabel}
          </span>
        )}
        {req.priority === 'high' && (
          <span style={{
            fontSize: '0.6875rem', fontWeight: 600,
            padding: '0.125rem 0.4375rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--priority-high-bg)',
            color: 'var(--priority-high-text)',
          }}>
            High
          </span>
        )}
      </div>
    </Link>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function TrackQueuePanel({
  tracks, queue, summary, isAdmin = false, basePath = '/requests',
}: TrackQueuePanelProps & { basePath?: string }) {
  const largeTracks = tracks.filter(t => t.type === 'large')
  const smallTracks = tracks.filter(t => t.type === 'small')

  const allQueue = queue  // show unified queue with type badge

  if (tracks.length === 0 && queue.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '2rem 1.5rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
          No active tracks yet.{' '}
          {!isAdmin && (
            <Link href="/requests?new=1" style={{ color: 'var(--color-brand)', fontWeight: 600 }}>
              Submit a request
            </Link>
          )}
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Tracks */}
      {tracks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {largeTracks.map(t => (
            <TrackSlot key={t.id} track={t} basePath={basePath} />
          ))}
          {smallTracks.map(t => (
            <TrackSlot key={t.id} track={t} basePath={basePath} />
          ))}
        </div>
      )}

      {/* Queue */}
      {allQueue.length > 0 && (
        <div style={{
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border-subtle)',
          overflow: 'hidden',
          background: 'var(--color-bg)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.5rem 0.75rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
          }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Queue
            </span>
            <span style={{
              fontSize: '0.625rem', fontWeight: 700,
              padding: '0.125rem 0.4375rem',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)',
            }}>
              {allQueue.length}
            </span>
          </div>
          <div style={{ padding: '0.25rem 0' }}>
            {allQueue.map((req, i) => (
              <QueueItem
                key={req.id}
                req={req}
                position={i + 1}
                isAdmin={isAdmin}
                basePath={basePath}
              />
            ))}
          </div>
        </div>
      )}

      {/* Summary footer */}
      <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: 0 }}>
        Plan: {summary}
      </p>
    </div>
  )
}

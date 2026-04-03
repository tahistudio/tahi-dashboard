'use client'

/**
 * TrackView
 *
 * Client portal track queue page. Fetches the client's tracks and requests,
 * groups them by track, and renders the TrackQueueView component with
 * drag-to-reorder support.
 */

import { useState, useEffect, useCallback } from 'react'
import { TrackQueueView } from '@/components/tahi/track-queue-view'
import type { TrackWithQueue, TrackActiveRequest, TrackQueueItem } from '@/components/tahi/track-queue-view'
import { apiPath } from '@/lib/api'
import { trackCanHandle } from '@/lib/plan-utils'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrackResponse {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: number | null
  currentRequestId: string | null
}

interface RequestResponse {
  id: string
  title: string
  type: string
  status: string
  priority: string
  trackId: string | null
  queueOrder: number | null
  assigneeName?: string | null
  dueDate?: string | null
  createdAt: string
}

interface CapacityResponse {
  tracks: TrackResponse[]
  requests: RequestResponse[]
}

// ── Statuses that mean "active" on a track ──────────────────────────────────

const ACTIVE_STATUSES = new Set([
  'in_progress',
  'in_review',
  'client_review',
])

const QUEUED_STATUSES = new Set([
  'submitted',
  'queued',
])

// ── Component ────────────────────────────────────────────────────────────────

interface TrackViewProps {
  isAdmin: boolean
}

export function TrackView({ isAdmin }: TrackViewProps) {
  const [tracks, setTracks] = useState<TrackWithQueue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = isAdmin ? '/api/admin/capacity' : '/api/portal/capacity'
      const res = await fetch(apiPath(endpoint))
      if (!res.ok) throw new Error('Failed to fetch track data')
      const data: CapacityResponse = await res.json()

      const trackMap = new Map<string, TrackWithQueue>()

      // Initialize tracks
      for (const t of data.tracks) {
        trackMap.set(t.id, {
          id: t.id,
          type: t.type,
          isPriorityTrack: t.isPriorityTrack === 1,
          activeRequest: null,
          queue: [],
        })
      }

      // Assign requests to tracks
      for (const req of data.requests) {
        if (req.trackId && trackMap.has(req.trackId)) {
          const track = trackMap.get(req.trackId)!

          if (ACTIVE_STATUSES.has(req.status) && track.activeRequest === null) {
            const activeReq: TrackActiveRequest = {
              id: req.id,
              title: req.title,
              type: req.type,
              status: req.status,
              priority: req.priority,
              assigneeName: req.assigneeName,
              assigneeInitials: req.assigneeName
                ? req.assigneeName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                : null,
              dueDate: req.dueDate,
            }
            track.activeRequest = activeReq
          } else if (QUEUED_STATUSES.has(req.status)) {
            const queueItem: TrackQueueItem = {
              id: req.id,
              title: req.title,
              type: req.type,
              priority: req.priority,
              queueOrder: req.queueOrder,
              dueDate: req.dueDate,
            }
            track.queue.push(queueItem)
          }
        }
      }

      // Sort queues by queueOrder, then createdAt
      for (const track of trackMap.values()) {
        track.queue.sort((a, b) => {
          const orderA = a.queueOrder ?? 9999
          const orderB = b.queueOrder ?? 9999
          return orderA - orderB
        })
      }

      // Also distribute untracked queued requests to eligible tracks
      const untrackedQueued = data.requests.filter(
        r => !r.trackId && QUEUED_STATUSES.has(r.status)
      )
      for (const req of untrackedQueued) {
        // Find first eligible track that can handle this request type
        for (const track of trackMap.values()) {
          if (trackCanHandle(track.type, req.type)) {
            track.queue.push({
              id: req.id,
              title: req.title,
              type: req.type,
              priority: req.priority,
              queueOrder: req.queueOrder,
              dueDate: req.dueDate,
            })
            break
          }
        }
      }

      // Re-sort after adding untracked items
      for (const track of trackMap.values()) {
        track.queue.sort((a, b) => {
          const orderA = a.queueOrder ?? 9999
          const orderB = b.queueOrder ?? 9999
          return orderA - orderB
        })
      }

      // Order: large tracks first, then small
      const sorted = [...trackMap.values()].sort((a, b) => {
        if (a.type === 'large' && b.type === 'small') return -1
        if (a.type === 'small' && b.type === 'large') return 1
        return 0
      })

      setTracks(sorted)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tracks')
      setTracks([])
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { fetchData() }, [fetchData])

  const handleReorder = useCallback(async (trackId: string, orderedRequestIds: string[]) => {
    try {
      const res = await fetch(apiPath(`/api/portal/tracks/${trackId}/reorder`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedRequestIds }),
      })
      if (!res.ok) {
        // Revert on failure by re-fetching
        await fetchData()
      }
    } catch {
      await fetchData()
    }
  }, [fetchData])

  const handleUpgradeClick = useCallback(() => {
    // Navigate to billing or open contact dialog
    globalThis.window?.open('/billing', '_self')
  }, [])

  if (loading) {
    return (
      <div style={{ padding: '1rem' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 22rem), 1fr))',
          gap: '1rem',
        }}>
          {[1, 2].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--color-border-subtle)',
                overflow: 'hidden',
              }}
            >
              {/* Header skeleton */}
              <div style={{
                padding: '0.75rem 1rem',
                background: 'var(--color-bg-secondary)',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}>
                <div style={{
                  height: '1rem', width: '8rem',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: '0.25rem',
                }} />
              </div>
              {/* Active task skeleton */}
              <div style={{ padding: '0.75rem' }}>
                <div style={{
                  height: '3.5rem',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-button)',
                }} />
              </div>
              {/* Queue skeleton */}
              <div style={{ padding: '0 0.75rem 0.75rem' }}>
                {[1, 2, 3].map(j => (
                  <div key={j} style={{
                    height: '2rem', marginBottom: '0.25rem',
                    background: 'var(--color-bg-tertiary)',
                    borderRadius: '0.25rem',
                  }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        padding: '2rem', textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontSize: '0.875rem',
      }}>
        <p>{error}</p>
        <button
          type="button"
          onClick={fetchData}
          style={{
            marginTop: '0.5rem',
            padding: '0.375rem 0.75rem',
            fontSize: '0.8125rem', fontWeight: 600,
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: '1rem' }}>
      <TrackQueueView
        tracks={tracks}
        basePath="/requests"
        onReorder={handleReorder}
        onUpgradeClick={handleUpgradeClick}
      />
    </div>
  )
}

'use client'

/**
 * TracksContent — the client portal /tracks page. Fetches the org's capacity
 * (tracks + queue + recently-delivered), buckets every request into per-track
 * mini-kanban lanes (Up next / In progress / Review / Delivered), computes the
 * header stats, and derives the ghost-track upsells, then renders TrackQueueView.
 *
 * Client-facing surface. Admins manage tracks per client from the client detail
 * page, so the admin view here is just an explainer.
 */

import { useState, useEffect, useCallback } from 'react'
import { Layers, RefreshCw, CreditCard, Building2 } from 'lucide-react'
import Link from 'next/link'
import { TrackQueueView, type TrackLanes } from '@/components/tahi/track-queue-view'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import { apiPath } from '@/lib/api'
import { getUpgradeGhostTracks, type GhostTrack } from '@/lib/plan-utils'
import { bucketTracks, bucketUnified, type CapacityResponse } from '@/lib/track-lanes'

export function TracksContent({ isAdmin }: { isAdmin: boolean }) {
  const [tracks, setTracks] = useState<TrackLanes[]>([])
  const [ghosts, setGhosts] = useState<GhostTrack[]>([])
  const [unified, setUnified] = useState(false)
  const [loading, setLoading] = useState(!isAdmin)

  const fetchTracks = useCallback(async () => {
    if (isAdmin) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/portal/capacity'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as CapacityResponse
      if (data.tracksMode === 'off') {
        // Tracks off: one unified board, no per-track split, no upsell.
        setUnified(true)
        setTracks([bucketUnified(data)])
        setGhosts([])
      } else {
        setUnified(false)
        setTracks(bucketTracks(data))
        // Ghost upsell only when the server says so (auto mode + retainer plan).
        setGhosts(data.showGhosts
          ? getUpgradeGhostTracks(data.subscription?.planType ?? null, !!data.subscription?.hasPrioritySupport)
          : [])
      }
    } catch {
      setTracks([]); setGhosts([]); setUnified(false)
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { fetchTracks() }, [fetchTracks])

  // Org-scoped reorder / cross-track move: passing the target trackId lets the
  // server bind the moved request to that track (type-validated: a large_task can
  // never land in a small track). Works for every mode (auto real tracks, custom
  // synthetic shells, and the unified board).
  const handleReorder = async (trackId: string, orderedRequestIds: string[]) => {
    try {
      const res = await fetch(apiPath('/api/portal/capacity/reorder'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId, requestIds: orderedRequestIds }),
      })
      if (!res.ok) throw new Error('Failed')
      await fetchTracks()
    } catch { await fetchTracks() }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Your tracks</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isAdmin
              ? 'Track queues are managed per client.'
              : 'See where every request is, what we have delivered, and reorder what is up next.'}
          </p>
        </div>
        {!isAdmin && (
          <TahiButton variant="secondary" size="sm" onClick={fetchTracks} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </TahiButton>
        )}
      </div>

      {isAdmin ? (
        <EmptyState
          icon={<Building2 className="w-8 h-8 text-white" />}
          title="Manage tracks from a client"
          description="Open a client to see and reorder their track queue. This page is the client-facing view."
          action={<Link href="/clients" className="inline-flex items-center gap-2 text-sm font-medium text-white px-4 py-2" style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-button)', minHeight: '2.75rem', textDecoration: 'none' }}>Go to clients</Link>}
        />
      ) : loading ? (
        <LoadingSkeleton rows={4} />
      ) : tracks.length === 0 && ghosts.length === 0 ? (
        <EmptyState
          icon={<Layers className="w-8 h-8 text-white" />}
          title="No tracks available"
          description="You do not have any active tracks. Contact your account manager to get started."
          action={<Link href="/billing" className="inline-flex items-center gap-2 text-sm font-medium text-white px-4 py-2" style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-button)', minHeight: '2.75rem', textDecoration: 'none' }}><CreditCard className="w-4 h-4" aria-hidden="true" />View billing</Link>}
        />
      ) : (
        <TrackQueueView
          tracks={tracks}
          ghosts={ghosts}
          basePath="/requests"
          unified={unified}
          onReorder={handleReorder}
          onUpgradeClick={() => { window.location.href = '/billing' }}
        />
      )}
    </div>
  )
}

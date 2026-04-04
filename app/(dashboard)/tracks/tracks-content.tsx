'use client'

import { useState, useEffect, useCallback } from 'react'
import { Layers, RefreshCw, CreditCard } from 'lucide-react'
import Link from 'next/link'
import { TrackQueueView, type TrackWithQueue } from '@/components/tahi/track-queue-view'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import { apiPath } from '@/lib/api'

export function TracksContent({ isAdmin }: { isAdmin: boolean }) {
  const [tracks, setTracks] = useState<TrackWithQueue[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTracks = useCallback(async () => {
    setLoading(true)
    try {
      const endpoint = isAdmin ? '/api/admin/capacity' : '/api/portal/tracks'
      const res = await fetch(apiPath(endpoint))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { tracks?: TrackWithQueue[] }
      setTracks(data.tracks ?? [])
    } catch {
      setTracks([])
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => { fetchTracks() }, [fetchTracks])

  const handleReorder = async (trackId: string, orderedRequestIds: string[]) => {
    try {
      const res = await fetch(apiPath(`/api/portal/tracks/${trackId}/reorder`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestIds: orderedRequestIds }),
      })
      if (!res.ok) throw new Error('Failed')
      // Refresh after reorder
      await fetchTracks()
    } catch {
      // Revert on failure by re-fetching
      await fetchTracks()
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Track Queue</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isAdmin
              ? 'View and manage track queues across all clients.'
              : 'View your active tracks and reorder your request queue.'}
          </p>
        </div>
        <TahiButton
          variant="secondary"
          size="sm"
          onClick={fetchTracks}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh
        </TahiButton>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={<Layers className="w-8 h-8 text-white" />}
          title="No tracks available"
          description={
            isAdmin
              ? 'Tracks will appear here once clients are provisioned with retainer plans.'
              : 'You do not have any active tracks. Contact your account manager to get started.'
          }
          action={
            isAdmin ? undefined : (
              <Link
                href="/billing"
                className="inline-flex items-center gap-2 text-sm font-medium text-white px-4 py-2 transition-colors"
                style={{
                  background: 'var(--color-brand)',
                  borderRadius: 'var(--radius-button)',
                  minHeight: '2.75rem',
                  textDecoration: 'none',
                }}
              >
                <CreditCard className="w-4 h-4" aria-hidden="true" />
                View Billing
              </Link>
            )
          }
        />
      ) : (
        <TrackQueueView
          tracks={tracks}
          basePath={isAdmin ? '/requests' : '/requests'}
          onReorder={isAdmin ? undefined : handleReorder}
          onUpgradeClick={() => {
            window.location.href = '/billing'
          }}
        />
      )}
    </div>
  )
}

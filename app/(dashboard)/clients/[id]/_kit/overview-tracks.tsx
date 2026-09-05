'use client'

/**
 * <OverviewTracks>. The mini kanban per track on the client Overview: what is
 * queued for it, what is in the studio on it, what is back with the client.
 *
 * The lanes themselves are the shipped <TrackQueueView>, bucketed by
 * lib/track-lanes, so the client sees the same board on their portal as the
 * studio sees here. Only the framing is new.
 *
 * This component READS `/api/admin/capacity?orgId=` and never writes it. The
 * auto / custom / off editor that decides how many tracks a client has lives
 * on the Settings tab and mutates the same SWR key, so there is exactly one
 * owner of that state and the two views cannot disagree after a save.
 */

import useSWR from 'swr'
import { Layers } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { DueDateChip } from '@/components/tahi/due-date-chip'
import { EmptyState } from '@/components/tahi/empty-state'
import { StatusBadge } from '@/components/tahi/status-badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { TrackQueueView, type TrackLanes } from '@/components/tahi/track-queue-view'
import { bucketTracks, bucketUnified, type CapacityResponse } from '@/lib/track-lanes'
import { CountText, Grow, InlineAction, SectionTitle, SubBar } from './chrome'
import { OPEN_REQUEST_STATUSES, type NeedRequest } from './needs'

export const CLIENT_CAPACITY_KEY = (clientId: string) => `/api/admin/capacity?orgId=${clientId}`

/** The capacity payload plus the per-client override the Settings tab writes. */
export type CapacityWithMode = CapacityResponse & {
  tracksMode?: string | null
  customSmallTracks?: number
  customLargeTracks?: number
}

/** Shared so the lanes here and the editor in Settings read one key one way. */
export async function fetchCapacity(path: string): Promise<CapacityWithMode> {
  const res = await fetch(apiPath(path))
  if (!res.ok) throw new Error('Failed to load capacity')
  return await res.json() as CapacityWithMode
}

export function OverviewTracks({
  clientId,
  orgName,
  requests,
  writeDisabled,
  onOpenBoard,
  onNewRequest,
  onOpenRequest,
}: {
  clientId: string
  orgName: string
  requests: NeedRequest[]
  writeDisabled: boolean
  onOpenBoard: () => void
  onNewRequest: () => void
  onOpenRequest: (id: string) => void
}) {
  const { data, isLoading } = useSWR<CapacityWithMode>(
    CLIENT_CAPACITY_KEY(clientId),
    fetchCapacity,
  )

  const mode = data?.tracksMode ?? 'auto'
  const unified = mode === 'off'
  let lanes: TrackLanes[] = []
  if (data) lanes = unified ? [bucketUnified(data)] : bucketTracks(data)

  const busy = lanes.filter(l => l.inProgress.length > 0).length
  const openWork = requests.filter(r => OPEN_REQUEST_STATUSES.includes(r.status))

  if (isLoading) {
    return (
      <div
        className="animate-pulse"
        style={{ minHeight: '12rem', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-secondary)' }}
        aria-hidden="true"
      />
    )
  }

  const head = (
    <SubBar>
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center flex-shrink-0"
        style={{
          width: '1.625rem',
          height: '1.625rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-muted)',
        }}
      >
        <Layers className="w-3.5 h-3.5" />
      </span>
      <SectionTitle>{lanes.length > 0 ? 'Tracks' : 'Work in flight'}</SectionTitle>
      <CountText>
        {lanes.length > 0
          ? `${busy} of ${lanes.length} ${lanes.length === 1 ? 'track' : 'tracks'} in the studio`
          : 'No retainer tracks. Work runs straight through Requests.'}
      </CountText>
      <Grow />
      <InlineAction onClick={onOpenBoard}>Open the board</InlineAction>
      <TahiButton variant="secondary" size="sm" onClick={onNewRequest} disabled={writeDisabled}>
        New request
      </TahiButton>
    </SubBar>
  )

  if (lanes.length === 0) {
    return (
      <section aria-label="Work in flight" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {head}
        {openWork.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<Layers className="w-8 h-8" />}
            title="Nothing open right now"
            description={`The next piece of work for ${orgName} starts with a request.`}
            ctaLabel={writeDisabled ? undefined : 'New request'}
            onCtaClick={writeDisabled ? undefined : onNewRequest}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {openWork.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => onOpenRequest(r.id)}
                className="tahi-focus-ring flex items-center flex-wrap text-left"
                style={{
                  gap: '0.625rem',
                  minHeight: '2.75rem',
                  padding: '0.375rem 0.625rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-bg)',
                  cursor: 'pointer',
                  transition: 'border-color var(--motion-quick) var(--ease-out)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)' }}
              >
                {r.requestNumber != null && (
                  <span className="tabular-nums" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-subtle)' }}>
                    #{r.requestNumber}
                  </span>
                )}
                <span
                  className="truncate"
                  style={{ flex: 1, minWidth: '8rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}
                >
                  {r.title}
                </span>
                <StatusBadge status={r.status} />
                <DueDateChip dueDate={r.dueDate} status={r.status} size="sm" />
              </button>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section aria-label="Tracks" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {head}
      <TrackQueueView tracks={lanes} basePath="/requests" unified={unified} />
    </section>
  )
}

'use client'

/**
 * <CapacityStrip>. What a retainer client's plan is actually doing right now.
 *
 * One lane per active track, each holding the request being built in it, plus
 * the numbered queue underneath. It answers the two questions a client opens
 * the requests page with: is anyone working on my thing, and when does the
 * next one start.
 *
 * Track structure comes from /api/portal/capacity (org-scoped, internal-only
 * work already filtered out). The rows themselves come from the list that is
 * already on screen, so the lane tile can show the person on it without a
 * second round trip. Progress is read from the request's steps when it has
 * them, and estimated from its status when it does not.
 *
 * Renders nothing for a client with no active retainer or no tracks.
 */

import * as React from 'react'
import useSWR from 'swr'
import { Calendar } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { getPlanLabel } from '@/lib/plan-utils'
import { formatDate, parseLooseDate } from '@/lib/utils'
import type { RequestParticipant } from '@/lib/request-participants'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CapacityStripRequest {
  id: string
  title: string
  status: string
  dueDate?: string | null
  requestNumber?: number | null
  participants?: RequestParticipant[] | null
}

interface CapacityTrack {
  id: string
  type: string
  isPriorityTrack?: number | boolean | null
  currentRequestId: string | null
  currentRequest?: { id: string; title: string; status: string; dueDate: string | null } | null
}

interface CapacityResponse {
  subscription: { id: string; planType: string | null } | null
  tracks?: CapacityTrack[]
}

interface StepsResponse {
  steps?: Array<{ id: string; completed?: boolean | number | null; children?: StepsResponse['steps'] }>
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fill order for a lane with no track link: building now, then in review,
 *  then back with the client. */
const INFLIGHT_ORDER = ['in_progress', 'in_review', 'client_review']

/** How far through a request looks from its status alone, when it carries no
 *  steps to count. Deliberately conservative: a client should never see a bar
 *  further along than the work is. */
const STATUS_PROGRESS: Record<string, number> = {
  submitted: 0,
  in_review: 0.25,
  in_progress: 0.5,
  client_review: 0.85,
  delivered: 1,
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CapacityStrip({
  requests,
  onOpen,
}: {
  requests: CapacityStripRequest[]
  onOpen: (id: string) => void
}) {
  const { data } = useSWR<CapacityResponse>('/api/portal/capacity')

  const byId = React.useMemo(() => {
    const map = new Map<string, CapacityStripRequest>()
    for (const r of requests) map.set(r.id, r)
    return map
  }, [requests])

  const tracks = React.useMemo(() => data?.tracks ?? [], [data])

  // Lanes first take the request their track is explicitly holding, then fill
  // from whatever else is in flight, so a client whose tracks were never wired
  // up still sees their work rather than a row of empty lanes.
  const { lanes, laneIds } = React.useMemo(() => {
    const taken = new Set<string>()
    const filled: Array<CapacityStripRequest | null> = tracks.map(t => {
      const id = t.currentRequestId
      if (!id) return null
      taken.add(id)
      const row = byId.get(id)
      if (row) return row
      const fallback = t.currentRequest
      return fallback
        ? { id: fallback.id, title: fallback.title, status: fallback.status, dueDate: fallback.dueDate }
        : null
    })

    const spare = INFLIGHT_ORDER.flatMap(status =>
      requests.filter(r => r.status === status && !taken.has(r.id)),
    )
    let next = 0
    for (let i = 0; i < filled.length; i++) {
      if (filled[i]) continue
      const candidate = spare[next]
      if (!candidate) break
      next += 1
      filled[i] = candidate
      taken.add(candidate.id)
    }

    return { lanes: filled, laneIds: taken }
  }, [tracks, requests, byId])

  // Everything still waiting to be picked up, in the order the studio works it.
  const queue = React.useMemo(
    () => requests.filter(r => r.status === 'submitted' && !laneIds.has(r.id)),
    [requests, laneIds],
  )

  if (!data?.subscription || tracks.length === 0) return null

  const planLabel = getPlanLabel(data.subscription.planType)

  return (
    <section
      aria-label="Your capacity"
      style={{
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg)',
        overflow: 'hidden',
      }}
    >
      <header style={{ padding: '0.875rem 1rem 0.75rem' }}>
        <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
          {`Your ${planLabel} plan`}
        </h2>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.1875rem 0 0', lineHeight: 1.45 }}>
          {`${tracks.length} active ${tracks.length === 1 ? 'track' : 'tracks'}. One request builds per track, the next pulls in automatically.`}
        </p>
      </header>

      <div style={{ padding: '0 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(15rem, 1fr))`,
          gap: '0.625rem',
        }}>
          {tracks.map((track, i) => (
            <Lane
              key={track.id}
              index={i}
              type={track.type}
              request={lanes[i] ?? null}
              onOpen={onOpen}
            />
          ))}
        </div>

        {queue.length > 0 && (
          <div>
            <p style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: 'var(--color-text-subtle)',
              margin: '0 0 0.375rem',
            }}>
              {`Up next. ${queue.length} in your queue`}
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {queue.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className="tahi-focus-ring"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.625rem',
                      width: '100%',
                      minHeight: '2.75rem',
                      padding: '0.5rem 0.625rem',
                      textAlign: 'left',
                      borderRadius: 'var(--radius-button)',
                      border: '1px solid var(--color-border-subtle)',
                      background: 'var(--color-bg-secondary)',
                      cursor: 'pointer',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'var(--color-bg-tertiary)'
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'var(--color-bg-secondary)'
                      e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
                    }}
                  >
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '1.5rem',
                      height: '1.5rem',
                      flexShrink: 0,
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      fontSize: '0.6875rem',
                      fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {i + 1}
                    </span>
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: '0.8125rem',
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {r.title}
                    </span>
                    {i === 0 && (
                      <span style={{
                        flexShrink: 0,
                        padding: '0.125rem 0.4375rem',
                        borderRadius: 'var(--radius-full)',
                        background: 'var(--color-brand-50)',
                        color: 'var(--color-brand-dark)',
                        fontSize: '0.625rem',
                        fontWeight: 600,
                      }}>
                        Next up
                      </span>
                    )}
                    <DueChip due={r.dueDate} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Lane ──────────────────────────────────────────────────────────────────────

function Lane({
  index, type, request, onOpen,
}: {
  index: number
  type: string
  request: CapacityStripRequest | null
  onOpen: (id: string) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.3125rem' }}>
        <span style={{
          fontSize: '0.6875rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-subtle)',
        }}>
          {`Track ${index + 1}`}
        </span>
        <span style={{
          padding: '0.0625rem 0.375rem',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-muted)',
          fontSize: '0.625rem',
          fontWeight: 600,
        }}>
          {type === 'large' ? 'Large' : 'Small'}
        </span>
      </div>
      {request ? <LaneTile request={request} onOpen={onOpen} /> : <EmptyLane />}
    </div>
  )
}

function EmptyLane() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      minHeight: '5rem',
      padding: '0.75rem',
      borderRadius: 'var(--radius-card)',
      border: '1px dashed var(--color-border)',
      background: 'var(--color-bg-secondary)',
      fontSize: '0.75rem',
      color: 'var(--color-text-subtle)',
      lineHeight: 1.45,
    }}>
      Open. Next in queue pulls in.
    </div>
  )
}

function LaneTile({
  request, onOpen,
}: {
  request: CapacityStripRequest
  onOpen: (id: string) => void
}) {
  // Steps give the honest number; the status is the fallback. The fetch is
  // per lane, so a client with one track makes one extra call.
  const { data } = useSWR<StepsResponse>(`/api/portal/requests/${request.id}/steps`)
  const progress = React.useMemo(() => {
    const counted = countSteps(data?.steps)
    if (counted.total > 0) return counted.done / counted.total
    return STATUS_PROGRESS[request.status] ?? 0
  }, [data, request.status])

  const assignee = (request.participants ?? []).find(p => p.role === 'assignee')
    ?? (request.participants ?? []).find(p => p.role === 'pm')
  const percent = Math.round(progress * 100)

  return (
    <button
      type="button"
      onClick={() => onOpen(request.id)}
      className="tahi-focus-ring"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        width: '100%',
        minHeight: '5rem',
        padding: '0.75rem',
        textAlign: 'left',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-brand-light)'
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'var(--color-bg)'
      }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <LiveDot />
        <span style={{
          flex: 1,
          minWidth: 0,
          fontSize: '0.8125rem',
          fontWeight: 600,
          lineHeight: 1.35,
          color: 'var(--color-text)',
        }}>
          {request.title}
        </span>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        {assignee && (
          <>
            <Avatar name={assignee.name} src={assignee.avatarUrl} size="xs" tooltip={false} />
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {assignee.name.split(' ')[0]}
            </span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <DueChip due={request.dueDate} />
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress"
          style={{
            flex: 1,
            height: '0.25rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg-tertiary)',
            overflow: 'hidden',
          }}
        >
          <span style={{
            display: 'block',
            width: `${percent}%`,
            height: '100%',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-brand)',
          }} />
        </span>
        <span style={{
          fontSize: '0.6875rem',
          color: 'var(--color-text-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {`${percent}%`}
        </span>
      </span>
    </button>
  )
}

// ── Small parts ───────────────────────────────────────────────────────────────

function LiveDot() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '0.5rem',
        height: '0.5rem',
        marginTop: '0.3125rem',
        flexShrink: 0,
        borderRadius: 'var(--radius-full)',
        background: 'var(--status-in-progress-dot, var(--color-brand))',
        boxShadow: '0 0 0 3px var(--color-brand-50)',
      }}
    />
  )
}

function DueChip({ due }: { due?: string | null }) {
  if (!due) return null
  const date = parseLooseDate(due)
  if (!date) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const overdue = date.getTime() < today.getTime()
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.1875rem',
      flexShrink: 0,
      fontSize: '0.6875rem',
      color: overdue ? 'var(--color-danger)' : 'var(--color-text-muted)',
    }}>
      <Calendar size={10} aria-hidden="true" />
      {formatDate(due, 'short')}
    </span>
  )
}

/** Completed vs total across a step tree. */
function countSteps(steps: StepsResponse['steps']): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const step of steps ?? []) {
    total += 1
    if (step.completed) done += 1
    const child = countSteps(step.children)
    done += child.done
    total += child.total
  }
  return { done, total }
}

'use client'

/**
 * EngagementHealthCard — delivery spine (#148) Slice 4.
 *
 * Shows the live delivery rollup for a deal or client engagement, aggregated
 * across all its schedules: overall status, phases-done progress, and the
 * off-track phases (deep-linked to their schedule). Renders nothing until the
 * engagement has at least one phase with linked work, mirroring the schedule
 * editor's `rowsTotal > 0` guard.
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { apiPath } from '@/lib/api'
import { Activity, ArrowUpRight } from 'lucide-react'
import { DELIVERY_STATUS_COLOR, DELIVERY_STATUS_LABEL } from '@/components/tahi/gantt-grid'
import type { DeliveryStatus, EngagementRollup } from '@/lib/delivery-status'

interface OffTrackRow {
  rowId: string
  scheduleId: string
  scheduleTitle: string
  label: string
  status: DeliveryStatus
}

interface AggregateResult {
  engagement: EngagementRollup
  perSchedule: Array<{ scheduleId: string; title: string; engagement: EngagementRollup }>
  offTrackRows: OffTrackRow[]
}

export function EngagementHealthCard({ dealId, orgId }: { dealId?: string; orgId?: string }) {
  const [data, setData] = useState<AggregateResult | null>(null)
  const [loading, setLoading] = useState(true)

  const param = dealId ? `dealId=${encodeURIComponent(dealId)}` : orgId ? `orgId=${encodeURIComponent(orgId)}` : null

  const load = useCallback(async () => {
    if (!param) { setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/engagements/delivery-status?${param}`))
      if (res.ok) setData(await res.json() as AggregateResult)
      else setData(null)
    } catch { setData(null) }
    finally { setLoading(false) }
  }, [param])

  useEffect(() => { void load() }, [load])

  // No card while loading the first time, on error, or when nothing is linked.
  if (loading) {
    return (
      <div
        className="animate-pulse"
        style={{
          height: '6rem', background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)',
        }}
      />
    )
  }
  if (!data || data.engagement.rowsTotal === 0) return null

  const { engagement, offTrackRows } = data
  const pct = Math.round(engagement.pctComplete * 100)

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border-subtle)' }}
      >
        <span className="inline-flex items-center" style={{ gap: '0.5rem', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
          <Activity size={14} style={{ color: 'var(--color-text-subtle)' }} />
          Delivery health
        </span>
        <span className="inline-flex items-center" style={{ gap: '0.4375rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)' }}>
          <span aria-hidden="true" style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: DELIVERY_STATUS_COLOR[engagement.status] }} />
          {DELIVERY_STATUS_LABEL[engagement.status]}
        </span>
      </div>

      <div style={{ padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Progress */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: '0.375rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {engagement.rowsDone}/{engagement.rowsTotal} phases done
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)' }}>{pct}%</span>
          </div>
          <div style={{ height: '0.375rem', borderRadius: '999px', background: 'var(--color-bg-tertiary)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--color-brand)', borderRadius: '999px', transition: 'width 200ms ease' }} />
          </div>
        </div>

        {/* Off-track phases */}
        {offTrackRows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-subtle)' }}>
              {offTrackRows.length} off track
            </span>
            {offTrackRows.map(row => (
              <Link
                key={row.rowId}
                href={`/schedules/${row.scheduleId}`}
                className="flex items-center justify-between group"
                style={{
                  padding: '0.375rem 0.5rem', borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-secondary)', textDecoration: 'none',
                  transition: 'background 140ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
              >
                <span className="inline-flex items-center" style={{ gap: '0.4375rem', minWidth: 0 }}>
                  <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: DELIVERY_STATUS_COLOR[row.status], flexShrink: 0 }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.label}
                  </span>
                </span>
                <span className="inline-flex items-center" style={{ gap: '0.25rem', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.6875rem', color: DELIVERY_STATUS_COLOR[row.status], fontWeight: 600 }}>
                    {DELIVERY_STATUS_LABEL[row.status]}
                  </span>
                  <ArrowUpRight size={12} style={{ color: 'var(--color-text-subtle)' }} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

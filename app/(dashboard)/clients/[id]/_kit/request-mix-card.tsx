'use client'

/**
 * <RequestMixCard>. The status donut in the Overview rail. Recharts is
 * deferred behind a dynamic import so a tab that never renders it never
 * pays for it.
 */

import dynamic from 'next/dynamic'
import type { DonutSegment } from '@/components/tahi/chart'
import type { Request } from './types'

const DonutChart = dynamic(
  () => import('@/components/tahi/chart').then(m => ({ default: m.DonutChart })),
  {
    ssr: false,
    loading: () => (
      <div
        className="animate-pulse"
        style={{
          width: '10rem',
          height: '10rem',
          borderRadius: '50%',
          background: 'var(--color-bg-secondary)',
        }}
      />
    ),
  }
)

// ── Request mix donut (sidebar slot on Overview) ───────────────────────────────

export function RequestMixCard({ requests }: { requests: Request[] }) {
  // Count by raw status so the legend mirrors the actual board labels the
  // user sees on /requests. Use stable category colours.
  const counts = new Map<string, number>()
  for (const r of requests) {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
  }

  const STATUS_COLOUR: Record<string, string> = {
    submitted:     '#3B82F6',
    in_review:     '#8B5CF6',
    in_progress:   '#5A824E',
    client_review: '#EC4899',
    on_hold:       '#F59E0B',
    delivered:     '#22C55E',
    completed:     '#22C55E',
    cancelled:     '#9CA3AF',
  }

  const segments: DonutSegment[] = Array.from(counts.entries()).map(([status, value]) => ({
    label: status.replace(/_/g, ' '),
    value,
    colour: STATUS_COLOUR[status] ?? '#9CA3AF',
  }))

  return (
    <div
      className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)]"
      style={{ padding: '1.25rem' }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-[var(--color-text)]">Request mix</h3>
        <span className="text-xs text-[var(--color-text-muted)]">{requests.length} recent</span>
      </div>
      <div className="flex items-center justify-center">
        <DonutChart
          segments={segments}
          size={160}
          centreLabel="Requests"
          centreValue={String(requests.length)}
          ariaLabel="Request status distribution"
        />
      </div>
    </div>
  )
}

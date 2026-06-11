'use client'

// ─── Receivables (the tide line) ──────────────────────────────────────────────
//
// The BOOKS-zone right card (homepage Studio Ledger Slice 5). One shared-scale
// horizontal spine: each aging bucket is a segment proportional to its share of
// the total, so the buckets are honestly comparable (no per-bucket max lies like
// the old four-bar treatment). Green = current, amber = 31-90 (darker at 61-90),
// red = 90+. A high-water tick above the spine names the single oldest invoice.
// Below, a four-bucket legend with amounts. Healthy collapse: nothing owed
// renders one calm green line, "Tide fully in", and nothing alarming. Always
// mounted. See SPECS/homepage-studio-ledger.md (the five signature moves, BOOKS).

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useDisplayCurrency } from '@/lib/display-currency-context'

export interface ArAgingData {
  currentNzd: number
  d30Nzd: number
  d60Nzd: number
  d90Nzd: number
  totalNzd: number
  oldest: { clientName: string | null; daysPastDue: number; amountNzd: number } | null
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

// 61-90 reads as a deeper amber than 31-60 so the spine telegraphs escalation
// inside the warning band. Both still sit on the system amber token (no new hex).
const BUCKET_DARK_AMBER = 'color-mix(in srgb, var(--color-warning) 78%, var(--color-danger))'

export function ReceivablesTide({ arAging, loading, className }: { arAging: ArAgingData | null; loading?: boolean; className?: string }) {
  const { format } = useDisplayCurrency()

  const buckets = arAging
    ? [
        { label: 'Current', v: arAging.currentNzd, color: 'var(--color-success)' },
        { label: '31-60d', v: arAging.d30Nzd, color: 'var(--color-warning)' },
        { label: '61-90d', v: arAging.d60Nzd, color: BUCKET_DARK_AMBER },
        { label: '90d+', v: arAging.d90Nzd, color: 'var(--color-danger)' },
      ]
    : []
  const total = arAging?.totalNzd ?? 0
  const oldest = arAging?.oldest ?? null
  const healthy = !arAging || total <= 0 || !oldest

  return (
    <section
      aria-label="Receivables"
      className={className}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
      }}
    >
      {/* Letterpress zone header + view link */}
      <div className="flex items-baseline justify-between" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <h2 style={LABEL_STYLE}>Receivables</h2>
        <Link
          href="/invoices"
          className="view-link flex items-center flex-shrink-0"
          style={{ gap: 'var(--space-1)', fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-link)', textDecoration: 'none' }}
        >
          View invoices <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col" style={{ gap: 'var(--space-4)' }} aria-hidden="true">
          <div className="tahi-shimmer" style={{ height: '0.5rem', width: '100%', borderRadius: 'var(--radius-full)' }} />
          <div className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: 'var(--space-3)' }}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="tahi-shimmer" style={{ height: '2.25rem', borderRadius: 'var(--radius-sm)' }} />
            ))}
          </div>
        </div>
      ) : healthy ? (
        <div>
          {/* Calm green line: the tide is fully in */}
          <div
            aria-hidden="true"
            style={{ height: 2, borderRadius: '9999px', background: 'var(--color-success)' }}
          />
          <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)', marginTop: 'var(--space-3)' }}>
            Tide fully in
          </p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
            Nothing outstanding right now.
          </p>
        </div>
      ) : (
        <>
          {/* High-water tick: names the oldest invoice */}
          <div className="flex items-baseline" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <span
              aria-hidden="true"
              className="flex-shrink-0"
              style={{ width: '0.375rem', height: '0.375rem', borderRadius: '9999px', background: oldest!.daysPastDue >= 90 ? 'var(--color-danger)' : 'var(--color-warning)' }}
            />
            <span data-private className="tabular-nums truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500, minWidth: 0 }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{oldest!.clientName ?? 'Unknown client'}</span>
              <span style={{ color: 'var(--color-text-subtle)' }}> &middot; </span>
              {format(oldest!.amountNzd)}
              <span style={{ color: 'var(--color-text-subtle)' }}> &middot; </span>
              {oldest!.daysPastDue}d
            </span>
          </div>

          {/* The tide line: one shared-scale spine, segments proportional to share */}
          <div
            data-private
            aria-hidden="true"
            className="flex"
            style={{ height: '0.5rem', borderRadius: '9999px', overflow: 'hidden', background: 'var(--color-bg-tertiary)' }}
          >
            {buckets.map((b, i) =>
              b.v > 0 ? (
                <div
                  key={i}
                  style={{
                    width: `${(b.v / Math.max(1, total)) * 100}%`,
                    height: '100%',
                    background: b.color,
                  }}
                />
              ) : null
            )}
          </div>

          {/* Four-bucket legend with amounts */}
          <div
            className="grid grid-cols-2 sm:grid-cols-4"
            style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}
          >
            {buckets.map(b => (
              <div key={b.label} className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
                <span className="flex items-center" style={{ gap: 'var(--space-1-5)' }}>
                  <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '0.125rem', background: b.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)', fontWeight: 600, letterSpacing: '0.04em' }}>
                    {b.label}
                  </span>
                </span>
                <span data-private className="tabular-nums" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
                  {format(b.v)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

'use client'

// ─── Pipeline Ahead (the AHEAD/SALES zone, amber HERO tile) ──────────────────
//
// Domain SALES (amber). This is the second of the at-most-two tinted hero tiles
// per viewport (the other is Content violet). It composes from the SHARED
// DomainCard `heroTile` shell so it renders the IDENTICAL amber wash + header +
// radius + padding as Content Engine; the card has no bespoke shell of its own.
// The 12-month expected figure is the single body HERO; one quiet gap sentence
// ("raw, weighted to ...") sits beneath it. Below that, a continuous descending
// erosion funnel (per-stage weighted bars) shows where value leaks out of the
// pipeline. Then a neutral "closing this month" rail (no fake target tick, since
// monthlyCloseTarget does not exist yet), up to three named closing-deal chips,
// and a "stale" badge at the top when open deals have gone untouched. See
// SPECS/homepage-lit.md (colour rules) + homepage-studio-ledger.md (AHEAD zone).
//
// Reuses both existing fetches verbatim:
//   - /api/admin/deals + /api/admin/pipeline/stages  (summary / closing-this-month)
//   - /api/admin/reports/pipeline-forecast           (weighted forecast / funnel)

import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { calculatePipelineTotals } from '@/lib/pipeline-math'
import { CountUp } from '@/components/tahi/count-up'
import { DomainCard } from '@/components/tahi/overview/domain-card'

// ─── Shared data shapes (mirrors overview-content.tsx) ───────────────────────

interface DealSummary {
  id: string
  title: string
  stageId: string
  value: number | null
  valueNzd: number | null
  currency: string | null
  expectedCloseDate: string | null
  stageName: string | null
  stageColour: string | null
  stageProbability: number | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  orgName: string | null
  updatedAt: string | null
}

// Open deals untouched for this long count as "stale" on the funnel header.
const STALE_AFTER_MS = 14 * 24 * 60 * 60 * 1000

interface StageSummary {
  id: string
  probability: number | null
  historicalProbability: number | null
  isClosedWon: number | boolean | null
  isClosedLost: number | boolean | null
}

interface ForecastByStage {
  stageId: string
  name: string
  slug: string
  probability: number
  position: number
  colour: string | null
  isClosedWon: boolean
  isClosedLost: boolean
  dealCount: number
  upfrontNzd: number
  monthlyNzd: number
  weightedUpfrontNzd: number
  weightedMonthlyNzd: number
}

interface ForecastResponse {
  totalDeals: number
  unweightedUpfrontNzd: number
  unweightedMonthlyNzd: number
  weightedUpfrontNzd: number
  weightedMonthlyNzd: number
  byStage: ForecastByStage[]
}

// One DomainCard heroTile shell for every state (loading, empty, populated), so
// Pipeline renders the IDENTICAL amber hero wash + header + radius + padding as
// the Content Engine hero. The amber lives only in the shared shell's tint +
// IconChip; the body figures and names stay ink.
const CARD_PROPS = {
  domain: 'sales',
  title: 'Pipeline',
  icon: <TrendingUp size={15} aria-hidden="true" />,
  heroTile: true,
  viewHref: '/deals',
  viewLabel: 'Pipeline',
} as const

export function PipelineAhead({ className }: { className?: string }) {
  const { format } = useDisplayCurrency()

  const [deals, setDeals] = useState<DealSummary[]>([])
  const [stages, setStages] = useState<StageSummary[]>([])
  const [forecast, setForecast] = useState<ForecastResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(apiPath('/api/admin/deals?limit=100')).then(r => (r.ok ? (r.json() as Promise<{ items: DealSummary[] }>) : { items: [] })),
      fetch(apiPath('/api/admin/pipeline/stages')).then(r => (r.ok ? (r.json() as Promise<{ stages: StageSummary[] }>) : { stages: [] })),
      fetch(apiPath('/api/admin/reports/pipeline-forecast')).then(r => (r.ok ? (r.json() as Promise<ForecastResponse>) : null)),
    ])
      .then(([dealsData, stagesData, forecastData]) => {
        if (cancelled) return
        setDeals(dealsData.items ?? [])
        setStages(stagesData.stages ?? [])
        setForecast(forecastData ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setDeals([])
        setStages([])
        setForecast(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <DomainCard {...CARD_PROPS} className={className}>
        <div className="tahi-shimmer" style={{ height: '3rem', width: '60%', marginBottom: 'var(--space-4)' }} />
        <div className="tahi-shimmer" style={{ height: '5rem', marginBottom: 'var(--space-4)' }} />
        <div className="tahi-shimmer" style={{ height: '2.5rem' }} />
      </DomainCard>
    )
  }

  const openDeals = deals.filter(d => !d.stageIsClosedWon && !d.stageIsClosedLost)
  const activeStages = (forecast?.byStage ?? []).filter(s => !s.isClosedWon && !s.isClosedLost && s.dealCount > 0)

  // Empty state: no active deals anywhere. Calm single line.
  if (openDeals.length === 0 && activeStages.length === 0) {
    return (
      <DomainCard {...CARD_PROPS} className={className}>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
          No deals in the pipeline yet. New work will show up here as it lands.
        </p>
      </DomainCard>
    )
  }

  // ── HERO: 12-month expected (weighted upfront + 12 x weighted MRR) ──
  const weightedUpfront = forecast?.weightedUpfrontNzd ?? 0
  const weightedMonthly = forecast?.weightedMonthlyNzd ?? 0
  const expected12mo = weightedUpfront + weightedMonthly * 12

  // ── Gap sentence: raw (unweighted) 12-mo vs weighted 12-mo ──
  const rawUpfront = forecast?.unweightedUpfrontNzd ?? 0
  const rawMonthly = forecast?.unweightedMonthlyNzd ?? 0
  const raw12mo = rawUpfront + rawMonthly * 12

  // ── Erosion funnel: per-stage weighted (upfront + 6 x MRR), descending ──
  // Sort highest-weighted first so the funnel reads as a continuous erosion.
  const funnel = activeStages
    .map(s => ({
      stageId: s.stageId,
      name: s.name,
      dealCount: s.dealCount,
      probability: s.probability,
      colour: s.colour,
      weighted: s.weightedUpfrontNzd + s.weightedMonthlyNzd * 6,
    }))
    .sort((a, b) => b.weighted - a.weighted)
  const funnelMax = Math.max(1, ...funnel.map(f => f.weighted))

  // ── Closing this month (from the deals fetch) ──
  // Routed through the canonical helper so any pipeline-value figure here would
  // agree with the Pipeline page + Reports (Decision #040). The hero + funnel use
  // the forecast endpoint's pre-weighted aggregates; the closing-this-month slice
  // below is a deal-level filter the forecast endpoint does not expose.
  const totals = calculatePipelineTotals(deals, stages)
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const closingThisMonth = openDeals.filter(d => {
    if (!d.expectedCloseDate) return false
    const close = new Date(d.expectedCloseDate)
    return close.getMonth() === currentMonth && close.getFullYear() === currentYear
  })
  const closingValue = closingThisMonth.reduce((sum, d) => sum + (d.valueNzd ?? d.value ?? 0), 0)
  // Month-progress: how far through the current month we are (the rail's only marker).
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()
  const monthProgressPct = Math.round((now.getDate() / daysInMonth) * 100)
  // Up to 3 named closing-deal chips (only if names are exposed).
  const closingChips = closingThisMonth
    .filter(d => d.orgName || d.title)
    .slice(0, 3)

  // Stale open deals: untouched for STALE_AFTER_MS. Skipped gracefully when the
  // deals payload carries no updatedAt (badge simply does not render).
  const staleCount = openDeals.filter(d => {
    if (!d.updatedAt) return false
    const updated = new Date(d.updatedAt).getTime()
    if (Number.isNaN(updated)) return false
    return now.getTime() - updated >= STALE_AFTER_MS
  }).length

  return (
    <DomainCard {...CARD_PROPS} className={className}>
      {/* Stale badge: open deals untouched past the threshold. Lives at the top
          of the card body now the shared shell owns the header. */}
      {staleCount > 0 && (
        <div className="flex" style={{ marginBottom: 'var(--space-3)' }}>
          <span
            className="tabular-nums flex-shrink-0"
            style={{
              padding: '0.0625rem 0.4375rem',
              borderRadius: 'var(--radius-full)',
              background: 'color-mix(in oklab, var(--color-warning) 16%, var(--color-bg))',
              color: 'var(--color-due-soon-text)',
              fontSize: 'var(--text-2xs, 0.6875rem)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {staleCount} stale
          </span>
        </div>
      )}

      {/* HERO: 12-month expected */}
      <div style={{ marginBottom: 'var(--space-1)' }}>
        <p
          style={{
            fontSize: 'var(--text-2xs, 0.6875rem)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-subtle)',
            marginBottom: 'var(--space-1-5)',
          }}
        >
          12-month expected
        </p>
        <p
          data-private
          className="tabular-nums"
          style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: 'var(--color-text)',
          }}
        >
          <CountUp value={expected12mo} durationMs={800} format={format} />
        </p>
      </div>

      {/* Quiet gap sentence: raw, weighted to ... */}
      <p data-private style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-subtle)', marginBottom: 'var(--space-5)' }}>
        <span className="tabular-nums">{format(raw12mo)}</span> raw, weighted to{' '}
        <span className="tabular-nums">{format(expected12mo)}</span>.
      </p>

      {/* Erosion funnel: continuous descending weighted bars */}
      {funnel.length > 0 && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 'var(--space-3)', gap: 'var(--space-2)' }}>
            <p
              style={{
                fontSize: 'var(--text-2xs, 0.6875rem)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-text-subtle)',
              }}
            >
              Where it stands
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
              {totals.openDealCount} open deal{totals.openDealCount === 1 ? '' : 's'}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2-5)' }}>
            {funnel.map(stage => {
              const pct = Math.round((stage.weighted / funnelMax) * 100)
              return (
                <div key={stage.stageId}>
                  <div className="flex items-center justify-between" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)', gap: 'var(--space-2)' }}>
                    <span className="truncate" style={{ color: 'var(--color-text)', fontWeight: 500, minWidth: 0 }}>
                      {stage.name}
                      <span style={{ color: 'var(--color-text-subtle)', marginLeft: 'var(--space-2)', fontWeight: 400 }}>
                        {stage.dealCount} {'×'} {stage.probability}%
                      </span>
                    </span>
                    <span data-private className="tabular-nums" style={{ color: 'var(--color-text)', flexShrink: 0 }}>
                      {format(stage.weighted)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: '0.375rem',
                      background: 'var(--color-bg-tertiary)',
                      borderRadius: 'var(--radius-full)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      className="pipeline-ahead-bar"
                      style={{
                        width: `${Math.max(2, pct)}%`,
                        height: '100%',
                        background: stage.colour ?? 'var(--color-brand)',
                        borderRadius: 'var(--radius-full)',
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Closing-this-month rail: value + deal count on a neutral month-progress rail
          (no fake target tick, since monthlyCloseTarget does not exist yet). The
          shared shell owns the bottom padding now, so this is the last block's
          bottom margin only when chips follow. */}
      <div style={{ marginBottom: closingChips.length > 0 ? 'var(--space-4)' : 0 }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 'var(--space-2)', gap: 'var(--space-2)' }}>
          <p
            style={{
              fontSize: 'var(--text-2xs, 0.6875rem)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-text-subtle)',
            }}
          >
            Closing this month
          </p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
            {closingThisMonth.length} deal{closingThisMonth.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
          <p data-private className="tabular-nums" style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text)', flexShrink: 0 }}>
            {format(closingValue)}
          </p>
          {/* Neutral month-progress rail: marks how far through the month we are,
              not progress toward a target (there is no target field). */}
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div
              style={{
                height: '0.375rem',
                background: 'var(--color-bg-tertiary)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
              }}
              role="img"
              aria-label={`${monthProgressPct}% through the month`}
            >
              <div
                style={{
                  width: `${monthProgressPct}%`,
                  height: '100%',
                  background: 'var(--color-border)',
                  borderRadius: 'var(--radius-full)',
                }}
              />
            </div>
            <p style={{ fontSize: 'var(--text-2xs, 0.6875rem)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
              {monthProgressPct}% through the month
            </p>
          </div>
        </div>
      </div>

      {/* Up to 3 named closing-deal chips */}
      {closingChips.length > 0 && (
        <div className="flex flex-wrap" style={{ gap: 'var(--space-1-5)' }}>
          {closingChips.map(d => (
            <span
              key={d.id}
              data-private
              className="flex items-center"
              style={{
                gap: 'var(--space-1-5)',
                padding: 'var(--space-1) var(--space-2-5)',
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand-dark)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                maxWidth: '100%',
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: '0.375rem', height: '0.375rem', borderRadius: 'var(--radius-full)', background: d.stageColour ?? 'var(--color-brand)', flexShrink: 0 }}
              />
              <span className="truncate">{d.orgName ?? d.title}</span>
            </span>
          ))}
        </div>
      )}
    </DomainCard>
  )
}

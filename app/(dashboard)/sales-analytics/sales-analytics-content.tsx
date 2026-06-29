'use client'

import { useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { ArrowRight, BarChart2, Inbox, PieChart, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { FeatureCard } from '@/components/tahi/feature-card'
import { FunnelChart, DonutChart, MultiBarChart } from '@/components/tahi/chart'
import { EmptyState } from '@/components/tahi/empty-state'
import { useDisplayCurrency } from '@/lib/display-currency-context'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DealSummary {
  id: string
  title: string
  stageId: string
  value: number | null
  valueNzd: number | null
  upfrontValueNzd?: number | null
  monthlyValueNzd?: number | null
  currency: string | null
  expectedCloseDate: string | null
  closedAt: string | null
  closeReason: string | null
  source: string | null
  ownerId: string | null
  ownerName: string | null
  stageName: string | null
  stageColour: string | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  orgName: string | null
}

interface StageSummary {
  id: string
  name: string
  slug: string
  position: number
  colour: string | null
  isClosedWon: number | boolean | null
  isClosedLost: number | boolean | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthKey(d: Date): string {
  return d.toLocaleDateString('en-NZ', { month: 'short', year: '2-digit' })
}

function lastSixMonths(): Array<{ key: string; year: number; month: number }> {
  const out: Array<{ key: string; year: number; month: number }> = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ key: monthKey(d), year: d.getFullYear(), month: d.getMonth() })
  }
  return out
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function SalesAnalyticsContent() {
  const { format } = useDisplayCurrency()
  const { data: dealsData, isLoading: dealsLoading } = useSWR<{ items: DealSummary[] }>('/api/admin/deals?limit=100')
  const { data: stagesData, isLoading: stagesLoading } = useSWR<{ stages: StageSummary[] }>('/api/admin/pipeline/stages')
  const loading = dealsLoading || stagesLoading
  const deals = dealsData?.items ?? []
  const stages = stagesData?.stages ?? []

  // ── Derived analytics ────────────────────────────────────────────────────
  const openDeals = useMemo(
    () => deals.filter(d => !d.stageIsClosedWon && !d.stageIsClosedLost),
    [deals],
  )
  const wonDeals = useMemo(() => deals.filter(d => d.stageIsClosedWon), [deals])
  const lostDeals = useMemo(() => deals.filter(d => d.stageIsClosedLost), [deals])

  const totalPipelineValue = useMemo(
    () => openDeals.reduce((sum, d) => sum + (d.valueNzd ?? d.value ?? 0), 0),
    [openDeals],
  )
  const wonValue = useMemo(
    () => wonDeals.reduce((sum, d) => sum + (d.valueNzd ?? d.value ?? 0), 0),
    [wonDeals],
  )
  const closeRate = useMemo(() => {
    const closed = wonDeals.length + lostDeals.length
    if (closed === 0) return 0
    return Math.round((wonDeals.length / closed) * 100)
  }, [wonDeals, lostDeals])

  // Funnel: ordered open stages (exclude closed_won / closed_lost / stalled)
  const funnelStages = useMemo(() => {
    if (stages.length === 0) return []
    const ordered = [...stages]
      .filter(s => !s.isClosedWon && !s.isClosedLost && s.slug !== 'stalled')
      .sort((a, b) => a.position - b.position)
    return ordered.map(stage => {
      const dealsInStage = deals.filter(d => d.stageId === stage.id)
      return {
        label: stage.name,
        value: dealsInStage.length,
        colour: stage.colour ?? undefined,
      }
    })
  }, [stages, deals])

  // Donut: pipeline value distribution by open stage
  const donutSegments = useMemo(() => {
    if (stages.length === 0) return []
    const openStages = stages.filter(s => !s.isClosedWon && !s.isClosedLost)
    return openStages
      .map(stage => {
        const valueInStage = deals
          .filter(d => d.stageId === stage.id)
          .reduce((sum, d) => sum + (d.valueNzd ?? d.value ?? 0), 0)
        return {
          label: stage.name,
          value: valueInStage,
          colour: stage.colour ?? undefined,
        }
      })
      .filter(s => s.value > 0)
  }, [stages, deals])

  // MultiBar: closed-won value by month (last 6 months), grouped by source
  const monthlyByOwnerData = useMemo(() => {
    const months = lastSixMonths()
    const ownerKeys = new Set<string>()
    const byMonth: Record<string, Record<string, number>> = {}
    months.forEach(m => { byMonth[m.key] = {} })

    wonDeals.forEach(d => {
      const closedDate = d.closedAt ?? d.expectedCloseDate
      if (!closedDate) return
      const dt = new Date(closedDate)
      const slot = months.find(m => m.year === dt.getFullYear() && m.month === dt.getMonth())
      if (!slot) return
      const owner = d.ownerName ?? 'Unassigned'
      ownerKeys.add(owner)
      byMonth[slot.key][owner] = (byMonth[slot.key][owner] ?? 0) + (d.valueNzd ?? d.value ?? 0)
    })

    const owners = Array.from(ownerKeys)
    const rows = months.map(m => {
      const row: Record<string, string | number> = { label: m.key }
      owners.forEach(o => { row[o] = byMonth[m.key][o] ?? 0 })
      return row
    })

    return {
      rows,
      owners,
      hasData: owners.length > 0 && rows.some(r => owners.some(o => Number(r[o]) > 0)),
    }
  }, [wonDeals])

  const nextDealToClose = useMemo(() => {
    const upcoming = openDeals
      .filter(d => d.expectedCloseDate)
      .sort((a, b) => new Date(a.expectedCloseDate!).getTime() - new Date(b.expectedCloseDate!).getTime())
    return upcoming[0] ?? null
  }, [openDeals])

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales analytics"
        subtitle="Live view of your pipeline shape, conversion and momentum. Detailed proposal / schedule / contract performance is coming in Phase 8."
      />

      {/* Hero strip: two FeatureCard tiles for context */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FeatureCard variant="forest" padding="lg">
          <FeatureCard.Eyebrow>Pipeline snapshot</FeatureCard.Eyebrow>
          <FeatureCard.Title>
            {loading ? 'Loading...' : `${format(totalPipelineValue)} open`}
          </FeatureCard.Title>
          <FeatureCard.Description>
            {loading
              ? 'Fetching live deals from the pipeline.'
              : openDeals.length === 0
                ? 'No open deals right now. Add a deal from the pipeline to start tracking.'
                : `${openDeals.length} open deal${openDeals.length === 1 ? '' : 's'} across ${funnelStages.length} stage${funnelStages.length === 1 ? '' : 's'}. ${closeRate}% historical close rate on resolved deals.`}
          </FeatureCard.Description>
        </FeatureCard>

        <FeatureCard variant="lime" padding="lg">
          <FeatureCard.Eyebrow>Next to close</FeatureCard.Eyebrow>
          <FeatureCard.Title>
            {loading
              ? 'Loading...'
              : nextDealToClose
                ? nextDealToClose.title
                : 'Nothing on the horizon'}
          </FeatureCard.Title>
          <FeatureCard.Description>
            {loading
              ? ' '
              : nextDealToClose
                ? `${nextDealToClose.orgName ?? 'No client'} · ${format(nextDealToClose.valueNzd ?? nextDealToClose.value ?? 0)} · ${nextDealToClose.stageName ?? 'No stage'}`
                : 'Add an expected close date to a deal to see what is next up.'}
          </FeatureCard.Description>
        </FeatureCard>
      </div>

      {/* KPI strip: lifetime wins / open value / close rate */}
      <Card variant="grouped">
        <div className="grid grid-cols-1 sm:grid-cols-3">
          <KPICell label="Won (all time)" value={loading ? '-' : format(wonValue)} sub={`${wonDeals.length} deal${wonDeals.length === 1 ? '' : 's'}`} />
          <KPICell label="Pipeline value" value={loading ? '-' : format(totalPipelineValue)} sub={`${openDeals.length} open`} bordered />
          <KPICell label="Close rate" value={loading ? '-' : `${closeRate}%`} sub={`${wonDeals.length} won / ${lostDeals.length} lost`} bordered />
        </div>
      </Card>

      {/* Charts: funnel + donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padding="lg">
          <div className="flex items-center gap-2" style={{ marginBottom: '1rem' }}>
            <BarChart2 size={16} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
            <h3 className="font-semibold" style={{ fontSize: 'var(--text-md)', color: 'var(--color-text)' }}>
              Deal stage funnel
            </h3>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
            Open deal count by stage. Width is proportional to the top stage.
          </p>
          {loading ? (
            <div className="animate-pulse" style={{ height: '15rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)' }} />
          ) : funnelStages.length === 0 || funnelStages.every(s => s.value === 0) ? (
            <EmptyState variant="inline" icon={<Inbox size={20} />} title="No open deals yet" description="Once you add deals to the pipeline the funnel will populate here." />
          ) : (
            <FunnelChart
              stages={funnelStages}
              ariaLabel="Deals by pipeline stage"
            />
          )}
        </Card>

        <Card padding="lg">
          <div className="flex items-center gap-2" style={{ marginBottom: '1rem' }}>
            <PieChart size={16} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
            <h3 className="font-semibold" style={{ fontSize: 'var(--text-md)', color: 'var(--color-text)' }}>
              Pipeline value by stage
            </h3>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
            Where the dollars sit across open stages.
          </p>
          {loading ? (
            <div className="animate-pulse" style={{ height: '15rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)' }} />
          ) : donutSegments.length === 0 ? (
            <EmptyState variant="inline" icon={<PieChart size={20} />} title="No pipeline value to chart" description="Deals need a value set for this breakdown to appear." />
          ) : (
            <div className="flex justify-center" style={{ padding: '0.5rem 0' }}>
              <DonutChart
                segments={donutSegments}
                centreLabel="Open"
                centreValue={format(totalPipelineValue)}
                size={200}
                ariaLabel="Pipeline value distribution by stage"
              />
            </div>
          )}
        </Card>
      </div>

      {/* MultiBar: closed-won by month per owner */}
      <Card padding="lg">
        <div className="flex items-center gap-2" style={{ marginBottom: '1rem' }}>
          <TrendingUp size={16} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
          <h3 className="font-semibold" style={{ fontSize: 'var(--text-md)', color: 'var(--color-text)' }}>
            Closed-won by month, by owner
          </h3>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
          Last six months of deal wins, stacked by deal owner. Uses the deal&apos;s close date (or expected close if missing).
        </p>
        {loading ? (
          <div className="animate-pulse" style={{ height: '15rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)' }} />
        ) : !monthlyByOwnerData.hasData ? (
          <EmptyState variant="inline" icon={<TrendingUp size={20} />} title="No closed-won deals in the last 6 months" description="Once deals close they will show up here, grouped by who owned them." />
        ) : (
          <MultiBarChart
            height={260}
            stacked
            data={monthlyByOwnerData.rows}
            series={monthlyByOwnerData.owners.map(o => ({ key: o, label: o }))}
            formatValue={v => format(v)}
            ariaLabel="Closed-won deal value by month, stacked by owner"
          />
        )}
      </Card>

      {/* Roadmap callout */}
      <Card
        padding="lg"
        style={{
          background: 'var(--color-bg-secondary)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Coming in Phase 8</h3>
        <ul className="mt-3 space-y-2 text-sm text-[var(--color-text-muted)] list-disc pl-5">
          <li>Close rate by source (referral / Webflow partner / LinkedIn / website / cold)</li>
          <li>Median proposal-to-sign time per source and per package</li>
          <li>Top-performing proposals by viewer count, dwell time and accept rate</li>
          <li>Variant heatmap (which package gets clicked vs which gets accepted)</li>
          <li>Open questions / tweak requests across all live proposals</li>
        </ul>
        <div className="mt-4 grid sm:grid-cols-3 gap-2">
          <Link
            href="/proposals"
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg)] transition-colors text-sm"
          >
            <span className="text-[var(--color-text)]">Proposals</span>
            <ArrowRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          </Link>
          <Link
            href="/schedules"
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg)] transition-colors text-sm"
          >
            <span className="text-[var(--color-text)]">Schedules</span>
            <ArrowRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          </Link>
          <Link
            href="/contracts"
            className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg)] transition-colors text-sm"
          >
            <span className="text-[var(--color-text)]">Contracts</span>
            <ArrowRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          </Link>
        </div>
      </Card>
    </div>
  )
}

// ─── KPICell (local, inline-divider style) ───────────────────────────────────

function KPICell({
  label,
  value,
  sub,
  bordered,
}: {
  label: string
  value: string
  sub?: string
  bordered?: boolean
}) {
  return (
    <div
      style={{
        padding: 'var(--space-5)',
        borderLeft: bordered ? '1px solid var(--color-border-subtle)' : undefined,
      }}
    >
      <p
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--color-text-subtle)',
          marginBottom: 'var(--space-2)',
        }}
      >
        {label}
      </p>
      <p
        className="tabular-nums"
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-1)',
        }}
      >
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}

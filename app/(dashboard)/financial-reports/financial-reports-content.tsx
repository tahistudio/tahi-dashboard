'use client'

/**
 * /financial-reports — Phase H finance overhaul page.
 *
 * Two halves:
 *  - Top: "Am I on track?" — status traffic-lights, disposable cash now,
 *    MRR / ARR / YTD revenue, sales velocity, outstanding AR. This is
 *    the page Liam opens to make hire / spend / tax decisions.
 *  - Bottom (coming next): "Huh, that's interesting" charts —
 *    MRR stacked area, revenue per client, cost-mix donut, profit per
 *    logged hour, pipeline → cash funnel, seasonality heatmap.
 *
 * Design rules:
 *  - No icons on metric tiles (type leads; icons reserved for actions)
 *  - No touching cards with divider lines (gap-driven layout)
 *  - Numbers in tabular-nums + currency-aligned columns
 *  - Source-of-truth chips on every figure (Stripe / Xero / Airwallex)
 */

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Play } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable } from '@/components/tahi/data-table'
import { DonutChart } from '@/components/tahi/chart'
import { CHART } from '@/lib/chart-colors'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { convertToNzd } from '@/lib/currency'

interface SummaryResponse {
  asOf: string
  primaryCurrency: string
  bankBalances: Array<{ currency: string; available: number; total: number; sources: string[] }>
  reserves: {
    total: number
    items: Array<{ id: string; name: string; category: string; currency: string; accruedAmount: number; targetAmount: number | null; accrualRate: number | null }>
  }
  disposableCash: number
  reserveConfig: {
    targetMonths: number
    monthlyBurnNzd: number | null
    lastYearTaxOwed: number
    targetAmount: number
    targetBurn: number
    monthsOfRunway: number | null
  }
  mrr: {
    retainer: number
    project: number
    combined: number
    retainerClientCount: number
    configured: boolean
    breakdown: Array<{
      id: string
      name: string
      nativeAmount: number
      nativeCurrency: string
      mrrNzd: number
      share: number
    }>
  }
  arr: number
  ytdRevenue: number
  ytdInvoiceCount: number
  projectRevenue: { projection: number; trailing5moActual: number }
  effectiveMonthlyRevenue: number
  newMrrThisMonth: { amount: number; wonDeals: number; churnedClients: number }
  clientConcentration: {
    totalNamedMrr: number
    topClientShare: number
    top3Share: number
    top: Array<{ name: string; mrr: number }>
  }
  arAging: { current: number; days30: number; days60: number; days90: number; days90plus: number }
  taxes: {
    gstOwedYtd: number
    corpTaxOwedYtd: number
    ytdProfit: number
    ytdExpensesApprox: number
    taxYearStart: string
    taxYearRevenue: number
    monthsIntoTaxYear: number
  }
  spendSplit: { discretionary: number; essential: number }
  takeHome: {
    liamAnnual: number
    staciAnnual: number
    combinedAnnual: number
    combinedMonthly: number
    targetEach: number
    gapEach: number
    gapCombined: number
  }
  yoy: { thisMonth: number; lastYearSameMonth: number; deltaPct: number | null }
  quarterly: { target: number; actual: number; projection: number; daysElapsed: number; daysTotal: number; pctElapsed: number; onPace: boolean | null }
  yearEnd: { projection: number; monthsRemaining: number }
  forex: { items: Array<{ currency: string; available: number }>; nzdShare: number }
  monthlyRevenueHistory: Array<{ ym: string; total: number }>
  costMix: Array<{ category: string; monthly: number }>
  pipelineFunnel: Array<{ stage: string; position: number; isClosedWon: boolean; count: number; value: number }>
  outstandingWork: { value: number; contracts: number }
  winRateBySource: Array<{ source: string; won: number; lost: number; total: number; rate: number }>
  dealStats: { avgValue: number; avgCycleDays: number; count: number }
  timeToPay: { avgDays: number; minDays: number; maxDays: number; count: number }
  cashConversion: { invoiced90d: number; collected90d: number; ratio: number | null }
  productivity: { hoursLast90d: number; revenuePerHour: number | null }
  pipelineOpen: { value: number; count: number }
  recentActivity: {
    invoices: Array<{ id: string; totalUsd: number; paidAt: string | null; orgName: string | null }>
    deals: Array<{ id: string; title: string; value: number; closedAt: string | null; orgName: string | null }>
  }
  salesVelocity: {
    last30Days: { count: number; value: number }
    last60Days: { count: number; value: number }
    last90Days: { count: number; value: number }
  }
  outstandingAr: number
  overdueCount: number
  status: {
    cash: 'green' | 'amber' | 'red'
    mrr: 'green' | 'amber' | 'red'
    ar: 'green' | 'amber' | 'red'
    reserves: 'green' | 'amber' | 'red'
    velocity: 'green' | 'amber' | 'red'
  }
}

function fmtCurrency(n: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  })
  return formatter.format(Math.round(n))
}

// Filters out balance rows with zero available cash. Liam doesn't want
// the row spam — Airwallex returns ~50 currencies regardless of whether
// any are funded.
function isFunded(b: { available: number; total: number }): boolean {
  return Math.abs(b.available) > 0.01 || Math.abs(b.total) > 0.01
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const STATUS_TONE: Record<'green' | 'amber' | 'red', BadgeTone> = {
  green: 'positive',
  amber: 'warning',
  red: 'danger',
}

const STATUS_LABEL: Record<'green' | 'amber' | 'red', string> = {
  green: 'On track',
  amber: 'Watch',
  red: 'Action',
}

export function FinancialReportsContent() {
  const { showToast } = useToast()
  // Every monetary number on the page follows the global nav currency
  // switcher. Native amounts are still shown next to bank rows since
  // those are bank-of-truth-in-currency, but the headline + status
  // tiles + revenue card convert via the FX-rate context.
  const { displayCurrency, toDisplay, format: formatDisplay, formatNative, exchangeRates, ratesLoaded } = useDisplayCurrency()
  const [data, setData] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(apiPath('/api/admin/financial-reports/summary'))
      if (!r.ok) throw new Error('Failed')
      const json = await r.json() as SummaryResponse
      setData(json)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchSummary() }, [fetchSummary])

  async function backfillMrr() {
    try {
      const r = await fetch(apiPath('/api/admin/financial-reports/backfill-mrr'), { method: 'POST' })
      const j = await r.json() as { updated?: number; unchanged?: number; error?: string }
      if (r.ok) {
        showToast(`MRR backfilled — ${j.updated ?? 0} clients updated, ${j.unchanged ?? 0} unchanged`, 'success')
        await fetchSummary()
      } else {
        showToast(`Backfill failed: ${j.error ?? 'unknown'}`, 'error')
      }
    } catch {
      showToast('Backfill failed', 'error')
    }
  }

  async function syncAirwallex() {
    setSyncing(true)
    try {
      const r = await fetch(apiPath('/api/admin/integrations/airwallex/sync'), { method: 'POST' })
      const j = await r.json() as { balances?: number; transactions?: { fetched?: number }; error?: string }
      if (r.ok) {
        showToast(`Airwallex synced — ${j.balances ?? 0} balances, ${j.transactions?.fetched ?? 0} txns`, 'success')
        await fetchSummary()
      } else {
        showToast(`Sync failed: ${j.error ?? 'unknown'}`, 'error')
      }
    } catch {
      showToast('Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Financial reports" subtitle="Loading…" />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem' }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="animate-pulse" style={{ height: '7rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-card)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Financial reports" subtitle="Could not load financial summary." />
        <TahiButton variant="secondary" onClick={() => void fetchSummary()}>Retry</TahiButton>
      </div>
    )
  }

  // Helpers that convert source-currency values into the user's chosen
  // display currency via the FX context. All headline numbers go through
  // this so the page reads the same whether you've picked NZD, USD, GBP
  // etc in the nav switcher.
  const cur = displayCurrency
  // toCur(amount, fromCurrency) — convert source-currency amount to
  // the user's display currency, fully formatted. Step 1 normalises to
  // NZD (the FX context's canonical pivot); step 2 lets toDisplay
  // render in whatever the nav switcher is set to.
  const toCur = (amount: number, fromCurrency: string): string => {
    const inNzd = fromCurrency === 'NZD' || !ratesLoaded
      ? amount
      : convertToNzd(amount, fromCurrency, exchangeRates)
    return formatDisplay(inNzd)
  }
  const toCurNumber = (amount: number, fromCurrency: string): number => {
    const inNzd = fromCurrency === 'NZD' || !ratesLoaded
      ? amount
      : convertToNzd(amount, fromCurrency, exchangeRates)
    return toDisplay(inNzd)
  }
  // Bank balances rendered in their NATIVE currency (with the display
  // currency equivalent in smaller text below). Strip any row with a
  // zero balance — Airwallex returns ~50 currencies regardless of
  // funding state.
  const fundedBanks = data.bankBalances.filter(isFunded)
  // Disposable cash is computed server-side in the primary (source)
  // currency. Convert to display for the headline.
  const disposableDisplay = toCurNumber(data.disposableCash, data.primaryCurrency)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Financial reports"
        subtitle={`Snapshot as of ${fmtRelative(data.asOf)}. Stripe + Xero + Airwallex reconciled.`}
      >
        <TahiButton
          variant="secondary"
          size="sm"
          loading={syncing}
          onClick={() => void syncAirwallex()}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Sync bank
        </TahiButton>
        <TahiButton
          variant="secondary"
          size="sm"
          onClick={() => void backfillMrr()}
        >
          Recompute MRR
        </TahiButton>
        <TahiButton
          variant="secondary"
          size="sm"
          onClick={() => void fetchSummary()}
          iconLeft={<Play className="w-3.5 h-3.5" />}
        >
          Reload
        </TahiButton>
      </PageHeader>

      {/* Status strip — traffic lights per axis, plain-English label */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.875rem' }}>
        <StatusTile label="Cash runway" status={data.status.cash} hint={
          data.reserveConfig.monthsOfRunway != null
            ? `${data.reserveConfig.monthsOfRunway.toFixed(1)} months at ${formatNative(data.reserveConfig.targetBurn, 'NZD')}/mo burn · target ${data.reserveConfig.targetMonths}mo`
            : 'Set monthly burn below to track this properly'
        } />
        <StatusTile label="MRR" status={data.status.mrr} hint={
          !data.mrr.configured
            ? 'Not configured — set custom_mrr per active client'
            : data.mrr.combined > 0
              ? `${toCur(data.mrr.combined, data.primaryCurrency)}/mo across ${data.mrr.retainerClientCount} client${data.mrr.retainerClientCount === 1 ? '' : 's'}`
              : 'No recurring revenue tracked'
        } />
        <StatusTile label="AR" status={data.status.ar} hint={
          data.overdueCount > 0 ? `${data.overdueCount} overdue, ${toCur(data.outstandingAr, data.primaryCurrency)} total`
          : `${toCur(data.outstandingAr, data.primaryCurrency)} outstanding`
        } />
        <StatusTile label="Reserves" status={data.status.reserves} hint={
          data.reserves.total > 0 ? `${toCur(data.reserves.total, data.primaryCurrency)} set aside`
          : 'No tax reserve configured'
        } />
        <StatusTile label="Sales velocity" status={data.status.velocity} hint={
          data.salesVelocity.last60Days.count > 0
            ? `${data.salesVelocity.last60Days.count} signed in last 60d`
            : data.salesVelocity.last90Days.count > 0
              ? `${data.salesVelocity.last90Days.count} in last 90d — slowing`
              : 'No deals signed in 90d'
        } />
      </div>

      {/* Disposable cash NOW + breakdown */}
      <Card>
        <div className="p-4 sm:p-6">
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-2">
            Disposable cash right now
          </div>
          <div className="flex items-baseline" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '2.5rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--color-text)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatDisplay(disposableDisplay)}
            </span>
            <span className="text-sm text-[var(--color-text-muted)]">
              after reserves · displayed in {cur}
            </span>
          </div>
          <div className="mt-4">
            {fundedBanks.length === 0 ? (
              <div className="text-xs text-[var(--color-text-muted)]">
                No funded bank accounts. Sync Airwallex / Xero to populate.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: '20rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider" style={{ textAlign: 'left', padding: '0.4375rem 0.5rem', borderBottom: '1px solid var(--color-border-subtle)' }}>Account</th>
                    <th className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider" style={{ textAlign: 'right', padding: '0.4375rem 0.5rem', borderBottom: '1px solid var(--color-border-subtle)' }}>Native</th>
                    <th className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider" style={{ textAlign: 'right', padding: '0.4375rem 0.5rem', borderBottom: '1px solid var(--color-border-subtle)' }}>≈ {cur}</th>
                    <th className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider" style={{ textAlign: 'right', padding: '0.4375rem 0.5rem', borderBottom: '1px solid var(--color-border-subtle)' }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {fundedBanks.map(b => (
                    <tr key={b.currency}>
                      <td className="text-sm font-medium text-[var(--color-text)]" style={{ padding: '0.5rem 0.5rem' }}>{b.currency}</td>
                      <td className="text-sm text-[var(--color-text)]" style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNative(b.available, b.currency)}</td>
                      <td className="text-sm text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b.currency === cur ? '—' : toCur(b.available, b.currency)}</td>
                      <td style={{ padding: '0.5rem 0.5rem', textAlign: 'right' }}>
                        {b.sources.map(s => (
                          <Badge key={s} tone="neutral" variant="soft" size="sm">{s}</Badge>
                        ))}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                    <td className="text-sm font-medium text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.5rem' }}>Reserved</td>
                    <td colSpan={2} className="text-sm text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      −{toCur(data.reserves.total, data.primaryCurrency)}
                    </td>
                    <td className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ padding: '0.5rem 0.5rem', textAlign: 'right' }}>
                      {data.reserves.items.length === 0 ? 'unset' : `${data.reserves.items.length} pot${data.reserves.items.length === 1 ? '' : 's'}`}
                    </td>
                  </tr>
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* AI anomaly findings — Sonnet's weekly + monthly scan output */}
      <AnomaliesCard />

      {/* Reserve target config */}
      <ReserveTargetCard
        config={data.reserveConfig}
        formatNative={formatNative}
        onSaved={() => void fetchSummary()}
      />

      {/* Spend impact calculator — "can I afford X?" */}
      <SpendImpactCard
        startingCash={data.disposableCash}
        burn={data.reserveConfig.targetBurn}
        revenue={data.effectiveMonthlyRevenue}
        reserveTarget={data.reserveConfig.targetAmount}
        formatNative={formatNative}
      />

      {/* MRR / ARR / YTD revenue */}
      <Card>
        <div className="p-4 sm:p-6">
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
            Revenue
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '1.5rem' }}>
            <MetricBlock
              label="Effective monthly revenue"
              value={toCur(data.effectiveMonthlyRevenue, data.primaryCurrency)}
              sub={`Retainer ${toCur(data.mrr.retainer, data.primaryCurrency)} + 5mo project avg ${toCur(data.projectRevenue.trailing5moActual, data.primaryCurrency)}`}
              accent
            />
            <MetricBlock
              label="Combined MRR (projection)"
              value={data.mrr.configured ? toCur(data.mrr.combined, data.primaryCurrency) : '—'}
              sub={data.mrr.configured
                ? `Retainer ${toCur(data.mrr.retainer, data.primaryCurrency)} · Project amortised ${toCur(data.mrr.project, data.primaryCurrency)}`
                : 'Set custom_mrr on active clients to track this'
              }
            />
            <MetricBlock
              label="ARR (projection)"
              value={data.mrr.configured ? toCur(data.arr, data.primaryCurrency) : '—'}
              sub="MRR × 12 — assumes current MRR holds for a year"
            />
            <MetricBlock
              label="YTD revenue"
              value={toCur(data.ytdRevenue, data.primaryCurrency)}
              sub={`${data.ytdInvoiceCount} paid invoice${data.ytdInvoiceCount === 1 ? '' : 's'} this calendar year`}
            />
            <MetricBlock
              label="Net new MRR this month"
              value={toCur(data.newMrrThisMonth.amount, data.primaryCurrency)}
              sub={`${data.newMrrThisMonth.wonDeals} won deal${data.newMrrThisMonth.wonDeals === 1 ? '' : 's'} · ${data.newMrrThisMonth.churnedClients} churned`}
            />
            <MetricBlock
              label="Outstanding AR"
              value={toCur(data.outstandingAr, data.primaryCurrency)}
              sub={data.overdueCount > 0 ? `${data.overdueCount} overdue` : 'All current'}
            />
          </div>
        </div>
      </Card>

      {/* Per-client MRR breakdown — uses DataTable so it sorts + is consistent
          with the rest of the dashboard. Source of the "wait, why is MRR
          70k?" answer: shows every retainer client with native + NZD. */}
      {data.mrr.breakdown.length > 0 && (
        <Card>
          <div className="p-4 sm:p-6">
            <div className="flex items-baseline justify-between flex-wrap" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
                MRR by client ({data.mrr.breakdown.length})
              </div>
              <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
                Native amount × FX = NZD contribution. Edit per-client on /clients.
              </div>
            </div>
            <DataTable
              rows={data.mrr.breakdown}
              getRowId={(r) => r.id}
              empty={<div className="p-4 text-sm text-[var(--color-text-muted)]">No retainer clients tracked. Set custom_mrr on a client to add them here.</div>}
              columns={[
                { key: 'name', header: 'Client', sortable: true, accessor: (r) => r.name },
                {
                  key: 'native',
                  header: 'Native MRR',
                  align: 'right',
                  sortable: true,
                  sortValue: (r) => r.nativeAmount,
                  render: (r) => (
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {new Intl.NumberFormat('en-NZ', { style: 'currency', currency: r.nativeCurrency, maximumFractionDigits: 0 }).format(r.nativeAmount)}
                    </span>
                  ),
                },
                {
                  key: 'currency',
                  header: 'Currency',
                  render: (r) => <Badge tone="neutral" variant="soft" size="sm">{r.nativeCurrency}</Badge>,
                },
                {
                  key: 'nzd',
                  header: `≈ ${data.primaryCurrency}`,
                  align: 'right',
                  sortable: true,
                  sortValue: (r) => r.mrrNzd,
                  render: (r) => (
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
                      {toCur(r.mrrNzd, data.primaryCurrency)}
                    </span>
                  ),
                },
                {
                  key: 'share',
                  header: 'Share',
                  align: 'right',
                  sortable: true,
                  sortValue: (r) => r.share,
                  render: (r) => (
                    <span className="text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {(r.share * 100).toFixed(1)}%
                    </span>
                  ),
                },
              ]}
              defaultSort={{ key: 'nzd', dir: 'desc' }}
            />
          </div>
        </Card>
      )}

      {/* Sales velocity */}
      <Card>
        <div className="p-4 sm:p-6">
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
            Sales velocity
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1.5rem' }}>
            <MetricBlock label="Last 30 days" value={`${data.salesVelocity.last30Days.count} deals`} sub={toCur(data.salesVelocity.last30Days.value, data.primaryCurrency)} />
            <MetricBlock label="Last 60 days" value={`${data.salesVelocity.last60Days.count} deals`} sub={toCur(data.salesVelocity.last60Days.value, data.primaryCurrency)} />
            <MetricBlock label="Last 90 days" value={`${data.salesVelocity.last90Days.count} deals`} sub={toCur(data.salesVelocity.last90Days.value, data.primaryCurrency)} />
          </div>
        </div>
      </Card>

      {/* Client concentration */}
      <Card>
        <div className="p-4 sm:p-6">
          <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
              Client concentration
            </div>
            <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
              {data.clientConcentration.totalNamedMrr > 0
                ? 'Risk indicator: if you lose your top client tomorrow…'
                : 'No client MRR configured yet'}
            </div>
          </div>
          {data.clientConcentration.totalNamedMrr === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              Set custom_mrr on your active clients to see concentration risk.
            </p>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '1.5rem', alignItems: 'center' }}>
              {/* Donut: at-a-glance share of MRR. Centre shows top client %. */}
              <div className="flex justify-center">
                <DonutChart
                  size={180}
                  segments={data.clientConcentration.top.map(c => ({ label: c.name, value: c.mrr }))}
                  centreLabel={<span className="text-[0.6875rem] uppercase tracking-wider text-[var(--color-text-subtle)]">Top client</span>}
                  centreValue={
                    <span className="text-xl font-bold text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {Math.round(data.clientConcentration.topClientShare * 100)}%
                    </span>
                  }
                  legend={false}
                  ariaLabel="MRR share by client"
                />
              </div>
              {/* Legend column: ranked list + share + native NZD. */}
              <div className="grid" style={{ gap: '0.5rem' }}>
                <div className="flex items-baseline justify-between text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ marginBottom: '0.25rem' }}>
                  <span>Risk: if your top 3 leave</span>
                  <span style={{ color: data.clientConcentration.top3Share > 0.7 ? 'var(--color-warning)' : 'var(--color-text)', fontWeight: 600 }}>
                    {Math.round(data.clientConcentration.top3Share * 100)}% gone
                  </span>
                </div>
                {data.clientConcentration.top.map((c, i) => {
                  const pct = data.clientConcentration.totalNamedMrr > 0 ? c.mrr / data.clientConcentration.totalNamedMrr : 0
                  const dot = CHART.categorical[i % CHART.categorical.length]
                  return (
                    <div key={c.name} className="flex items-center" style={{ gap: '0.625rem' }}>
                      <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: dot, flexShrink: 0 }} />
                      <span className="text-sm text-[var(--color-text)] truncate" style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
                      <span className="text-xs text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                        {toCur(c.mrr, data.primaryCurrency)}
                      </span>
                      <span className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums', width: '2.5rem', textAlign: 'right', flexShrink: 0 }}>
                        {(pct * 100).toFixed(0)}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* AR aging */}
      <Card>
        <div className="p-4 sm:p-6">
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
            AR aging
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '1rem' }}>
            <ArBucket label="Current" amount={data.arAging.current} cur={data.primaryCurrency} toCur={toCur} tone="positive" />
            <ArBucket label="1-30 days" amount={data.arAging.days30} cur={data.primaryCurrency} toCur={toCur} tone="warning" />
            <ArBucket label="31-60 days" amount={data.arAging.days60} cur={data.primaryCurrency} toCur={toCur} tone="warning" />
            <ArBucket label="61-90 days" amount={data.arAging.days90} cur={data.primaryCurrency} toCur={toCur} tone="danger" />
            <ArBucket label="90+ days" amount={data.arAging.days90plus} cur={data.primaryCurrency} toCur={toCur} tone="danger" />
          </div>
        </div>
      </Card>

      {/* Tax owed (NZ tax year — Apr 1 → Mar 31) */}
      <Card>
        <div className="p-4 sm:p-6">
          <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
              Tax owed (NZ tax year — Apr 1 → Mar 31)
            </div>
            <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
              {data.taxes.monthsIntoTaxYear} of 12 months elapsed · approximate, verify with IRD
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1.5rem' }}>
            <MetricBlock
              label="Corp tax accrued"
              value={toCur(data.taxes.corpTaxOwedYtd, data.primaryCurrency)}
              sub={`28% × tax-year profit (${toCur(data.taxes.ytdProfit, data.primaryCurrency)})`}
              accent
            />
            <MetricBlock
              label="GST collected"
              value={toCur(data.taxes.gstOwedYtd, data.primaryCurrency)}
              sub="Tax_amount on paid invoices since Apr 1"
            />
            <MetricBlock
              label="Tax-year revenue"
              value={toCur(data.taxes.taxYearRevenue, data.primaryCurrency)}
              sub={`Paid invoices since ${new Date(data.taxes.taxYearStart).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}`}
            />
            <MetricBlock
              label="Expenses (approx.)"
              value={toCur(data.taxes.ytdExpensesApprox, data.primaryCurrency)}
              sub="Recurring × tax-year months elapsed"
            />
          </div>
        </div>
      </Card>

      {/* Take-home tracking */}
      <TakeHomeCard
        takeHome={data.takeHome}
        formatNative={formatNative}
        onSaved={() => void fetchSummary()}
      />

      {/* Discretionary vs essential spend split */}
      {(data.spendSplit.discretionary > 0 || data.spendSplit.essential > 0) && (
        <Card>
          <div className="p-4 sm:p-6">
            <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
                Discretionary vs essential spend
              </div>
              <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
                Tag commitments via Settings → Commitments
              </div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1.5rem' }}>
              <MetricBlock
                label="Essential (cannot cut)"
                value={formatNative(data.spendSplit.essential, 'NZD')}
                sub={`${Math.round((data.spendSplit.essential / Math.max(1, data.spendSplit.essential + data.spendSplit.discretionary)) * 100)}% of recurring outflow`}
                accent
              />
              <MetricBlock
                label="Discretionary (can cut now)"
                value={formatNative(data.spendSplit.discretionary, 'NZD')}
                sub={data.spendSplit.discretionary > 0
                  ? `${formatNative(data.spendSplit.discretionary * 12, 'NZD')}/yr if you trimmed all of it`
                  : 'None tagged yet — open Settings to mark some'}
              />
            </div>
          </div>
        </Card>
      )}

      {/* YoY comparison */}
      <Card>
        <div className="p-4 sm:p-6">
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
            This month vs last year
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1.5rem' }}>
            <MetricBlock
              label="This month so far"
              value={toCur(data.yoy.thisMonth, data.primaryCurrency)}
              sub="Paid invoices, current calendar month"
              accent
            />
            <MetricBlock
              label="Same month last year"
              value={toCur(data.yoy.lastYearSameMonth, data.primaryCurrency)}
              sub={data.yoy.lastYearSameMonth === 0 ? 'No data — comparison N/A' : 'For perspective'}
            />
            <MetricBlock
              label="Year-over-year"
              value={data.yoy.deltaPct == null ? '—' : `${data.yoy.deltaPct >= 0 ? '+' : ''}${Math.round(data.yoy.deltaPct * 100)}%`}
              sub={data.yoy.deltaPct == null
                ? 'No baseline to compare'
                : data.yoy.deltaPct > 0
                  ? 'Growing month-over-prior-year'
                  : 'Down vs same month last year'
              }
            />
          </div>
        </div>
      </Card>

      {/* Reserves breakdown */}
      {data.reserves.items.length > 0 && (
        <Card>
          <div className="p-4 sm:p-6">
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
              Reserve pots
            </div>
            <div className="grid" style={{ gap: '0.625rem' }}>
              {data.reserves.items.map(r => {
                const pct = r.targetAmount && r.targetAmount > 0
                  ? Math.min(100, (r.accruedAmount / r.targetAmount) * 100)
                  : null
                return (
                  <div key={r.id} className="flex items-center justify-between" style={{ gap: '1rem', flexWrap: 'wrap' }}>
                    <div className="min-w-0" style={{ flex: 1 }}>
                      <div className="text-sm font-semibold text-[var(--color-text)]">{r.name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {r.category}
                        {r.accrualRate ? ` · auto-accruing at ${Math.round(r.accrualRate * 100)}%` : ' · manual'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formatNative(r.accruedAmount, r.currency)}
                        {r.targetAmount ? <span className="text-xs text-[var(--color-text-subtle)] font-normal"> / {formatNative(r.targetAmount, r.currency)}</span> : null}
                      </div>
                      {pct != null && (
                        <div style={{
                          marginTop: '0.25rem',
                          height: '0.25rem',
                          width: '6rem',
                          background: 'var(--color-bg-secondary)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                          marginLeft: 'auto',
                        }}>
                          <div style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: pct >= 100 ? 'var(--color-brand)' : 'var(--color-brand-light)',
                          }} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Quarterly target + year-end projection + benchmarks */}
      <QuarterAndProjectionCard
        quarterly={data.quarterly}
        yearEnd={data.yearEnd}
        ytdRevenue={data.ytdRevenue}
        effectiveMonthly={data.effectiveMonthlyRevenue}
        onSavedTarget={() => void fetchSummary()}
        formatNative={formatNative}
      />

      {/* Forex exposure */}
      <ForexCard forex={data.forex} formatNative={formatNative} />

      {/* Subscription audit */}
      <SubscriptionsAuditCard formatNative={formatNative} />

      {/* Recent activity feed */}
      {(data.recentActivity.invoices.length > 0 || data.recentActivity.deals.length > 0) && (
        <Card>
          <div className="p-4 sm:p-6">
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
              Recent activity
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', gap: '1.5rem' }}>
              <div>
                <div className="text-xs font-semibold text-[var(--color-text)] mb-2">Last 5 paid invoices</div>
                {data.recentActivity.invoices.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-subtle)] italic">No paid invoices yet.</p>
                ) : (
                  <div className="grid" style={{ gap: '0.375rem' }}>
                    {data.recentActivity.invoices.map(inv => (
                      <div key={inv.id} className="flex items-center justify-between text-xs" style={{ gap: '0.5rem', padding: '0.4375rem 0.625rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                        <span className="text-[var(--color-text)] truncate" style={{ minWidth: 0, flex: 1 }}>
                          {inv.orgName ?? '—'}
                        </span>
                        <span className="text-[var(--color-text-muted)] font-mono" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {toCur(inv.totalUsd, data.primaryCurrency)}
                        </span>
                        <span className="text-[var(--color-text-subtle)] text-[0.6875rem]" style={{ flexShrink: 0 }}>
                          {inv.paidAt ? fmtRelative(inv.paidAt) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-[var(--color-text)] mb-2">Last 5 deals signed</div>
                {data.recentActivity.deals.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-subtle)] italic">No deals closed yet.</p>
                ) : (
                  <div className="grid" style={{ gap: '0.375rem' }}>
                    {data.recentActivity.deals.map(deal => (
                      <div key={deal.id} className="flex items-center justify-between text-xs" style={{ gap: '0.5rem', padding: '0.4375rem 0.625rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                        <span className="text-[var(--color-text)] truncate" style={{ minWidth: 0, flex: 1 }}>
                          {deal.title}
                          {deal.orgName && <span className="text-[var(--color-text-subtle)]"> · {deal.orgName}</span>}
                        </span>
                        <span className="text-[var(--color-text-muted)] font-mono" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                          {toCur(deal.value, data.primaryCurrency)}
                        </span>
                        <span className="text-[var(--color-text-subtle)] text-[0.6875rem]" style={{ flexShrink: 0 }}>
                          {deal.closedAt ? fmtRelative(deal.closedAt) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Tier 2 charts cluster — the "huh, that's interesting" half */}
      <RevenueHistoryCard history={data.monthlyRevenueHistory} cur={data.primaryCurrency} toCur={toCur} />
      <CostMixCard costMix={data.costMix} formatNative={formatNative} />
      <PipelineFunnelCard funnel={data.pipelineFunnel} open={data.pipelineOpen} formatNative={formatNative} />
      <ProductivityCard
        revenuePerHour={data.productivity.revenuePerHour}
        hours={data.productivity.hoursLast90d}
        cashConversion={data.cashConversion}
        timeToPay={data.timeToPay}
        outstandingWork={data.outstandingWork}
        dealStats={data.dealStats}
        winRateBySource={data.winRateBySource}
        formatNative={formatNative}
      />
    </div>
  )
}

function StatusTile({ label, status, hint }: { label: string; status: 'green' | 'amber' | 'red'; hint: string }) {
  return (
    <div style={{
      padding: '0.875rem 1rem',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-card)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
    }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--color-text)]">{label}</span>
        <Badge tone={STATUS_TONE[status]} variant="soft" size="sm">{STATUS_LABEL[status]}</Badge>
      </div>
      <span className="text-xs text-[var(--color-text-muted)]" style={{ lineHeight: 1.4 }}>{hint}</span>
    </div>
  )
}

function TakeHomeCard({ takeHome, formatNative, onSaved }: {
  takeHome: {
    liamAnnual: number; staciAnnual: number; combinedAnnual: number
    combinedMonthly: number; targetEach: number; gapEach: number; gapCombined: number
  }
  formatNative: (n: number, currency: string) => string
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [liam, setLiam] = useState(String(takeHome.liamAnnual))
  const [staci, setStaci] = useState(String(takeHome.staciAnnual))
  const [target, setTarget] = useState(String(takeHome.targetEach))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      for (const w of [
        { key: 'finance.liamTakeHomeAnnual', value: liam || '0' },
        { key: 'finance.staciTakeHomeAnnual', value: staci || '0' },
        { key: 'finance.takeHomeTargetEach', value: target || '0' },
      ]) {
        await fetch(apiPath('/api/admin/settings'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(w),
        })
      }
      showToast('Take-home saved', 'success')
      setEditing(false)
      onSaved()
    } catch {
      showToast('Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const liamPct = takeHome.targetEach > 0 ? Math.min(100, (takeHome.liamAnnual / takeHome.targetEach) * 100) : 0
  const staciPct = takeHome.targetEach > 0 ? Math.min(100, (takeHome.staciAnnual / takeHome.targetEach) * 100) : 0
  const fieldStyle: React.CSSProperties = {
    padding: '0.4375rem 0.625rem',
    fontSize: '0.875rem',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text)',
    outline: 'none',
    fontVariantNumeric: 'tabular-nums',
    width: '100%',
  }

  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Take-home (Liam + Staci)
          </div>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="text-[var(--color-brand-dark)] text-[0.6875rem] font-medium" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
              Edit
            </button>
          ) : (
            <div className="flex" style={{ gap: '0.375rem' }}>
              <TahiButton size="sm" loading={saving} onClick={() => void save()}>Save</TahiButton>
              <TahiButton size="sm" variant="secondary" onClick={() => {
                setEditing(false)
                setLiam(String(takeHome.liamAnnual))
                setStaci(String(takeHome.staciAnnual))
                setTarget(String(takeHome.targetEach))
              }}>Cancel</TahiButton>
            </div>
          )}
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1.5rem' }}>
          {editing ? (
            <>
              <div>
                <label className="text-[0.6875rem] text-[var(--color-text-muted)]">Liam annual (NZD)</label>
                <input type="number" min={0} step="1000" value={liam} onChange={e => setLiam(e.target.value)} style={fieldStyle} />
              </div>
              <div>
                <label className="text-[0.6875rem] text-[var(--color-text-muted)]">Staci annual (NZD)</label>
                <input type="number" min={0} step="1000" value={staci} onChange={e => setStaci(e.target.value)} style={fieldStyle} />
              </div>
              <div>
                <label className="text-[0.6875rem] text-[var(--color-text-muted)]">Target each (NZD)</label>
                <input type="number" min={0} step="1000" value={target} onChange={e => setTarget(e.target.value)} style={fieldStyle} />
              </div>
            </>
          ) : (
            <>
              <MetricBlock
                label="Combined annual"
                value={formatNative(takeHome.combinedAnnual, 'NZD')}
                sub={`${formatNative(takeHome.combinedMonthly, 'NZD')}/mo · target ${formatNative(takeHome.targetEach * 2, 'NZD')}`}
                accent
              />
              <MetricBlock
                label="Gap to target (combined)"
                value={takeHome.gapCombined > 0 ? formatNative(takeHome.gapCombined, 'NZD') : 'On target'}
                sub={takeHome.gapCombined > 0
                  ? `+${formatNative(takeHome.gapCombined / 12, 'NZD')}/mo would close it`
                  : 'Both at or above target'}
              />
              <div>
                <div className="text-xs text-[var(--color-text-muted)]">Per-person progress</div>
                <div className="mt-2">
                  <div className="flex items-center justify-between text-[0.6875rem] mb-0.5">
                    <span className="text-[var(--color-text-muted)]">Liam</span>
                    <span className="text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatNative(takeHome.liamAnnual, 'NZD')} / {formatNative(takeHome.targetEach, 'NZD')}
                    </span>
                  </div>
                  <div style={{ height: '0.375rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                    <div style={{ width: `${liamPct}%`, height: '100%', background: 'var(--color-brand)' }} />
                  </div>
                  <div className="flex items-center justify-between text-[0.6875rem] mb-0.5">
                    <span className="text-[var(--color-text-muted)]">Staci</span>
                    <span className="text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatNative(takeHome.staciAnnual, 'NZD')} / {formatNative(takeHome.targetEach, 'NZD')}
                    </span>
                  </div>
                  <div style={{ height: '0.375rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${staciPct}%`, height: '100%', background: 'var(--color-brand)' }} />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
        {!editing && takeHome.gapCombined > 0 && (
          <p className="text-xs text-[var(--color-text-muted)] mt-3" style={{ lineHeight: 1.5 }}>
            Closing the combined gap costs {formatNative(takeHome.gapCombined, 'NZD')}/yr — roughly the same as one part-time hire at ~$2k USD/mo. Run that comparison in the Spend impact calculator below.
          </p>
        )}
      </div>
    </Card>
  )
}

// ─── Tier 3 cards: quarter, year-end, forex ───────────────────────────

function QuarterAndProjectionCard({ quarterly, yearEnd, ytdRevenue, effectiveMonthly, onSavedTarget, formatNative }: {
  quarterly: { target: number; actual: number; projection: number; daysElapsed: number; daysTotal: number; pctElapsed: number; onPace: boolean | null }
  yearEnd: { projection: number; monthsRemaining: number }
  ytdRevenue: number
  effectiveMonthly: number
  onSavedTarget: () => void
  formatNative: (n: number, currency: string) => string
}) {
  const { showToast } = useToast()
  const [target, setTarget] = useState(String(quarterly.target || ''))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'finance.quarterlyTargetNzd', value: target || '0' }),
      })
      showToast('Quarterly target saved', 'success')
      setEditing(false)
      onSavedTarget()
    } catch {
      showToast('Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const progressPct = quarterly.target > 0 ? Math.min(100, (quarterly.actual / quarterly.target) * 100) : 0
  const pacingDelta = quarterly.target > 0 ? quarterly.projection - quarterly.target : 0
  const targetTrack: 'positive' | 'warning' | 'danger' = quarterly.target === 0
    ? 'warning'
    : quarterly.projection >= quarterly.target ? 'positive'
    : quarterly.projection >= quarterly.target * 0.7 ? 'warning'
    : 'danger'

  // Industry benchmark overlays (NZ agency medians from 2024-25 surveys).
  const benchmarks = {
    netProfitMargin: { label: 'Agency net margin', median: '15-25%' },
    ownerTakeHome: { label: 'Owner take-home', median: '$80-120k NZD' },
  }

  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Quarter + year-end
          </div>
          <Badge tone={targetTrack === 'positive' ? 'positive' : targetTrack === 'warning' ? 'warning' : 'danger'} variant="soft" size="sm">
            {quarterly.target === 0 ? 'No target set' : (targetTrack === 'positive' ? 'On track' : targetTrack === 'warning' ? 'Watch' : 'Off pace')}
          </Badge>
        </div>

        {/* Quarter progress bar */}
        <div style={{ marginBottom: '1rem' }}>
          <div className="flex items-center justify-between mb-1 text-xs">
            <span className="text-[var(--color-text)]">
              {editing ? 'Quarterly target (NZD)' : `Quarter target: ${quarterly.target > 0 ? formatNative(quarterly.target, 'NZD') : 'not set'}`}
            </span>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-[var(--color-brand-dark)] text-[0.6875rem] font-medium"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                Edit
              </button>
            )}
          </div>
          {editing ? (
            <div className="flex items-center" style={{ gap: '0.5rem' }}>
              <input
                type="number"
                min={0}
                step="1000"
                value={target}
                onChange={e => setTarget(e.target.value)}
                placeholder="e.g. 30000"
                style={{
                  flex: 1,
                  padding: '0.4375rem 0.625rem',
                  fontSize: '0.875rem',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--color-text)',
                  outline: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
              />
              <TahiButton size="sm" loading={saving} onClick={() => void save()}>Save</TahiButton>
              <TahiButton size="sm" variant="secondary" onClick={() => { setEditing(false); setTarget(String(quarterly.target || '')) }}>Cancel</TahiButton>
            </div>
          ) : (
            <>
              <div style={{ position: 'relative', height: '0.75rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: targetTrack === 'positive' ? 'var(--color-brand)' : targetTrack === 'warning' ? '#fb923c' : '#f87171' }} />
                <div style={{ position: 'absolute', left: `${quarterly.pctElapsed * 100}%`, top: 0, bottom: 0, width: '2px', background: 'var(--color-text-subtle)' }} />
              </div>
              <div className="flex items-center justify-between text-[0.6875rem] text-[var(--color-text-subtle)] mt-1">
                <span>{formatNative(quarterly.actual, 'NZD')} so far</span>
                <span>{Math.round(quarterly.pctElapsed * 100)}% of quarter elapsed</span>
              </div>
            </>
          )}
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1.5rem' }}>
          <MetricBlock
            label="Quarter projection"
            value={formatNative(quarterly.projection, 'NZD')}
            sub={quarterly.target > 0 ? `${pacingDelta >= 0 ? '+' : ''}${formatNative(pacingDelta, 'NZD')} vs target` : 'Daily run-rate × quarter days'}
            accent
          />
          <MetricBlock
            label="Year-end projection"
            value={formatNative(yearEnd.projection, 'NZD')}
            sub={`YTD ${formatNative(ytdRevenue, 'NZD')} + ${yearEnd.monthsRemaining} mo × ${formatNative(effectiveMonthly, 'NZD')}`}
          />
          <MetricBlock
            label={benchmarks.netProfitMargin.label}
            value={benchmarks.netProfitMargin.median}
            sub="NZ agency median — for comparison"
          />
          <MetricBlock
            label={benchmarks.ownerTakeHome.label}
            value={benchmarks.ownerTakeHome.median}
            sub="NZ agency owner median — for comparison"
          />
        </div>
      </div>
    </Card>
  )
}

function ForexCard({ forex, formatNative }: {
  forex: { items: Array<{ currency: string; available: number }>; nzdShare: number }
  formatNative: (n: number, currency: string) => string
}) {
  if (forex.items.length === 0) return null
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Forex exposure
          </div>
          <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
            {Math.round(forex.nzdShare * 100)}% held in NZD
          </div>
        </div>
        <div className="grid" style={{ gap: '0.375rem' }}>
          {forex.items.filter(b => Math.abs(b.available) > 0.01).map(b => {
            const totalAll = forex.items.reduce((s, x) => s + Math.max(0, x.available), 0)
            const pct = totalAll > 0 ? b.available / totalAll : 0
            return (
              <div key={b.currency} className="flex items-center" style={{ gap: '0.75rem' }}>
                <span className="text-sm text-[var(--color-text)]" style={{ minWidth: '3rem', fontVariantNumeric: 'tabular-nums' }}>{b.currency}</span>
                <div style={{ flex: 1, height: '0.5rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, pct * 100)}%`, height: '100%', background: b.currency === 'NZD' ? 'var(--color-brand)' : 'var(--color-brand-light)' }} />
                </div>
                <span className="text-xs text-[var(--color-text-muted)]" style={{ width: '7rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatNative(b.available, b.currency)}
                </span>
                <span className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ width: '3rem', textAlign: 'right' }}>
                  {Math.round(pct * 100)}%
                </span>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mt-3" style={{ lineHeight: 1.5 }}>
          Costs are denominated in NZD. {forex.nzdShare < 0.7 ? 'A NZD strengthening would dent the non-NZD pots\' purchasing power for your domestic burn.' : 'Forex exposure is low — most cash is in operating currency.'}
        </p>
      </div>
    </Card>
  )
}

// ─── Tier 2 chart cards ───────────────────────────────────────────────

function RevenueHistoryCard({ history, cur, toCur }: {
  history: Array<{ ym: string; total: number }>
  cur: string
  toCur: (n: number, fromCurrency: string) => string
}) {
  if (history.length === 0) return null
  // Inline SVG bar chart — 12 monthly bars.
  const w = 640, chartH = 120
  const maxValue = Math.max(...history.map(h => h.total), 1)
  const barWidth = (w - 20) / history.length
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
          Monthly revenue, last 12 months
        </div>
        <svg width="100%" viewBox={`0 0 ${w} ${chartH + 30}`} preserveAspectRatio="xMidYMid meet" style={{ height: '8rem' }}>
          {history.map((h, i) => {
            const barH = (h.total / maxValue) * chartH
            const x = 10 + i * barWidth
            const y = chartH - barH
            return (
              <g key={h.ym}>
                <rect x={x} y={y} width={Math.max(2, barWidth - 4)} height={barH} fill="var(--color-brand)" rx="2">
                  <title>{h.ym}: {toCur(h.total, 'NZD')}</title>
                </rect>
                <text x={x + (barWidth - 4) / 2} y={140} fontSize="9" textAnchor="middle" fill="var(--color-text-subtle)">
                  {h.ym.slice(5)}
                </text>
              </g>
            )
          })}
        </svg>
        <p className="text-xs text-[var(--color-text-muted)] mt-2">
          {history.length === 12 ? 'Full 12-month history.' : `${history.length} month${history.length === 1 ? '' : 's'} of data.`} Peak: {toCur(maxValue, cur)}.
        </p>
      </div>
    </Card>
  )
}

function CostMixCard({ costMix, formatNative }: {
  costMix: Array<{ category: string; monthly: number }>
  formatNative: (n: number, currency: string) => string
}) {
  if (costMix.length === 0) return null
  const total = costMix.reduce((s, c) => s + c.monthly, 0)
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Cost mix
          </div>
          <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
            {formatNative(total, 'NZD')}/mo total recurring
          </div>
        </div>
        <div className="grid" style={{ gap: '0.375rem' }}>
          {costMix.map(c => {
            const pct = total > 0 ? c.monthly / total : 0
            return (
              <div key={c.category} className="flex items-center" style={{ gap: '0.75rem' }}>
                <span className="text-sm text-[var(--color-text)] capitalize" style={{ minWidth: '7rem' }}>{c.category}</span>
                <div style={{ flex: 1, height: '0.625rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, pct * 100)}%`, height: '100%', background: 'var(--color-brand)' }} />
                </div>
                <span className="text-xs text-[var(--color-text-muted)]" style={{ width: '5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {formatNative(c.monthly, 'NZD')}
                </span>
                <span className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ width: '3rem', textAlign: 'right' }}>
                  {Math.round(pct * 100)}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function PipelineFunnelCard({ funnel, open, formatNative }: {
  funnel: Array<{ stage: string; position: number; isClosedWon: boolean; count: number; value: number }>
  open: { value: number; count: number }
  formatNative: (n: number, currency: string) => string
}) {
  // Drop closed-lost stages (already filtered server-side).
  const stages = funnel.filter(s => s.count > 0 || !s.isClosedWon)
  if (stages.length === 0) return null
  const maxValue = Math.max(...stages.map(s => s.value), 1)
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Pipeline → cash funnel
          </div>
          <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
            {formatNative(open.value, 'NZD')} open across {open.count} deals
          </div>
        </div>
        <div className="grid" style={{ gap: '0.375rem' }}>
          {stages.map(s => (
            <div key={s.stage} className="flex items-center" style={{ gap: '0.75rem' }}>
              <span className="text-sm text-[var(--color-text)]" style={{ minWidth: '9rem' }}>
                {s.stage}
                {s.isClosedWon && !/won/i.test(s.stage) && <span className="text-[0.625rem] text-[var(--color-brand)] ml-1">won</span>}
              </span>
              <div style={{ flex: 1, height: '0.5rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${(s.value / maxValue) * 100}%`, height: '100%', background: s.isClosedWon ? 'var(--color-brand-dark)' : 'var(--color-brand-light)' }} />
              </div>
              <span className="text-xs text-[var(--color-text-muted)]" style={{ width: '6rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {formatNative(s.value, 'NZD')}
              </span>
              <span className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ width: '2.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {s.count}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function ProductivityCard({ revenuePerHour, hours, cashConversion, timeToPay, outstandingWork, dealStats, winRateBySource, formatNative }: {
  revenuePerHour: number | null
  hours: number
  cashConversion: { invoiced90d: number; collected90d: number; ratio: number | null }
  timeToPay: { avgDays: number; minDays: number; maxDays: number; count: number }
  outstandingWork: { value: number; contracts: number }
  dealStats: { avgValue: number; avgCycleDays: number; count: number }
  winRateBySource: Array<{ source: string; won: number; lost: number; total: number; rate: number }>
  formatNative: (n: number, currency: string) => string
}) {
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
          Efficiency + sales economics
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1.5rem' }}>
          <MetricBlock
            label="Revenue per logged hour"
            value={revenuePerHour != null && hours > 0 ? formatNative(revenuePerHour, 'NZD') : '—'}
            sub={hours > 0 ? `${Math.round(hours)} hours logged last 90d` : 'Log hours to track this'}
            accent
          />
          <MetricBlock
            label="Cash conversion"
            value={cashConversion.ratio != null ? `${Math.round(cashConversion.ratio * 100)}%` : '—'}
            sub={`${formatNative(cashConversion.collected90d, 'NZD')} collected of ${formatNative(cashConversion.invoiced90d, 'NZD')} invoiced (90d)`}
          />
          <MetricBlock
            label="Time to pay"
            value={timeToPay.count > 0 ? `${Math.round(timeToPay.avgDays)}d avg` : '—'}
            sub={timeToPay.count > 0 ? `Range ${Math.round(timeToPay.minDays)} to ${Math.round(timeToPay.maxDays)} days across ${timeToPay.count} invoices` : 'No paid invoices in window'}
          />
          <MetricBlock
            label="Outstanding contracted work"
            value={formatNative(outstandingWork.value, 'NZD')}
            sub={`${outstandingWork.contracts} active retainer${outstandingWork.contracts === 1 ? '' : 's'} × months remaining`}
          />
          <MetricBlock
            label="Average deal"
            value={dealStats.count > 0 ? formatNative(dealStats.avgValue, 'NZD') : '—'}
            sub={dealStats.count > 0 ? `${dealStats.count} won in 90d · ${Math.round(dealStats.avgCycleDays)}d avg cycle` : 'No won deals in 90d'}
          />
        </div>
        {winRateBySource.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-[var(--color-text)] mb-2">Win rate by source (180d)</div>
            <div className="grid" style={{ gap: '0.375rem' }}>
              {winRateBySource.map(s => (
                <div key={s.source} className="flex items-center" style={{ gap: '0.75rem' }}>
                  <span className="text-sm text-[var(--color-text)] truncate" style={{ minWidth: '8rem' }}>{s.source}</span>
                  <div style={{ flex: 1, height: '0.375rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round(s.rate * 100)}%`, height: '100%', background: s.rate >= 0.5 ? 'var(--color-brand)' : 'var(--color-brand-light)' }} />
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)]" style={{ width: '4rem', textAlign: 'right' }}>
                    {Math.round(s.rate * 100)}%
                  </span>
                  <span className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ width: '5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {s.won}/{s.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

interface Anomaly {
  id: string
  title: string
  body: string | null
  entityId: string | null
  createdAt: string
}

function AnomaliesCard() {
  const [items, setItems] = useState<Anomaly[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const { showToast } = useToast()

  const fetchAnomalies = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(apiPath('/api/admin/financial-reports/anomalies'))
      if (r.ok) {
        const d = await r.json() as { items?: Anomaly[] }
        setItems(d.items ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAnomalies() }, [fetchAnomalies])

  async function runScan() {
    setRunning(true)
    try {
      const r = await fetch(apiPath('/api/admin/cron/finance-anomaly-scan'), { method: 'POST' })
      const d = await r.json() as { inserted?: number; findingsRaw?: number; error?: string }
      if (r.ok) {
        showToast(`Scan ran — ${d.inserted ?? 0} new ${d.inserted === 1 ? 'finding' : 'findings'} (${(d.findingsRaw ?? 0) - (d.inserted ?? 0)} deduped)`, 'success')
        await fetchAnomalies()
      } else {
        showToast(`Scan failed: ${d.error ?? 'unknown'}`, 'error')
      }
    } catch {
      showToast('Scan failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  async function resolve(id: string) {
    // Optimistic remove. Marks the notification read so it drops out of
    // the unresolved query on next fetch.
    setItems(prev => prev.filter(x => x.id !== id))
    try {
      await fetch(apiPath(`/api/admin/notifications/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      })
    } catch {
      // Restore on failure.
      await fetchAnomalies()
    }
  }

  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Anomalies — AI weekly + monthly scan
          </div>
          <TahiButton size="sm" variant="secondary" loading={running} onClick={() => void runScan()}>
            Run scan now
          </TahiButton>
        </div>
        {loading ? (
          <div className="animate-pulse" style={{ height: '4rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }} />
        ) : items.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            Nothing unusual. Sonnet runs the scan weekly + monthly; tap Run scan now to check immediately.
          </p>
        ) : (
          <div className="grid" style={{ gap: '0.5rem' }}>
            {items.map(a => (
              <div key={a.id} className="flex items-start" style={{
                gap: '0.75rem',
                padding: '0.625rem 0.875rem',
                background: 'var(--color-warning-bg, #fff7ed)',
                border: '1px solid var(--color-warning-border, #fed7aa)',
                borderRadius: 'var(--radius-md)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="text-sm font-semibold text-[var(--color-text)]">{a.title}</div>
                  {a.body && <div className="text-xs text-[var(--color-text-muted)] mt-1" style={{ lineHeight: 1.5 }}>{a.body}</div>}
                  <div className="text-[0.625rem] text-[var(--color-text-subtle)] mt-1">{fmtRelative(a.createdAt)}</div>
                </div>
                <button
                  onClick={() => void resolve(a.id)}
                  className="text-[0.6875rem] font-medium text-[var(--color-text-muted)]"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.25rem 0.5rem',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Mark resolved
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

interface SubscriptionsAuditItem {
  id: string
  name: string
  vendor: string | null
  amount: number
  currency: string
  cadence: string
  category: string
  nextDueDate: string | null
  annualisedNzd: number
  lastBankHit: { id: string; amount: number; currency: string; settledAt: string | null; counterparty: string | null } | null
  hitsInWindow: number
}

function SubscriptionsAuditCard({ formatNative }: {
  formatNative: (amount: number, currency: string) => string
}) {
  const [items, setItems] = useState<SubscriptionsAuditItem[]>([])
  const [summary, setSummary] = useState<{ count: number; monthlyTotal: number; annualTotal: number; staleCount: number } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(apiPath('/api/admin/financial-reports/subscriptions-audit'))
      .then(r => r.ok ? r.json() : null)
      .then(raw => {
        if (cancelled || !raw) return
        const d = raw as { items?: SubscriptionsAuditItem[]; summary?: { count: number; monthlyTotal: number; annualTotal: number; staleCount: number } }
        setItems(d.items ?? [])
        setSummary(d.summary ?? null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Recurring outflows
          </div>
          <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
            {summary && (
              <>
                {summary.count} commitments · {formatNative(summary.monthlyTotal, 'NZD')}/mo · {formatNative(summary.annualTotal, 'NZD')}/yr
                {summary.staleCount > 0 && <> · <span style={{ color: 'var(--color-warning, #fb923c)' }}>{summary.staleCount} with no recent bank hit</span></>}
              </>
            )}
          </div>
        </div>
        <DataTable
          rows={items}
          getRowId={(r) => r.id}
          loading={loading}
          empty={
            <div className="p-4 text-sm text-[var(--color-text-muted)]">
              No expense commitments configured yet. Add software / payroll / shareholder distributions through Settings → Commitments to start tracking outflow patterns.
            </div>
          }
          columns={[
            {
              key: 'name',
              header: 'Commitment',
              sortable: true,
              accessor: (r) => r.name,
              render: (r) => (
                <div>
                  <div className="font-medium text-[var(--color-text)]">{r.name}</div>
                  <div className="text-[0.6875rem] text-[var(--color-text-subtle)] truncate">
                    {r.vendor ?? r.category} · {r.cadence}
                  </div>
                </div>
              ),
            },
            {
              key: 'amount',
              header: 'Native',
              align: 'right',
              sortable: true,
              sortValue: (r) => r.annualisedNzd,
              render: (r) => (
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <div className="text-[var(--color-text)] font-medium">{formatNative(r.amount, r.currency)}</div>
                  <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">{formatNative(r.annualisedNzd, 'NZD')}/yr NZD</div>
                </div>
              ),
            },
            {
              key: 'lastHit',
              header: 'Last bank hit',
              align: 'right',
              sortable: true,
              sortValue: (r) => r.lastBankHit?.settledAt ?? '',
              render: (r) => r.lastBankHit ? (
                <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <div className="text-[var(--color-text-muted)] text-xs">
                    {formatNative(r.lastBankHit.amount, r.lastBankHit.currency)}
                  </div>
                  <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
                    {r.lastBankHit.settledAt ? fmtRelative(r.lastBankHit.settledAt) : '—'}
                  </div>
                </div>
              ) : (
                <Badge tone="warning" variant="soft" size="sm">No recent hit</Badge>
              ),
            },
          ]}
          defaultSort={{ key: 'amount', dir: 'desc' }}
        />
      </div>
    </Card>
  )
}

function SpendImpactCard({ startingCash, burn, revenue, reserveTarget, formatNative }: {
  startingCash: number
  burn: number
  revenue: number
  reserveTarget: number
  formatNative: (amount: number, currency: string) => string
}) {
  // Generic "if I add $X/mo for Y months on Z, what does cash look like?"
  // Works for hires, software, agency partners, ad spend, any recurring
  // commitment. The chart projects 12 months out.
  const [label, setLabel] = useState('Part-time dev hire')
  const [monthlySpend, setMonthlySpend] = useState('3400')
  const [durationMonths, setDurationMonths] = useState('12')
  const [oneOff, setOneOff] = useState('0')

  const spend = Math.max(0, parseFloat(monthlySpend) || 0)
  const duration = Math.max(1, Math.min(60, parseInt(durationMonths, 10) || 12))
  const upfront = Math.max(0, parseFloat(oneOff) || 0)

  // Net burn/month under this scenario. Negative = cash growing.
  const netBurnPerMonth = burn + spend - revenue
  // 12-month projection points. Always show 12 even if the spend duration
  // is shorter — see what happens after the cost goes away.
  const horizon = 12
  const projection: Array<{ month: number; cash: number; spendActive: boolean; belowTarget: boolean }> = []
  let cash = startingCash - upfront
  for (let m = 1; m <= horizon; m++) {
    const spendActive = m <= duration
    cash += revenue - burn - (spendActive ? spend : 0)
    projection.push({ month: m, cash, spendActive, belowTarget: cash < reserveTarget })
  }
  const cashAt12 = projection[horizon - 1].cash
  const lowest = projection.reduce((min, p) => p.cash < min.cash ? p : min, projection[0])
  // First month the cash dips below the reserve target.
  const targetBreach = projection.find(p => p.belowTarget)
  // First month it would go negative.
  const zeroBreach = projection.find(p => p.cash < 0)

  let verdict: { tone: 'positive' | 'warning' | 'danger'; label: string; detail: string }
  if (zeroBreach) {
    verdict = {
      tone: 'danger',
      label: 'Not affordable',
      detail: `Cash hits $0 around month ${zeroBreach.month}. Drop the spend, raise revenue, or extend duration carefully.`,
    }
  } else if (targetBreach) {
    verdict = {
      tone: 'warning',
      label: 'Tight',
      detail: `Cash dips below your ${formatNative(reserveTarget, 'NZD')} reserve target around month ${targetBreach.month}. Doable if you trust the revenue line.`,
    }
  } else {
    verdict = {
      tone: 'positive',
      label: 'Affordable',
      detail: `Stays above reserve target the whole 12 months. Lowest point: ${formatNative(lowest.cash, 'NZD')} at month ${lowest.month}.`,
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.4375rem 0.625rem',
    fontSize: '0.875rem',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text)',
    outline: 'none',
    fontVariantNumeric: 'tabular-nums',
  }

  // Tiny inline sparkline: 12-point line, red below target, brand-green above.
  const w = 320, h = 60
  const maxCash = Math.max(startingCash, ...projection.map(p => p.cash))
  const minCash = Math.min(0, ...projection.map(p => p.cash))
  const range = Math.max(1, maxCash - minCash)
  const points = [{ cash: startingCash }, ...projection].map((p, i) => {
    const x = (i / horizon) * w
    const y = h - ((p.cash - minCash) / range) * h
    return { x, y }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const targetY = h - ((reserveTarget - minCash) / range) * h

  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Spend impact calculator
          </div>
          <Badge tone={verdict.tone === 'positive' ? 'positive' : verdict.tone === 'warning' ? 'warning' : 'danger'} variant="soft" size="sm">
            {verdict.label}
          </Badge>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>What&apos;s the spend?</label>
            <input value={label} onChange={e => setLabel(e.target.value)} style={inputStyle} placeholder="Dev hire / SaaS / ad spend" />
          </div>
          <div>
            <label style={labelStyle}>Monthly cost (NZD)</label>
            <input type="number" min={0} step="100" value={monthlySpend} onChange={e => setMonthlySpend(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Duration (months)</label>
            <input type="number" min={1} max={60} step="1" value={durationMonths} onChange={e => setDurationMonths(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>One-off cost (NZD)</label>
            <input type="number" min={0} step="100" value={oneOff} onChange={e => setOneOff(e.target.value)} style={inputStyle} placeholder="Setup / equipment" />
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: '4rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
            {/* Reserve-target line */}
            {targetY >= 0 && targetY <= h && (
              <line x1="0" y1={targetY} x2={w} y2={targetY} stroke="var(--color-warning, #fb923c)" strokeWidth="1" strokeDasharray="3,3" />
            )}
            {/* Zero-line (visible only if cash goes negative) */}
            {minCash < 0 && (
              <line x1="0" y1={h - ((0 - minCash) / range) * h} x2={w} y2={h - ((0 - minCash) / range) * h} stroke="var(--color-danger, #f87171)" strokeWidth="1" />
            )}
            {/* Projection line */}
            <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1rem' }}>
          <MetricBlock
            label={`Cash at month 12`}
            value={formatNative(cashAt12, 'NZD')}
            sub={`Net burn ${netBurnPerMonth > 0 ? formatNative(netBurnPerMonth, 'NZD') + '/mo' : 'cash positive'} during spend`}
            accent
          />
          <MetricBlock
            label="Total cost of this spend"
            value={formatNative(upfront + spend * duration, 'NZD')}
            sub={`${formatNative(upfront, 'NZD')} upfront + ${duration}×${formatNative(spend, 'NZD')}/mo`}
          />
          <MetricBlock
            label="Lowest cash point"
            value={formatNative(lowest.cash, 'NZD')}
            sub={`Month ${lowest.month}`}
          />
        </div>
        <p className="text-xs text-[var(--color-text-muted)]" style={{ marginTop: '0.75rem', lineHeight: 1.5 }}>
          {verdict.detail} Assumes revenue stays flat at {formatNative(revenue, 'NZD')}/mo and existing burn at {formatNative(burn, 'NZD')}/mo — adjust either in the reserve target card above for a different projection. <em>{label}</em>: this scenario.
        </p>
      </div>
    </Card>
  )
}

function ReserveTargetCard({ config, formatNative, onSaved }: {
  config: {
    targetMonths: number
    monthlyBurnNzd: number | null
    lastYearTaxOwed: number
    targetAmount: number
    monthsOfRunway: number | null
  }
  formatNative: (amount: number, currency: string) => string
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [months, setMonths] = useState(String(config.targetMonths))
  const [burn, setBurn] = useState(config.monthlyBurnNzd != null ? String(config.monthlyBurnNzd) : '')
  const [tax, setTax] = useState(String(config.lastYearTaxOwed || ''))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const writes: Array<{ key: string; value: string }> = [
        { key: 'finance.reserveTargetMonths', value: months || '4' },
        { key: 'finance.monthlyBurnNzd', value: burn || '0' },
        { key: 'finance.lastYearTaxOwed', value: tax || '0' },
      ]
      for (const w of writes) {
        await fetch(apiPath('/api/admin/settings'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(w),
        })
      }
      showToast('Reserve target saved', 'success')
      setDirty(false)
      onSaved()
    } catch {
      showToast('Could not save', 'error')
    } finally {
      setSaving(false)
    }
  }

  const labelStyle: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.25rem' }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.4375rem 0.625rem',
    fontSize: '0.875rem',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text)',
    outline: 'none',
    fontVariantNumeric: 'tabular-nums',
  }

  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Reserve target
          </div>
          <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
            Target = months × burn + last-year tax. Drives the Cash runway traffic light.
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label style={labelStyle}>Months of runway target</label>
            <input
              type="number"
              min={1}
              max={24}
              step="0.5"
              value={months}
              onChange={e => { setMonths(e.target.value); setDirty(true) }}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Monthly burn (NZD)</label>
            <input
              type="number"
              min={0}
              step="100"
              value={burn}
              onChange={e => { setBurn(e.target.value); setDirty(true) }}
              placeholder="e.g. 8000"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Last year tax owed (NZD)</label>
            <input
              type="number"
              min={0}
              step="100"
              value={tax}
              onChange={e => { setTax(e.target.value); setDirty(true) }}
              placeholder="e.g. 20000"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Target amount</label>
            <div style={{ ...inputStyle, border: 'none', padding: '0.4375rem 0', fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-brand-dark)' }}>
              {formatNative(config.targetAmount, 'NZD')}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="text-xs text-[var(--color-text-muted)]" style={{ lineHeight: 1.5 }}>
            {config.monthsOfRunway != null
              ? `Current runway: ${config.monthsOfRunway.toFixed(1)} months. ${config.monthsOfRunway >= config.targetMonths ? 'On target.' : config.monthsOfRunway >= config.targetMonths / 2 ? 'Below target, watch closely.' : 'Below half target — defer discretionary spend.'}`
              : 'Set monthly burn to start tracking runway.'}
          </div>
          <TahiButton onClick={() => void save()} loading={saving} disabled={!dirty} size="sm">
            Save reserve target
          </TahiButton>
        </div>
      </div>
    </Card>
  )
}

function ArBucket({ label, amount, cur, toCur, tone }: {
  label: string
  amount: number
  cur: string
  toCur: (amount: number, fromCurrency: string) => string
  tone: 'positive' | 'warning' | 'danger'
}) {
  // Hex literals because tone tokens vary by surface; want flat colour bars.
  const accent = tone === 'positive' ? 'var(--color-brand)'
    : tone === 'warning' ? '#fb923c'
    : '#f87171'
  const isEmpty = amount < 0.01
  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="text-base font-semibold mt-0.5" style={{
        color: isEmpty ? 'var(--color-text-subtle)' : 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {toCur(amount, cur)}
      </div>
      <div style={{
        height: '0.25rem',
        marginTop: '0.375rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: '999px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: isEmpty ? '0%' : '100%',
          height: '100%',
          background: isEmpty ? 'transparent' : accent,
        }} />
      </div>
    </div>
  )
}

function MetricBlock({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div style={{
        fontSize: accent ? '1.75rem' : '1.375rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: accent ? 'var(--color-brand-dark)' : 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
        marginTop: '0.125rem',
      }}>
        {value}
      </div>
      {sub && (
        <div className="text-[0.6875rem] text-[var(--color-text-subtle)] mt-0.5" style={{ lineHeight: 1.4 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

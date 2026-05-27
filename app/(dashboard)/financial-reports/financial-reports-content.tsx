'use client'

/**
 * /financial-reports. The finance dashboard Liam opens to make hire,
 * spend, and tax decisions.
 *
 * Structure:
 *  - Hero band: cash and revenue at a glance.
 *  - Sectioned scroll: Cash, Revenue, MRR, Sales, Outflows, Tax,
 *    Take-home, Planning. Jump nav sticky on scroll.
 *  - Every NZD aggregate respects the global currency switcher via
 *    the `formatNative` shim. Native bank balances stay native.
 *
 * Design rules:
 *  - No icons on metric tiles (type leads; icons reserved for actions).
 *  - No side-only borders. Borders are all-sides or absent.
 *  - rem units only. No raw px.
 *  - Numbers in tabular-nums and currency-aligned columns.
 *  - Source-of-truth chips on bank rows (Stripe, Xero, Airwallex).
 */

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Play, Plus, Pencil, Trash2 } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable } from '@/components/tahi/data-table'
import { DonutChart, LineChart, BarChart } from '@/components/tahi/chart'
import { CHART } from '@/lib/chart-colors'
import { SectionTabs } from '@/components/tahi/section-tabs'
import { useToast } from '@/components/tahi/toast'
import { SlideOver } from '@/components/tahi/slide-over'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { Input, Select, Textarea } from '@/components/tahi/input'
import { apiPath } from '@/lib/api'
import { useDisplayCurrency } from '@/lib/display-currency-context'
import { convertToNzd } from '@/lib/currency'

interface SummaryResponse {
  asOf: string
  /** Latest updatedAt across airwallex_balances. Null if Airwallex has
   *  never synced. Surfaced on the cash hero as "Synced X ago" + the
   *  Watchlist strip when older than 7 days. */
  bankSyncedAt: string | null
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
    autoBurnNzd: number
    lastYearTaxOwed: number
    targetAmount: number
    targetBurn: number
    monthsOfRunway: number | null
    totalCashNzd: number
    unreservedTaxNzd: number
    taxAdjustedCashNzd: number
    grossRunwayMonths: number | null
    netRunwayMonths: number | null
    netMonthlyBurnNzd: number
    monthlySurplusNzd: number
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

// Filters out balance rows with zero available cash. Liam doesn't want
// the row spam. Airwallex returns ~50 currencies regardless of whether
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
  const { displayCurrency, toDisplay, format: formatDisplay, formatNative: formatNativeRaw, exchangeRates, ratesLoaded } = useDisplayCurrency()
  // Smart formatter that respects the nav currency switcher:
  //   - 'NZD' headline aggregates → convert via formatDisplay so the user sees
  //     their chosen currency (USD, GBP, etc.) on burn, MRR, runway, etc.
  //   - Genuinely native amounts (bank balances per currency, invoice billed
  //     in GBP) → stay native via the raw formatter from context.
  // This single shim is what makes every card on this page respect the
  // switcher. Children take this version as the `formatNative` prop.
  const formatNative = useCallback((amount: number, currency: string): string => {
    if (currency === 'NZD') return formatDisplay(amount)
    return formatNativeRaw(amount, currency)
  }, [formatDisplay, formatNativeRaw])
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
        showToast(`MRR backfilled. ${j.updated ?? 0} clients updated, ${j.unchanged ?? 0} unchanged`, 'success')
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
        showToast(`Airwallex synced. ${j.balances ?? 0} balances, ${j.transactions?.fetched ?? 0} txns`, 'success')
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
  // toCur(amount, fromCurrency). Convert source-currency amount to
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
  // zero balance. Airwallex returns ~50 currencies regardless of
  // funding state.
  const fundedBanks = data.bankBalances.filter(isFunded)

  // ── Hero numbers (pre-computed so the JSX stays readable) ────────────
  // Total cash in the source/primary currency (typically NZD). Hero card
  // surfaces this as the headline number, converted to the user's chosen
  // display currency via formatDisplay.
  const totalCashDisplay = toCurNumber(data.reserveConfig.totalCashNzd, 'NZD')
  // % of reserve target reached. Drives the mini donut on the cash card.
  const reservePct = data.reserveConfig.targetAmount > 0
    ? Math.min(100, Math.round((data.reserveConfig.totalCashNzd / data.reserveConfig.targetAmount) * 100))
    : 0
  // Donut tone tracks the reserve traffic-light: green at/above target,
  // amber when partway, red when far below.
  const reserveTone: 'positive' | 'warning' | 'danger' = reservePct >= 100 ? 'positive'
    : reservePct >= 50 ? 'warning'
    : 'danger'
  // Revenue sparkline source data. Falls back gracefully if the API
  // hasn't shipped a monthly history yet.
  const revenueSpark = data.monthlyRevenueHistory.map(h => ({
    label: h.ym.slice(5),
    value: h.total,
  }))
  // Client-concentration risk hint. Surfaces "high risk" when the top
  // single client is over half of named MRR.
  const concentrationRisk = data.clientConcentration.topClientShare
  const concentrationHint = concentrationRisk >= 0.5
    ? { tone: 'warning' as const, text: `High concentration. Your top client is ${Math.round(concentrationRisk * 100)}% of MRR.` }
    : concentrationRisk >= 0.33
      ? { tone: 'warning' as const, text: `Watch. Top client is ${Math.round(concentrationRisk * 100)}% of MRR.` }
      : { tone: 'positive' as const, text: `Healthy spread. No single client is more than ${Math.round(concentrationRisk * 100)}% of MRR.` }

  return (
    <div className="page-flush-top" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title="Financial reports"
        subtitle={`Snapshot ${fmtRelative(data.asOf)}. Stripe, Xero and Airwallex reconciled.`}
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

      {/* ── Hero band: Where you stand right now ─────────────────────
          Two side-by-side FeatureCards. Left summarises cash and the
          two runway flavours; right summarises the revenue engine. */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--space-4)' }}>
        <HeroCashCard
          totalCashDisplay={totalCashDisplay}
          cur={cur}
          reserveConfig={data.reserveConfig}
          reservePct={reservePct}
          reserveTone={reserveTone}
          formatDisplay={formatDisplay}
          formatNative={formatNative}
          statusCash={data.status.cash}
          bankSyncedAt={data.bankSyncedAt}
          onRefreshBank={() => void syncAirwallex()}
          syncing={syncing}
        />
        <HeroRevenueCard
          mrrCombined={toCurNumber(data.mrr.combined, data.primaryCurrency)}
          mrrLabel={data.mrr.configured ? formatDisplay(toCurNumber(data.mrr.combined, data.primaryCurrency)) : 'Not set'}
          arrLabel={data.mrr.configured ? toCur(data.arr, data.primaryCurrency) : 'Not set'}
          ytdLabel={toCur(data.ytdRevenue, data.primaryCurrency)}
          newMrrLabel={toCur(data.newMrrThisMonth.amount, data.primaryCurrency)}
          retainerCount={data.mrr.retainerClientCount}
          spark={revenueSpark}
          cur={cur}
          statusMrr={data.status.mrr}
        />
      </div>

      {/* ── Watchlist strip ──────────────────────────────────────────
          Only renders when at least one alert applies. Aggregates the
          urgent "do something" signals from across the page so Liam
          doesn't have to scroll to find the red blinking lights. */}
      <WatchlistStrip data={data} toCur={toCur} />

      {/* ── Section jump nav ─────────────────────────────────────── */}
      <SectionTabs items={FINANCE_SECTIONS} />

      {/* ── Cash section ─────────────────────────────────────────── */}
      <div id="cash" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="Cash" hint="Live bank balances and reserve pots." />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(24rem, 1fr))', gap: 'var(--space-4)', alignItems: 'start' }}>
          {/* Bank balances table */}
          <Card>
            <div className="p-4 sm:p-6">
              <SubSectionHeader title="Bank balances" meta={`${fundedBanks.length} funded ${fundedBanks.length === 1 ? 'account' : 'accounts'}`} />
              {fundedBanks.length === 0 ? (
                <EmptyHint>No funded bank accounts. Sync Airwallex or Xero to populate.</EmptyHint>
              ) : (
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', minWidth: '20rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <TableTh align="left">Account</TableTh>
                        <TableTh align="right">Native</TableTh>
                        <TableTh align="right">{`= ${cur}`}</TableTh>
                        <TableTh align="right">Source</TableTh>
                      </tr>
                    </thead>
                    <tbody>
                      {fundedBanks.map(b => (
                        <tr key={b.currency}>
                          <td className="text-sm font-medium text-[var(--color-text)]" style={{ padding: '0.5rem 0.5rem' }}>{b.currency}</td>
                          <td className="text-sm text-[var(--color-text)]" style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNativeRaw(b.available, b.currency)}</td>
                          <td className="text-sm text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b.currency === cur ? 'native' : toCur(b.available, b.currency)}</td>
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
                          -{toCur(data.reserves.total, data.primaryCurrency)}
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
          </Card>

          {/* Reserve pots (only renders when configured) */}
          <Card>
            <div className="p-4 sm:p-6">
              <SubSectionHeader title="Reserve pots" meta={`${toCur(data.reserves.total, data.primaryCurrency)} set aside`} />
              {data.reserves.items.length === 0 ? (
                <EmptyHint>No reserve pots configured. Add one in Settings to start accruing tax or float reserves.</EmptyHint>
              ) : (
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
                            {formatNativeRaw(r.accruedAmount, r.currency)}
                            {r.targetAmount ? <span className="text-xs text-[var(--color-text-subtle)] font-normal"> / {formatNativeRaw(r.targetAmount, r.currency)}</span> : null}
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
              )}
            </div>
          </Card>
        </div>

        {/* AI anomaly findings sit just below the cash split, since most
            findings are about unusual cash movement. */}
        <AnomaliesCard />
      </div>

      {/* ── Revenue section ─────────────────────────────────────── */}
      <div id="revenue" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="Revenue" hint="Effective monthly, quarterly target and year-on-year." />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))', gap: 'var(--space-4)', alignItems: 'start' }}>
          <QuarterAndProjectionCard
            quarterly={data.quarterly}
            yearEnd={data.yearEnd}
            ytdRevenue={data.ytdRevenue}
            effectiveMonthly={data.effectiveMonthlyRevenue}
            onSavedTarget={() => void fetchSummary()}
            formatNative={formatNative}
          />
          <YoyCard
            yoy={data.yoy}
            history={data.monthlyRevenueHistory}
            cur={data.primaryCurrency}
            toCur={toCur}
          />
        </div>
        <RevenueHistoryCard history={data.monthlyRevenueHistory} cur={data.primaryCurrency} toCur={toCur} />
      </div>

      {/* ── MRR section ─────────────────────────────────────────── */}
      <div id="mrr" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="MRR" hint="Per-client breakdown and concentration risk." />
        <Card>
          <div className="p-4 sm:p-6">
            <SubSectionHeader
              title={`MRR by client (${data.mrr.breakdown.length})`}
              meta="Native amount times FX equals NZD contribution. Edit per-client on /clients."
            />
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
                  header: `= ${data.primaryCurrency}`,
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
                    <ShareCell pct={r.share} />
                  ),
                },
              ]}
              defaultSort={{ key: 'nzd', dir: 'desc' }}
            />
          </div>
        </Card>

        <Card>
          <div className="p-4 sm:p-6">
            <SubSectionHeader
              title="Client concentration"
              meta={data.clientConcentration.totalNamedMrr > 0
                ? 'Risk if your top client churns tomorrow.'
                : 'No client MRR configured yet.'}
            />
            {data.clientConcentration.totalNamedMrr === 0 ? (
              <EmptyHint>Set custom_mrr on your active clients to see concentration risk.</EmptyHint>
            ) : (
              <>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '1.5rem', alignItems: 'center', minWidth: 0 }}>
                  <div className="flex justify-center" style={{ minWidth: 0 }}>
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
                  <div className="grid" style={{ gap: '0.5rem', minWidth: 0 }}>
                    <div className="flex items-baseline justify-between text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ marginBottom: '0.25rem' }}>
                      <span>If your top 3 leave</span>
                      <span style={{ color: data.clientConcentration.top3Share > 0.7 ? 'var(--color-warning)' : 'var(--color-text)', fontWeight: 600 }}>
                        {Math.round(data.clientConcentration.top3Share * 100)}% gone
                      </span>
                    </div>
                    {data.clientConcentration.top.map((c, i) => {
                      const pct = data.clientConcentration.totalNamedMrr > 0 ? c.mrr / data.clientConcentration.totalNamedMrr : 0
                      const dot = CHART.categorical[i % CHART.categorical.length]
                      return (
                        <div key={c.name} className="flex items-center" style={{ gap: '0.625rem', minWidth: 0 }}>
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
                <ConcentrationHint hint={concentrationHint} />
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ── Sales section ───────────────────────────────────────── */}
      <div id="sales" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="Sales" hint="Pipeline funnel, recent deals and AR aging." />
        <SalesVelocityCard salesVelocity={data.salesVelocity} primaryCurrency={data.primaryCurrency} toCur={toCur} />
        <PipelineFunnelCard funnel={data.pipelineFunnel} open={data.pipelineOpen} formatNative={formatNative} />
        {(data.recentActivity.invoices.length > 0 || data.recentActivity.deals.length > 0) && (
          <Card>
            <div className="p-4 sm:p-6">
              <SubSectionHeader title="Recent activity" meta="Last 5 paid invoices and last 5 deals signed." />
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', gap: '1.5rem' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="text-xs font-semibold text-[var(--color-text)] mb-2">Paid invoices</div>
                  {data.recentActivity.invoices.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-subtle)] italic">No paid invoices yet.</p>
                  ) : (
                    <div className="grid" style={{ gap: '0.375rem', minWidth: 0 }}>
                      {data.recentActivity.invoices.map(inv => (
                        <ActivityRow
                          key={inv.id}
                          title={inv.orgName ?? '(unattributed)'}
                          amountLabel={toCur(inv.totalUsd, data.primaryCurrency)}
                          dateLabel={inv.paidAt ? fmtRelative(inv.paidAt) : ''}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="text-xs font-semibold text-[var(--color-text)] mb-2">Deals signed</div>
                  {data.recentActivity.deals.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-subtle)] italic">No deals closed yet.</p>
                  ) : (
                    <div className="grid" style={{ gap: '0.375rem', minWidth: 0 }}>
                      {data.recentActivity.deals.map(deal => (
                        <ActivityRow
                          key={deal.id}
                          title={`${deal.title}${deal.orgName ? ` · ${deal.orgName}` : ''}`}
                          amountLabel={toCur(deal.value, data.primaryCurrency)}
                          dateLabel={deal.closedAt ? fmtRelative(deal.closedAt) : ''}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* AR aging */}
        <Card>
          <div className="p-4 sm:p-6">
            <SubSectionHeader title="AR aging" meta={`${toCur(data.outstandingAr, data.primaryCurrency)} outstanding · ${data.overdueCount} overdue`} />
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '1rem' }}>
              <ArBucket label="Current" amount={data.arAging.current} cur={data.primaryCurrency} toCur={toCur} tone="positive" />
              <ArBucket label="1 to 30 days" amount={data.arAging.days30} cur={data.primaryCurrency} toCur={toCur} tone="warning" />
              <ArBucket label="31 to 60 days" amount={data.arAging.days60} cur={data.primaryCurrency} toCur={toCur} tone="warning" />
              <ArBucket label="61 to 90 days" amount={data.arAging.days90} cur={data.primaryCurrency} toCur={toCur} tone="danger" />
              <ArBucket label="90+ days" amount={data.arAging.days90plus} cur={data.primaryCurrency} toCur={toCur} tone="danger" />
            </div>
          </div>
        </Card>
      </div>

      {/* ── Outflows section ────────────────────────────────────── */}
      <div id="outflows" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="Outflows" hint="Recurring spend, category mix and essential vs discretionary." />
        <RecurringOutflowsCard formatNative={formatNative} />
        <CostMixCard
          costMix={data.costMix}
          spendSplit={data.spendSplit}
          formatNative={formatNative}
        />
        <ForexCard forex={data.forex} formatNative={formatNative} />
      </div>

      {/* ── Tax section ─────────────────────────────────────────── */}
      <div id="tax" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="Tax" hint="Reserve progress versus what you owe right now." />
        <TaxSummaryCard taxes={data.taxes} reserves={data.reserves} primaryCurrency={data.primaryCurrency} toCur={toCur} formatNative={formatNative} />
      </div>

      {/* ── Take-home section ───────────────────────────────────── */}
      <div id="takehome" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="Take-home" hint="Liam and Staci progress toward each annual target." />
        <TakeHomeCard
          takeHome={data.takeHome}
          formatNative={formatNative}
          onSaved={() => void fetchSummary()}
        />
      </div>

      {/* ── Footer planning tools ───────────────────────────────── */}
      <div id="planning" className="scroll-mt-20" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeader title="Planning" hint="Reserve target and spend impact what-ifs." />
        <ReserveTargetCard
          config={data.reserveConfig}
          formatNative={formatNative}
          onSaved={() => void fetchSummary()}
        />
        <SpendImpactCard
          startingCash={data.disposableCash}
          burn={data.reserveConfig.targetBurn}
          revenue={data.effectiveMonthlyRevenue}
          reserveTarget={data.reserveConfig.targetAmount}
          formatNative={formatNative}
        />
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
    </div>
  )
}

// ─── Section anchors (jump nav) ───────────────────────────────────────

const FINANCE_SECTIONS = [
  { id: 'cash',     label: 'Cash' },
  { id: 'revenue',  label: 'Revenue' },
  { id: 'mrr',      label: 'MRR' },
  { id: 'sales',    label: 'Sales' },
  { id: 'outflows', label: 'Outflows' },
  { id: 'tax',      label: 'Tax' },
  { id: 'takehome', label: 'Take-home' },
  { id: 'planning', label: 'Planning' },
] as const

// ─── Layout helpers ───────────────────────────────────────────────────

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <h2 style={{
        margin: 0,
        fontSize: 'var(--text-lg)',
        fontWeight: 600,
        letterSpacing: '-0.01em',
        color: 'var(--color-text)',
      }}>
        {title}
      </h2>
      {hint && (
        <span className="text-xs text-[var(--color-text-muted)]" style={{ fontWeight: 500 }}>
          {hint}
        </span>
      )}
    </div>
  )
}

function SubSectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between" style={{ marginBottom: '0.875rem', flexWrap: 'wrap', gap: '0.5rem' }}>
      <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
        {title}
      </div>
      {meta && (
        <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
          {meta}
        </div>
      )}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-[var(--color-text-muted)]" style={{ lineHeight: 1.55 }}>
      {children}
    </p>
  )
}

function TableTh({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th
      className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider"
      style={{
        textAlign: align,
        padding: '0.4375rem 0.5rem',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      {children}
    </th>
  )
}

function ShareCell({ pct }: { pct: number }) {
  const display = Math.round(pct * 100)
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
      <div style={{
        width: '3.5rem',
        height: '0.3125rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: '999px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${Math.min(100, display)}%`,
          height: '100%',
          background: 'var(--color-brand)',
        }} />
      </div>
      <span className="text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums', minWidth: '2.5rem', textAlign: 'right' }}>
        {display}%
      </span>
    </div>
  )
}

function ActivityRow({ title, amountLabel, dateLabel }: { title: string; amountLabel: string; dateLabel: string }) {
  // minWidth: 0 on the outer flex container lets it shrink to its grid
  // cell. Without it, a long deal title pushes the whole row wider than
  // the parent and the page horizontal-scrolls on mobile.
  return (
    <div
      className="flex items-center justify-between text-xs"
      style={{ gap: '0.5rem', padding: '0.4375rem 0.625rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', minWidth: 0 }}
    >
      <span
        className="text-[var(--color-text)]"
        style={{
          minWidth: 0,
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={title}
      >
        {title}
      </span>
      <span className="text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, fontWeight: 500 }}>
        {amountLabel}
      </span>
      {dateLabel && (
        <span className="text-[var(--color-text-subtle)] text-[0.6875rem]" style={{ flexShrink: 0 }}>
          {dateLabel}
        </span>
      )}
    </div>
  )
}

function ConcentrationHint({ hint }: { hint: { tone: 'positive' | 'warning' | 'danger'; text: string } }) {
  const bg = hint.tone === 'positive' ? 'var(--color-brand-50)'
    : hint.tone === 'warning' ? '#fff7ed'
    : '#fef2f2'
  const fg = hint.tone === 'positive' ? 'var(--color-brand-dark)'
    : hint.tone === 'warning' ? '#9a3412'
    : '#991b1b'
  return (
    <div
      style={{
        marginTop: 'var(--space-4)',
        padding: '0.625rem 0.875rem',
        background: bg,
        color: fg,
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        lineHeight: 1.5,
      }}
    >
      {hint.text}
    </div>
  )
}

// ─── Watchlist strip ──────────────────────────────────────────────────
//
// Aggregates the urgent finance-page alerts into one horizontal strip.
// Only renders when at least one alert qualifies. Cap at 4 cards so the
// strip never overflows past one row on desktop (h-scroll on mobile).
// Warning chips outrank info chips when we're at the cap.

type WatchlistTone = 'warning' | 'info'

interface WatchlistChip {
  id: string
  tone: WatchlistTone
  label: string
  /** Section id to scroll to on click. */
  target: string | null
}

function buildWatchlist(data: SummaryResponse, toCur: (amount: number, fromCurrency: string) => string): WatchlistChip[] {
  const chips: WatchlistChip[] = []
  const primary = data.primaryCurrency

  // Overdue AR (31d+). data.arAging exposes day-bucketed totals in primary
  // currency. We collapse 31-60, 61-90, and 90+ into one "overdue" sum.
  const overdueAmount = (data.arAging.days30 ?? 0) + (data.arAging.days60 ?? 0) + (data.arAging.days90 ?? 0) + (data.arAging.days90plus ?? 0)
  const overdueCount = data.overdueCount ?? 0
  if (overdueAmount > 0 || overdueCount > 0) {
    const noun = overdueCount === 1 ? 'overdue invoice' : 'overdue invoices'
    chips.push({
      id: 'ar-overdue',
      tone: 'warning',
      label: overdueCount > 0
        ? `${overdueCount} ${noun} · ${toCur(overdueAmount, primary)}`
        : `${toCur(overdueAmount, primary)} overdue invoices`,
      target: 'sales',
    })
  }

  // No deals signed in 60 days = sales engine stalled.
  if (data.salesVelocity.last60Days.count === 0) {
    chips.push({
      id: 'sales-stalled',
      tone: 'warning',
      label: 'Sales engine stalled. No deals in 60 days.',
      target: 'sales',
    })
  }

  // Unreserved corp tax. reserveConfig.unreservedTaxNzd is YTD owed minus
  // what's already in a tax reserve pot. > 0 means we owe money we haven't
  // ringfenced yet.
  if (data.reserveConfig.unreservedTaxNzd > 0) {
    chips.push({
      id: 'tax-unreserved',
      tone: 'warning',
      label: `${toCur(data.reserveConfig.unreservedTaxNzd, 'NZD')} tax owed but not reserved`,
      target: 'tax',
    })
  }

  // High client concentration. >50% of named MRR sitting with one client
  // is a serious risk signal.
  if (data.clientConcentration.topClientShare > 0.5) {
    chips.push({
      id: 'concentration-high',
      tone: 'info',
      label: `Top client is ${Math.round(data.clientConcentration.topClientShare * 100)}% of MRR`,
      target: 'mrr',
    })
  }

  // Bank sync stale. > 7 days = info chip prompting a manual refresh.
  if (data.bankSyncedAt) {
    const ageDays = (Date.now() - new Date(data.bankSyncedAt).getTime()) / 86_400_000
    if (ageDays > 7) {
      chips.push({
        id: 'bank-stale',
        tone: 'info',
        label: `Bank balances ${Math.floor(ageDays)} days old. Refresh to update.`,
        target: 'cash',
      })
    }
  }

  // Cap at 4. Warnings outrank info when trimming.
  const warningsFirst = [...chips].sort((a, b) => {
    if (a.tone === b.tone) return 0
    return a.tone === 'warning' ? -1 : 1
  })
  return warningsFirst.slice(0, 4)
}

function WatchlistStrip({ data, toCur }: {
  data: SummaryResponse
  toCur: (amount: number, fromCurrency: string) => string
}) {
  const chips = buildWatchlist(data, toCur)
  if (chips.length === 0) return null

  function jumpTo(id: string | null) {
    if (!id) return
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div
      className="h-scroll scrollbar-hide"
      role="region"
      aria-label="Finance watchlist"
      style={{ minWidth: 0 }}
    >
      <div
        className="flex"
        style={{ gap: 'var(--space-2)' }}
      >
        {chips.map(chip => {
          const tint = chip.tone === 'warning'
            ? { bg: 'var(--color-warning-bg)', text: 'var(--color-warning)', border: 'var(--color-warning)' }
            : { bg: 'var(--color-info-bg)', text: 'var(--color-info)', border: 'var(--color-info)' }
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => jumpTo(chip.target)}
              className="flex-shrink-0"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                background: tint.bg,
                border: `1px solid ${tint.border}`,
                borderRadius: 'var(--radius-md)',
                color: tint.text,
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                cursor: chip.target ? 'pointer' : 'default',
                transition: 'transform 150ms ease, box-shadow 150ms ease',
                minHeight: '2.75rem',
                textAlign: 'left',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => {
                if (!chip.target) return
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '0.5rem',
                  height: '0.5rem',
                  borderRadius: '999px',
                  background: tint.text,
                  flexShrink: 0,
                }}
              />
              {chip.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Hero cards ────────────────────────────────────────────────────────

function HeroCashCard({
  totalCashDisplay,
  cur,
  reserveConfig,
  reservePct,
  reserveTone,
  formatDisplay,
  formatNative,
  statusCash,
  bankSyncedAt,
  onRefreshBank,
  syncing,
}: {
  totalCashDisplay: number
  cur: string
  reserveConfig: SummaryResponse['reserveConfig']
  reservePct: number
  reserveTone: 'positive' | 'warning' | 'danger'
  formatDisplay: (n: number) => string
  formatNative: (n: number, currency: string) => string
  statusCash: 'green' | 'amber' | 'red'
  bankSyncedAt: string | null
  onRefreshBank: () => void
  syncing: boolean
}) {
  const grossRunway = reserveConfig.grossRunwayMonths
  const netRunway = reserveConfig.netRunwayMonths
  const surplus = reserveConfig.monthlySurplusNzd

  // Bottom block shows the two runway flavours side by side. "Profitable"
  // is a soft replacement for any net-runway value when we are cash positive.
  const grossLabel = grossRunway != null ? `${grossRunway.toFixed(1)} mo` : 'n/a'
  const netLabel = netRunway == null
    ? (surplus > 0 ? `+${formatNative(Math.max(0, surplus), 'NZD')}/mo` : 'n/a')
    : netRunway > 999 ? '∞' : `${netRunway.toFixed(1)} mo`
  const netLabelTitle = netRunway == null ? 'Cash positive' : 'Net-burn runway'

  // Bank-sync freshness chip. Tints warning past 24h, danger past 7d so
  // Liam never trusts a stale cash number. Refresh button next to it
  // hand-fires the Airwallex sync.
  const syncAgeHours = bankSyncedAt
    ? Math.max(0, (Date.now() - new Date(bankSyncedAt).getTime()) / 3_600_000)
    : null
  const syncTone: 'muted' | 'warning' | 'danger' = syncAgeHours == null
    ? 'muted'
    : syncAgeHours >= 24 * 7
      ? 'danger'
      : syncAgeHours >= 24
        ? 'warning'
        : 'muted'
  const syncColor = syncTone === 'danger'
    ? 'var(--color-danger)'
    : syncTone === 'warning'
      ? 'var(--color-warning)'
      : 'var(--color-text-subtle)'
  const syncLabel = bankSyncedAt ? `Synced ${fmtRelative(bankSyncedAt)}` : 'Never synced'

  return (
    <Card>
      <div style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="flex items-start justify-between" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]" style={{ marginBottom: '0.375rem' }}>
              Cash and runway
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '2.25rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--color-text)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.05,
              }}>
                {formatDisplay(totalCashDisplay)}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                across all accounts · displayed in {cur}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  color: syncColor,
                  fontWeight: syncTone === 'muted' ? 400 : 500,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {syncLabel}
              </span>
              <button
                type="button"
                onClick={onRefreshBank}
                disabled={syncing}
                aria-label="Refresh bank balances"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  padding: '0.4375rem 0.625rem',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 500,
                  color: 'var(--color-text-muted)',
                  background: 'transparent',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  cursor: syncing ? 'not-allowed' : 'pointer',
                  opacity: syncing ? 0.5 : 1,
                  transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
                  minHeight: '2.25rem',
                }}
                onMouseEnter={e => {
                  if (syncing) return
                  e.currentTarget.style.background = 'var(--color-bg-secondary)'
                  e.currentTarget.style.color = 'var(--color-brand)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
              >
                <RefreshCw
                  size={12}
                  aria-hidden="true"
                  className={syncing ? 'animate-spin' : undefined}
                />
                Refresh
              </button>
            </div>
          </div>
          <Badge tone={STATUS_TONE[statusCash]} variant="soft" size="sm">
            {STATUS_LABEL[statusCash]}
          </Badge>
        </div>

        {/* Stack vertically: donut centred, then runway metrics. Side-by-
            side felt cramped on mobile and felt off on desktop too — the
            three pieces (donut, worst case, net burn) read better as a
            single column at every breakpoint. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 'var(--space-4)' }}>
          <div style={{ alignSelf: 'center', width: '8.5rem', height: '8.5rem' }}>
            <DonutChart
              size={136}
              segments={[
                { label: 'Reached', value: reservePct, colour: reserveTone === 'positive' ? '#5A824E' : reserveTone === 'warning' ? '#fb923c' : '#f87171' },
                { label: 'Remaining', value: Math.max(0, 100 - reservePct), colour: 'var(--color-bg-tertiary)' },
              ]}
              centreLabel={<span className="text-[0.6875rem] uppercase tracking-wider text-[var(--color-text-subtle)]">Reserve</span>}
              centreValue={
                <span className="text-lg font-bold text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {reservePct}%
                </span>
              }
              legend={false}
              ariaLabel="Reserve target progress"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <MetricBlock
              label="Worst case runway"
              value={grossLabel}
              sub={grossRunway != null
                ? (reserveConfig.unreservedTaxNzd > 0
                  ? `After ${formatNative(reserveConfig.unreservedTaxNzd, 'NZD')} tax set aside`
                  : 'Tax-adjusted cash ÷ burn, no income')
                : 'Set burn to compute'}
              compact
            />
            <MetricBlock
              label={netLabelTitle}
              value={netLabel}
              sub={netRunway == null
                ? 'Revenue exceeds burn'
                : (reserveConfig.unreservedTaxNzd > 0
                  ? `After ${formatNative(reserveConfig.unreservedTaxNzd, 'NZD')} tax set aside`
                  : 'At current burn vs revenue')}
              compact
            />
          </div>
        </div>
      </div>
    </Card>
  )
}

function HeroRevenueCard({
  mrrCombined,
  mrrLabel,
  arrLabel,
  ytdLabel,
  newMrrLabel,
  retainerCount,
  spark,
  cur,
  statusMrr,
}: {
  mrrCombined: number
  mrrLabel: string
  arrLabel: string
  ytdLabel: string
  newMrrLabel: string
  retainerCount: number
  spark: Array<{ label: string; value: number }>
  cur: string
  statusMrr: 'green' | 'amber' | 'red'
}) {
  return (
    <Card>
      <div style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="flex items-start justify-between" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]" style={{ marginBottom: '0.375rem' }}>
              Revenue engine
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{
                fontSize: '2.25rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--color-text)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.05,
              }}>
                {mrrLabel}
              </span>
              <span className="text-xs text-[var(--color-text-muted)]">
                MRR · {retainerCount} retainer{retainerCount === 1 ? '' : 's'} · {cur}
              </span>
            </div>
          </div>
          <Badge tone={STATUS_TONE[statusMrr]} variant="soft" size="sm">
            {STATUS_LABEL[statusMrr]}
          </Badge>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <MetricBlock label="ARR" value={arrLabel} sub="MRR x 12" compact />
          <MetricBlock label="YTD revenue" value={ytdLabel} sub="Paid invoices" compact />
          <MetricBlock label="New MRR this mo" value={newMrrLabel} sub="Won minus churn" compact />
        </div>

        {spark.length > 1 ? (
          <div style={{ marginTop: '0.25rem' }}>
            <LineChart
              data={spark}
              height={64}
              area
              showYAxis={false}
              showGrid={false}
              ariaLabel="Monthly revenue trend, last 12 months"
            />
          </div>
        ) : (
          <div style={{ height: '4rem', display: 'flex', alignItems: 'center' }}>
            <span className="text-xs text-[var(--color-text-subtle)]">Trend shows when more than one month of history exists. MRR base: {Math.round(mrrCombined).toLocaleString()}.</span>
          </div>
        )}
      </div>
    </Card>
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

  const onTarget = takeHome.gapCombined <= 0
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.875rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Take-home (Liam and Staci)
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
        {editing ? (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1.25rem' }}>
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
          </div>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: 'var(--space-5)', alignItems: 'start' }}>
            {/* Left: hero gap + supporting combined number. */}
            <div>
              <div className="text-xs text-[var(--color-text-muted)]" style={{ fontWeight: 500 }}>Gap to target (combined)</div>
              <div style={{
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: onTarget ? 'var(--color-brand-dark)' : 'var(--color-text)',
                fontVariantNumeric: 'tabular-nums',
                marginTop: '0.125rem',
                lineHeight: 1.1,
              }}>
                {onTarget ? 'On target' : formatNative(takeHome.gapCombined, 'NZD')}
              </div>
              <div className="text-xs text-[var(--color-text-muted)]" style={{ marginTop: '0.25rem', lineHeight: 1.5 }}>
                {onTarget
                  ? 'Both founders at or above their target.'
                  : `Closing the gap costs about ${formatNative(takeHome.gapCombined / 12, 'NZD')}/mo over the next year.`}
              </div>
              <div style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: '1fr 1fr' }}>
                <MetricBlock
                  label="Combined annual"
                  value={formatNative(takeHome.combinedAnnual, 'NZD')}
                  sub={`${formatNative(takeHome.combinedMonthly, 'NZD')}/mo`}
                  compact
                />
                <MetricBlock
                  label="Target each"
                  value={formatNative(takeHome.targetEach, 'NZD')}
                  sub={`Combined ${formatNative(takeHome.targetEach * 2, 'NZD')}`}
                  compact
                />
              </div>
            </div>
            {/* Right: per-person progress chart. */}
            <div>
              <div className="text-xs text-[var(--color-text-muted)]" style={{ fontWeight: 500, marginBottom: 'var(--space-2)' }}>Per-person progress</div>
              <ProgressRow
                label="Liam"
                current={takeHome.liamAnnual}
                target={takeHome.targetEach}
                pct={liamPct}
                formatNative={formatNative}
              />
              <div style={{ marginTop: 'var(--space-3)' }}>
                <ProgressRow
                  label="Staci"
                  current={takeHome.staciAnnual}
                  target={takeHome.targetEach}
                  pct={staciPct}
                  formatNative={formatNative}
                />
              </div>
            </div>
          </div>
        )}
        {!editing && !onTarget && (
          <p className="text-xs text-[var(--color-text-muted)] mt-3" style={{ lineHeight: 1.5 }}>
            Closing the combined gap is roughly equivalent to one part-time hire at about $2k USD per month. Run the comparison in the Spend impact calculator below.
          </p>
        )}
      </div>
    </Card>
  )
}

function ProgressRow({ label, current, target, pct, formatNative }: {
  label: string
  current: number
  target: number
  pct: number
  formatNative: (n: number, currency: string) => string
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[0.6875rem] mb-0.5">
        <span className="text-[var(--color-text)]" style={{ fontWeight: 500 }}>{label}</span>
        <span className="text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatNative(current, 'NZD')} of {formatNative(target, 'NZD')}
        </span>
      </div>
      <div style={{ height: '0.4375rem', background: 'var(--color-bg-secondary)', borderRadius: '999px', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.max(2, pct)}%`,
          height: '100%',
          background: pct >= 100 ? 'var(--color-brand)' : 'var(--color-brand-light)',
          transition: 'width 600ms cubic-bezier(0.22, 1, 0.36, 1)',
        }} />
      </div>
      <div className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ marginTop: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(pct)}% of target
      </div>
    </div>
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
        <div className="flex items-baseline justify-between" style={{ marginBottom: '0.875rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
            Quarter and year-end
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
            sub={quarterly.target > 0 ? `${pacingDelta >= 0 ? '+' : ''}${formatNative(pacingDelta, 'NZD')} vs target` : 'Daily run-rate over quarter days'}
            accent
          />
          <MetricBlock
            label="Year-end projection"
            value={formatNative(yearEnd.projection, 'NZD')}
            sub={`YTD ${formatNative(ytdRevenue, 'NZD')} plus ${yearEnd.monthsRemaining} mo of ${formatNative(effectiveMonthly, 'NZD')}`}
          />
          <MetricBlock
            label={benchmarks.netProfitMargin.label}
            value={benchmarks.netProfitMargin.median}
            sub="NZ agency median, for comparison"
          />
          <MetricBlock
            label={benchmarks.ownerTakeHome.label}
            value={benchmarks.ownerTakeHome.median}
            sub="NZ agency owner median, for comparison"
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
          Costs are denominated in NZD. {forex.nzdShare < 0.7 ? 'A NZD strengthening would dent the non-NZD pots\' purchasing power for your domestic burn.' : 'Forex exposure is low. Most cash is already in operating currency.'}
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
  const maxValue = Math.max(...history.map(h => h.total), 1)
  // Compact format function for the Y axis so big numbers don't break the layout.
  const compactFmt = (v: number): string => {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
    return Math.round(v).toString()
  }
  // Year-aware short label so the X axis reads chronologically across a
  // year boundary (e.g. Jun 25, Jul 25 ... Mar 26, Apr 26). Stripping just
  // the year produced "06, 07, ... 03, 04" which scans as scrambled even
  // though the data is in date order.
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const ymLabel = (ym: string): string => {
    const [yStr, mStr] = ym.split('-')
    const m = parseInt(mStr ?? '0', 10)
    const y = parseInt(yStr ?? '0', 10)
    if (!m || !y) return ym
    return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
  }
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <SubSectionHeader
          title="Monthly revenue, last 12 months"
          meta={history.length === 12 ? `Peak ${toCur(maxValue, cur)}` : `${history.length} month${history.length === 1 ? '' : 's'} of data`}
        />
        <BarChart
          data={history.map(h => ({ label: ymLabel(h.ym), value: h.total }))}
          height={200}
          variant="pill"
          tone="positive"
          formatValue={compactFmt}
          ariaLabel="Monthly revenue, last 12 months"
        />
      </div>
    </Card>
  )
}

function CostMixCard({ costMix, spendSplit, formatNative }: {
  costMix: Array<{ category: string; monthly: number }>
  spendSplit: { discretionary: number; essential: number }
  formatNative: (n: number, currency: string) => string
}) {
  const total = costMix.reduce((s, c) => s + c.monthly, 0)
  const splitTotal = spendSplit.essential + spendSplit.discretionary
  const essentialPct = splitTotal > 0 ? (spendSplit.essential / splitTotal) * 100 : 0
  // No data branch. Keep a neat empty hint inside the consistent shell.
  if (costMix.length === 0 && splitTotal === 0) {
    return (
      <Card>
        <div className="p-4 sm:p-6">
          <SubSectionHeader title="Cost mix and split" />
          <EmptyHint>No outflow data yet. Add some commitments above to populate this view.</EmptyHint>
        </div>
      </Card>
    )
  }
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <SubSectionHeader
          title="Cost mix and split"
          meta={`${formatNative(total, 'NZD')}/mo recurring · ${formatNative(splitTotal * 12, 'NZD')}/yr`}
        />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--space-5)', alignItems: 'start', minWidth: 0 }}>
          {/* Left: donut + legend by category. Donut + legend stack when
              the container is narrower than ~22rem (mobile portrait) so the
              legend isn't squeezed into 10rem of width. */}
          <div className="cost-mix-donut-row" style={{ minWidth: 0 }}>
            <div className="cost-mix-donut">
              <DonutChart
                size={140}
                segments={costMix.map(c => ({ label: c.category, value: c.monthly }))}
                centreLabel={<span className="text-[0.6875rem] uppercase tracking-wider text-[var(--color-text-subtle)]">Monthly</span>}
                centreValue={
                  <span className="text-sm font-bold text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatNative(total, 'NZD')}
                  </span>
                }
                legend={false}
                ariaLabel="Cost mix by category"
              />
            </div>
            <div className="grid cost-mix-legend" style={{ gap: '0.4375rem', minWidth: 0 }}>
              {costMix.map((c, i) => {
                const pct = total > 0 ? c.monthly / total : 0
                const dot = CHART.categorical[i % CHART.categorical.length]
                return (
                  <div key={c.category} className="flex items-center" style={{ gap: '0.5rem', minWidth: 0 }}>
                    <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '999px', background: dot, flexShrink: 0 }} />
                    <span className="text-xs text-[var(--color-text)] capitalize truncate" style={{ flex: 1, minWidth: 0 }}>{c.category}</span>
                    <span className="text-xs text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                      {formatNative(c.monthly, 'NZD')}
                    </span>
                    <span className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ fontVariantNumeric: 'tabular-nums', width: '2.5rem', textAlign: 'right', flexShrink: 0 }}>
                      {Math.round(pct * 100)}%
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: essential vs discretionary split */}
          <div>
            <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]" style={{ marginBottom: '0.5rem' }}>
              Essential vs discretionary
            </div>
            <div style={{
              height: '0.75rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: '999px',
              overflow: 'hidden',
              display: 'flex',
              marginBottom: '0.625rem',
            }}>
              <div style={{ width: `${essentialPct}%`, height: '100%', background: 'var(--color-brand)' }} />
              <div style={{ width: `${100 - essentialPct}%`, height: '100%', background: 'var(--color-brand-light)' }} />
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <MetricBlock
                label="Essential (cannot cut)"
                value={formatNative(spendSplit.essential, 'NZD')}
                sub={`${Math.round(essentialPct)}% of recurring outflow`}
                compact
                accent
              />
              <MetricBlock
                label="Discretionary (could cut)"
                value={formatNative(spendSplit.discretionary, 'NZD')}
                sub={spendSplit.discretionary > 0
                  ? `${formatNative(spendSplit.discretionary * 12, 'NZD')}/yr if trimmed`
                  : 'None tagged yet'}
                compact
              />
            </div>
            <p className="text-xs text-[var(--color-text-muted)]" style={{ marginTop: 'var(--space-3)', lineHeight: 1.55 }}>
              Tag commitments in the table above as discretionary or essential to drive this split.
            </p>
          </div>
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
  const stages = funnel.filter(s => s.count > 0 || !s.isClosedWon)
  if (stages.length === 0) {
    return (
      <Card>
        <div className="p-4 sm:p-6">
          <SubSectionHeader title="Pipeline funnel" />
          <EmptyHint>No open deals yet. Add deals on /pipeline to see the funnel light up.</EmptyHint>
        </div>
      </Card>
    )
  }
  // Compact formatter for the chart Y-axis.
  const compactFmt = (v: number): string => {
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
    return Math.round(v).toString()
  }
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <SubSectionHeader
          title="Pipeline funnel"
          meta={`${formatNative(open.value, 'NZD')} open · ${open.count} deal${open.count === 1 ? '' : 's'}`}
        />
        <BarChart
          data={stages.map(s => ({
            label: s.stage,
            value: s.value,
            tone: s.isClosedWon ? 'positive' : 'neutral',
          }))}
          height={220}
          variant="pill"
          tone="neutral"
          formatValue={compactFmt}
          ariaLabel="Pipeline funnel by stage"
        />
        {/* Per-stage count grid for quick scan. */}
        <div className="grid" style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))',
          gap: 'var(--space-3)',
          marginTop: 'var(--space-4)',
        }}>
          {stages.map(s => (
            <div key={s.stage} style={{
              padding: '0.5rem 0.625rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div className="text-[0.625rem] text-[var(--color-text-subtle)] truncate" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {s.stage}
              </div>
              <div className="text-sm font-semibold text-[var(--color-text)]" style={{ marginTop: '0.125rem', fontVariantNumeric: 'tabular-nums' }}>
                {s.count}
              </div>
              <div className="text-[0.625rem] text-[var(--color-text-muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatNative(s.value, 'NZD')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

// ─── Sales velocity + YoY + Tax summary helpers ───────────────────────

function SalesVelocityCard({ salesVelocity, primaryCurrency, toCur }: {
  salesVelocity: SummaryResponse['salesVelocity']
  primaryCurrency: string
  toCur: (n: number, fromCurrency: string) => string
}) {
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <SubSectionHeader title="Sales velocity" meta="Deals signed across rolling windows." />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1.25rem' }}>
          <MetricBlock label="Last 30 days" value={`${salesVelocity.last30Days.count} deal${salesVelocity.last30Days.count === 1 ? '' : 's'}`} sub={toCur(salesVelocity.last30Days.value, primaryCurrency)} />
          <MetricBlock label="Last 60 days" value={`${salesVelocity.last60Days.count} deal${salesVelocity.last60Days.count === 1 ? '' : 's'}`} sub={toCur(salesVelocity.last60Days.value, primaryCurrency)} />
          <MetricBlock label="Last 90 days" value={`${salesVelocity.last90Days.count} deal${salesVelocity.last90Days.count === 1 ? '' : 's'}`} sub={toCur(salesVelocity.last90Days.value, primaryCurrency)} />
        </div>
      </div>
    </Card>
  )
}

function YoyCard({ yoy, history, cur, toCur }: {
  yoy: SummaryResponse['yoy']
  history: Array<{ ym: string; total: number }>
  cur: string
  toCur: (n: number, fromCurrency: string) => string
}) {
  // Tiny sparkline of the last 6 months for context next to the YoY number.
  const recent = history.slice(-6).map(h => ({ label: h.ym.slice(5), value: h.total }))
  const deltaSign = yoy.deltaPct == null ? '' : yoy.deltaPct >= 0 ? '+' : ''
  const deltaLabel = yoy.deltaPct == null ? 'n/a' : `${deltaSign}${Math.round(yoy.deltaPct * 100)}%`
  const deltaTone: 'positive' | 'warning' | 'danger' | 'neutral' = yoy.deltaPct == null ? 'neutral'
    : yoy.deltaPct > 0 ? 'positive'
    : yoy.deltaPct > -0.1 ? 'warning'
    : 'danger'
  const deltaColour = deltaTone === 'positive' ? 'var(--color-brand-dark)'
    : deltaTone === 'warning' ? '#9a3412'
    : deltaTone === 'danger' ? '#991b1b'
    : 'var(--color-text)'
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <SubSectionHeader title="Year-over-year" meta="This month versus the same month last year." />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: 'var(--space-4)' }}>
          <div>
            <div className="text-xs text-[var(--color-text-muted)]" style={{ fontWeight: 500 }}>This month so far</div>
            <div style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: 'var(--color-brand-dark)',
              fontVariantNumeric: 'tabular-nums',
              marginTop: '0.125rem',
              lineHeight: 1.15,
            }}>
              {toCur(yoy.thisMonth, cur)}
            </div>
            <div className="text-[0.6875rem] text-[var(--color-text-subtle)] mt-0.5">Paid invoices, current calendar month</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-muted)]" style={{ fontWeight: 500 }}>Same month last year</div>
            <div style={{
              fontSize: '1.375rem',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: 'var(--color-text)',
              fontVariantNumeric: 'tabular-nums',
              marginTop: '0.125rem',
              lineHeight: 1.15,
            }}>
              {toCur(yoy.lastYearSameMonth, cur)}
            </div>
            <div className="text-[0.6875rem] text-[var(--color-text-subtle)] mt-0.5">{yoy.lastYearSameMonth === 0 ? 'No data, comparison not available' : 'For perspective'}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-muted)]" style={{ fontWeight: 500 }}>Delta</div>
            <div style={{
              fontSize: '1.375rem',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: deltaColour,
              fontVariantNumeric: 'tabular-nums',
              marginTop: '0.125rem',
              lineHeight: 1.15,
            }}>
              {deltaLabel}
            </div>
            <div className="text-[0.6875rem] text-[var(--color-text-subtle)] mt-0.5">
              {yoy.deltaPct == null ? 'No baseline' : yoy.deltaPct > 0 ? 'Growing year-on-year' : 'Down vs same month last year'}
            </div>
          </div>
        </div>
        {recent.length > 1 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <BarChart
              data={recent}
              height={120}
              variant="pill"
              tone="positive"
              showYAxis={false}
              ariaLabel="Last 6 months revenue trend"
            />
          </div>
        )}
      </div>
    </Card>
  )
}

function TaxSummaryCard({ taxes, reserves, primaryCurrency, toCur, formatNative }: {
  taxes: SummaryResponse['taxes']
  reserves: SummaryResponse['reserves']
  primaryCurrency: string
  toCur: (n: number, fromCurrency: string) => string
  formatNative: (n: number, currency: string) => string
}) {
  // Reserve coverage for accrued tax. If they have set aside more than
  // the corp-tax-owed YTD, this lands at 100%. Cap at 100 so the donut
  // doesn't look stuck mid-loop.
  const taxOwed = Math.max(0, taxes.corpTaxOwedYtd)
  const reserved = Math.max(0, reserves.total)
  const coveragePct = taxOwed > 0 ? Math.min(100, Math.round((reserved / taxOwed) * 100)) : reserved > 0 ? 100 : 0
  const tone: 'positive' | 'warning' | 'danger' = coveragePct >= 80 ? 'positive' : coveragePct >= 40 ? 'warning' : 'danger'
  const toneColour = tone === 'positive' ? '#5A824E' : tone === 'warning' ? '#fb923c' : '#f87171'
  return (
    <Card>
      <div className="p-4 sm:p-6">
        <SubSectionHeader
          title="Tax owed and reserve progress"
          meta={`NZ tax year ${new Date(taxes.taxYearStart).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })} · ${taxes.monthsIntoTaxYear} of 12 months elapsed`}
        />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--space-5)', alignItems: 'center' }}>
          {/* Donut: how much of corp-tax-owed is already reserved. */}
          <div className="grid" style={{ gridTemplateColumns: '8rem 1fr', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div style={{ width: '8rem', height: '8rem' }}>
              <DonutChart
                size={128}
                segments={[
                  { label: 'Reserved', value: coveragePct, colour: toneColour },
                  { label: 'To reserve', value: Math.max(0, 100 - coveragePct), colour: 'var(--color-bg-tertiary)' },
                ]}
                centreLabel={<span className="text-[0.6875rem] uppercase tracking-wider text-[var(--color-text-subtle)]">Reserved</span>}
                centreValue={
                  <span className="text-lg font-bold text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {coveragePct}%
                  </span>
                }
                legend={false}
                ariaLabel="Tax reserve coverage"
              />
            </div>
            <div className="grid" style={{ gap: 'var(--space-3)' }}>
              <MetricBlock
                label="Corp tax accrued YTD"
                value={toCur(taxes.corpTaxOwedYtd, primaryCurrency)}
                sub={`28% of profit (${toCur(taxes.ytdProfit, primaryCurrency)})`}
                compact
                accent
              />
              <MetricBlock
                label="Reserved so far"
                value={formatNative(reserved, 'NZD')}
                sub={taxOwed > 0 ? `${formatNative(Math.max(0, taxOwed - reserved), 'NZD')} still to set aside` : 'Up to date'}
                compact
              />
            </div>
          </div>

          {/* Right side: tax-year revenue + GST + expenses block. */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: 'var(--space-4)' }}>
            <MetricBlock
              label="Tax-year revenue"
              value={toCur(taxes.taxYearRevenue, primaryCurrency)}
              sub="Paid invoices, current tax year"
              compact
            />
            <MetricBlock
              label="GST collected"
              value={toCur(taxes.gstOwedYtd, primaryCurrency)}
              sub="Tax on paid invoices"
              compact
            />
            <MetricBlock
              label="Expenses (approx)"
              value={toCur(taxes.ytdExpensesApprox, primaryCurrency)}
              sub="Recurring × months elapsed"
              compact
            />
          </div>
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
            value={revenuePerHour != null && hours > 0 ? formatNative(revenuePerHour, 'NZD') : 'n/a'}
            sub={hours > 0 ? `${Math.round(hours)} hours logged last 90d` : 'Log hours to track this'}
            accent
          />
          <MetricBlock
            label="Cash conversion"
            value={cashConversion.ratio != null ? `${Math.round(cashConversion.ratio * 100)}%` : 'n/a'}
            sub={`${formatNative(cashConversion.collected90d, 'NZD')} collected of ${formatNative(cashConversion.invoiced90d, 'NZD')} invoiced (90d)`}
          />
          <MetricBlock
            label="Time to pay"
            value={timeToPay.count > 0 ? `${Math.round(timeToPay.avgDays)}d avg` : 'n/a'}
            sub={timeToPay.count > 0 ? `Range ${Math.round(timeToPay.minDays)} to ${Math.round(timeToPay.maxDays)} days across ${timeToPay.count} invoices` : 'No paid invoices in window'}
          />
          <MetricBlock
            label="Outstanding contracted work"
            value={formatNative(outstandingWork.value, 'NZD')}
            sub={`${outstandingWork.contracts} active retainer${outstandingWork.contracts === 1 ? '' : 's'} × months remaining`}
          />
          <MetricBlock
            label="Average deal"
            value={dealStats.count > 0 ? formatNative(dealStats.avgValue, 'NZD') : 'n/a'}
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
        showToast(`Scan ran. ${d.inserted ?? 0} new ${d.inserted === 1 ? 'finding' : 'findings'} (${(d.findingsRaw ?? 0) - (d.inserted ?? 0)} deduped)`, 'success')
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
            Anomalies (AI weekly and monthly scan)
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

interface CommitmentRow {
  id: string
  name: string
  vendor: string | null
  amount: number
  currency: string
  cadence: 'monthly' | 'quarterly' | 'annual' | 'one_off'
  category: string
  nextDueDate: string | null
  startDate: string | null
  endDate: string | null
  billingDayOfMonth: number | null
  active: boolean
  isDiscretionary: boolean
  notes: string | null
  linkedXeroAccount: string | null
  // Overlaid from /subscriptions-audit
  annualisedNative?: number
  lastBankHit?: { id: string; amount: number; currency: string; settledAt: string | null; counterparty: string | null } | null
}

const COMMITMENT_CADENCES = [
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual',    label: 'Annual' },
  { value: 'one_off',   label: 'One-off' },
] as const

const COMMITMENT_CATEGORIES = [
  { value: 'software',   label: 'Software' },
  { value: 'salary',     label: 'Salary' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'insurance',  label: 'Insurance' },
  { value: 'tax',        label: 'Tax' },
  { value: 'office',     label: 'Office' },
  { value: 'marketing',  label: 'Marketing' },
  { value: 'other',      label: 'Other' },
] as const

const COMMITMENT_CURRENCIES = ['NZD', 'USD', 'GBP', 'EUR', 'AUD'].map(c => ({ value: c, label: c }))

interface CommitmentFormState {
  name: string
  vendor: string
  amount: string
  currency: string
  cadence: CommitmentRow['cadence']
  category: string
  nextDueDate: string
  startDate: string
  endDate: string
  billingDayOfMonth: string
  notes: string
  active: boolean
  isDiscretionary: boolean
}

function emptyCommitmentForm(): CommitmentFormState {
  return {
    name: '', vendor: '', amount: '', currency: 'NZD', cadence: 'monthly',
    category: 'software', nextDueDate: '', startDate: '', endDate: '',
    billingDayOfMonth: '', notes: '', active: true, isDiscretionary: false,
  }
}

// Monthly equivalent in the commitment's native currency. Active-aware.
function monthlyEquivNative(c: CommitmentRow): number {
  if (!c.active) return 0
  switch (c.cadence) {
    case 'monthly':   return c.amount
    case 'quarterly': return c.amount / 3
    case 'annual':    return c.amount / 12
    case 'one_off':   return 0
  }
}

function RecurringOutflowsCard({ formatNative }: {
  formatNative: (amount: number, currency: string) => string
}) {
  const [items, setItems] = useState<CommitmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  const [form, setForm] = useState<CommitmentFormState>(emptyCommitmentForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [commitRes, auditRes] = await Promise.all([
        fetch(apiPath('/api/admin/commitments')),
        fetch(apiPath('/api/admin/financial-reports/subscriptions-audit')),
      ])
      const commitJson = commitRes.ok ? (await commitRes.json() as { commitments?: CommitmentRow[] }) : { commitments: [] }
      const auditJson = auditRes.ok ? (await auditRes.json() as { items?: Array<{ id: string; annualisedNzd?: number; lastBankHit?: CommitmentRow['lastBankHit'] }> }) : { items: [] }
      const auditMap = new Map((auditJson.items ?? []).map(a => [a.id, a]))
      const merged: CommitmentRow[] = (commitJson.commitments ?? []).map(c => ({
        ...c,
        annualisedNative: auditMap.get(c.id)?.annualisedNzd, // misnamed upstream; it's actually native annualised
        lastBankHit: auditMap.get(c.id)?.lastBankHit ?? null,
      }))
      setItems(merged)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function openCreate() {
    setForm(emptyCommitmentForm())
    setEditingId(null)
    setError(null)
    setDrawerOpen(true)
  }

  function openEdit(c: CommitmentRow) {
    setForm({
      name: c.name,
      vendor: c.vendor ?? '',
      amount: String(c.amount),
      currency: c.currency,
      cadence: c.cadence,
      category: c.category,
      nextDueDate: c.nextDueDate ?? '',
      startDate: c.startDate ?? '',
      endDate: c.endDate ?? '',
      billingDayOfMonth: c.billingDayOfMonth != null ? String(c.billingDayOfMonth) : '',
      notes: c.notes ?? '',
      active: c.active,
      isDiscretionary: c.isDiscretionary,
    })
    setEditingId(c.id)
    setError(null)
    setDrawerOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseFloat(form.amount)
    if (!form.name.trim() || !Number.isFinite(amount)) {
      setError('Name and a numeric amount are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const day = form.billingDayOfMonth ? parseInt(form.billingDayOfMonth, 10) : null
      const body = {
        name: form.name.trim(),
        vendor: form.vendor.trim() || null,
        amount,
        currency: form.currency,
        cadence: form.cadence,
        category: form.category,
        nextDueDate: form.nextDueDate || null,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        billingDayOfMonth: day && day >= 1 && day <= 31 ? day : null,
        notes: form.notes.trim() || null,
        active: form.active,
        isDiscretionary: form.isDiscretionary,
      }
      const url = editingId ? apiPath(`/api/admin/commitments/${editingId}`) : apiPath('/api/admin/commitments')
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? 'Save failed')
        return
      }
      showToast(editingId ? 'Commitment updated' : 'Commitment added', 'success')
      setDrawerOpen(false)
      await load()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await fetch(apiPath(`/api/admin/commitments/${confirmDelete.id}`), { method: 'DELETE' })
      showToast('Commitment deleted', 'success')
      setConfirmDelete(null)
      await load()
    } catch {
      showToast('Delete failed', 'error')
    }
  }

  async function toggleActive(c: CommitmentRow) {
    // Optimistic flip so the table updates instantly.
    setItems(prev => prev.map(x => x.id === c.id ? { ...x, active: !c.active } : x))
    try {
      await fetch(apiPath(`/api/admin/commitments/${c.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !c.active }),
      })
    } catch { await load() }
  }

  // ── Auto-detect cadence (Airwallex matching) ─────────────────────
  // Two-step UX: dry-run first → show preview → operator confirms apply.
  const [detectPreview, setDetectPreview] = useState<Array<{ id: string; name: string; vendor: string | null; currentCadence: string; currentBillingDay: number | null; inferredBillingDay: number | null; inferredCadence: string | null; matchCount: number; confidence: string; reason: string }> | null>(null)
  const [detecting, setDetecting] = useState(false)
  async function runAutoDetect(apply: boolean) {
    setDetecting(true)
    try {
      const res = await fetch(apiPath('/api/admin/commitments/auto-detect-cadence'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply }),
      })
      if (!res.ok) {
        showToast('Auto-detect failed', 'error')
        return
      }
      const json = await res.json() as { plans?: typeof detectPreview; applied?: number }
      if (apply) {
        showToast(`Updated ${json.applied ?? 0} commitments from bank history`, 'success')
        setDetectPreview(null)
        await load()
      } else {
        setDetectPreview(json.plans ?? [])
      }
    } finally {
      setDetecting(false)
    }
  }

  const visible = showInactive ? items : items.filter(c => c.active)
  // Display totals stay in native-currency sum (same behaviour as before).
  // For accurate NZD totals, use the burn figure on the Reserves card.
  const totalCount = items.length
  const activeCount = items.filter(c => c.active).length
  const staleCount = items.filter(c => c.active && !c.lastBankHit).length

  // Strip metrics: monthly sum, annualised, single biggest commitment,
  // and essential / discretionary split. All native-currency sums so this
  // matches the existing display behaviour.
  const monthlyTotal = items.filter(c => c.active).reduce((s, c) => s + monthlyEquivNative(c), 0)
  const annualTotal = monthlyTotal * 12
  const biggest = items.filter(c => c.active).reduce<CommitmentRow | null>((max, c) => {
    const m = monthlyEquivNative(c)
    if (!max) return c
    return m > monthlyEquivNative(max) ? c : max
  }, null)
  const essentialSum = items.filter(c => c.active && !c.isDiscretionary).reduce((s, c) => s + monthlyEquivNative(c), 0)
  const discretionarySum = items.filter(c => c.active && c.isDiscretionary).reduce((s, c) => s + monthlyEquivNative(c), 0)
  const essentialPct = (essentialSum + discretionarySum) > 0
    ? Math.round((essentialSum / (essentialSum + discretionarySum)) * 100)
    : 0

  return (
    <>
      <Card>
        <div className="p-4 sm:p-6">
          <div className="flex items-baseline justify-between" style={{ marginBottom: '0.875rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)]">
                Recurring outflows
              </div>
              <div className="text-[0.6875rem] text-[var(--color-text-subtle)]" style={{ marginTop: '0.25rem' }}>
                {activeCount} active{showInactive && totalCount !== activeCount ? ` · ${totalCount - activeCount} paused` : ''}
                {staleCount > 0 && (
                  <> · <span style={{ color: 'var(--color-warning)' }}>{staleCount} with no recent bank hit</span></>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowInactive(v => !v)}
                className="text-[0.6875rem] font-medium"
                style={{
                  padding: '0.25rem 0.625rem',
                  borderRadius: 'var(--radius-md)',
                  background: showInactive ? 'var(--color-bg-tertiary)' : 'transparent',
                  color: 'var(--color-text-muted)',
                  border: '1px solid var(--color-border-subtle)',
                  cursor: 'pointer',
                  minHeight: '1.75rem',
                }}
              >
                {showInactive ? 'Hide paused' : 'Show paused'}
              </button>
              <TahiButton size="sm" variant="secondary" onClick={() => void runAutoDetect(false)} loading={detecting && !detectPreview}>
                Auto-detect cadence
              </TahiButton>
              <TahiButton size="sm" variant="primary" iconLeft={<Plus size={14} />} onClick={openCreate}>
                Add commitment
              </TahiButton>
            </div>
          </div>

          {/* Strip metrics that summarise the rows below. Renders only when
              we have any active commitments so empty state stays clean. */}
          {activeCount > 0 && (
            <div
              className="grid"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 'var(--space-4)',
              }}
            >
              <MetricBlock
                label="Total monthly"
                value={formatNative(monthlyTotal, 'NZD')}
                sub="Active commitments"
                compact
                accent
              />
              <MetricBlock
                label="Annualised"
                value={formatNative(annualTotal, 'NZD')}
                sub="12 mo run rate"
                compact
              />
              <MetricBlock
                label="Biggest line"
                value={biggest ? formatNative(monthlyEquivNative(biggest), biggest.currency) : 'n/a'}
                sub={biggest ? biggest.name : 'No active commitments'}
                compact
              />
              <MetricBlock
                label="Essential share"
                value={`${essentialPct}%`}
                sub={`${formatNative(essentialSum, 'NZD')} essential, ${formatNative(discretionarySum, 'NZD')} discretionary`}
                compact
              />
            </div>
          )}

          <DataTable
            rows={visible}
            getRowId={(r) => r.id}
            loading={loading}
            empty={
              <div className="p-4 text-sm text-[var(--color-text-muted)]">
                No expense commitments yet. Add software, salaries, agency contracts and other recurring spend.
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
                    <div className="font-medium text-[var(--color-text)]" style={{ opacity: r.active ? 1 : 0.55 }}>
                      {r.name}
                    </div>
                    <div className="text-[0.6875rem] text-[var(--color-text-subtle)] truncate">
                      {r.vendor ?? r.category} · {r.cadence.replace('_', ' ')}
                      {r.billingDayOfMonth ? ` · day ${r.billingDayOfMonth}` : ''}
                    </div>
                    {(r.startDate || r.endDate) && (
                      <div className="text-[0.6875rem]" style={{ marginTop: '0.125rem', color: 'var(--color-text-subtle)' }}>
                        {r.startDate && <>from {r.startDate}</>}
                        {r.startDate && r.endDate && ' · '}
                        {r.endDate && <span style={{ color: 'var(--color-warning)' }}>ends {r.endDate}</span>}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'amount',
                header: 'Native',
                align: 'right',
                sortable: true,
                sortValue: (r) => monthlyEquivNative(r),
                render: (r) => (
                  <div style={{ fontVariantNumeric: 'tabular-nums', opacity: r.active ? 1 : 0.55 }}>
                    <div className="text-[var(--color-text)] font-medium">{formatNative(r.amount, r.currency)}</div>
                    <div className="text-[0.6875rem] text-[var(--color-text-subtle)]">
                      {formatNative(monthlyEquivNative(r), r.currency)}/mo
                    </div>
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
                      {r.lastBankHit.settledAt ? fmtRelative(r.lastBankHit.settledAt) : 'n/a'}
                    </div>
                  </div>
                ) : r.active ? (
                  <Badge tone="warning" variant="soft" size="sm">No recent hit</Badge>
                ) : (
                  <Badge tone="neutral" variant="soft" size="sm">Paused</Badge>
                ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (r) => (
                  <div className="flex items-center justify-end" style={{ gap: '0.25rem' }}>
                    <button
                      type="button"
                      onClick={() => toggleActive(r)}
                      title={r.active ? 'Pause (exclude from forecast)' : 'Resume (include in forecast)'}
                      className="text-[0.6875rem] font-medium"
                      style={{
                        padding: '0.1875rem 0.5rem',
                        borderRadius: 'var(--radius-md)',
                        background: r.active ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)',
                        color: r.active ? 'var(--color-brand)' : 'var(--color-text-subtle)',
                        border: 'none',
                        cursor: 'pointer',
                        minHeight: '1.75rem',
                      }}
                    >
                      {r.active ? 'Active' : 'Paused'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      title="Edit"
                      aria-label={`Edit ${r.name}`}
                      style={{
                        width: '1.75rem',
                        height: '1.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 'var(--radius-md)',
                        background: 'transparent',
                        color: 'var(--color-text-muted)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)'; e.currentTarget.style.color = 'var(--color-text)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete({ id: r.id, name: r.name })}
                      title="Delete"
                      aria-label={`Delete ${r.name}`}
                      style={{
                        width: '1.75rem',
                        height: '1.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 'var(--radius-md)',
                        background: 'transparent',
                        color: 'var(--color-text-muted)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)'; e.currentTarget.style.color = 'var(--color-danger)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ),
              },
            ]}
            defaultSort={{ key: 'amount', dir: 'desc' }}
          />
        </div>
      </Card>

      <SlideOver
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? 'Edit commitment' : 'Add commitment'}
        subtitle="Recurring expense that feeds your burn and cash-flow forecast"
        maxWidth="32rem"
      >
        <form onSubmit={handleSave} style={{ display: 'contents' }}>
          <SlideOver.Body>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
              <CommitmentField label="Name" required className="col-span-2">
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. StraightIn (LinkedIn agency)"
                />
              </CommitmentField>
              <CommitmentField label="Vendor / supplier">
                <Input
                  value={form.vendor}
                  onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                  placeholder="e.g. StraightIn"
                />
              </CommitmentField>
              <CommitmentField label="Category">
                <Select
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  options={COMMITMENT_CATEGORIES}
                  style={{ width: '100%' }}
                />
              </CommitmentField>
              <CommitmentField label="Amount" required>
                <Input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </CommitmentField>
              <CommitmentField label="Currency">
                <Select
                  value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                  options={COMMITMENT_CURRENCIES}
                  style={{ width: '100%' }}
                />
              </CommitmentField>
              <CommitmentField label="Cadence">
                <Select
                  value={form.cadence}
                  onChange={e => setForm(f => ({ ...f, cadence: e.target.value as CommitmentRow['cadence'] }))}
                  options={COMMITMENT_CADENCES}
                  style={{ width: '100%' }}
                />
              </CommitmentField>
              <CommitmentField label="Billing day (1-31)" hint="When the charge typically hits">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.billingDayOfMonth}
                  onChange={e => setForm(f => ({ ...f, billingDayOfMonth: e.target.value }))}
                  placeholder="e.g. 1"
                />
              </CommitmentField>
              <CommitmentField label="Start date" hint="Excluded from months before this">
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                />
              </CommitmentField>
              <CommitmentField label="End date" hint="Forecast drops off after this">
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                />
              </CommitmentField>
              {form.cadence !== 'monthly' && form.cadence !== 'one_off' && (
                <CommitmentField label="Next due date" className="col-span-2">
                  <Input
                    type="date"
                    value={form.nextDueDate}
                    onChange={e => setForm(f => ({ ...f, nextDueDate: e.target.value }))}
                  />
                </CommitmentField>
              )}
              <CommitmentField label="Notes" className="col-span-2">
                <Textarea
                  rows={3}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Anything you'd want to remember later."
                />
              </CommitmentField>
              <div className="col-span-2" style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', paddingTop: '0.25rem' }}>
                <label className="flex items-center" style={{ gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                  />
                  Active (counted in burn)
                </label>
                <label className="flex items-center" style={{ gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.isDiscretionary}
                    onChange={e => setForm(f => ({ ...f, isDiscretionary: e.target.checked }))}
                  />
                  Discretionary (nice-to-have, could cut)
                </label>
              </div>
              {error && (
                <div className="col-span-2 text-sm" style={{ color: 'var(--color-danger)' }}>{error}</div>
              )}
            </div>
            <style>{`.col-span-2 { grid-column: span 2; }`}</style>
          </SlideOver.Body>
          <SlideOver.Footer>
            <div style={{ flex: 1 }}>
              {editingId && (
                <button
                  type="button"
                  onClick={() => { setDrawerOpen(false); setConfirmDelete({ id: editingId, name: form.name }) }}
                  className="text-sm"
                  style={{
                    background: 'transparent',
                    color: 'var(--color-danger)',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0.5rem 0',
                    fontWeight: 500,
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            <TahiButton type="button" variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</TahiButton>
            <TahiButton type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add commitment'}
            </TahiButton>
          </SlideOver.Footer>
        </form>
      </SlideOver>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete commitment?"
        description={confirmDelete ? `"${confirmDelete.name}" will be removed from your forecast. You can re-add it later if needed.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      <SlideOver
        open={!!detectPreview}
        onClose={() => setDetectPreview(null)}
        title="Auto-detect cadence"
        subtitle="Inferred billing day + cadence from the last 180 days of Airwallex transactions"
        maxWidth="34rem"
      >
        <SlideOver.Body>
          {detectPreview && detectPreview.length === 0 ? (
            <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              No commitments to scan.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {detectPreview?.map(p => {
                const tone = p.confidence === 'high' ? 'positive' : p.confidence === 'medium' ? 'brand' : p.confidence === 'low' ? 'warning' : 'neutral'
                const changes: string[] = []
                if (p.inferredBillingDay != null && p.inferredBillingDay !== p.currentBillingDay) {
                  changes.push(`day ${p.currentBillingDay ?? 'n/a'} -> ${p.inferredBillingDay}`)
                }
                if (p.inferredCadence && p.inferredCadence !== p.currentCadence) {
                  changes.push(`cadence ${p.currentCadence} → ${p.inferredCadence}`)
                }
                return (
                  <div key={p.id} style={{ padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-secondary)' }}>
                    <div className="flex items-start justify-between" style={{ gap: '0.5rem' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{p.name}</div>
                        <div className="text-[0.6875rem]" style={{ color: 'var(--color-text-subtle)' }}>{p.vendor ?? 'no vendor'} · {p.matchCount} matches</div>
                      </div>
                      <Badge tone={tone} variant="soft" size="sm">{p.confidence}</Badge>
                    </div>
                    {changes.length > 0 && (
                      <div className="text-[0.75rem]" style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>
                        {changes.join(' · ')}
                      </div>
                    )}
                    <div className="text-[0.6875rem]" style={{ color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>{p.reason}</div>
                  </div>
                )
              })}
            </div>
          )}
        </SlideOver.Body>
        <SlideOver.Footer>
          <div style={{ flex: 1, fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            Applies only to rows with high/medium confidence and no existing day set.
          </div>
          <TahiButton variant="ghost" onClick={() => setDetectPreview(null)}>Cancel</TahiButton>
          <TahiButton
            variant="primary"
            disabled={detecting}
            onClick={() => void runAutoDetect(true)}
          >
            {detecting ? 'Applying…' : 'Apply changes'}
          </TahiButton>
        </SlideOver.Footer>
      </SlideOver>
    </>
  )
}

function CommitmentField({ label, required, hint, className, children }: {
  label: string
  required?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={className} style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3125rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      </span>
      {children}
      {hint && (
        <span style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
          {hint}
        </span>
      )}
    </label>
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
  // is shorter. See what happens after the cost goes away.
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
          {verdict.detail} Assumes revenue stays flat at {formatNative(revenue, 'NZD')}/mo and existing burn at {formatNative(burn, 'NZD')}/mo. Adjust either in the reserve target card above for a different projection. <em>{label}</em>: this scenario.
        </p>
      </div>
    </Card>
  )
}

/** Small tile used inside ReserveTargetCard to surface gross + net runway side by side. */
function RunwayTile({ label, sub, value, detail, tone }: {
  label: string
  sub: string
  value: string
  detail: string
  tone: 'positive' | 'warning' | 'danger' | 'neutral'
}) {
  const accent =
    tone === 'positive' ? 'var(--color-brand)' :
    tone === 'warning'  ? '#fb923c' :
    tone === 'danger'   ? '#f87171' :
                          'var(--color-text-subtle)'
  return (
    <div
      style={{
        padding: '0.625rem 0.75rem',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-secondary)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-subtle)' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.1875rem', fontVariantNumeric: 'tabular-nums' }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: accent, lineHeight: 1.1 }}>{value}</div>
      </div>
      <div className="text-[0.6875rem]" style={{ color: 'var(--color-text-muted)', marginTop: '0.1875rem' }}>{sub}</div>
      <div className="text-[0.625rem]" style={{ color: 'var(--color-text-subtle)', marginTop: '0.125rem', fontVariantNumeric: 'tabular-nums' }}>{detail}</div>
    </div>
  )
}

function ReserveTargetCard({ config, formatNative, onSaved }: {
  config: {
    targetMonths: number
    monthlyBurnNzd: number | null
    autoBurnNzd: number
    lastYearTaxOwed: number
    targetAmount: number
    monthsOfRunway: number | null
    totalCashNzd: number
    unreservedTaxNzd: number
    taxAdjustedCashNzd: number
    grossRunwayMonths: number | null
    netRunwayMonths: number | null
    netMonthlyBurnNzd: number
    monthlySurplusNzd: number
  }
  formatNative: (amount: number, currency: string) => string
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [months, setMonths] = useState(String(config.targetMonths))
  // burnMode tracks whether the operator wants the auto-calculated burn
  // (sum of active commitments) or their hand-set value. Switching to
  // auto preserves the manual number in state so flipping back is
  // friction-free. The input just blanks out visually.
  const [burnMode, setBurnMode] = useState<'auto' | 'manual'>(
    config.monthlyBurnNzd != null && config.monthlyBurnNzd > 0 ? 'manual' : 'auto'
  )
  const [burn, setBurn] = useState(config.monthlyBurnNzd != null ? String(config.monthlyBurnNzd) : '')
  const [tax, setTax] = useState(String(config.lastYearTaxOwed || ''))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Effective burn shown in the "Target amount" preview. Recompute
  // here so the preview updates as the user types, before save lands.
  const previewBurn = burnMode === 'auto'
    ? config.autoBurnNzd
    : (parseFloat(burn) || 0)
  const previewTarget = previewBurn * (parseFloat(months) || 0) + (parseFloat(tax) || 0)

  async function save() {
    setSaving(true)
    try {
      // Auto mode persists as 0. Backend treats null/0 as "fall back
      // to autoBurnNzd". Manual mode persists the typed number.
      const burnValue = burnMode === 'auto' ? '0' : (burn || '0')
      const writes: Array<{ key: string; value: string }> = [
        { key: 'finance.reserveTargetMonths', value: months || '4' },
        { key: 'finance.monthlyBurnNzd', value: burnValue },
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem', gap: '0.5rem' }}>
              <label style={{ ...labelStyle, marginBottom: 0 }}>Monthly burn (NZD)</label>
              <div role="group" aria-label="Burn calculation mode" style={{ display: 'inline-flex', alignItems: 'stretch', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => { setBurnMode('auto'); setDirty(true) }}
                  className="text-[0.625rem] font-medium"
                  style={{
                    padding: '0.1875rem 0.5rem',
                    background: burnMode === 'auto' ? 'var(--color-brand-50)' : 'transparent',
                    color: burnMode === 'auto' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  aria-pressed={burnMode === 'auto'}
                >
                  Auto
                </button>
                <span aria-hidden="true" style={{ width: '1px', background: 'var(--color-border)' }} />
                <button
                  type="button"
                  onClick={() => { setBurnMode('manual'); setDirty(true) }}
                  className="text-[0.625rem] font-medium"
                  style={{
                    padding: '0.1875rem 0.5rem',
                    background: burnMode === 'manual' ? 'var(--color-brand-50)' : 'transparent',
                    color: burnMode === 'manual' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  aria-pressed={burnMode === 'manual'}
                >
                  Manual
                </button>
              </div>
            </div>
            {burnMode === 'auto' ? (
              <div style={{ ...inputStyle, border: '1px dashed var(--color-border)', background: 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNative(config.autoBurnNzd, 'NZD')}</span>
                <span style={{ fontSize: '0.625rem', fontWeight: 500, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  From commitments
                </span>
              </div>
            ) : (
              <input
                type="number"
                min={0}
                step="100"
                value={burn}
                onChange={e => { setBurn(e.target.value); setDirty(true) }}
                placeholder="e.g. 8000"
                style={inputStyle}
              />
            )}
            <div style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem', lineHeight: 1.45 }}>
              {burnMode === 'auto'
                ? 'Sum of every active commitment, currency-converted.'
                : `Auto would give ${formatNative(config.autoBurnNzd, 'NZD')}/mo.`}
            </div>
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
              {formatNative(dirty ? previewTarget : config.targetAmount, 'NZD')}
            </div>
            {dirty && Math.abs(previewTarget - config.targetAmount) > 0.5 && (
              <div style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
                Was {formatNative(config.targetAmount, 'NZD')}. Save to apply.
              </div>
            )}
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <RunwayTile
            label="Worst case runway"
            sub={`Tax-adjusted cash ÷ burn · zero revenue`}
            value={config.grossRunwayMonths != null ? `${config.grossRunwayMonths.toFixed(1)} mo` : 'n/a'}
            detail={config.unreservedTaxNzd > 0
              ? `${formatNative(config.taxAdjustedCashNzd, 'NZD')} after setting aside ${formatNative(config.unreservedTaxNzd, 'NZD')} tax ÷ ${formatNative(previewBurn, 'NZD')}/mo`
              : `${formatNative(config.taxAdjustedCashNzd, 'NZD')} cash ÷ ${formatNative(previewBurn, 'NZD')}/mo`}
            tone={config.grossRunwayMonths == null ? 'neutral'
              : config.grossRunwayMonths >= config.targetMonths ? 'positive'
              : config.grossRunwayMonths >= config.targetMonths / 2 ? 'warning' : 'danger'}
          />
          <RunwayTile
            label={config.netRunwayMonths == null ? 'Cash position' : 'Net-burn runway'}
            sub={config.netRunwayMonths == null ? 'Revenue exceeds burn' : 'At current burn vs revenue'}
            value={config.netRunwayMonths == null
              ? 'Profitable'
              : config.netRunwayMonths > 999 ? '∞' : `${config.netRunwayMonths.toFixed(1)} mo`}
            detail={config.netRunwayMonths == null
              ? `+${formatNative(Math.max(0, config.monthlySurplusNzd), 'NZD')}/mo surplus`
              : config.unreservedTaxNzd > 0
                ? `${formatNative(config.taxAdjustedCashNzd, 'NZD')} after ${formatNative(config.unreservedTaxNzd, 'NZD')} tax ÷ ${formatNative(config.netMonthlyBurnNzd, 'NZD')}/mo net`
                : `${formatNative(config.taxAdjustedCashNzd, 'NZD')} cash ÷ ${formatNative(config.netMonthlyBurnNzd, 'NZD')}/mo net`}
            tone={config.netRunwayMonths == null ? 'positive'
              : config.netRunwayMonths >= config.targetMonths ? 'positive'
              : config.netRunwayMonths >= config.targetMonths / 2 ? 'warning' : 'danger'}
          />
        </div>
        <div className="flex items-center justify-between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="text-xs text-[var(--color-text-muted)]" style={{ lineHeight: 1.5 }}>
            Worst case assumes income drops to zero. Net-burn is the real-world view that
            counts incoming MRR against your monthly outflow.
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

function MetricBlock({ label, value, sub, accent = false, compact = false }: { label: string; value: string; sub?: string; accent?: boolean; compact?: boolean }) {
  const fontSize = compact ? '1.125rem' : accent ? '1.75rem' : '1.375rem'
  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)]" style={{ fontWeight: 500 }}>{label}</div>
      <div style={{
        fontSize,
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: accent ? 'var(--color-brand-dark)' : 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
        marginTop: '0.125rem',
        lineHeight: 1.15,
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

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
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'

interface SummaryResponse {
  asOf: string
  primaryCurrency: string
  bankBalances: Array<{ currency: string; available: number; total: number; sources: string[] }>
  reserves: {
    total: number
    items: Array<{ id: string; name: string; category: string; currency: string; accruedAmount: number; targetAmount: number | null; accrualRate: number | null }>
  }
  disposableCash: number
  mrr: { retainer: number; project: number; combined: number }
  arr: number
  ytdRevenue: number
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

  const cur = data.primaryCurrency

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
          onClick={() => void fetchSummary()}
          iconLeft={<Play className="w-3.5 h-3.5" />}
        >
          Reload
        </TahiButton>
      </PageHeader>

      {/* Status strip — traffic lights per axis, plain-English label */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.875rem' }}>
        <StatusTile label="Cash runway" status={data.status.cash} hint={
          data.status.cash === 'red' ? 'Less than 1 month at current burn'
          : data.status.cash === 'amber' ? '1-3 months runway'
          : 'More than 3 months runway'
        } />
        <StatusTile label="MRR" status={data.status.mrr} hint={
          data.mrr.combined > 0 ? `${fmtCurrency(data.mrr.combined, cur)}/mo` : 'No recurring revenue tracked'
        } />
        <StatusTile label="AR" status={data.status.ar} hint={
          data.overdueCount > 0 ? `${data.overdueCount} overdue, ${fmtCurrency(data.outstandingAr, cur)} total`
          : `${fmtCurrency(data.outstandingAr, cur)} outstanding`
        } />
        <StatusTile label="Reserves" status={data.status.reserves} hint={
          data.reserves.total > 0 ? `${fmtCurrency(data.reserves.total, cur)} set aside`
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
        <div style={{ padding: '1.25rem 1.5rem' }}>
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
              {fmtCurrency(data.disposableCash, cur)}
            </span>
            <span className="text-sm text-[var(--color-text-muted)]">
              after reserves
            </span>
          </div>
          <div className="grid mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '1rem' }}>
            {data.bankBalances.map(b => (
              <div key={b.currency}>
                <div className="text-xs text-[var(--color-text-muted)]">Bank {b.currency}</div>
                <div className="text-base font-semibold text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCurrency(b.available, b.currency)}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  {b.sources.map(s => (
                    <Badge key={s} tone="neutral" variant="soft" size="sm">{s}</Badge>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <div className="text-xs text-[var(--color-text-muted)]">Reserved</div>
              <div className="text-base font-semibold text-[var(--color-text)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmtCurrency(data.reserves.total, cur)}
              </div>
              <div className="text-[0.6875rem] text-[var(--color-text-subtle)] mt-0.5">
                {data.reserves.items.length === 0 ? 'No pots configured' : `${data.reserves.items.length} pot${data.reserves.items.length === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* MRR / ARR / YTD revenue */}
      <Card>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
            Revenue
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '1.5rem' }}>
            <MetricBlock label="Combined MRR" value={fmtCurrency(data.mrr.combined, cur)} sub={`Retainer ${fmtCurrency(data.mrr.retainer, cur)} · Project ${fmtCurrency(data.mrr.project, cur)}`} accent />
            <MetricBlock label="ARR" value={fmtCurrency(data.arr, cur)} sub="Combined MRR × 12" />
            <MetricBlock label="YTD revenue" value={fmtCurrency(data.ytdRevenue, cur)} sub="Paid invoices, this calendar year" />
            <MetricBlock label="Outstanding AR" value={fmtCurrency(data.outstandingAr, cur)} sub={data.overdueCount > 0 ? `${data.overdueCount} overdue` : 'All current'} />
          </div>
        </div>
      </Card>

      {/* Sales velocity */}
      <Card>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
            Sales velocity
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1.5rem' }}>
            <MetricBlock label="Last 30 days" value={`${data.salesVelocity.last30Days.count} deals`} sub={fmtCurrency(data.salesVelocity.last30Days.value, cur)} />
            <MetricBlock label="Last 60 days" value={`${data.salesVelocity.last60Days.count} deals`} sub={fmtCurrency(data.salesVelocity.last60Days.value, cur)} />
            <MetricBlock label="Last 90 days" value={`${data.salesVelocity.last90Days.count} deals`} sub={fmtCurrency(data.salesVelocity.last90Days.value, cur)} />
          </div>
        </div>
      </Card>

      {/* Reserves breakdown */}
      {data.reserves.items.length > 0 && (
        <Card>
          <div style={{ padding: '1.25rem 1.5rem' }}>
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
                        {fmtCurrency(r.accruedAmount, r.currency)}
                        {r.targetAmount ? <span className="text-xs text-[var(--color-text-subtle)] font-normal"> / {fmtCurrency(r.targetAmount, r.currency)}</span> : null}
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

      {/* Placeholder for the "huh, that's interesting" charts half */}
      <Card>
        <div style={{ padding: '1.25rem 1.5rem' }}>
          <div className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-2">
            Coming next
          </div>
          <p className="text-sm text-[var(--color-text-muted)]" style={{ lineHeight: 1.5 }}>
            MRR stacked area · revenue per client · cost-mix donut · profit per logged hour · pipeline → cash funnel · seasonality heatmap · time-to-pay distribution. Building these in the next pass.
          </p>
        </div>
      </Card>
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

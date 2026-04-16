'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, BarChart3,
  Plus, Clock, UserPlus,
  ArrowRight, AlertTriangle, RefreshCw, Video, ExternalLink,
  CalendarClock, Loader2, TrendingUp,
  Target, Scale, Timer,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
import { OnboardingChecklist, type OnboardingState } from '@/components/tahi/onboarding-checklist'
import { BookingWidget } from '@/components/tahi/booking-widget'
import { apiPath } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

// ─── Accent colour map (CSS var references for dark mode compat) ─────────────
//
// Semantic rules:
//   brand / brand-soft / brand-dark  -- informational KPIs
//   amber  -- warnings only (outstanding invoices, in-review flags)
//   red    -- errors and overdue states only
//   neutral -- truly neutral counters
const ACCENTS = {
  brand:        { bg: 'var(--color-brand-100)', color: 'var(--color-brand)' },
  'brand-soft': { bg: 'var(--color-brand-50)',  color: 'var(--color-brand-light)' },
  'brand-dark': { bg: 'var(--color-brand-200)', color: 'var(--color-brand-dark)' },

  amber:   { bg: '#fef3c7', color: '#b45309' },
  red:     { bg: '#fee2e2', color: '#b91c1c' },
  neutral: { bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-subtle)' },

  // Legacy aliases
  violet:  { bg: 'var(--color-brand-100)', color: 'var(--color-brand)' },
  blue:    { bg: 'var(--color-brand-50)',  color: 'var(--color-brand-light)' },
  emerald: { bg: 'var(--color-brand-200)', color: 'var(--color-brand-dark)' },
  teal:    { bg: 'var(--color-brand-50)',  color: 'var(--color-brand-light)' },
} as const

type Accent = keyof typeof ACCENTS

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  activeClients: number
  openRequests: number
  inProgress: number
  outstandingInvoicesNzd: number
  mrr: number
}

interface RecentRequest {
  id: string
  title: string
  status: string
  priority: string
  type: string
  orgName: string | null
  orgId: string
  updatedAt: string
  createdAt: string
  scopeFlagged: boolean
}

interface MonthlyRevenue {
  month: string
  total: number
}

// ─── Overview Switcher (handles impersonation) ───────────────────────────────

export function OverviewSwitcher({ userName, orgName }: { userName: string; orgName: string }) {
  const { isImpersonatingClient, isImpersonatingTeamMember, impersonatedOrgName, impersonatedTeamMemberName } = useImpersonation()

  // Client impersonation: show the client portal overview
  if (isImpersonatingClient) {
    return <ClientOverview userName={userName} orgName={impersonatedOrgName ?? orgName} />
  }

  // Team member impersonation: show admin overview (they are still admin-side, just scoped)
  // The admin overview will show with a note about viewing as team member
  if (isImpersonatingTeamMember) {
    return <AdminOverview userName={impersonatedTeamMemberName ?? userName} />
  }

  return <AdminOverview userName={userName} />
}

// ─── Admin Overview ───────────────────────────────────────────────────────────

export function AdminOverview({ userName }: { userName: string }) {
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([])
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    fetch(apiPath('/api/admin/overview'))
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch overview')
        return r.json() as Promise<{ kpis: KPIs; recentRequests: RecentRequest[]; monthlyRevenue?: MonthlyRevenue[] }>
      })
      .then(data => {
        setKpis(data.kpis)
        setRecentRequests(data.recentRequests)
        setMonthlyRevenue(data.monthlyRevenue ?? [])
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  }, [])

  const firstName = userName.split(' ')[0]

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)', maxWidth: '68.75rem' }}>
      {fetchError && (
        <div
          className="flex items-center"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-base)',
            color: 'var(--color-danger)',
            gap: 'var(--space-2)',
          }}
        >
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          Failed to load overview data. Please refresh the page.
        </div>
      )}

      {/* Greeting + quick actions */}
      <div className="flex items-start justify-between" style={{ gap: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--color-text)' }}>
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Here&apos;s what&apos;s happening at Tahi today.
          </p>
        </div>
        <div className="hidden sm:flex items-center flex-shrink-0" style={{ gap: 'var(--space-2)' }}>
          <QuickBtn href="/requests?new=1" icon={<Plus size={14} aria-hidden="true" />} label="New Request" primary />
          <QuickBtn href="/clients?new=1" icon={<UserPlus size={14} aria-hidden="true" />} label="Add Client" />
          <QuickBtn href="/time?new=1" icon={<Clock size={14} aria-hidden="true" />} label="Log Time" />
        </div>
      </div>

      {/* KPI strip: single panel with internal dividers */}
      <KPIStrip kpis={kpis} loading={loading} />

      {/* Pipeline summary */}
      <PipelineSummaryCard />

      {/* Revenue trend */}
      {!loading && monthlyRevenue.length > 0 && (
        <RevenueChart data={monthlyRevenue} />
      )}

      {/* Recent requests */}
      <SectionCard title="Recent Requests" action={{ label: 'View all', href: '/requests' }}>
        {loading ? <LoadingRows /> : recentRequests.length === 0 ? (
          <EmptyRows
            title="No requests yet"
            message="When clients submit requests they'll appear here."
            action={{ label: 'Create first request', href: '/requests?new=1' }}
          />
        ) : recentRequests.slice(0, 5).map((req, i) => (
          <RequestRow key={req.id} req={req} isLast={i === Math.min(recentRequests.length, 5) - 1} showOrg />
        ))}
      </SectionCard>

      {/* Pipeline + Capacity */}
      <PipelineCapacityCard />

      {/* Upcoming Calls */}
      <UpcomingCallsWidget />

      {!loading && (kpis?.activeClients ?? 0) === 0 && <GettingStarted />}
    </div>
  )
}

// ─── Pipeline Summary Card (T360) ───────────────────────────────────────────

interface DealSummary {
  id: string
  title: string
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
}

function PipelineSummaryCard() {
  const [deals, setDeals] = useState<DealSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/deals?limit=100'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ items: DealSummary[] }>
      })
      .then(data => setDeals(data.items ?? []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  if (deals.length === 0) return null

  // Calculate totals: only open deals (not won/lost)
  const openDeals = deals.filter(d => !d.stageIsClosedWon && !d.stageIsClosedLost)
  const totalPipelineValue = openDeals.reduce((sum, d) => sum + (d.valueNzd ?? d.value ?? 0), 0)
  const weightedValue = openDeals.reduce((sum, d) => {
    const val = d.valueNzd ?? d.value ?? 0
    const prob = d.stageProbability ?? 0
    return sum + (val * prob / 100)
  }, 0)

  // Deals closing this month
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()
  const closingThisMonth = openDeals.filter(d => {
    if (!d.expectedCloseDate) return false
    const close = new Date(d.expectedCloseDate)
    return close.getMonth() === currentMonth && close.getFullYear() === currentYear
  })
  const closingThisMonthValue = closingThisMonth.reduce((sum, d) => sum + (d.valueNzd ?? d.value ?? 0), 0)

  const pipelineItems = [
    { label: 'Pipeline Value', value: formatNzd(totalPipelineValue), sub: `${openDeals.length} open deal${openDeals.length !== 1 ? 's' : ''}`, icon: <Target size={14} aria-hidden="true" /> },
    { label: 'Weighted Value', value: formatNzd(weightedValue), sub: 'probability-adjusted', icon: <Scale size={14} aria-hidden="true" /> },
    { label: 'Closing This Month', value: formatNzd(closingThisMonthValue), sub: `${closingThisMonth.length} deal${closingThisMonth.length !== 1 ? 's' : ''}`, icon: <Timer size={14} aria-hidden="true" /> },
  ]

  return (
    <Link
      href="/pipeline"
      className="block"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        textDecoration: 'none',
        overflow: 'hidden',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x" style={{ '--tw-divide-opacity': 1, borderColor: 'var(--color-border-subtle)' } as React.CSSProperties}>
        {pipelineItems.map((item) => (
          <div
            key={item.label}
            style={{ padding: 'var(--space-5)' }}
          >
            <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: '2rem',
                  height: '2rem',
                  background: 'var(--color-brand-50)',
                  color: 'var(--color-brand)',
                  borderRadius: 'var(--radius-leaf-sm)',
                }}
              >
                {item.icon}
              </div>
              <span style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--color-text-subtle)',
              }}>
                {item.label}
              </span>
            </div>
            <p className="tabular-nums" style={{
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              color: 'var(--color-text)',
              marginBottom: 'var(--space-1)',
            }}>
              {item.value}
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
              {item.sub}
            </p>
          </div>
        ))}
      </div>
    </Link>
  )
}

function formatNzd(n: number) {
  if (n === 0) return '$0'
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n)
}

// ─── Bank Runway Card (T600) ─────────────────────────────────────────────────
// Shows current bank balance (from latest Xero sync) + months of runway at
// the trailing 3-month burn rate. A dismissive note appears if no sync has
// happened yet, with a direct link to the Reports page where the sync
// buttons live.

interface BankRunwayData {
  asOf: string | null
  accounts: Array<{ accountId: string; accountName: string; currency: string; balance: number; balanceNzd: number }>
  totalBalanceNzd: number
  avgMonthlyBurnNzd: number
  runwayMonths: number | null
  lastSyncedAt: string | null
}

function BankRunwayCard() {
  const [data, setData] = useState<BankRunwayData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/reports/bank-balances'))
      .then(r => r.ok ? r.json() as Promise<BankRunwayData> : Promise.reject())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="rounded-xl border p-5 animate-pulse" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
        <div className="h-4 rounded" style={{ background: 'var(--color-bg-tertiary)', width: '30%' }} />
        <div className="h-8 rounded mt-3" style={{ background: 'var(--color-bg-tertiary)', width: '50%' }} />
      </div>
    )
  }

  const noData = !data || data.accounts.length === 0

  if (noData) {
    return (
      <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Bank & Runway</div>
            <div className="text-base font-medium text-[var(--color-text)] mt-1">No Xero bank data yet</div>
            <div className="text-xs text-[var(--color-text-subtle)] mt-1">Run a bank + P&L sync from the Reports page.</div>
          </div>
          <Link href="/reports" className="text-sm font-medium text-[var(--color-brand)] hover:underline">
            Go to Reports →
          </Link>
        </div>
      </div>
    )
  }

  const runway = data.runwayMonths
  const runwayColour = runway === null ? 'var(--color-text-muted)'
    : runway >= 12 ? 'var(--color-success)'
    : runway >= 6 ? 'var(--color-warning)'
    : 'var(--color-danger)'
  const runwayLabel = runway === null ? 'Need more months of P&L data'
    : runway >= 24 ? `${Math.floor(runway)}+ months of runway`
    : `${runway.toFixed(1)} months of runway`

  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Bank & Runway</div>
          <div className="flex items-baseline gap-3 mt-1">
            <div className="text-2xl font-bold text-[var(--color-text)]">{formatNzd(data.totalBalanceNzd)}</div>
            <div className="text-xs text-[var(--color-text-subtle)]">across {data.accounts.length} account{data.accounts.length === 1 ? '' : 's'}</div>
          </div>
          <div className="text-sm mt-1" style={{ color: runwayColour, fontWeight: 500 }}>{runwayLabel}</div>
          {data.avgMonthlyBurnNzd > 0 && (
            <div className="text-xs text-[var(--color-text-subtle)] mt-0.5">
              Burn rate: {formatNzd(data.avgMonthlyBurnNzd)}/mo (3-mo avg)
            </div>
          )}
          {data.asOf && (
            <div className="text-xs text-[var(--color-text-subtle)] mt-0.5">As of {data.asOf}</div>
          )}
        </div>
        <div className="flex flex-col gap-1 text-xs min-w-[12rem]">
          {data.accounts.slice(0, 4).map(a => (
            <div key={a.accountId} className="flex justify-between gap-3">
              <span className="text-[var(--color-text-muted)] truncate">{a.accountName}</span>
              <span className="text-[var(--color-text)] font-medium whitespace-nowrap">
                {new Intl.NumberFormat('en-NZ', { style: 'currency', currency: a.currency, maximumFractionDigits: 0 }).format(a.balance)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Pipeline Capacity Card ──────────────────────────────────────────────────

interface CapacityData {
  teamMembers: Array<{
    id: string
    name: string
    weeklyCapacityHours: number
    currentHoursAllocated: number
    utilization: number
  }>
  totalCapacity: number
  totalAllocated: number
  pipelineImpact: number
  availableCapacity: number
  forecastedCapacity: number
}

function PipelineCapacityCard() {
  const [data, setData] = useState<CapacityData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/pipeline/capacity'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<CapacityData>
      })
      .then(setData)
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <SectionCard title="Team Capacity">
        <LoadingRows />
      </SectionCard>
    )
  }

  if (!data) return null

  const utilizationPct = data.totalCapacity > 0
    ? Math.round((data.totalAllocated / data.totalCapacity) * 100)
    : 0

  const barColor = utilizationPct > 90
    ? 'var(--color-danger)'
    : utilizationPct > 70
      ? 'var(--color-warning)'
      : 'var(--color-brand)'

  return (
    <SectionCard title="Team Capacity" action={{ label: 'View pipeline', href: '/pipeline' }}>
      <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
        {/* Overall utilization */}
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-1-5)' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
            Overall Utilization
          </span>
          <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: barColor }}>
            {utilizationPct}%
          </span>
        </div>
        <div className="overflow-hidden" style={{ height: 'var(--space-2)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-full)', marginBottom: 'var(--space-5)' }}>
          <div style={{ height: '100%', width: `${Math.min(utilizationPct, 100)}%`, background: barColor, borderRadius: 'var(--radius-full)', transition: 'width 300ms ease' }} />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
          {[
            { label: 'Available', value: `${data.availableCapacity}h`, color: 'var(--color-text)' },
            { label: 'Pipeline', value: `${data.pipelineImpact}h`, color: 'var(--color-warning)' },
            { label: 'Forecast', value: `${data.forecastedCapacity}h`, color: data.forecastedCapacity < 0 ? 'var(--color-danger)' : 'var(--color-brand)' },
          ].map(stat => (
            <div key={stat.label} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-0-5)' }}>
                {stat.label}
              </p>
              <p className="tabular-nums" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: stat.color }}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Per-member bars */}
        {data.teamMembers.length > 0 && (
          <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-3)' }}>
              Team Members
            </p>
            <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
              {data.teamMembers.slice(0, 5).map(m => {
                const memberBarColor = m.utilization > 85 ? 'var(--color-danger)' : m.utilization >= 60 ? 'var(--color-warning)' : 'var(--color-brand)'
                return (
                  <div key={m.id} style={{ background: 'var(--color-bg-secondary)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-1-5)' }}>
                      <span className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', maxWidth: '10rem' }}>
                        {m.name}
                      </span>
                      <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                        <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                          {m.currentHoursAllocated}h / {m.weeklyCapacityHours}h
                        </span>
                        <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: memberBarColor }}>
                          {m.utilization}%
                        </span>
                      </div>
                    </div>
                    <div className="overflow-hidden" style={{ height: 'var(--space-2)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-full)' }}>
                      <div style={{ height: '100%', width: `${Math.min(m.utilization, 100)}%`, background: memberBarColor, borderRadius: 'var(--radius-full)', transition: 'width 300ms ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Earliest Start Date calculator */}
        <EarliestStartDateWidget />

        {/* Pipeline Impact (T478) */}
        <PipelineImpactCard />
      </div>
    </SectionCard>
  )
}

// ─── Pipeline Impact Card (T478) ────────────────────────────────────────────

interface PipelineForecast {
  totalWeightedHours: number
  bestCaseHours: number
  worstCaseHours: number
  dealCount: number
}

function PipelineImpactCard() {
  const [forecast, setForecast] = useState<PipelineForecast | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(apiPath('/api/admin/capacity/forecast'))
        if (!res.ok) throw new Error('Failed')
        const d = await res.json() as {
          totalWeightedHours?: number
          bestCaseHours?: number
          worstCaseHours?: number
          dealCount?: number
        }
        if (!cancelled && d.totalWeightedHours !== undefined) {
          setForecast({
            totalWeightedHours: d.totalWeightedHours ?? 0,
            bestCaseHours: d.bestCaseHours ?? 0,
            worstCaseHours: d.worstCaseHours ?? 0,
            dealCount: d.dealCount ?? 0,
          })
        }
      } catch {
        // Fallback: derive from deals data
        try {
          const dealsRes = await fetch(apiPath('/api/admin/deals?limit=100'))
          if (!dealsRes.ok) throw new Error('Failed')
          const dealsJson = await dealsRes.json() as {
            items: Array<{
              stageIsClosedWon: number | null
              stageIsClosedLost: number | null
              stageProbability: number | null
              estimatedHours?: number | null
              valueNzd: number | null
              value: number | null
            }>
          }
          const openDeals = (dealsJson.items ?? []).filter(
            d => !d.stageIsClosedWon && !d.stageIsClosedLost
          )
          // Estimate hours from deal value (rough: $100/hr assumed)
          const hourlyRate = 100
          let weightedHrs = 0
          let bestHrs = 0
          let worstHrs = 0
          for (const deal of openDeals) {
            const val = deal.valueNzd ?? deal.value ?? 0
            const prob = deal.stageProbability ?? 0
            const hrs = deal.estimatedHours ?? (val / hourlyRate)
            weightedHrs += hrs * (prob / 100)
            bestHrs += hrs
            worstHrs += hrs * Math.max(prob - 20, 0) / 100
          }
          if (!cancelled) {
            setForecast({
              totalWeightedHours: Math.round(weightedHrs),
              bestCaseHours: Math.round(bestHrs),
              worstCaseHours: Math.round(worstHrs),
              dealCount: openDeals.length,
            })
          }
        } catch {
          // silent
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading || !forecast) return null
  if (forecast.dealCount === 0) return null

  const impactItems = [
    { label: 'Weighted', value: `${forecast.totalWeightedHours}h`, sub: `${forecast.dealCount} deal${forecast.dealCount !== 1 ? 's' : ''}`, color: 'var(--color-brand)' },
    { label: 'Best Case', value: `${forecast.bestCaseHours}h`, sub: 'all deals close', color: 'var(--color-info)' },
    { label: 'Worst Case', value: `${forecast.worstCaseHours}h`, sub: 'conservative', color: 'var(--color-warning)' },
  ]

  return (
    <div id="capacity" style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-1)' }}>
      <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-3)' }}>
        Pipeline Impact
      </p>
      <div className="grid grid-cols-3" style={{ gap: 'var(--space-3)' }}>
        {impactItems.map(item => (
          <div key={item.label} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-0-5)' }}>
              {item.label}
            </p>
            <p className="tabular-nums" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: item.color }}>
              {item.value}
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
              {item.sub}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Earliest Start Date Widget ──────────────────────────────────────────────

interface StartDateResult {
  earliestDate: string | null
  availableHoursPerWeek: number
  totalTeamCapacity: number
  committedHours: number
  weeksOut: number
}

function EarliestStartDateWidget() {
  const [hoursPerWeek, setHoursPerWeek] = useState('')
  const [result, setResult] = useState<StartDateResult | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [hovered, setHovered] = useState(false)

  const calculate = async () => {
    const hours = parseFloat(hoursPerWeek)
    if (!hours || hours <= 0) return
    setCalculating(true)
    setResult(null)
    try {
      const res = await fetch(apiPath('/api/admin/capacity/start-date'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimatedHoursPerWeek: hours }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as StartDateResult
      setResult(data)
    } catch {
      setResult(null)
    } finally {
      setCalculating(false)
    }
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-1)' }}>
      <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-3)' }}>
        Earliest Start Date
      </p>
      <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="Hours/week needed"
            value={hoursPerWeek}
            onChange={e => { setHoursPerWeek(e.target.value); setResult(null) }}
            onKeyDown={e => { if (e.key === 'Enter') calculate() }}
            aria-label="Hours per week needed"
            style={{
              width: '100%',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-input)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              outline: 'none',
              minHeight: '2.25rem',
            }}
          />
        </div>
        <button
          onClick={calculate}
          disabled={calculating || !hoursPerWeek || parseFloat(hoursPerWeek) <= 0}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            color: '#ffffff',
            background: hovered ? 'var(--color-brand-dark)' : 'var(--color-brand)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            minHeight: '2.25rem',
            whiteSpace: 'nowrap',
            transition: 'background 150ms ease',
          }}
        >
          {calculating ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <CalendarClock size={14} aria-hidden="true" />
          )}
          Calculate
        </button>
      </div>

      {result && (
        <div style={{
          marginTop: 'var(--space-3)',
          padding: 'var(--space-3)',
          background: result.earliestDate ? 'var(--color-brand-50)' : 'var(--status-in-review-bg)',
          borderRadius: 'var(--radius-md)',
        }}>
          {result.earliestDate ? (
            <div>
              <div className="flex items-center" style={{ gap: 'var(--space-1-5)', marginBottom: 'var(--space-1)' }}>
                <CalendarClock size={14} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
                <span style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--color-brand-dark)' }}>
                  {formatDate(result.earliestDate)}
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
                {result.weeksOut === 1 ? 'Next week' : `${result.weeksOut} weeks out`}
                {' \u2014 '}
                {result.availableHoursPerWeek}h/week available of {result.totalTeamCapacity}h total
              </p>
            </div>
          ) : (
            <div>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-danger)' }}>
                No capacity available in the next 12 weeks
              </span>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 'var(--space-1) 0 0' }}>
                {result.availableHoursPerWeek}h/week available, {parseFloat(hoursPerWeek)}h/week needed
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Client Overview ──────────────────────────────────────────────────────────

export function ClientOverview({ userName, orgName }: { userName: string; orgName: string }) {
  const [requests, setRequests] = useState<RecentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    fetch(apiPath('/api/portal/requests?status=active&page=1'))
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch requests')
        return r.json() as Promise<{ requests: RecentRequest[] }>
      })
      .then(data => setRequests(data.requests ?? []))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  }, [])

  const open = requests.filter(r => !['delivered', 'archived'].includes(r.status))
  const inReview = requests.filter(r => r.status === 'client_review')
  const firstName = userName.split(' ')[0]

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)', maxWidth: '56.25rem' }}>
      {fetchError && (
        <div
          className="flex items-center"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-base)',
            color: 'var(--color-danger)',
            gap: 'var(--space-2)',
          }}
        >
          <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          Failed to load your requests. Please refresh the page.
        </div>
      )}

      {/* Greeting */}
      <div className="flex items-start justify-between" style={{ gap: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--color-text)' }}>
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            {orgName} (Tahi Studio workspace)
          </p>
        </div>
        <Link
          href="/requests?new=1"
          className="flex-shrink-0 flex items-center hover:opacity-90"
          style={{
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--color-brand)',
            color: 'white',
            borderRadius: 'var(--radius-leaf-sm)',
            textDecoration: 'none',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            gap: 'var(--space-1-5)',
            transition: 'opacity 150ms ease',
          }}
        >
          <Plus size={14} aria-hidden="true" />
          New Request
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 'var(--space-4)' }}>
        <StatCard
          label="Open Requests"
          value={loading ? null : open.length}
          icon={<Inbox size={18} />}
          href="/requests"
          accent="blue"
        />
        <StatCard
          label="Awaiting Review"
          value={loading ? null : inReview.length}
          icon={<RefreshCw size={18} />}
          href="/requests?status=client_review"
          accent={inReview.length > 0 ? 'amber' : 'teal'}
          highlight={inReview.length > 0}
        />
        <StatCard
          label="Invoices Due"
          value="--"
          icon={<FileText size={18} />}
          href="/invoices"
          accent="neutral"
        />
      </div>

      {/* Track capacity card */}
      <TrackCapacityCard />

      {/* Review alert */}
      {inReview.length > 0 && (
        <div
          className="flex items-start"
          style={{
            padding: 'var(--space-4)',
            background: 'var(--status-in-review-bg)',
            border: '1px solid var(--status-in-review-border)',
            borderRadius: 'var(--radius-lg)',
            gap: 'var(--space-3)',
          }}
        >
          <RefreshCw size={16} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--status-in-review-dot)', marginTop: '0.125rem' }} />
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--status-in-review-text)' }}>
              {inReview.length} request{inReview.length > 1 ? 's' : ''} waiting for your review
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--status-in-review-text)', marginTop: 'var(--space-0-5)' }}>
              Please approve or request changes.
            </p>
          </div>
          <Link
            href="/requests?status=client_review"
            className="flex items-center whitespace-nowrap hover:underline"
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--status-in-review-text)',
              gap: 'var(--space-1)',
            }}
          >
            Review now <ArrowRight size={12} aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* Onboarding Checklist */}
      <OnboardingChecklistWrapper />

      {/* Schedule a Call (T88) */}
      <ScheduleCallWidget />

      {/* Book a Call - Google Calendar embed */}
      <BookingWidget />

      {/* Review outreach banner (T107) */}
      <ReviewOutreachBanner />

      {/* Recent requests */}
      <SectionCard title="Your Requests" action={{ label: 'View all', href: '/requests' }}>
        {loading ? <LoadingRows /> : requests.length === 0 ? (
          <EmptyRows
            title="No requests yet"
            message="Submit your first request and the Tahi team will get started."
            action={{ label: 'Submit a request', href: '/requests?new=1' }}
          />
        ) : requests.slice(0, 6).map((req, i) => (
          <RequestRow key={req.id} req={req} isLast={i === Math.min(requests.length, 6) - 1} />
        ))}
      </SectionCard>
    </div>
  )
}

// ─── Onboarding Checklist Wrapper ──────────────────────────────────────────────

function OnboardingChecklistWrapper() {
  const [state, setState] = useState<Record<string, boolean> | null>(null)
  const [loomUrl, setLoomUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  const fetchOnboarding = useCallback(async () => {
    if (typeof window !== 'undefined' && localStorage.getItem('tahi-onboarding-dismissed') === '1') {
      setDismissed(true)
      setLoading(false)
      return
    }
    try {
      const res = await fetch(apiPath('/api/portal/onboarding'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as {
        onboardingState: Record<string, boolean>
        onboardingLoomUrl: string | null
      }
      setState(data.onboardingState)
      setLoomUrl(data.onboardingLoomUrl)
    } catch {
      setState(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchOnboarding() }, [fetchOnboarding])

  async function handleToggleStep(step: string, completed: boolean) {
    if (!state) return
    setState(prev => prev ? { ...prev, [step]: completed } : prev)
    try {
      await fetch(apiPath('/api/portal/onboarding'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, completed }),
      })
    } catch {
      setState(prev => prev ? { ...prev, [step]: !completed } : prev)
    }
  }

  function handleDismiss() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('tahi-onboarding-dismissed', '1')
    }
    setDismissed(true)
  }

  if (loading || dismissed || !state) return null

  const onboardingState: OnboardingState = {
    welcomeVideoWatched: state.welcomeVideoWatched ?? false,
    brandAssetsUploaded: state.brandAssetsUploaded ?? false,
    firstRequestSubmitted: state.firstRequestSubmitted ?? false,
    billingSetUp: state.billingSetUp ?? false,
    meetTheTeam: state.meetTheTeam ?? false,
  }

  return (
    <OnboardingChecklist
      state={onboardingState}
      loomUrl={loomUrl}
      onToggleStep={(step, completed) => handleToggleStep(step, completed)}
      onDismiss={handleDismiss}
    />
  )
}

// ─── KPI Strip (grouped panel with dividers) ────────────────────────────────

function KPIStrip({ kpis, loading }: { kpis: KPIs | null; loading: boolean }) {
  const items: Array<{
    label: string
    value: number | string | null
    icon: React.ReactNode
    href: string
    sub?: string
  }> = [
    {
      label: 'Active Clients',
      value: loading ? null : kpis?.activeClients ?? 0,
      icon: <Users size={16} aria-hidden="true" />,
      href: '/clients',
      sub: 'across all plans',
    },
    {
      label: 'Open Requests',
      value: loading ? null : kpis?.openRequests ?? 0,
      icon: <Inbox size={16} aria-hidden="true" />,
      href: '/requests',
      sub: kpis ? `${kpis.inProgress} in progress` : undefined,
    },
    {
      label: 'Outstanding',
      value: loading ? null : formatNzd(kpis?.outstandingInvoicesNzd ?? 0),
      icon: <FileText size={16} aria-hidden="true" />,
      href: '/invoices',
      sub: 'invoices',
    },
    {
      label: 'MRR',
      value: loading ? null : formatNzd(kpis?.mrr ?? 0),
      icon: <BarChart3 size={16} aria-hidden="true" />,
      href: '/reports',
      sub: 'recurring retainers',
    },
  ]

  return (
    <div
      data-tour="overview-kpis"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => {
          // On 2-col mobile: items 0,1 get bottom border. Items 0,2 get right border.
          // On 4-col desktop: all except last get right border, no bottom borders.
          const rightBorder = i < items.length - 1 ? '1px solid var(--color-border-subtle)' : 'none'
          const bottomBorder = i < 2 ? '1px solid var(--color-border-subtle)' : 'none'
          return (
            <Link
              key={item.label}
              href={item.href}
              className="group relative flex flex-col kpi-strip-item"
              style={{
                padding: 'var(--space-5)',
                textDecoration: 'none',
                borderRight: rightBorder,
                borderBottom: bottomBorder,
                transition: 'background-color 150ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              {/* Icon + label */}
              <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <div
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    width: '2rem',
                    height: '2rem',
                    background: 'var(--color-brand-50)',
                    color: 'var(--color-brand)',
                    borderRadius: 'var(--radius-leaf-sm)',
                  }}
                >
                  {item.icon}
                </div>
                <span style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text-muted)',
                }}>
                  {item.label}
                </span>
              </div>

              {/* Value */}
              {item.value === null ? (
                <div className="animate-pulse" style={{
                  height: '1.75rem',
                  width: '3.5rem',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-sm)',
                }} />
              ) : (
                <p className="tabular-nums" style={{
                  fontSize: 'var(--text-2xl)',
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: 'var(--color-text)',
                }}>
                  {item.value}
                </p>
              )}

              {/* Sub label */}
              {item.sub && (
                <p style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-subtle)',
                  marginTop: 'var(--space-1)',
                }}>
                  {item.sub}
                </p>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── StatCard (used by client portal) ────────────────────────────────────────

function StatCard({
  label, value, icon, href, accent, sub, highlight,
}: {
  label: string
  value: number | string | null
  icon: React.ReactNode
  href: string
  accent: Accent
  sub?: string
  highlight?: boolean
}) {
  const a = ACCENTS[accent]
  return (
    <Link
      href={href}
      className="group block"
      style={{
        padding: 'var(--space-5)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        textDecoration: 'none',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Icon row */}
      <div className="flex items-start justify-between" style={{ marginBottom: 'var(--space-4)' }}>
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: '2.5rem',
            height: '2.5rem',
            background: a.bg,
            color: a.color,
            borderRadius: 'var(--radius-leaf-sm)',
          }}
        >
          {icon}
        </div>
        {highlight && (
          <span style={{
            padding: 'var(--space-0-5) var(--space-2)',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            background: 'var(--status-in-review-bg)',
            color: 'var(--status-in-review-text)',
            borderRadius: 'var(--radius-full)',
          }}>
            Action needed
          </span>
        )}
      </div>

      {/* Value */}
      {value === null ? (
        <div className="animate-pulse" style={{
          height: '2rem',
          width: '3.5rem',
          background: 'var(--color-bg-tertiary)',
          borderRadius: 'var(--radius-sm)',
          marginBottom: 'var(--space-2)',
        }} />
      ) : (
        <p className="tabular-nums" style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          lineHeight: 1.2,
          color: 'var(--color-text)',
          marginBottom: 'var(--space-2)',
        }}>
          {value}
        </p>
      )}

      {/* Label */}
      <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text-muted)' }}>{label}</p>
      {sub && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>{sub}</p>}
    </Link>
  )
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function SectionCard({
  title, action, children,
}: {
  title: string
  action?: { label: string; href: string }
  children: React.ReactNode
}) {
  return (
    <div
      className="overflow-hidden"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>{title}</h2>
        {action && (
          <Link
            href={action.href}
            className="flex items-center hover:underline"
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-brand)',
              gap: 'var(--space-1)',
            }}
          >
            {action.label} <ArrowRight size={12} aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </div>
  )
}

// ─── Request row ──────────────────────────────────────────────────────────────

function RequestRow({ req, isLast, showOrg }: { req: RecentRequest; isLast: boolean; showOrg?: boolean }) {
  return (
    <Link
      href={`/requests/${req.id}`}
      className="flex items-center group"
      style={{
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
        textDecoration: 'none',
        gap: 'var(--space-3)',
        transition: 'background-color 150ms ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-row-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <StatusBadge status={req.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center" style={{ gap: 'var(--space-1-5)' }}>
          <p className="truncate" style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
            {req.title}
          </p>
          {req.scopeFlagged && (
            <AlertTriangle size={12} aria-hidden="true" style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
          )}
          {req.priority === 'high' && (
            <span
              className="flex-shrink-0"
              style={{
                padding: 'var(--space-0-5) var(--space-2)',
                background: 'var(--status-in-review-bg)',
                color: 'var(--status-in-review-text)',
                fontSize: '0.625rem',
                fontWeight: 600,
                borderRadius: 'var(--radius-full)',
              }}
            >
              High
            </span>
          )}
        </div>
        <p className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
          {showOrg && req.orgName ? `${req.orgName} \u00b7 ` : ''}
          {req.type.replace(/_/g, ' ')}
        </p>
      </div>
      <span className="tabular-nums flex-shrink-0" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
        {timeAgo(req.updatedAt)}
      </span>
      <ArrowRight size={14} aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--color-border)', opacity: 0, transition: 'opacity 150ms ease' }} />
    </Link>
  )
}

// ─── Loading rows ─────────────────────────────────────────────────────────────

function LoadingRows() {
  return (
    <div>
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="flex items-center animate-pulse"
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: i < 3 ? '1px solid var(--color-border-subtle)' : 'none',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ width: '5rem', height: '1.375rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-full)' }} />
          <div className="flex-1 flex flex-col" style={{ gap: 'var(--space-1-5)' }}>
            <div style={{ height: '0.8125rem', width: '60%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
            <div style={{ height: '0.6875rem', width: '35%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
          </div>
          <div style={{ height: '0.6875rem', width: '3rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
        </div>
      ))}
    </div>
  )
}

// ─── Empty rows ───────────────────────────────────────────────────────────────

function EmptyRows({
  title, message, action,
}: {
  title: string
  message: string
  action?: { label: string; href: string }
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: 'var(--space-12) var(--space-6)', gap: 'var(--space-2)' }}>
      <div
        className="flex items-center justify-center brand-gradient"
        style={{
          width: '2.75rem',
          height: '2.75rem',
          borderRadius: 'var(--radius-leaf-sm)',
          marginBottom: 'var(--space-1)',
        }}
      >
        <Inbox size={20} style={{ color: 'white' }} aria-hidden="true" />
      </div>
      <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>{title}</p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', maxWidth: '17.5rem' }}>{message}</p>
      {action && (
        <Link
          href={action.href}
          className="flex items-center hover:underline"
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-brand)',
            gap: 'var(--space-1)',
            marginTop: 'var(--space-1)',
          }}
        >
          {action.label} <ArrowRight size={12} aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

// ─── Quick action buttons ─────────────────────────────────────────────────────

function QuickBtn({
  href, icon, label, primary,
}: {
  href: string
  icon: React.ReactNode
  label: string
  primary?: boolean
}) {
  return (
    <Link
      href={href}
      className="flex items-center hover:opacity-90"
      style={primary
        ? {
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-brand)',
            color: 'white',
            border: '1px solid var(--color-brand)',
            borderRadius: 'var(--radius-leaf-sm)',
            textDecoration: 'none',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            gap: 'var(--space-1-5)',
            transition: 'opacity 150ms ease',
          }
        : {
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            textDecoration: 'none',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            gap: 'var(--space-1-5)',
            transition: 'border-color 150ms ease',
          }
      }
      onMouseEnter={e => { if (!primary) e.currentTarget.style.borderColor = 'var(--color-border)' }}
      onMouseLeave={e => { if (!primary) e.currentTarget.style.borderColor = 'var(--color-border-subtle)' }}
    >
      {icon}
      {label}
    </Link>
  )
}

// ─── Upcoming Calls Widget ───────────────────────────────────────────────────

interface UpcomingCall {
  id: string
  orgName: string | null
  title: string
  scheduledAt: string
  durationMinutes: number
  meetingUrl: string | null
}

function UpcomingCallsWidget() {
  const [calls, setCalls] = useState<UpcomingCall[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/calls?status=scheduled&limit=5'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ calls: UpcomingCall[] }>
      })
      .then(data => setCalls(data.calls ?? []))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false))
  }, [])

  if (!loading && calls.length === 0) return null

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>Upcoming Calls</h2>
        <Link
          href="/calls"
          className="flex items-center hover:underline"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-brand)', gap: 'var(--space-1)' }}
        >
          View all <ArrowRight size={12} aria-hidden="true" />
        </Link>
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
        {loading ? <LoadingRows /> : calls.map(call => {
          const d = new Date(call.scheduledAt)
          return (
            <div
              key={call.id}
              className="flex items-center"
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                gap: 'var(--space-3)',
                transition: 'border-color 150ms ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)' }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{
                  width: '2rem',
                  height: '2rem',
                  background: 'var(--color-brand-50)',
                  color: 'var(--color-brand)',
                  borderRadius: 'var(--radius-leaf-sm)',
                }}
              >
                <Video size={14} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
                  {call.title}
                </p>
                <p className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
                  {call.orgName ? `${call.orgName} \u00b7 ` : ''}
                  {d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                  {' at '}
                  {d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
                  {' '}({call.durationMinutes}min)
                </p>
              </div>
              {call.meetingUrl && (
                <a
                  href={call.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center hover:underline flex-shrink-0"
                  style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-brand)', gap: 'var(--space-1)' }}
                >
                  Join <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Getting started ──────────────────────────────────────────────────────────

function GettingStarted() {
  const steps = [
    { n: 1, label: 'Add your first client',           href: '/clients?new=1' },
    { n: 2, label: 'Create a subscription or project', href: '/billing'       },
    { n: 3, label: 'Submit a request on their behalf', href: '/requests?new=1'},
    { n: 4, label: 'Connect Stripe for billing',       href: '/settings'      },
  ]
  return (
    <div style={{
      padding: 'var(--space-6)',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)', marginBottom: 'var(--space-1)' }}>
        Getting started
      </h2>
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-5)' }}>
        Complete these steps to set up your dashboard.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 'var(--space-3)' }}>
        {steps.map(s => (
          <Link
            key={s.n}
            href={s.href}
            className="flex items-center"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
              gap: 'var(--space-3)',
              transition: 'border-color 150ms ease, background-color 150ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-brand-200)'
              e.currentTarget.style.backgroundColor = 'var(--color-brand-50)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
              e.currentTarget.style.backgroundColor = 'transparent'
            }}
          >
            <span
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: '1.5rem',
                height: '1.5rem',
                background: 'var(--color-brand)',
                color: 'white',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
              }}
            >
              {s.n}
            </span>
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text)', flex: 1 }}>{s.label}</span>
            <ArrowRight size={14} aria-hidden="true" style={{ color: 'var(--color-border)' }} />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Schedule Call Widget (client portal, T88) ──────────────────────────────

function ScheduleCallWidget() {
  const [bookingUrl, setBookingUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch(apiPath('/api/portal/settings/booking'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ url: string | null }>
      })
      .then(data => setBookingUrl(data.url ?? null))
      .catch(() => setBookingUrl(null))
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded || !bookingUrl) return null

  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: 'var(--space-4) var(--space-5)',
        background: 'var(--color-brand-50)',
        border: '1px solid var(--color-brand-100)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <div>
        <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-brand-dark)' }}>
          Need to chat?
        </p>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-0-5)' }}>
          Book a quick call with the Tahi team.
        </p>
      </div>
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center hover:opacity-90"
        style={{
          padding: 'var(--space-2) var(--space-4)',
          background: 'var(--color-brand)',
          color: 'white',
          borderRadius: 'var(--radius-leaf-sm)',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          gap: 'var(--space-1-5)',
          transition: 'opacity 150ms ease',
        }}
      >
        <Video size={14} aria-hidden="true" />
        Schedule a Call
      </a>
    </div>
  )
}

// ─── Track Capacity Card (Client Portal) ────────────────────────────────────

interface TrackData {
  id: string
  type: string
  isPriorityTrack: boolean
  currentRequest: { id: string; title: string; status: string } | null
}

interface CapacityData {
  subscription: { planType: string; hasPrioritySupport: boolean } | null
  entitlements: { smallTracks: number; largeTracks: number; totalSlots: number; canUseLargeTrack: boolean }
  summary: string
  tracks: TrackData[]
  queue: Array<{ id: string; title: string; status: string; priority: string }>
}

function TrackCapacityCard() {
  const [data, setData] = useState<CapacityData | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch(apiPath('/api/portal/capacity'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<CapacityData>
      })
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded || !data?.subscription) return null

  const plan = data.subscription

  // Build upsell messages based on plan
  const upsells: string[] = []
  if (plan.planType === 'maintain' && !plan.hasPrioritySupport) {
    upsells.push('Add Priority Support for an extra small track')
    upsells.push('Upgrade to Scale for large tasks and more capacity')
  } else if (plan.planType === 'maintain' && plan.hasPrioritySupport) {
    upsells.push('Upgrade to Scale for large tasks and more capacity')
  } else if (plan.planType === 'scale' && !plan.hasPrioritySupport) {
    upsells.push('Add Priority Support for an extra small track')
  }

  return (
    <div
      className="rounded-xl"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}
    >
      {/* Header */}
      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Your Plan: <span className="capitalize">{plan.planType}</span>
              {plan.hasPrioritySupport && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: 'var(--color-brand-50)', color: 'var(--color-brand)' }}
                >
                  Priority
                </span>
              )}
            </h3>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
              {data.summary}
            </p>
          </div>
        </div>
      </div>

      {/* Track slots */}
      <div style={{ padding: '1rem 1.25rem' }}>
        <div className="flex gap-3 flex-wrap">
          {data.tracks.map(track => {
            const isOccupied = !!track.currentRequest
            return (
              <div
                key={track.id}
                style={{
                  flex: '1 1 8rem',
                  minWidth: '8rem',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-card)',
                  border: `2px solid ${isOccupied ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
                  background: isOccupied ? 'var(--color-brand-50)' : 'var(--color-bg-secondary)',
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <div
                    style={{
                      width: '0.5rem',
                      height: '0.5rem',
                      borderRadius: '50%',
                      background: isOccupied ? 'var(--color-brand)' : 'var(--color-border)',
                    }}
                  />
                  <span className="text-xs font-medium uppercase" style={{ color: 'var(--color-text-muted)' }}>
                    {track.type === 'large' ? 'Large' : 'Small'} Track
                    {track.isPriorityTrack ? ' (Priority)' : ''}
                  </span>
                </div>
                {isOccupied ? (
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {track.currentRequest?.title}
                  </p>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--color-text-subtle)' }}>
                    Available
                  </p>
                )}
              </div>
            )
          })}
        </div>

        {/* Queue */}
        {data.queue.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Queue ({data.queue.length} waiting)
            </p>
            <div className="flex flex-col gap-1">
              {data.queue.slice(0, 5).map((req, i) => (
                <div key={req.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                  <span style={{ color: 'var(--color-text-subtle)', fontWeight: 500, minWidth: '1rem' }}>{i + 1}.</span>
                  <span className="truncate">{req.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Upsell */}
      {upsells.length > 0 && (
        <div style={{
          padding: '0.75rem 1.25rem',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg-secondary)',
        }}>
          {upsells.map((msg, i) => (
            <div key={i} className="flex items-center gap-2" style={{ marginTop: i > 0 ? '0.375rem' : 0 }}>
              <TrendingUp size={12} style={{ color: 'var(--color-brand)', flexShrink: 0 }} />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Full package badge */}
      {plan.planType === 'scale' && plan.hasPrioritySupport && (
        <div style={{
          padding: '0.5rem 1.25rem',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-success-bg)',
          textAlign: 'center',
        }}>
          <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
            You have the full package
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Review Outreach Banner (T107) ───────────────────────────────────────────

function ReviewOutreachBanner() {
  const [show, setShow] = useState(false)
  const [responding, setResponding] = useState(false)

  useEffect(() => {
    fetch(apiPath('/api/portal/review-outreach'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ pending: boolean }>
      })
      .then(data => setShow(data.pending))
      .catch(() => setShow(false))
  }, [])

  if (!show) return null

  const handleResponse = async (action: 'yes' | 'defer' | 'no') => {
    setResponding(true)
    try {
      await fetch(apiPath('/api/portal/review-outreach'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      setShow(false)
    } catch {
      // silent
    } finally {
      setResponding(false)
    }
  }

  return (
    <div style={{
      padding: 'var(--space-5)',
      background: 'var(--color-info-bg)',
      border: '1px solid var(--color-info)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
        We would love your feedback!
      </p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)', marginBottom: 'var(--space-3)' }}>
        Your experience matters. Share a quick review to help us improve.
      </p>
      <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
        <button
          onClick={() => handleResponse('yes')}
          disabled={responding}
          className="hover:opacity-90"
          style={{
            padding: 'var(--space-1-5) var(--space-3)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'white',
            background: 'var(--color-brand)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            transition: 'opacity 150ms ease',
          }}
        >
          Yes, I will
        </button>
        <button
          onClick={() => handleResponse('defer')}
          disabled={responding}
          className="hover:opacity-90"
          style={{
            padding: 'var(--space-1-5) var(--space-3)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            borderRadius: 'var(--radius-md)',
            transition: 'opacity 150ms ease',
          }}
        >
          Not right now
        </button>
        <button
          onClick={() => handleResponse('no')}
          disabled={responding}
          className="hover:opacity-90"
          style={{
            padding: 'var(--space-1-5) var(--space-3)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-subtle)',
            transition: 'opacity 150ms ease',
          }}
        >
          No thanks
        </button>
      </div>
    </div>
  )
}

// ─── Revenue Chart ───────────────────────────────────────────────────────────

function RevenueChart({ data }: { data: MonthlyRevenue[] }) {
  const chartData = data.map(d => {
    let label = d.month
    try {
      const [year, month] = d.month.split('-')
      const dt = new Date(parseInt(year), parseInt(month) - 1)
      label = dt.toLocaleDateString('en-NZ', { month: 'short' })
    } catch { /* keep raw */ }
    return { month: label, total: d.total }
  })

  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-5)',
    }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-5)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>Revenue Trend</h2>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-0-5)' }}>
            Paid invoices, last 6 months
          </p>
        </div>
        <Link
          href="/reports"
          className="hover:underline"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-brand)' }}
        >
          View reports
        </Link>
      </div>
      <div style={{ height: '10rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }}
              dy={8}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: 'var(--color-text-subtle)' }}
              tickFormatter={(v: number) => v === 0 ? '$0' : `$${(v / 1000).toFixed(0)}k`}
              width={48}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)',
                fontSize: '0.8125rem',
                padding: '0.5rem 0.75rem',
              }}
              formatter={(value: number) => [formatNzd(value), 'Revenue']}
              labelStyle={{ fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="var(--color-brand)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--color-brand)', stroke: 'var(--color-bg)', strokeWidth: 2 }}
              activeDot={{ r: 5, fill: 'var(--color-brand)', stroke: 'var(--color-bg)', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) }
  catch { return '' }
}

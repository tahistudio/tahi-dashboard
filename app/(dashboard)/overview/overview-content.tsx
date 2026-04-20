'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, BarChart3,
  Plus, Clock, UserPlus,
  ArrowRight, AlertTriangle, RefreshCw, Video, ExternalLink,
  TrendingUp,
  Target, Scale, Timer,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
import { OnboardingChecklist, type OnboardingState } from '@/components/tahi/onboarding-checklist'
import { BookingWidget } from '@/components/tahi/booking-widget'
import { AIDailyBriefing } from '@/components/tahi/ai-briefing-card'
import { KPIStrip as SharedKPIStrip, KPICell } from '@/components/tahi/kpi-strip'
import { apiPath } from '@/lib/api'
import { calculatePipelineTotals } from '@/lib/pipeline-math'
import { formatDistanceToNow } from 'date-fns'
import { useImpersonation } from '@/components/tahi/impersonation-banner'

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

  amber:   { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
  red:     { bg: 'var(--color-danger-bg)',  color: 'var(--color-danger)' },
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
  const [, setMonthlyRevenue] = useState<MonthlyRevenue[]>([])
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
    <div className="flex flex-col" style={{ gap: 'var(--space-8)', maxWidth: '68.75rem' }}>
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

      {/* 1. Greeting + quick actions */}
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

      {/* 2. AI Daily Briefing */}
      <AIDailyBriefing />

      {/* 3. KPI strip */}
      <KPIStrip kpis={kpis} loading={loading} />

      {/* 4. Recent requests + Upcoming calls side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-5" style={{ gap: 'var(--space-6)' }}>
        <div className="lg:col-span-3">
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
        </div>
        <div className="lg:col-span-2">
          <UpcomingCallsWidget />
        </div>
      </div>

      {/* 5. Pipeline summary */}
      <PipelineSummaryCard />

      {/* 6. Team Capacity */}
      <PipelineCapacityCard />

      {!loading && (kpis?.activeClients ?? 0) === 0 && <GettingStarted />}
    </div>
  )
}

// ─── Pipeline Summary Card (T360) ───────────────────────────────────────────

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
}

interface StageSummary {
  id: string
  probability: number | null
  historicalProbability: number | null
  isClosedWon: number | boolean | null
  isClosedLost: number | boolean | null
}

function PipelineSummaryCard() {
  const [deals, setDeals] = useState<DealSummary[]>([])
  const [stages, setStages] = useState<StageSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch(apiPath('/api/admin/deals?limit=100')).then(r => r.ok ? r.json() as Promise<{ items: DealSummary[] }> : { items: [] }),
      // NB: /api/admin/pipeline/stages returns { stages: [...] }, not { items: [...] }.
      fetch(apiPath('/api/admin/pipeline/stages')).then(r => r.ok ? r.json() as Promise<{ stages: StageSummary[] }> : { stages: [] }),
    ])
      .then(([dealsData, stagesData]) => {
        setDeals(dealsData.items ?? [])
        setStages(stagesData.stages ?? [])
      })
      .catch(() => {
        setDeals([])
        setStages([])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="animate-pulse" style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 'var(--space-5)' }}>
          {[0, 1, 2].map(n => (
            <div key={n}>
              <div style={{ height: '0.75rem', width: '40%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)' }} />
              <div style={{ height: '1.5rem', width: '60%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (deals.length === 0) return null

  // Calculate totals via the shared pipeline-math helper so this agrees
  // with the Pipeline page and Reports. Historical close rates take
  // precedence over static stage probability. See Decision #040.
  const totals = calculatePipelineTotals(deals, stages)
  const totalPipelineValue = totals.totalValue
  const weightedValue = totals.weightedValue
  const openDeals = deals.filter(d => !d.stageIsClosedWon && !d.stageIsClosedLost)

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
      <div className="grid grid-cols-1 sm:grid-cols-3">
        {pipelineItems.map((item, i) => (
          <div
            key={item.label}
            className="pipeline-divider-item"
            style={{
              padding: 'var(--space-5)',
              borderBottom: i < pipelineItems.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
            }}
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
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between" style={{
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}>
        <div className="flex items-center" style={{ gap: 'var(--space-3)' }}>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
            Team Capacity
          </h2>
          <span className="tabular-nums" style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 700,
            color: barColor,
            padding: 'var(--space-0-5) var(--space-2)',
            background: utilizationPct > 90 ? 'var(--color-danger-bg)' : utilizationPct > 70 ? 'var(--color-warning-bg)' : 'var(--color-brand-50)',
            borderRadius: 'var(--radius-full)',
          }}>
            {utilizationPct}%
          </span>
        </div>
        <Link href="/pipeline" className="view-link" style={{
          fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-brand)',
        }}>
          View pipeline <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
        </Link>
      </div>

      {/* Utilization bar */}
      <div style={{ padding: 'var(--space-4) var(--space-5) 0' }}>
        <div className="overflow-hidden" style={{ height: '0.375rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-full)' }}>
          <div style={{ height: '100%', width: `${Math.min(utilizationPct, 100)}%`, background: barColor, borderRadius: 'var(--radius-full)', transition: 'width 300ms ease' }} />
        </div>
      </div>

      {/* Stats strip with dividers */}
      <div className="grid grid-cols-3" style={{ padding: 'var(--space-4) 0', margin: '0 var(--space-5)', borderBottom: '1px solid var(--color-border-subtle)' }}>
        {[
          { label: 'Available', value: `${data.availableCapacity}h`, color: 'var(--color-text)' },
          { label: 'Pipeline', value: `${data.pipelineImpact}h`, color: 'var(--color-warning)' },
          { label: 'Forecast', value: `${data.forecastedCapacity}h`, color: data.forecastedCapacity < 0 ? 'var(--color-danger)' : 'var(--color-brand)' },
        ].map((stat, i) => (
          <div key={stat.label} className="text-center" style={{
            borderRight: i < 2 ? '1px solid var(--color-border-subtle)' : 'none',
          }}>
            <p className="tabular-nums" style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: stat.color }}>
              {stat.value}
            </p>
            <p style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {/* Per-member rows with divider lines */}
      {data.teamMembers.length > 0 && (
        <div>
          {data.teamMembers.slice(0, 5).map((m, i) => {
            const memberBarColor = m.utilization > 85 ? 'var(--color-danger)' : m.utilization >= 60 ? 'var(--color-warning)' : 'var(--color-brand)'
            return (
              <div key={m.id} style={{
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: i < Math.min(data.teamMembers.length, 5) - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-1-5)' }}>
                  <span className="truncate" style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)' }}>
                    {m.name}
                  </span>
                  <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
                    <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                      {m.currentHoursAllocated}h / {m.weeklyCapacityHours}h
                    </span>
                    <span className="tabular-nums" style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: memberBarColor, minWidth: '2rem', textAlign: 'right' }}>
                      {m.utilization}%
                    </span>
                  </div>
                </div>
                <div className="overflow-hidden" style={{ height: '0.25rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-full)' }}>
                  <div style={{ height: '100%', width: `${Math.min(m.utilization, 100)}%`, background: memberBarColor, borderRadius: 'var(--radius-full)', transition: 'width 300ms ease' }} />
                </div>
              </div>
            )
          })}
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
  const outstanding = kpis?.outstandingInvoicesNzd ?? 0
  return (
    <div data-tour="overview-kpis">
      <SharedKPIStrip>
        <KPICell
          icon={Users}
          label="Active Clients"
          value={loading ? '—' : String(kpis?.activeClients ?? 0)}
          sub="across all plans"
          href="/clients"
        />
        <KPICell
          icon={Inbox}
          label="Open Requests"
          value={loading ? '—' : String(kpis?.openRequests ?? 0)}
          sub={kpis ? `${kpis.inProgress} in progress` : undefined}
          href="/requests"
        />
        <KPICell
          icon={FileText}
          label="Outstanding"
          value={loading ? '—' : formatNzd(outstanding)}
          sub="invoices"
          tone={outstanding > 0 ? 'warning' : 'brand'}
          href="/invoices"
        />
        <KPICell
          icon={BarChart3}
          label="MRR"
          value={loading ? '—' : formatNzd(kpis?.mrr ?? 0)}
          sub="recurring retainers"
          href="/reports"
        />
      </SharedKPIStrip>
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
            className="view-link"
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              color: 'var(--color-brand)',
            }}
          >
            {action.label} <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
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
                background: 'var(--priority-high-bg)',
                color: 'var(--priority-high-text)',
                border: '1px solid var(--priority-high-border)',
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
      <ArrowRight size={14} aria-hidden="true" className="flex-shrink-0 row-arrow" style={{ color: 'var(--color-border)' }} />
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
      className="flex items-center"
      style={primary
        ? {
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--color-brand)',
            color: 'white',
            border: '1px solid var(--color-brand)',
            borderRadius: 'var(--radius-leaf-sm)',
            textDecoration: 'none',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            gap: 'var(--space-1-5)',
            transition: 'background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
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
            transition: 'border-color 150ms ease, background-color 150ms ease',
          }
      }
      onMouseEnter={e => {
        if (primary) {
          e.currentTarget.style.background = 'var(--color-brand-dark)'
          e.currentTarget.style.boxShadow = '0 4px 14px rgba(90,130,78,0.4)'
          e.currentTarget.style.transform = 'translateY(-1px)'
        } else {
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'
        }
      }}
      onMouseLeave={e => {
        if (primary) {
          e.currentTarget.style.background = 'var(--color-brand)'
          e.currentTarget.style.boxShadow = 'none'
          e.currentTarget.style.transform = 'none'
        } else {
          e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
          e.currentTarget.style.backgroundColor = 'var(--color-bg)'
        }
      }}
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

  if (!loading && calls.length === 0) {
    return (
      <SectionCard title="Upcoming Calls" action={{ label: 'Schedule', href: '/calls' }}>
        <EmptyRows title="No upcoming calls" message="Schedule a call with a client." />
      </SectionCard>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
        <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>Upcoming Calls</h2>
        <Link
          href="/calls"
          className="view-link"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-brand)' }}
        >
          View all <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
        </Link>
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
        {loading ? [0, 1, 2].map(n => (
          <div key={n} className="animate-pulse flex items-center" style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            gap: 'var(--space-3)',
          }}>
            <div style={{ width: '2rem', height: '2rem', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-leaf-sm)', flexShrink: 0 }} />
            <div className="flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div style={{ height: '0.75rem', width: '70%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
              <div style={{ height: '0.625rem', width: '50%', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }} />
            </div>
          </div>
        )) : calls.map(call => {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) }
  catch { return '' }
}

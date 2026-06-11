'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Inbox, FileText,
  Plus, Clock, UserPlus,
  ArrowRight, AlertTriangle, RefreshCw, Video, ExternalLink,
  TrendingUp,
  Target, Scale, Timer,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
import { OnboardingChecklist, type OnboardingState } from '@/components/tahi/onboarding-checklist'
import { BookingWidget } from '@/components/tahi/booking-widget'
import { AIDailyBriefing } from '@/components/tahi/ai-briefing-card'
import { FeatureCard } from '@/components/tahi/feature-card'
import { Gate, usePermissions } from '@/components/tahi/permissions-context'
import { Reveal } from '@/components/tahi/reveal'
import { CountUp } from '@/components/tahi/count-up'
import { ProgressRing } from '@/components/tahi/progress-ring'
import {
  AnimatedUsers, AnimatedInbox, AnimatedFileText, AnimatedBarChart,
  AnimatedTrendingUp, AnimatedClock, AnimatedCalendar, AnimatedGauge,
  type AnimatedIconProps,
} from '@/components/tahi/animated-icons'
import { apiPath } from '@/lib/api'
import { DELIVERY_STATUS_COLOR, DELIVERY_STATUS_LABEL } from '@/components/tahi/gantt-grid'
import type { DeliveryStatus } from '@/lib/delivery-status'
import { calculatePipelineTotals } from '@/lib/pipeline-math'
import { useDisplayCurrency } from '@/lib/display-currency-context'
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

// ─── Admin overview permission registry ──────────────────────────────────────
//
// Feature keys that drive the admin overview cards. KPI_DATA_FEATURES guards
// the shared /api/admin/overview fetch (KPI cells + Recent Requests + Getting
// Started all read from it); CARD_FEATURES drives the zero-card fallback.
const KPI_DATA_FEATURES = ['clients', 'requests', 'invoices', 'financial_reports'] as const
const CARD_FEATURES = [
  'clients', 'requests', 'invoices', 'financial_reports',
  'calls', 'deals', 'overview', 'schedules', 'capacity',
] as const

// Literal class maps so Tailwind compiles every variant (never build class
// strings dynamically from data).
const KPI_DESKTOP_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  activeClients: number
  openRequests: number
  inProgress: number
  outstandingInvoicesNzd?: number
  mrr?: number
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
  const { features } = usePermissions()
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // The shared overview payload only feeds the KPI cells, Recent Requests and
  // Getting Started. Skip the fetch entirely when none of them are visible.
  const needsOverviewData = KPI_DATA_FEATURES.some(key => features[key] !== false)

  useEffect(() => {
    if (!needsOverviewData) {
      setLoading(false)
      return
    }
    fetch(apiPath('/api/admin/overview'))
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch overview')
        return r.json() as Promise<{ kpis: KPIs; recentRequests: RecentRequest[]; monthlyRevenue?: MonthlyRevenue[] }>
      })
      .then(data => {
        setKpis(data.kpis)
        setRecentRequests(data.recentRequests)
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  }, [needsOverviewData])

  const firstName = userName.split(' ')[0]
  const hasAnyCard = CARD_FEATURES.some(key => features[key] !== false)

  // Pairs share a bento row; when one half is gated off, the survivor takes
  // the full 12 columns so the grid re-packs with no holes.
  const requestsVisible = features['requests'] !== false
  const callsVisible = features['calls'] !== false
  const dealsVisible = features['deals'] !== false
  const capacityVisible = features['capacity'] !== false

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

      {/* Hero zone: greeting + quick actions + today's focus strip */}
      <Reveal id="overview-hero" className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
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
            <Gate feature="requests">
              <QuickBtn href="/requests?new=1" icon={<Plus size={14} aria-hidden="true" />} label="New Request" primary />
            </Gate>
            <Gate feature="clients">
              <QuickBtn href="/clients?new=1" icon={<UserPlus size={14} aria-hidden="true" />} label="Add Client" />
            </Gate>
            <Gate feature="time">
              <QuickBtn href="/time?new=1" icon={<Clock size={14} aria-hidden="true" />} label="Log Time" />
            </Gate>
          </div>
        </div>

        {/* Today's focus strip (next call + closing deal); self-gates per tile */}
        <TodayFocusStrip />
      </Reveal>

      {hasAnyCard ? (
        <Reveal
          id="overview-grid"
          stagger
          className="grid grid-cols-1 lg:grid-cols-12"
          style={{ gap: 'var(--space-6)', gridAutoFlow: 'dense' }}
        >
          {/* KPI strip: per-cell permission registry, MRR hero tile */}
          <KPIBentoStrip kpis={kpis} loading={loading} />

          {/* Engagements off track (delivery spine #148, Slice 5): alert priority */}
          <Gate feature="schedules">
            <OffTrackEngagementsWidget />
          </Gate>

          {/* AI Daily Briefing */}
          <Gate feature="overview">
            <div className="lg:col-span-12">
              <AIDailyBriefing />
            </div>
          </Gate>

          {/* Recent requests + upcoming calls */}
          <Gate feature="requests">
            <SectionCard
              className={callsVisible ? 'lg:col-span-7' : 'lg:col-span-12'}
              icon={<HeaderIcon><AnimatedInbox size={14} /></HeaderIcon>}
              title="Recent Requests"
              action={{ label: 'View all', href: '/requests' }}
            >
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
          </Gate>
          <Gate feature="calls">
            <UpcomingCallsWidget className={requestsVisible ? 'lg:col-span-5' : 'lg:col-span-12'} />
          </Gate>

          {/* Pipeline summary */}
          <Gate feature="deals">
            <PipelineSummaryCard />
          </Gate>

          {/* Weighted forecast + team capacity */}
          <Gate feature="deals">
            <PipelineForecastCard className={capacityVisible ? 'lg:col-span-7' : 'lg:col-span-12'} />
          </Gate>
          <Gate feature="capacity">
            <PipelineCapacityCard className={dealsVisible ? 'lg:col-span-5' : 'lg:col-span-12'} />
          </Gate>

          {!loading && kpis !== null && kpis.activeClients === 0 && (
            <Gate feature="clients">
              <GettingStarted />
            </Gate>
          )}
        </Reveal>
      ) : (
        <NothingEnabledCard />
      )}
    </div>
  )
}

// ─── Zero-card fallback ──────────────────────────────────────────────────────

function NothingEnabledCard() {
  const { features } = usePermissions()
  const canOpenSettings = features['settings'] !== false
  return (
    <div
      className="overflow-hidden"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
      }}
    >
      <EmptyRows
        title="Nothing enabled on your home yet"
        message="Ask an admin to switch on home cards for you in Settings under Permissions."
        action={canOpenSettings ? { label: 'Open Settings', href: '/settings' } : undefined}
      />
    </div>
  )
}

// ─── Header icon wrapper (leaf radius, brand or warning tone) ────────────────

function HeaderIcon({ tone = 'brand', children }: { tone?: 'brand' | 'warning'; children: React.ReactNode }) {
  const c = tone === 'warning'
    ? { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' }
    : { bg: 'var(--color-brand-50)', fg: 'var(--color-brand)' }
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{
        width: '1.75rem',
        height: '1.75rem',
        background: c.bg,
        color: c.fg,
        borderRadius: 'var(--radius-leaf-sm)',
      }}
    >
      {children}
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
  const { format } = useDisplayCurrency()
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
      <div className="lg:col-span-12" style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 'var(--space-5)' }}>
          {[0, 1, 2].map(n => (
            <div key={n}>
              <div className="tahi-shimmer" style={{ height: '0.75rem', width: '40%', marginBottom: 'var(--space-3)' }} />
              <div className="tahi-shimmer" style={{ height: '1.5rem', width: '60%' }} />
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
    { label: 'Pipeline Value', value: format(totalPipelineValue), sub: `${openDeals.length} open deal${openDeals.length !== 1 ? 's' : ''}`, icon: <Target size={14} aria-hidden="true" /> },
    { label: 'Weighted Value', value: format(weightedValue), sub: 'probability-adjusted', icon: <Scale size={14} aria-hidden="true" /> },
    { label: 'Closing This Month', value: format(closingThisMonthValue), sub: `${closingThisMonth.length} deal${closingThisMonth.length !== 1 ? 's' : ''}`, icon: <Timer size={14} aria-hidden="true" /> },
  ]

  return (
    <Link
      href="/deals"
      className="block lg:col-span-12"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        textDecoration: 'none',
        overflow: 'hidden',
        transition: 'border-color var(--dur-2) var(--ease-productive)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
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
            <p data-private className="tabular-nums" style={{
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

function PipelineCapacityCard({ className }: { className?: string }) {
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
      <SectionCard
        className={className}
        icon={<HeaderIcon><AnimatedGauge size={14} /></HeaderIcon>}
        title="Team Capacity"
      >
        <LoadingRows />
      </SectionCard>
    )
  }

  if (!data) {
    return (
      <SectionCard
        className={className}
        icon={<HeaderIcon><AnimatedGauge size={14} /></HeaderIcon>}
        title="Team Capacity"
      >
        <EmptyRows
          title="No capacity data yet"
          message="Add team members and allocate hours to see utilization here."
        />
      </SectionCard>
    )
  }

  const utilizationPct = data.totalCapacity > 0
    ? Math.round((data.totalAllocated / data.totalCapacity) * 100)
    : 0

  const barColor = utilizationPct > 90
    ? 'var(--color-danger)'
    : utilizationPct > 70
      ? 'var(--color-warning)'
      : 'var(--color-brand)'

  return (
    <div className={className} style={{
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
          <HeaderIcon><AnimatedGauge size={14} /></HeaderIcon>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
            Team Capacity
          </h2>
          <ProgressRing value={utilizationPct} size={40} strokeWidth={4} label="Team capacity utilization">
            <span style={{ color: barColor }}>
              {utilizationPct}%
            </span>
          </ProgressRing>
        </div>
        <Link href="/deals" className="view-link" style={{
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

// ─── KPI Bento Strip (per-cell permission registry, MRR hero tile) ───────────

interface KPICellDef {
  key: string
  /** Permission feature key; cell is dropped when features[feature] === false. */
  feature: string
  /** Hero cells get the filled brand treatment (Donezo lead-KPI reference). */
  hero?: boolean
  label: string
  icon: React.ComponentType<AnimatedIconProps>
  value: React.ReactNode
  sub?: React.ReactNode
  href: string
  tone?: 'brand' | 'warning'
}

function KPIBentoStrip({ kpis, loading }: { kpis: KPIs | null; loading: boolean }) {
  const { features } = usePermissions()
  const { format } = useDisplayCurrency()
  const outstanding = kpis?.outstandingInvoicesNzd ?? 0

  // Registry of KPI cells, filtered by feature visibility below. No hooks run
  // inside the loop. MRR leads the row as the filled hero tile (lead metric
  // top-left per the Donezo reference); CountUp fires once per load on it.
  const registry: KPICellDef[] = [
    {
      key: 'mrr',
      feature: 'financial_reports',
      hero: true,
      label: 'MRR',
      icon: AnimatedBarChart,
      href: '/reports',
      sub: 'recurring retainers',
      value: (
        <span data-private>
          <CountUp value={kpis?.mrr ?? 0} format={n => format(Math.round(n))} />
        </span>
      ),
    },
    {
      key: 'clients',
      feature: 'clients',
      label: 'Active Clients',
      icon: AnimatedUsers,
      href: '/clients',
      sub: 'across all plans',
      value: String(kpis?.activeClients ?? 0),
    },
    {
      key: 'requests',
      feature: 'requests',
      label: 'Open Requests',
      icon: AnimatedInbox,
      href: '/requests',
      sub: kpis ? `${kpis.inProgress} in progress` : undefined,
      value: String(kpis?.openRequests ?? 0),
    },
    {
      key: 'outstanding',
      feature: 'invoices',
      label: 'Outstanding',
      icon: AnimatedFileText,
      href: '/invoices',
      sub: 'invoices',
      tone: outstanding > 0 ? 'warning' : 'brand',
      value: <span data-private>{format(outstanding)}</span>,
    },
  ]

  const visible = registry.filter(cell => features[cell.feature] !== false)
  if (visible.length === 0) return null

  const desktopCols = KPI_DESKTOP_COLS[visible.length] ?? 'lg:grid-cols-4'
  const mobileCols = visible.length === 1 ? 'grid-cols-1' : 'grid-cols-2'

  return (
    <div
      data-tour="overview-kpis"
      className={`lg:col-span-12 grid ${mobileCols} ${desktopCols}`}
      style={{ gap: 'var(--space-4)' }}
    >
      {visible.map(cell => cell.hero
        ? <HeroKPICard key={cell.key} cell={cell} loading={loading} />
        : <LightKPICard key={cell.key} cell={cell} loading={loading} />)}
    </div>
  )
}

// The lead KPI: filled brand gradient, white text, clockwise border trace on
// hover (the scarce signature; nothing else on this page uses it).
function HeroKPICard({ cell, loading }: { cell: KPICellDef; loading: boolean }) {
  const Icon = cell.icon
  return (
    <Link
      href={cell.href}
      className="tahi-border-trace block"
      style={{
        padding: 'var(--space-5)',
        background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
        borderRadius: 'var(--radius-lg)',
        color: 'white',
        textDecoration: 'none',
      }}
    >
      <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: '2rem',
            height: '2rem',
            background: 'rgba(255, 255, 255, 0.16)',
            color: 'white',
            borderRadius: 'var(--radius-leaf-sm)',
          }}
        >
          <Icon size={15} />
        </div>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(255, 255, 255, 0.85)' }}>
          {cell.label}
        </span>
      </div>
      {loading ? (
        <div className="tahi-shimmer" style={{ height: '1.75rem', width: '6rem' }} />
      ) : (
        <div className="tabular-nums" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
          {cell.value}
        </div>
      )}
      {cell.sub && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255, 255, 255, 0.75)', marginTop: 'var(--space-1)' }}>
          {cell.sub}
        </div>
      )}
    </Link>
  )
}

function LightKPICard({ cell, loading }: { cell: KPICellDef; loading: boolean }) {
  const Icon = cell.icon
  const toneStyle = cell.tone === 'warning'
    ? { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' }
    : { bg: 'var(--color-brand-50)', fg: 'var(--color-brand)' }
  return (
    <Link
      href={cell.href}
      className="block"
      style={{
        padding: 'var(--space-5)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        textDecoration: 'none',
        transition: 'border-color var(--dur-2) var(--ease-productive), background-color var(--dur-2) var(--ease-productive)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
        e.currentTarget.style.backgroundColor = 'var(--color-bg)'
      }}
    >
      <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: '2rem',
            height: '2rem',
            background: toneStyle.bg,
            color: toneStyle.fg,
            borderRadius: 'var(--radius-leaf-sm)',
          }}
        >
          <Icon size={15} />
        </div>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-muted)' }}>
          {cell.label}
        </span>
      </div>
      {loading ? (
        <div className="tahi-shimmer" style={{ height: '1.75rem', width: '4.5rem' }} />
      ) : (
        <div className="tabular-nums" style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-text)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
          {cell.value}
        </div>
      )}
      {cell.sub && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
          {cell.sub}
        </div>
      )}
    </Link>
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
        <div className="tahi-shimmer" style={{
          height: '2rem',
          width: '3.5rem',
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

// ─── Off-track engagements widget (delivery spine #148, Slice 5) ─────────────

interface OffTrackEngagement {
  orgId: string
  orgName: string
  status: DeliveryStatus
  pctComplete: number
  rowsDone: number
  rowsTotal: number
  offTrackCount: number
}

function OffTrackEngagementsWidget() {
  const [items, setItems] = useState<OffTrackEngagement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/engagements/off-track'))
      .then(r => (r.ok ? r.json() as Promise<{ engagements?: OffTrackEngagement[] }> : { engagements: [] }))
      .then(d => setItems(d.engagements ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  // Quiet until known, and hidden entirely when every engagement is on track
  // (no clutter on a healthy overview).
  if (loading || items.length === 0) return null

  return (
    <SectionCard
      className="lg:col-span-12"
      icon={<HeaderIcon tone="warning"><AnimatedClock size={14} /></HeaderIcon>}
      title="Engagements off track"
      action={{ label: 'View schedules', href: '/schedules' }}
    >
      {items.map((e, i) => (
        <Link
          key={e.orgId}
          href={`/clients/${e.orgId}`}
          className="flex items-center hover:bg-[var(--color-bg-secondary)]"
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: i < items.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
            gap: 'var(--space-3)',
            textDecoration: 'none',
            transition: 'background 140ms ease',
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: DELIVERY_STATUS_COLOR[e.status], flexShrink: 0 }}
          />
          <div className="flex-1" style={{ minWidth: 0 }}>
            <p data-private style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.orgName}
            </p>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
              {e.rowsDone}/{e.rowsTotal} phases done · {e.offTrackCount} off track
            </p>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: DELIVERY_STATUS_COLOR[e.status], flexShrink: 0 }}>
            {DELIVERY_STATUS_LABEL[e.status]}
          </span>
        </Link>
      ))}
    </SectionCard>
  )
}

function SectionCard({
  title, action, children, icon, className,
}: {
  title: string
  action?: { label: string; href: string }
  children: React.ReactNode
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={className ? `overflow-hidden ${className}` : 'overflow-hidden'}
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
        <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
          {icon}
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>{title}</h2>
        </div>
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
          <p data-private className="truncate" style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
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
          {showOrg && req.orgName ? <span data-private>{req.orgName}</span> : null}
          {showOrg && req.orgName ? ' \u00b7 ' : ''}
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
          className="flex items-center"
          style={{
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: i < 3 ? '1px solid var(--color-border-subtle)' : 'none',
            gap: 'var(--space-3)',
          }}
        >
          <div className="tahi-shimmer" style={{ width: '5rem', height: '1.375rem', borderRadius: 'var(--radius-full)' }} />
          <div className="flex-1 flex flex-col" style={{ gap: 'var(--space-1-5)' }}>
            <div className="tahi-shimmer" style={{ height: '0.8125rem', width: '60%' }} />
            <div className="tahi-shimmer" style={{ height: '0.6875rem', width: '35%' }} />
          </div>
          <div className="tahi-shimmer" style={{ height: '0.6875rem', width: '3rem' }} />
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
            transition: 'background-color var(--dur-2) var(--ease-productive)',
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
        } else {
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'
        }
      }}
      onMouseLeave={e => {
        if (primary) {
          e.currentTarget.style.background = 'var(--color-brand)'
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
  title: string
  scheduledAt: string
  durationMinutes: number
  meetingUrl: string | null
  withName: string | null
  withSubtitle: string | null
  parentType: 'lead' | 'deal' | 'org' | 'request' | 'task' | null
  parentHref: string | null
  fromCalendar: boolean
}

function UpcomingCallsWidget({ className }: { className?: string }) {
  const [calls, setCalls] = useState<UpcomingCall[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Reads from discovery_calls (polymorphic) not the legacy
    // scheduled_calls table — that's why Google Calendar synced
    // meetings now show up here.
    fetch(apiPath('/api/admin/discovery-calls/upcoming?limit=5&includePast=1'))
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
      <SectionCard
        className={className}
        icon={<HeaderIcon><AnimatedCalendar size={14} /></HeaderIcon>}
        title="Upcoming Calls"
        action={{ label: 'Open leads', href: '/leads' }}
      >
        <EmptyRows title="No upcoming calls" message="Calls auto-sync from Google Calendar. Schedule one in Google Cal with a lead's email." />
      </SectionCard>
    )
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
          <HeaderIcon><AnimatedCalendar size={14} /></HeaderIcon>
          <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>Upcoming Calls</h2>
        </div>
        <Link
          href="/leads"
          className="view-link"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-brand)' }}
        >
          View all <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
        </Link>
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--space-2)' }}>
        {loading ? [0, 1, 2].map(n => (
          <div key={n} className="flex items-center" style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            gap: 'var(--space-3)',
          }}>
            <div className="tahi-shimmer" style={{ width: '2rem', height: '2rem', borderRadius: 'var(--radius-leaf-sm)', flexShrink: 0 }} />
            <div className="flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div className="tahi-shimmer" style={{ height: '0.75rem', width: '70%' }} />
              <div className="tahi-shimmer" style={{ height: '0.625rem', width: '50%' }} />
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
                {call.parentHref ? (
                  <Link
                    href={call.parentHref}
                    className="truncate hover:underline"
                    style={{ display: 'block', fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}
                  >
                    <span data-private>{call.withName ?? call.title}</span>
                  </Link>
                ) : (
                  <p className="truncate" style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
                    <span data-private>{call.withName ?? call.title}</span>
                  </p>
                )}
                <p className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
                  {call.withSubtitle ? <><span data-private>{call.withSubtitle}</span>{' \u00b7 '}</> : ''}
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
    <div className="lg:col-span-12" style={{
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
  /** Override-aware upsell gate: false when the client is on custom/off tracks. */
  showGhosts?: boolean
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

  // Build upsell messages based on plan, but only when the server says to (the
  // per-client override suppresses upsell on custom / tracks-off clients).
  const upsells: string[] = []
  if (data.showGhosts !== false) {
    if (plan.planType === 'maintain' && !plan.hasPrioritySupport) {
      upsells.push('Add Priority Support for an extra small track')
      upsells.push('Upgrade to Scale for large tasks and more capacity')
    } else if (plan.planType === 'maintain' && plan.hasPrioritySupport) {
      upsells.push('Upgrade to Scale for large tasks and more capacity')
    } else if (plan.planType === 'scale' && !plan.hasPrioritySupport) {
      upsells.push('Add Priority Support for an extra small track')
    }
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
                  <p data-private className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
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
                  <span data-private className="truncate">{req.title}</span>
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

// ─── Today's Focus Strip (admin) ──────────────────────────────────────────────
//
// Two non-clickable FeatureCard tiles sitting just under the greeting.
// Left = next scheduled call (today / soon). Right = highest-value deal
// closing this month. Reuses existing /api/admin/calls and /api/admin/deals
// endpoints; no new APIs.

interface FocusCall {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  withName: string | null
  withSubtitle: string | null
  meetingUrl: string | null
  parentHref: string | null
}

interface FocusDeal {
  id: string
  title: string
  valueNzd: number | null
  value: number | null
  expectedCloseDate: string | null
  orgName: string | null
  stageName: string | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
}

// Tick once a minute so the live-now status + countdown stay accurate
// without forcing a refresh. Returns a render counter; consumers compute
// their own freshness from `Date.now()` on each tick.
function useMinuteTicker() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(v => v + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  return tick
}

// Compute live status for a scheduled call. The window opens 5 minutes
// before the start (so the join button appears in time) and closes at
// scheduledAt + durationMinutes.
function callPhase(scheduledAt: string, durationMinutes: number): {
  phase: 'live' | 'soon' | 'upcoming' | 'past'
  minutesUntilStart: number
} {
  const now = Date.now()
  const start = new Date(scheduledAt).getTime()
  const end = start + durationMinutes * 60_000
  const minutesUntilStart = Math.round((start - now) / 60_000)
  if (now >= start && now <= end) return { phase: 'live', minutesUntilStart }
  if (now < start && start - now <= 5 * 60_000) return { phase: 'soon', minutesUntilStart }
  if (now > end) return { phase: 'past', minutesUntilStart }
  return { phase: 'upcoming', minutesUntilStart }
}

function NextCallLiveBadge({ scheduledAt, durationMinutes }: { scheduledAt: string; durationMinutes: number }) {
  useMinuteTicker()
  const { phase, minutesUntilStart } = callPhase(scheduledAt, durationMinutes)
  if (phase === 'upcoming' || phase === 'past') return null
  const tone = phase === 'live' ? '#4ade80' : '#fbbf24'
  const label = phase === 'live' ? 'Live now' : minutesUntilStart <= 0 ? 'Starting now' : `In ${minutesUntilStart}m`
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: '0.3125rem',
        padding: '0.125rem 0.5rem',
        borderRadius: '999px',
        background: 'rgba(255, 255, 255, 0.14)',
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: 'white',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          width: '0.4375rem',
          height: '0.4375rem',
          borderRadius: '999px',
          background: tone,
          animation: phase === 'live' ? 'tahi-call-pulse 1.4s ease-in-out infinite' : undefined,
          flexShrink: 0,
        }}
      />
      {label}
      <style>{`
        @keyframes tahi-call-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55); }
          50%      { opacity: 0.65; box-shadow: 0 0 0 0.375rem rgba(74, 222, 128, 0); }
        }
      `}</style>
    </span>
  )
}

function NextCallJoinButton({ meetingUrl, scheduledAt, durationMinutes }: {
  meetingUrl: string
  scheduledAt: string
  durationMinutes: number
}) {
  useMinuteTicker()
  const { phase } = callPhase(scheduledAt, durationMinutes)
  // Brand-green pop when the call is live or about to start. Muted
  // secondary look for plain-upcoming calls so the home page doesn't
  // shout "Join now" for something three days away.
  const live = phase === 'live' || phase === 'soon'
  return (
    <a
      href={meetingUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center"
      style={{
        gap: '0.4375rem',
        padding: '0.5rem 0.875rem',
        fontSize: '0.8125rem',
        fontWeight: 600,
        borderRadius: 'var(--radius-leaf-sm)',
        background: live ? '#4ade80' : 'rgba(255, 255, 255, 0.14)',
        color: live ? '#0f1d0e' : 'white',
        textDecoration: 'none',
        transition: 'background 150ms ease, transform 150ms ease',
        boxShadow: live ? '0 0 0 0 rgba(74, 222, 128, 0.55)' : 'none',
        animation: phase === 'live' ? 'tahi-join-pulse 1.6s ease-in-out infinite' : undefined,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)' }}
    >
      {live ? 'Join now' : 'Open meeting link'}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 17L17 7M9 7h8v8" />
      </svg>
      <style>{`
        @keyframes tahi-join-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.55); }
          50%      { box-shadow: 0 0 0 0.5rem rgba(74, 222, 128, 0); }
        }
      `}</style>
    </a>
  )
}

function TodayFocusStrip() {
  const { features } = usePermissions()
  const { format } = useDisplayCurrency()
  const showCall = features['calls'] !== false
  const showDeal = features['deals'] !== false
  const [call, setCall] = useState<FocusCall | null>(null)
  const [deal, setDeal] = useState<FocusDeal | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!showCall && !showDeal) {
      setLoading(false)
      return
    }
    // Only fetch what the viewer is permitted to see.
    const callsPromise = showCall
      ? fetch(apiPath('/api/admin/discovery-calls/upcoming?limit=1&includePast=1'))
          .then(r => (r.ok ? r.json() as Promise<{ calls: FocusCall[] }> : { calls: [] }))
          .catch(() => ({ calls: [] as FocusCall[] }))
      : Promise.resolve({ calls: [] as FocusCall[] })
    const dealsPromise = showDeal
      ? fetch(apiPath('/api/admin/deals?limit=100'))
          .then(r => (r.ok ? r.json() as Promise<{ items: FocusDeal[] }> : { items: [] }))
          .catch(() => ({ items: [] as FocusDeal[] }))
      : Promise.resolve({ items: [] as FocusDeal[] })

    Promise.all([callsPromise, dealsPromise])
      .then(([callsData, dealsData]) => {
        setCall(callsData.calls?.[0] ?? null)

        // Highest-value open deal closing this month
        const now = new Date()
        const month = now.getMonth()
        const year = now.getFullYear()
        const closingThisMonth = (dealsData.items ?? []).filter(d => {
          if (d.stageIsClosedWon || d.stageIsClosedLost) return false
          if (!d.expectedCloseDate) return false
          const close = new Date(d.expectedCloseDate)
          return close.getMonth() === month && close.getFullYear() === year
        })
        closingThisMonth.sort(
          (a, b) => (b.valueNzd ?? b.value ?? 0) - (a.valueNzd ?? a.value ?? 0),
        )
        setDeal(closingThisMonth[0] ?? null)
      })
      .finally(() => setLoading(false))
  }, [showCall, showDeal])

  // Both tiles gated off: the strip does not exist for this viewer.
  if (!showCall && !showDeal) return null

  // Nothing to show in any visible tile? Hide the strip, no placeholders.
  if (!loading && !(showCall && call) && !(showDeal && deal)) return null

  // Collapse to one full-width tile when only one half is visible.
  const gridClass = showCall && showDeal ? 'grid grid-cols-1 md:grid-cols-2' : 'grid grid-cols-1'

  if (loading) {
    return (
      <div className={gridClass} style={{ gap: 'var(--space-4)' }}>
        {showCall && <div className="tahi-shimmer" style={{ minHeight: '8.5rem', borderRadius: 'var(--radius-leaf)' }} />}
        {showDeal && <div className="tahi-shimmer" style={{ minHeight: '8.5rem', borderRadius: 'var(--radius-leaf)' }} />}
      </div>
    )
  }

  return (
    <div className={gridClass} style={{ gap: 'var(--space-4)' }}>
      {showCall && (
        <FeatureCard variant="forest" padding="lg">
          <FeatureCard.Eyebrow>
            <span className="inline-flex items-center" style={{ gap: '0.5rem' }}>
              Next call
              {call && <NextCallLiveBadge scheduledAt={call.scheduledAt} durationMinutes={call.durationMinutes} />}
            </span>
          </FeatureCard.Eyebrow>
          <FeatureCard.Title>
            {call
              ? (call.withName ? <>Next call with <span data-private>{call.withName}</span></> : <span data-private>{call.title}</span>)
              : 'No calls scheduled'}
          </FeatureCard.Title>
          <FeatureCard.Description>
            {call
              ? <>{call.withSubtitle ? <><span data-private>{call.withSubtitle}</span>{' · '}</> : ''}{`${new Date(call.scheduledAt).toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })} at ${new Date(call.scheduledAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })} (${call.durationMinutes}min)`}</>
              : 'Schedule a call from the calls page when one comes up.'}
          </FeatureCard.Description>
          {call && call.meetingUrl && (
            <FeatureCard.Footer>
              <NextCallJoinButton
                meetingUrl={call.meetingUrl}
                scheduledAt={call.scheduledAt}
                durationMinutes={call.durationMinutes}
              />
            </FeatureCard.Footer>
          )}
        </FeatureCard>
      )}

      {showDeal && (
        <FeatureCard variant="lime" padding="lg">
          <FeatureCard.Eyebrow>Closing this month</FeatureCard.Eyebrow>
          <FeatureCard.Title>
            {deal
              ? <span data-private>{format(deal.valueNzd ?? deal.value ?? 0)}</span>
              : 'Nothing closing yet'}
          </FeatureCard.Title>
          <FeatureCard.Description>
            {deal
              ? <><span data-private>{deal.title}</span>{deal.orgName ? <> · <span data-private>{deal.orgName}</span></> : ''}{deal.stageName ? ` · ${deal.stageName}` : ''}</>
              : 'Set an expected close date on a deal to surface it here.'}
          </FeatureCard.Description>
        </FeatureCard>
      )}
    </div>
  )
}

// ─── Pipeline Forecast Card (weighted by stage probability) ───────────

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

function PipelineForecastCard({ className }: { className?: string }) {
  const { format } = useDisplayCurrency()
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/reports/pipeline-forecast'))
      .then(r => r.ok ? r.json() as Promise<ForecastResponse> : null)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const activeStages = data?.byStage.filter(s => !s.isClosedWon && !s.isClosedLost && s.dealCount > 0) ?? []
  // Max weighted upfront for bar scaling
  const maxWeighted = Math.max(1, ...activeStages.map(s => s.weightedUpfrontNzd + s.weightedMonthlyNzd * 6))

  return (
    <div className={className} style={{
      padding: 'var(--space-6)',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
          <HeaderIcon><AnimatedTrendingUp size={14} /></HeaderIcon>
          <div>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)' }}>
              Pipeline forecast
            </h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
              Weighted by each stage&apos;s probability
            </p>
          </div>
        </div>
        <Link
          href="/deals"
          className="view-link"
          style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-brand)' }}
        >
          View pipeline <ArrowRight size={12} aria-hidden="true" className="view-arrow" />
        </Link>
      </div>

      {loading ? (
        <div className="tahi-shimmer" style={{ height: '6rem' }} />
      ) : !data || activeStages.length === 0 ? (
        <EmptyRows title="No active deals" message="Add deals to the pipeline to see a weighted forecast." />
      ) : (
        <>
          {/* Summary numbers — weighted vs unweighted */}
          <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <ForecastStat label="Weighted upfront" value={format(data.weightedUpfrontNzd)} sub={`of ${format(data.unweightedUpfrontNzd)}`} priv />
            <ForecastStat label="Weighted MRR" value={format(data.weightedMonthlyNzd)} sub={`of ${format(data.unweightedMonthlyNzd)}`} priv />
            <ForecastStat label="Active deals" value={String(activeStages.reduce((s, x) => s + x.dealCount, 0))} sub={`${data.totalDeals} total`} />
            <ForecastStat label="12-mo expected" value={format(data.weightedUpfrontNzd + data.weightedMonthlyNzd * 12)} sub="upfront + 12× MRR" priv />
          </div>

          {/* Per-stage bars */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {activeStages.map(stage => {
              const total = stage.weightedUpfrontNzd + stage.weightedMonthlyNzd * 6
              const pct = Math.round((total / maxWeighted) * 100)
              return (
                <div key={stage.stageId}>
                  <div className="flex items-center justify-between" style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}>
                    <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>
                      {stage.name}
                      <span style={{ color: 'var(--color-text-subtle)', marginLeft: 'var(--space-2)' }}>
                        {stage.dealCount} × {stage.probability}% probability
                      </span>
                    </span>
                    <span data-private style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
                      {format(stage.weightedUpfrontNzd)}
                      {stage.weightedMonthlyNzd > 0 && (
                        <span style={{ color: 'var(--color-text-subtle)' }}>
                          {' + '}{format(stage.weightedMonthlyNzd)}/mo
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{
                    height: '0.375rem',
                    background: 'var(--color-bg-tertiary)',
                    borderRadius: '9999px',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: stage.colour ?? 'var(--color-brand)',
                      borderRadius: '9999px',
                      transition: 'width 400ms ease-out',
                    }} />
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function ForecastStat({ label, value, sub, priv }: { label: string; value: string; sub: string; priv?: boolean }) {
  return (
    <div style={{
      padding: 'var(--space-3)',
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
    }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </p>
      <p {...(priv ? { 'data-private': true } : {})} style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-text)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
        {sub}
      </p>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) }
  catch { return '' }
}

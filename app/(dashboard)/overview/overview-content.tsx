'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, TrendingUp,
  Plus, Clock, UserPlus,
  ArrowRight, AlertTriangle, RefreshCw, Video, ExternalLink,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
import { OnboardingChecklist, type OnboardingState } from '@/components/tahi/onboarding-checklist'
import { apiPath } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'

// ─── Brand / palette constants ────────────────────────────────────────────────

const BRAND = '#5A824E'

// ─── Accent colour map (hex only, no Tailwind dynamic classes) ───────────────

const ACCENTS = {
  violet:  { bg: '#ede9fe', color: '#7c3aed' },
  blue:    { bg: '#dbeafe', color: '#2563eb' },
  amber:   { bg: '#fef3c7', color: '#d97706' },
  emerald: { bg: '#d1fae5', color: '#059669' },
  neutral: { bg: '#e5e7eb', color: '#6b7280' },
  teal:    { bg: '#ccfbf1', color: '#0d9488' },
  red:     { bg: '#fee2e2', color: '#dc2626' },
} as const

type Accent = keyof typeof ACCENTS

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  activeClients: number
  openRequests: number
  inProgress: number
  outstandingInvoicesUsd: number
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
    <div className="flex flex-col" style={{ gap: '2rem', maxWidth: '68.75rem' }}>
      {fetchError && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', borderRadius: 8, fontSize: '0.875rem', color: 'var(--color-danger)' }}>
          Failed to load overview data. Please refresh the page.
        </div>
      )}
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text)' }}>
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Here&apos;s what&apos;s happening at Tahi today.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          <QuickBtn href="/requests?new=1" icon={<Plus size={13} />} label="New Request" primary />
          <QuickBtn href="/clients?new=1" icon={<UserPlus size={13} />} label="Add Client" />
          <QuickBtn href="/time?new=1" icon={<Clock size={13} />} label="Log Time" />
        </div>
      </div>

      {/* KPI cards */}
      <div data-tour="overview-kpis" className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Active Clients"
          value={loading ? null : kpis?.activeClients ?? 0}
          icon={<Users size={18} />}
          href="/clients"
          accent="violet"
        />
        <StatCard
          label="Open Requests"
          value={loading ? null : kpis?.openRequests ?? 0}
          icon={<Inbox size={18} />}
          href="/requests"
          accent="blue"
          sub={kpis ? `${kpis.inProgress} in progress` : undefined}
        />
        <StatCard
          label="Outstanding"
          value={loading ? null : formatUsd(kpis?.outstandingInvoicesUsd ?? 0)}
          icon={<FileText size={18} />}
          href="/invoices"
          accent={kpis && kpis.outstandingInvoicesUsd > 0 ? 'amber' : 'neutral'}
          sub="invoices"
        />
        <StatCard
          label="MRR"
          value={loading ? null : (() => {
            if (monthlyRevenue.length === 0) return '$0'
            const latest = monthlyRevenue[monthlyRevenue.length - 1]
            return formatUsd(latest.total)
          })()}
          icon={<TrendingUp size={18} />}
          href="/reports"
          accent="emerald"
          sub={monthlyRevenue.length > 0 ? 'from invoices' : 'no invoice data'}
        />
      </div>

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
        ) : recentRequests.map((req, i) => (
          <RequestRow key={req.id} req={req} isLast={i === recentRequests.length - 1} showOrg />
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
      <div style={{ padding: '0 0.5rem' }}>
        {/* Overall utilization */}
        <div className="flex items-center justify-between" style={{ marginBottom: '0.375rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
            Overall Utilization
          </span>
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: barColor }}>
            {utilizationPct}%
          </span>
        </div>
        <div
          className="overflow-hidden"
          style={{ height: '0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '1.25rem' }}
        >
          <div
            className="transition-all"
            style={{ height: '100%', width: `${Math.min(utilizationPct, 100)}%`, background: barColor, borderRadius: '0.25rem' }}
          />
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3" style={{ gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={{ padding: '0.625rem 0.75rem', background: 'var(--color-bg-secondary)', borderRadius: '0.5rem' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.125rem' }}>
              Available
            </p>
            <p style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text)' }}>
              {data.availableCapacity}h
            </p>
          </div>
          <div style={{ padding: '0.625rem 0.75rem', background: 'var(--color-bg-secondary)', borderRadius: '0.5rem' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.125rem' }}>
              Pipeline
            </p>
            <p style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-warning)' }}>
              {data.pipelineImpact}h
            </p>
          </div>
          <div style={{ padding: '0.625rem 0.75rem', background: 'var(--color-bg-secondary)', borderRadius: '0.5rem' }}>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.125rem' }}>
              Forecast
            </p>
            <p style={{ fontSize: '1.125rem', fontWeight: 700, color: data.forecastedCapacity < 0 ? 'var(--color-danger)' : 'var(--color-brand)' }}>
              {data.forecastedCapacity}h
            </p>
          </div>
        </div>

        {/* Per-member bars */}
        {data.teamMembers.length > 0 && (
          <>
            <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '1rem' }}>
              <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '0.75rem' }}>
                Team Members
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.teamMembers.slice(0, 5).map(m => {
                  const memberBarColor = m.utilization > 85 ? 'var(--color-danger)' : m.utilization >= 60 ? 'var(--color-warning)' : 'var(--color-brand)'
                  return (
                    <div key={m.id} style={{ background: 'var(--color-bg-secondary)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: '0.375rem' }}>
                        <span className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', maxWidth: '10rem' }}>
                          {m.name}
                        </span>
                        <div className="flex items-center" style={{ gap: '0.5rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
                            {m.currentHoursAllocated}h / {m.weeklyCapacityHours}h
                          </span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: memberBarColor }}>
                            {m.utilization}%
                          </span>
                        </div>
                      </div>
                      <div className="overflow-hidden" style={{ height: '0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '9999px' }}>
                        <div
                          className="transition-all"
                          style={{
                            height: '100%',
                            width: `${Math.min(m.utilization, 100)}%`,
                            background: memberBarColor,
                            borderRadius: '9999px',
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </SectionCard>
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
    <div className="flex flex-col" style={{ gap: '2rem', maxWidth: '56.25rem' }}>
      {fetchError && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger)', borderRadius: 8, fontSize: '0.875rem', color: 'var(--color-danger)' }}>
          Failed to load your requests. Please refresh the page.
        </div>
      )}
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text)' }}>
            Welcome back{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            {orgName} (Tahi Studio workspace)
          </p>
        </div>
        <Link
          href="/requests?new=1"
          className="flex-shrink-0 flex items-center gap-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '0.5625rem 1rem', background: BRAND, borderRadius: 8 }}
        >
          <Plus size={14} />
          New Request
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
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
          className="flex items-start gap-3 rounded-xl"
          style={{ padding: '0.875rem 1rem', background: 'var(--status-in-review-bg)', border: '1px solid var(--status-in-review-border)' }}
        >
          <RefreshCw size={15} className="text-amber-500 flex-shrink-0" style={{ marginTop: 1 }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--status-in-review-text)' }}>
              {inReview.length} request{inReview.length > 1 ? 's' : ''} waiting for your review
            </p>
            <p className="text-xs" style={{ color: 'var(--status-in-review-text)', marginTop: '0.125rem' }}>
              Please approve or request changes.
            </p>
          </div>
          <Link
            href="/requests?status=client_review"
            className="text-xs font-semibold flex items-center gap-1 whitespace-nowrap hover:underline"
            style={{ color: 'var(--status-in-review-text)' }}
          >
            Review now <ArrowRight size={11} />
          </Link>
        </div>
      )}

      {/* Onboarding Checklist */}
      <OnboardingChecklistWrapper />

      {/* Schedule a Call (T88) */}
      <ScheduleCallWidget />

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

// ─── StatCard ─────────────────────────────────────────────────────────────────

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
      className="block rounded-xl transition-all hover:shadow-md"
      style={{
        padding: '1.5rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        textDecoration: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      {/* Icon row */}
      <div className="flex items-start justify-between" style={{ marginBottom: '1.25rem' }}>
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 44, height: 44, background: a.bg, color: a.color, borderRadius: '0 0.75rem 0 0.75rem' }}
        >
          {icon}
        </div>
        {highlight && (
          <span
            className="text-xs font-semibold rounded-full"
            style={{ padding: '0.1875rem 0.625rem', background: 'var(--status-in-review-bg)', color: 'var(--status-in-review-text)' }}
          >
            Action needed
          </span>
        )}
      </div>

      {/* Value */}
      {value === null ? (
        <div className="rounded animate-pulse" style={{ height: 36, width: 64, background: 'var(--color-bg-tertiary)', marginBottom: '0.5rem' }} />
      ) : (
        <p className="font-bold leading-none tabular-nums" style={{ fontSize: '2rem', color: 'var(--color-text)', marginBottom: '0.5rem' }}>
          {value}
        </p>
      )}

      {/* Label */}
      <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      {sub && <p className="text-xs" style={{ color: 'var(--color-text-subtle)', marginTop: '0.1875rem' }}>{sub}</p>}
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
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-row-border)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
        {action && (
          <Link
            href={action.href}
            className="text-xs flex items-center gap-1 font-medium hover:underline"
            style={{ color: BRAND }}
          >
            {action.label} <ArrowRight size={11} />
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
      className="flex items-center gap-4 group transition-colors"
      style={{
        padding: '0.875rem 1.25rem',
        borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
        textDecoration: 'none',
        background: 'var(--color-bg)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-row-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
    >
      <StatusBadge status={req.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {req.title}
          </p>
          {req.scopeFlagged && (
            <AlertTriangle size={11} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
          )}
          {req.priority === 'high' && (
            <span
              className="text-xs rounded-full flex-shrink-0"
              style={{ padding: '0.0625rem 0.4375rem', background: 'var(--status-in-review-bg)', color: 'var(--status-in-review-text)', fontSize: '0.625rem', fontWeight: 600 }}
            >
              High
            </span>
          )}
        </div>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>
          {showOrg && req.orgName ? `${req.orgName} · ` : ''}
          {req.type.replace(/_/g, ' ')}
        </p>
      </div>
      <span className="text-xs tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
        {timeAgo(req.updatedAt)}
      </span>
      <ArrowRight size={13} style={{ color: 'var(--color-border)', flexShrink: 0 }} />
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
          className="flex items-center gap-4 animate-pulse"
          style={{ padding: '1rem 1.25rem', borderBottom: i < 3 ? '1px solid var(--color-row-border)' : 'none' }}
        >
          <div className="rounded-full" style={{ width: 80, height: 22, background: 'var(--color-bg-tertiary)' }} />
          <div className="flex-1" style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <div className="rounded" style={{ height: 13, width: '60%', background: 'var(--color-bg-tertiary)' }} />
            <div className="rounded" style={{ height: 11, width: '35%', background: 'var(--color-bg-tertiary)' }} />
          </div>
          <div className="rounded" style={{ height: 11, width: 48, background: 'var(--color-bg-tertiary)' }} />
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
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: '3rem 1.5rem', gap: '0.5rem' }}>
      <div
        className="flex items-center justify-center"
        style={{ width: 44, height: 44, background: 'linear-gradient(135deg, #7aab6b, #425F39)', borderRadius: '0 0.75rem 0 0.75rem', marginBottom: '0.25rem' }}
      >
        <Inbox size={20} style={{ color: 'white' }} />
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{title}</p>
      <p className="text-xs" style={{ color: 'var(--color-text-subtle)', maxWidth: 280 }}>{message}</p>
      {action && (
        <Link
          href={action.href}
          className="text-xs flex items-center gap-1 font-medium hover:underline"
          style={{ color: BRAND, marginTop: '0.25rem' }}
        >
          {action.label} <ArrowRight size={11} />
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
      className="flex items-center gap-1.5 text-sm font-medium rounded-lg transition-opacity hover:opacity-90"
      style={primary
        ? { padding: '0.5rem 0.875rem', background: BRAND, color: 'white', border: `1px solid ${BRAND}`, textDecoration: 'none' }
        : { padding: '0.5rem 0.875rem', background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', textDecoration: 'none' }
      }
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
    <SectionCard title="Upcoming Calls" action={{ label: 'View all', href: '/calls' }}>
      {loading ? <LoadingRows /> : calls.map((call, i) => {
        const d = new Date(call.scheduledAt)
        return (
          <div
            key={call.id}
            className="flex items-center gap-3"
            style={{
              padding: '0.75rem 1.25rem',
              borderBottom: i < calls.length - 1 ? '1px solid var(--color-row-border)' : 'none',
            }}
          >
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: '2.25rem', height: '2.25rem', background: 'var(--color-info-bg, #eff6ff)', color: 'var(--color-info, #2563eb)', borderRadius: '0 0.625rem 0 0.625rem' }}
            >
              <Video size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                {call.title}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>
                {call.orgName ? `${call.orgName} · ` : ''}
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
                className="flex items-center gap-1 text-xs font-medium hover:underline flex-shrink-0"
                style={{ color: BRAND }}
              >
                Join <ExternalLink size={11} />
              </a>
            )}
          </div>
        )
      })}
    </SectionCard>
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
    <div
      className="rounded-xl"
      style={{ padding: '1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)', marginBottom: '0.25rem' }}>
        Getting started
      </h2>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        Complete these steps to set up your dashboard.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {steps.map(s => (
          <Link
            key={s.n}
            href={s.href}
            className="flex items-center gap-3 rounded-lg transition-colors"
            style={{ padding: '0.75rem 0.875rem', border: '1px solid var(--color-row-border)', textDecoration: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand-200)'; e.currentTarget.style.background = 'var(--color-brand-50)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-row-border)'; e.currentTarget.style.background = 'var(--color-bg)' }}
          >
            <span
              className="flex items-center justify-center rounded-full text-xs font-semibold text-white flex-shrink-0"
              style={{ width: 24, height: 24, background: BRAND }}
            >
              {s.n}
            </span>
            <span className="text-sm" style={{ color: 'var(--color-text)', flex: 1 }}>{s.label}</span>
            <ArrowRight size={13} style={{ color: 'var(--color-border)' }} />
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
      className="rounded-xl flex items-center justify-between"
      style={{
        padding: '1rem 1.25rem',
        background: 'var(--color-brand-50)',
        border: '1px solid var(--color-brand-100)',
      }}
    >
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-brand-dark)' }}>
          Need to chat?
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
          Book a quick call with the Tahi team.
        </p>
      </div>
      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        style={{
          padding: '0.5rem 1rem',
          background: BRAND,
          borderRadius: '0 0.5rem 0 0.5rem',
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          minHeight: '2.75rem',
          display: 'flex',
          alignItems: 'center',
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
    <div
      className="rounded-xl"
      style={{
        padding: '1.25rem',
        background: 'var(--color-info-bg, #eff6ff)',
        border: '1px solid var(--color-info, #60a5fa)',
      }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        We would love your feedback!
      </p>
      <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem', marginBottom: '0.75rem' }}>
        Your experience matters. Share a quick review to help us improve.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleResponse('yes')}
          disabled={responding}
          className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-brand)', border: 'none', cursor: 'pointer' }}
        >
          Yes, I will
        </button>
        <button
          onClick={() => handleResponse('defer')}
          disabled={responding}
          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-opacity hover:opacity-90"
          style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
          }}
        >
          Not right now
        </button>
        <button
          onClick={() => handleResponse('no')}
          disabled={responding}
          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-opacity hover:opacity-90"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-subtle)',
            cursor: 'pointer',
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
  const maxTotal = Math.max(...data.map(d => d.total), 1)

  function formatMonth(m: string): string {
    try {
      const [year, month] = m.split('-')
      const d = new Date(parseInt(year), parseInt(month) - 1)
      return d.toLocaleDateString('en-NZ', { month: 'short' })
    } catch {
      return m
    }
  }

  return (
    <div
      className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl"
      style={{ padding: '1.25rem' }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Revenue Trend</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Paid invoices, last 6 months</p>
        </div>
        <Link
          href="/reports"
          className="text-xs font-medium hover:underline"
          style={{ color: 'var(--color-brand)' }}
        >
          View reports
        </Link>
      </div>
      <div className="flex items-end gap-2" style={{ height: '8rem' }}>
        {data.map(d => {
          const heightPct = maxTotal > 0 ? (d.total / maxTotal) * 100 : 0
          return (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-medium text-[var(--color-text)]">
                {d.total > 0 ? formatUsd(d.total) : ''}
              </span>
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height: `${Math.max(heightPct, 2)}%`,
                  background: d.total > 0 ? 'var(--color-brand)' : 'var(--color-border-subtle)',
                  minHeight: '0.25rem',
                  maxWidth: '4rem',
                }}
              />
              <span className="text-xs text-[var(--color-text-muted)]">
                {formatMonth(d.month)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) }
  catch { return '' }
}

function formatUsd(n: number) {
  if (n === 0) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

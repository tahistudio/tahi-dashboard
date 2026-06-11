'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Inbox, FileText,
  Plus,
  ArrowRight, AlertTriangle, RefreshCw, Video,
  TrendingUp,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
import { OnboardingChecklist, type OnboardingState } from '@/components/tahi/onboarding-checklist'
import { BookingWidget } from '@/components/tahi/booking-widget'
import { Gate, usePermissions } from '@/components/tahi/permissions-context'
import { Reveal } from '@/components/tahi/reveal'
import { LedgerMasthead, type LedgerData } from '@/components/tahi/overview/ledger-masthead'
import { NeedsYou } from '@/components/tahi/overview/needs-you'
import { InTheStudio } from '@/components/tahi/overview/in-the-studio'
import { TodayRail } from '@/components/tahi/overview/today-rail'
import { PipelineAhead } from '@/components/tahi/overview/pipeline-ahead'
import { StudioCapacity } from '@/components/tahi/overview/studio-capacity'
import { CashRunway } from '@/components/tahi/overview/cash-runway'
import { ReceivablesTide } from '@/components/tahi/overview/receivables-tide'
import { TheWire } from '@/components/tahi/overview/the-wire'
import { TimeTracker } from '@/components/tahi/overview/time-tracker'
import { WorldClock } from '@/components/tahi/overview/world-clock'
import { ContentEngine } from '@/components/tahi/overview/content-engine'
import { SocialCadence } from '@/components/tahi/overview/social-cadence'
import { HotLeads } from '@/components/tahi/overview/hot-leads'
import { ProposalsLive } from '@/components/tahi/overview/proposals-live'
import { RetainerHealth } from '@/components/tahi/overview/retainer-health'
import { ContractsCard } from '@/components/tahi/overview/contracts-card'
import { TakeHomeGauges } from '@/components/tahi/overview/take-home-gauges'
import { CashFlowRibbon } from '@/components/tahi/overview/cash-flow-ribbon'
import { apiPath } from '@/lib/api'
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
  'calls', 'deals', 'overview', 'schedules', 'capacity', 'tasks',
  'content_studio', 'social', 'leads', 'proposals', 'contracts', 'time',
] as const

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
  const [ledger, setLedger] = useState<LedgerData | null>(null)
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
        return r.json() as Promise<LedgerData & { recentRequests: RecentRequest[] }>
      })
      .then(data => {
        setLedger(data)
        setKpis(data.kpis)
        setRecentRequests(data.recentRequests)
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  }, [needsOverviewData])

  const hasAnyCard = CARD_FEATURES.some(key => features[key] !== false)

  // Pairs share a bento row; when one half is gated off, the survivor takes
  // the full 12 columns so the grid re-packs with no holes.
  const requestsVisible = features['requests'] !== false
  const callsVisible = features['calls'] !== false
  const dealsVisible = features['deals'] !== false
  const capacityVisible = features['capacity'] !== false
  const cashVisible = features['financial_reports'] !== false
  const arVisible = features['invoices'] !== false
  const workVisible = requestsVisible || callsVisible
  const aheadVisible = dealsVisible || capacityVisible || features['leads'] !== false || features['proposals'] !== false
  const booksVisible = cashVisible || arVisible
  const growthVisible = features['content_studio'] !== false || features['social'] !== false
  const clientsZoneVisible = features['clients'] !== false || features['contracts'] !== false

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

      {/* The Ledger Masthead: MRR bare on the canvas + vitals + the Studio Note.
          Replaces the old greeting, the KPI bento strip and the AI briefing card. */}
      <Reveal id="overview-hero" className="flex flex-col" style={{ gap: 'var(--space-6)' }}>
        <LedgerMasthead userName={userName} data={ledger} loading={loading} />
      </Reveal>

      {hasAnyCard ? (
        <Reveal
          id="overview-grid"
          stagger
          className="grid grid-cols-1 lg:grid-cols-12"
          style={{ gap: 'var(--space-6)', gridAutoFlow: 'dense' }}
        >
          {/* Needs You: the act-now queue. Owns the page's single border-trace. */}
          <NeedsYou oldest={ledger?.arAging?.oldest ?? null} className="lg:col-span-12" />

          {/* The Wire: cross-dashboard live ticker (the page's heartbeat) */}
          <div className="lg:col-span-12"><TheWire /></div>

          {/* Desk: timer + world clock, folded in high near the masthead clocks */}
          <Gate feature="time">
            <TimeTracker className="lg:col-span-5" />
          </Gate>
          <WorldClock className="lg:col-span-7" />

          {/* GROWTH zone: content engine + social cadence */}
          {growthVisible && <ZoneLabel>Growth</ZoneLabel>}
          <Gate feature="content_studio">
            <ContentEngine className="lg:col-span-7" />
          </Gate>
          <Gate feature="social">
            <SocialCadence className="lg:col-span-5" />
          </Gate>

          {/* WORK zone: the worklog + today's rail */}
          {workVisible && <ZoneLabel>Work</ZoneLabel>}
          <Gate feature="requests">
            <InTheStudio data={recentRequests} loading={loading} className={callsVisible ? 'lg:col-span-7' : 'lg:col-span-12'} />
          </Gate>
          <Gate feature="calls">
            <TodayRail className={requestsVisible ? 'lg:col-span-5' : 'lg:col-span-12'} />
          </Gate>

          {/* AHEAD zone: pipeline + capacity + hot leads + proposals */}
          {aheadVisible && <ZoneLabel>Ahead</ZoneLabel>}
          <Gate feature="deals">
            <PipelineAhead className={capacityVisible ? 'lg:col-span-7' : 'lg:col-span-12'} />
          </Gate>
          <Gate feature="capacity">
            <StudioCapacity className={dealsVisible ? 'lg:col-span-5' : 'lg:col-span-12'} />
          </Gate>
          <Gate feature="leads">
            <HotLeads className="lg:col-span-6" />
          </Gate>
          <Gate feature="proposals">
            <ProposalsLive className="lg:col-span-6" />
          </Gate>

          {/* CLIENTS zone: retainer health + contracts */}
          {clientsZoneVisible && <ZoneLabel>Clients</ZoneLabel>}
          <Gate feature="clients">
            <RetainerHealth className="lg:col-span-7" />
          </Gate>
          <Gate feature="contracts">
            <ContractsCard className="lg:col-span-5" />
          </Gate>

          {/* BOOKS zone: take-home, cash + runway, forecast, receivables */}
          {booksVisible && <ZoneLabel>Books</ZoneLabel>}
          <Gate feature="financial_reports">
            <TakeHomeGauges className="lg:col-span-5" />
          </Gate>
          <Gate feature="financial_reports">
            <CashRunway cash={ledger?.cash ?? null} className="lg:col-span-7" />
          </Gate>
          <Gate feature="financial_reports">
            <CashFlowRibbon className="lg:col-span-7" />
          </Gate>
          <Gate feature="invoices">
            <ReceivablesTide arAging={ledger?.arAging ?? null} className="lg:col-span-5" />
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

// ─── Zone label (letterpress section divider in the bento) ───────────────────

function ZoneLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg:col-span-12" style={{ marginTop: 'var(--space-4)' }}>
      <span style={{ fontSize: 'var(--text-2xs, 0.6875rem)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>
        {children}
      </span>
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


// ─── Pipeline Summary Card (T360) ───────────────────────────────────────────




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

// ─── Upcoming Calls Widget ───────────────────────────────────────────────────



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
      background: 'var(--color-brand-50)',
      border: '1px solid var(--color-brand-100)',
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



// Tick once a minute so the live-now status + countdown stay accurate
// without forcing a refresh. Returns a render counter; consumers compute
// their own freshness from `Date.now()` on each tick.

// Compute live status for a scheduled call. The window opens 5 minutes
// before the start (so the join button appears in time) and closes at
// scheduledAt + durationMinutes.




// ─── Pipeline Forecast Card (weighted by stage probability) ───────────





// ─── Cash position (financial_reports) ───────────────────────────────────────



// ─── Receivables / AR aging (invoices) ───────────────────────────────────────



// ─── Open tasks (tasks) ───────────────────────────────────────────────────────







// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) }
  catch { return '' }
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, TrendingUp,
  Plus, Clock, UserPlus,
  ArrowRight, AlertTriangle, RefreshCw, Video, ExternalLink,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
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

// ─── Admin Overview ───────────────────────────────────────────────────────────

export function AdminOverview({ userName }: { userName: string }) {
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    fetch(apiPath('/api/admin/overview'))
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch overview')
        return r.json() as Promise<{ kpis: KPIs; recentRequests: RecentRequest[] }>
      })
      .then(data => { setKpis(data.kpis); setRecentRequests(data.recentRequests) })
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
        <div className="flex items-center gap-2 flex-shrink-0">
          <QuickBtn href="/requests?new=1" icon={<Plus size={13} />} label="New Request" primary />
          <QuickBtn href="/clients?new=1" icon={<UserPlus size={13} />} label="Add Client" />
          <QuickBtn href="/time?new=1" icon={<Clock size={13} />} label="Log Time" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
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
          value="--"
          icon={<TrendingUp size={18} />}
          href="/reports"
          accent="emerald"
          sub="Connect Stripe"
        />
      </div>

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

      {/* Upcoming Calls */}
      <UpcomingCallsWidget />

      {!loading && (kpis?.activeClients ?? 0) === 0 && <GettingStarted />}
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
      <div className="grid grid-cols-3 gap-5">
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
      className="block bg-white rounded-xl transition-all hover:shadow-md"
      style={{
        padding: '1.5rem',
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
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ width: 44, height: 44, background: a.bg, color: a.color }}
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
      className="bg-white rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
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
            <AlertTriangle size={11} style={{ color: '#f87171', flexShrink: 0 }} />
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
      <ArrowRight size={13} style={{ color: '#d1d5db', flexShrink: 0 }} />
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
        className="flex items-center justify-center rounded-xl"
        style={{ width: 44, height: 44, background: 'var(--color-bg-secondary)', marginBottom: '0.25rem' }}
      >
        <Inbox size={20} style={{ color: '#d1d5db' }} />
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
              className="flex items-center justify-center rounded-lg flex-shrink-0"
              style={{ width: '2.25rem', height: '2.25rem', background: '#eff6ff', color: '#2563eb' }}
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
      className="bg-white rounded-xl"
      style={{ padding: '1.5rem', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
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
            <ArrowRight size={13} style={{ color: '#d1d5db' }} />
          </Link>
        ))}
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

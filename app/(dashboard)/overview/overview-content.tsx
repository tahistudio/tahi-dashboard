'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, TrendingUp,
  Plus, Clock, UserPlus,
  ArrowRight, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
import { formatDistanceToNow } from 'date-fns'

// ─── Brand / palette constants ────────────────────────────────────────────────

const BRAND     = '#5A824E'
const BRAND_DRK = '#425F39'

// ─── Accent colour map (hex only — no Tailwind dynamic classes) ───────────────

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

  useEffect(() => {
    fetch('/api/admin/overview')
      .then(r => r.json() as Promise<{ kpis: KPIs; recentRequests: RecentRequest[] }>)
      .then(data => { setKpis(data.kpis); setRecentRequests(data.recentRequests) })
      .finally(() => setLoading(false))
  }, [])

  const firstName = userName.split(' ')[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col" style={{ gap: 32, maxWidth: 1100 }}>
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#111827' }}>
            {greeting}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="text-sm" style={{ color: '#6b7280', marginTop: 4 }}>
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
          value="—"
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

      {!loading && (kpis?.activeClients ?? 0) === 0 && <GettingStarted />}
    </div>
  )
}

// ─── Client Overview ──────────────────────────────────────────────────────────

export function ClientOverview({ userName, orgName }: { userName: string; orgName: string }) {
  const [requests, setRequests] = useState<RecentRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portal/requests?status=active&page=1')
      .then(r => r.json() as Promise<{ requests: RecentRequest[] }>)
      .then(data => setRequests(data.requests ?? []))
      .finally(() => setLoading(false))
  }, [])

  const open = requests.filter(r => !['delivered', 'archived'].includes(r.status))
  const inReview = requests.filter(r => r.status === 'client_review')
  const firstName = userName.split(' ')[0]
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col" style={{ gap: 32, maxWidth: 900 }}>
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#111827' }}>
            {greeting}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="text-sm" style={{ color: '#6b7280', marginTop: 4 }}>
            {orgName} — Tahi Studio workspace
          </p>
        </div>
        <Link
          href="/requests?new=1"
          className="flex-shrink-0 flex items-center gap-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '9px 16px', background: BRAND, borderRadius: 8 }}
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
          value="—"
          icon={<FileText size={18} />}
          href="/invoices"
          accent="neutral"
        />
      </div>

      {/* Review alert */}
      {inReview.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl"
          style={{ padding: '14px 16px', background: '#fffbeb', border: '1px solid #fcd34d' }}
        >
          <RefreshCw size={15} className="text-amber-500 flex-shrink-0" style={{ marginTop: 1 }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
              {inReview.length} request{inReview.length > 1 ? 's' : ''} waiting for your review
            </p>
            <p className="text-xs" style={{ color: '#b45309', marginTop: 2 }}>
              Please approve or request changes.
            </p>
          </div>
          <Link
            href="/requests?status=client_review"
            className="text-xs font-semibold flex items-center gap-1 whitespace-nowrap hover:underline"
            style={{ color: '#92400e' }}
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
        padding: 24,
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        textDecoration: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      {/* Icon row */}
      <div className="flex items-start justify-between" style={{ marginBottom: 20 }}>
        <div
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ width: 44, height: 44, background: a.bg, color: a.color }}
        >
          {icon}
        </div>
        {highlight && (
          <span
            className="text-xs font-semibold rounded-full"
            style={{ padding: '3px 10px', background: '#fef3c7', color: '#b45309' }}
          >
            Action needed
          </span>
        )}
      </div>

      {/* Value */}
      {value === null ? (
        <div className="rounded animate-pulse" style={{ height: 36, width: 64, background: '#f3f4f6', marginBottom: 8 }} />
      ) : (
        <p className="font-bold leading-none tabular-nums" style={{ fontSize: 32, color: '#111827', marginBottom: 8 }}>
          {value}
        </p>
      )}

      {/* Label */}
      <p className="text-sm font-medium" style={{ color: '#6b7280' }}>{label}</p>
      {sub && <p className="text-xs" style={{ color: '#9ca3af', marginTop: 3 }}>{sub}</p>}
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
      style={{ border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: '#374151' }}>{title}</h2>
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
        padding: '14px 20px',
        borderBottom: isLast ? 'none' : '1px solid #f9fafb',
        textDecoration: 'none',
        background: 'white',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'white' }}
    >
      <StatusBadge status={req.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate" style={{ color: '#1f2937' }}>
            {req.title}
          </p>
          {req.scopeFlagged && (
            <AlertTriangle size={11} style={{ color: '#f87171', flexShrink: 0 }} />
          )}
          {req.priority === 'high' && (
            <span
              className="text-xs rounded-full flex-shrink-0"
              style={{ padding: '1px 7px', background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 600 }}
            >
              High
            </span>
          )}
        </div>
        <p className="text-xs truncate" style={{ color: '#9ca3af', marginTop: 2 }}>
          {showOrg && req.orgName ? `${req.orgName} · ` : ''}
          {req.type.replace(/_/g, ' ')}
        </p>
      </div>
      <span className="text-xs tabular-nums flex-shrink-0" style={{ color: '#9ca3af' }}>
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
          style={{ padding: '16px 20px', borderBottom: i < 3 ? '1px solid #f9fafb' : 'none' }}
        >
          <div className="rounded-full" style={{ width: 80, height: 22, background: '#f3f4f6' }} />
          <div className="flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="rounded" style={{ height: 13, width: '60%', background: '#f3f4f6' }} />
            <div className="rounded" style={{ height: 11, width: '35%', background: '#f3f4f6' }} />
          </div>
          <div className="rounded" style={{ height: 11, width: 48, background: '#f3f4f6' }} />
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
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: '48px 24px', gap: 8 }}>
      <div
        className="flex items-center justify-center rounded-xl"
        style={{ width: 44, height: 44, background: '#f9fafb', marginBottom: 4 }}
      >
        <Inbox size={20} style={{ color: '#d1d5db' }} />
      </div>
      <p className="text-sm font-medium" style={{ color: '#374151' }}>{title}</p>
      <p className="text-xs" style={{ color: '#9ca3af', maxWidth: 280 }}>{message}</p>
      {action && (
        <Link
          href={action.href}
          className="text-xs flex items-center gap-1 font-medium hover:underline"
          style={{ color: BRAND, marginTop: 4 }}
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
        ? { padding: '8px 14px', background: BRAND, color: 'white', border: `1px solid ${BRAND}`, textDecoration: 'none' }
        : { padding: '8px 14px', background: 'white', color: '#374151', border: '1px solid #e5e7eb', textDecoration: 'none' }
      }
    >
      {icon}
      {label}
    </Link>
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
      style={{ padding: 24, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <h2 className="text-sm font-semibold" style={{ color: '#374151', marginBottom: 4 }}>
        Getting started
      </h2>
      <p className="text-sm" style={{ color: '#6b7280', marginBottom: 20 }}>
        Complete these steps to set up your dashboard.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {steps.map(s => (
          <Link
            key={s.n}
            href={s.href}
            className="flex items-center gap-3 rounded-lg transition-colors"
            style={{ padding: '12px 14px', border: '1px solid #f3f4f6', textDecoration: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#c6dbc0'; e.currentTarget.style.background = '#f4faf2' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#f3f4f6'; e.currentTarget.style.background = 'white' }}
          >
            <span
              className="flex items-center justify-center rounded-full text-xs font-semibold text-white flex-shrink-0"
              style={{ width: 24, height: 24, background: BRAND }}
            >
              {s.n}
            </span>
            <span className="text-sm" style={{ color: '#374151', flex: 1 }}>{s.label}</span>
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

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

// ─── Accent colour map (hex, no Tailwind dynamic classes) ─────────────────────

const ACCENTS = {
  violet:  { bg: '#ede9fe', color: '#7c3aed' },
  blue:    { bg: '#dbeafe', color: '#2563eb' },
  amber:   { bg: '#fef3c7', color: '#d97706' },
  emerald: { bg: '#d1fae5', color: '#059669' },
  neutral: { bg: '#f3f4f6', color: '#6b7280' },
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
    <div className="flex flex-col gap-7 max-w-5xl">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {greeting}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">Here&apos;s what&apos;s happening at Tahi today.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <QuickBtn href="/requests?new=1" icon={<Plus size={13} />} label="New Request" primary />
          <QuickBtn href="/clients?new=1" icon={<UserPlus size={13} />} label="Add Client" />
          <QuickBtn href="/time?new=1" icon={<Clock size={13} />} label="Log Time" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Clients"
          value={loading ? null : kpis?.activeClients ?? 0}
          icon={<Users size={16} />}
          href="/clients"
          accent="violet"
        />
        <StatCard
          label="Open Requests"
          value={loading ? null : kpis?.openRequests ?? 0}
          icon={<Inbox size={16} />}
          href="/requests"
          accent="blue"
          sub={kpis ? `${kpis.inProgress} in progress` : undefined}
        />
        <StatCard
          label="Outstanding"
          value={loading ? null : formatUsd(kpis?.outstandingInvoicesUsd ?? 0)}
          icon={<FileText size={16} />}
          href="/invoices"
          accent={kpis && kpis.outstandingInvoicesUsd > 0 ? 'amber' : 'neutral'}
          sub="invoices"
        />
        <StatCard
          label="MRR"
          value="—"
          icon={<TrendingUp size={16} />}
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
    <div className="flex flex-col gap-7 max-w-4xl">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            {greeting}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">{orgName} — Tahi Studio workspace</p>
        </div>
        <Link
          href="/requests?new=1"
          className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white rounded-lg transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-brand)' }}
        >
          <Plus size={14} />
          New Request
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Open Requests"
          value={loading ? null : open.length}
          icon={<Inbox size={16} />}
          href="/requests"
          accent="blue"
        />
        <StatCard
          label="Awaiting Review"
          value={loading ? null : inReview.length}
          icon={<RefreshCw size={16} />}
          href="/requests?status=client_review"
          accent={inReview.length > 0 ? 'amber' : 'neutral'}
          highlight={inReview.length > 0}
        />
        <StatCard
          label="Invoices Due"
          value="—"
          icon={<FileText size={16} />}
          href="/invoices"
          accent="neutral"
        />
      </div>

      {/* Review alert */}
      {inReview.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: '#fffbeb', border: '1px solid #fcd34d' }}>
          <RefreshCw size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {inReview.length} request{inReview.length > 1 ? 's' : ''} waiting for your review
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Please approve or request changes.</p>
          </div>
          <Link href="/requests?status=client_review" className="text-xs font-semibold text-amber-700 hover:underline whitespace-nowrap flex items-center gap-1">
            Review now <ArrowRight size={11} />
          </Link>
        </div>
      )}

      {/* Recent requests */}
      <SectionCard
        title="Your Requests"
        action={{ label: 'View all', href: '/requests' }}
      >
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
      className="block bg-white rounded-xl p-5 transition-all hover:shadow-md"
      style={{ border: '1px solid #d1d5db', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
    >
      <div className="flex items-start justify-between mb-4">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: a.bg, color: a.color }}
        >
          {icon}
        </div>
        {highlight && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>
            Action needed
          </span>
        )}
      </div>
      {value === null ? (
        <div className="h-8 w-16 rounded animate-pulse mb-1" style={{ background: '#f3f4f6' }} />
      ) : (
        <p className="text-3xl font-bold leading-none text-gray-900 tabular-nums">{value}</p>
      )}
      <p className="text-sm text-gray-500 mt-2">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
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
      style={{ border: '1px solid #d1d5db', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
    >
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #f3f4f6' }}>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {action && (
          <Link href={action.href} className="text-xs flex items-center gap-1 hover:underline" style={{ color: 'var(--color-brand)' }}>
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
      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors group"
      style={{ borderBottom: isLast ? 'none' : '1px solid #f9fafb' }}
    >
      <StatusBadge status={req.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-gray-800 truncate group-hover:text-gray-900">
            {req.title}
          </p>
          {req.scopeFlagged && <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />}
          {req.priority === 'high' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#fef3c7', color: '#92400e' }}>
              High
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {showOrg && req.orgName ? `${req.orgName} · ` : ''}
          {req.type.replace(/_/g, ' ')}
        </p>
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">{timeAgo(req.updatedAt)}</span>
      <ArrowRight size={13} className="text-gray-300 group-hover:text-gray-400 flex-shrink-0 transition-colors" />
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
          className="flex items-center gap-4 px-5 py-4 animate-pulse"
          style={{ borderBottom: i < 3 ? '1px solid #f9fafb' : 'none' }}
        >
          <div className="w-20 h-5 rounded-full" style={{ background: '#f3f4f6' }} />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 rounded w-2/3" style={{ background: '#f3f4f6' }} />
            <div className="h-3 rounded w-1/3" style={{ background: '#f3f4f6' }} />
          </div>
          <div className="h-3 w-12 rounded" style={{ background: '#f3f4f6' }} />
        </div>
      ))}
    </div>
  )
}

// ─── Empty rows ───────────────────────────────────────────────────────────────

function EmptyRows({ title, message, action }: { title: string; message: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-2">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-1" style={{ background: '#f9fafb' }}>
        <Inbox size={20} className="text-gray-300" />
      </div>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="text-xs text-gray-400 text-center max-w-xs">{message}</p>
      {action && (
        <Link href={action.href} className="text-xs flex items-center gap-1 mt-1 hover:underline" style={{ color: 'var(--color-brand)' }}>
          {action.label} <ArrowRight size={11} />
        </Link>
      )}
    </div>
  )
}

// ─── Quick action buttons ─────────────────────────────────────────────────────

function QuickBtn({ href, icon, label, primary }: { href: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors font-medium"
      style={primary
        ? { background: 'var(--color-brand)', color: 'white', border: '1px solid var(--color-brand)' }
        : { background: 'white', color: '#374151', border: '1px solid #e5e7eb' }
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
    { n: 1, label: 'Add your first client', href: '/clients?new=1' },
    { n: 2, label: 'Create a subscription or project', href: '/billing' },
    { n: 3, label: 'Submit a request on their behalf', href: '/requests?new=1' },
    { n: 4, label: 'Connect Stripe for billing', href: '/settings' },
  ]
  return (
    <div className="bg-white rounded-xl p-6" style={{ border: '1px solid #d1d5db', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
      <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Getting started</h2>
      <p className="text-sm text-gray-500 mb-5">Complete these steps to set up your dashboard.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {steps.map(s => (
          <Link
            key={s.n}
            href={s.href}
            className="flex items-center gap-3 p-3 rounded-lg transition-colors group"
            style={{ border: '1px solid #f3f4f6' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand-200)'; e.currentTarget.style.background = '#f0f7ee' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#f3f4f6'; e.currentTarget.style.background = 'white' }}
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
              style={{ background: 'var(--color-brand)' }}
            >
              {s.n}
            </span>
            <span className="text-sm text-gray-700">{s.label}</span>
            <ArrowRight size={13} className="ml-auto text-gray-300" />
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

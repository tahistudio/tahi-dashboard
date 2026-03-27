'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, TrendingUp,
  Plus, Clock, UserPlus, Loader2,
  ArrowRight, AlertTriangle, RefreshCw,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react'
import { StatusBadge } from '@/components/tahi/status-badge'
import { formatDistanceToNow } from 'date-fns'

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
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">
            {greeting}{firstName ? `, ${firstName}` : ''} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Clients"
          value={loading ? null : kpis?.activeClients ?? 0}
          icon={<Users size={16} />}
          href="/clients"
          iconBg="bg-violet-50"
          iconColor="text-violet-500"
        />
        <StatCard
          label="Open Requests"
          value={loading ? null : kpis?.openRequests ?? 0}
          icon={<Inbox size={16} />}
          href="/requests"
          iconBg="bg-blue-50"
          iconColor="text-blue-500"
          sub={kpis ? `${kpis.inProgress} in progress` : undefined}
        />
        <StatCard
          label="Outstanding"
          value={loading ? null : formatUsd(kpis?.outstandingInvoicesUsd ?? 0)}
          icon={<FileText size={16} />}
          href="/invoices"
          iconBg={kpis && kpis.outstandingInvoicesUsd > 0 ? 'bg-amber-50' : 'bg-gray-50'}
          iconColor={kpis && kpis.outstandingInvoicesUsd > 0 ? 'text-amber-500' : 'text-gray-400'}
          sub="invoices"
        />
        <StatCard
          label="MRR"
          value="—"
          icon={<TrendingUp size={16} />}
          href="/reports"
          iconBg="bg-emerald-50"
          iconColor="text-emerald-500"
          sub="Connect Stripe"
        />
      </div>

      {/* Recent requests */}
      <Card>
        <CardHeader title="Recent Requests" action={{ label: 'View all', href: '/requests' }} />
        {loading ? (
          <LoadingRows />
        ) : recentRequests.length === 0 ? (
          <EmptyRows
            title="No requests yet"
            message="When clients submit requests they'll appear here."
            action={{ label: 'Create first request', href: '/requests?new=1' }}
          />
        ) : (
          <div>
            {recentRequests.map((req, i) => (
              <RequestRow
                key={req.id}
                req={req}
                isLast={i === recentRequests.length - 1}
                showOrg
              />
            ))}
          </div>
        )}
      </Card>

      {/* Getting started */}
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
          <h1 className="text-[22px] font-bold tracking-tight text-gray-900">
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
          iconBg="bg-blue-50"
          iconColor="text-blue-500"
        />
        <StatCard
          label="Awaiting Review"
          value={loading ? null : inReview.length}
          icon={<RefreshCw size={16} />}
          href="/requests?status=client_review"
          iconBg={inReview.length > 0 ? 'bg-amber-50' : 'bg-gray-50'}
          iconColor={inReview.length > 0 ? 'text-amber-500' : 'text-gray-400'}
          highlight={inReview.length > 0}
        />
        <StatCard
          label="Invoices Due"
          value="—"
          icon={<FileText size={16} />}
          href="/invoices"
          iconBg="bg-gray-50"
          iconColor="text-gray-400"
        />
      </div>

      {/* Review alert */}
      {inReview.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <RefreshCw size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800">
              {inReview.length} request{inReview.length > 1 ? 's' : ''} waiting for your review
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Please approve or request changes.</p>
          </div>
          <Link href="/requests?status=client_review" className="text-xs font-medium text-amber-700 hover:underline whitespace-nowrap flex items-center gap-1">
            Review now <ArrowRight size={11} />
          </Link>
        </div>
      )}

      {/* Recent requests */}
      <Card>
        <CardHeader
          title="Your Requests"
          action={{ label: 'View all', href: '/requests' }}
        />
        {loading ? (
          <LoadingRows />
        ) : requests.length === 0 ? (
          <EmptyRows
            title="No requests yet"
            message="Submit your first request and the Tahi team will get started."
            action={{ label: 'Submit a request', href: '/requests?new=1' }}
          />
        ) : (
          <div>
            {requests.slice(0, 6).map((req, i) => (
              <RequestRow
                key={req.id}
                req={req}
                isLast={i === Math.min(requests.length, 6) - 1}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StatCard({
  label, value, icon, href, iconBg, iconColor, sub, highlight,
}: {
  label: string
  value: number | string | null
  icon: React.ReactNode
  href: string
  iconBg: string
  iconColor: string
  sub?: string
  highlight?: boolean
}) {
  return (
    <Link
      href={href}
      className="block bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md hover:border-gray-200 transition-all group"
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
        {highlight && (
          <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
            Action needed
          </span>
        )}
      </div>
      {value === null ? (
        <div className="h-8 w-16 bg-gray-100 rounded animate-pulse mb-1" />
      ) : (
        <p className="text-[28px] font-bold leading-none text-gray-900 tabular-nums">{value}</p>
      )}
      <p className="text-[13px] text-gray-500 mt-1.5">{label}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </Link>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      {children}
    </div>
  )
}

function CardHeader({ title, action }: { title: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
      <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      {action && (
        <Link
          href={action.href}
          className="text-xs text-[var(--color-brand)] hover:underline flex items-center gap-1"
        >
          {action.label} <ArrowRight size={11} />
        </Link>
      )}
    </div>
  )
}

function RequestRow({ req, isLast, showOrg }: { req: RecentRequest; isLast: boolean; showOrg?: boolean }) {
  return (
    <Link
      href={`/requests/${req.id}`}
      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/80 transition-colors group"
      style={{ borderBottom: isLast ? 'none' : '1px solid #f5f5f5' }}
    >
      <StatusBadge status={req.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-gray-800 truncate group-hover:text-[var(--color-brand-dark)]">
            {req.title}
          </p>
          {req.scopeFlagged && <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />}
          {req.priority === 'high' && (
            <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full flex-shrink-0">
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

function LoadingRows() {
  return (
    <div>
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse" style={{ borderBottom: i < 3 ? '1px solid #f5f5f5' : 'none' }}>
          <div className="w-20 h-5 bg-gray-100 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-gray-100 rounded w-2/3" />
            <div className="h-3 bg-gray-100 rounded w-1/3" />
          </div>
          <div className="h-3 w-12 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyRows({ title, message, action }: { title: string; message: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-2">
      <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mb-1">
        <Inbox size={20} className="text-gray-300" />
      </div>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="text-xs text-gray-400 text-center max-w-xs">{message}</p>
      {action && (
        <Link href={action.href} className="text-xs text-[var(--color-brand)] hover:underline flex items-center gap-1 mt-1">
          {action.label} <ArrowRight size={11} />
        </Link>
      )}
    </div>
  )
}

function QuickBtn({ href, icon, label, primary }: { href: string; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors font-medium ${
        primary
          ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)] hover:opacity-90'
          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}

function GettingStarted() {
  const steps = [
    { n: 1, label: 'Add your first client', href: '/clients?new=1' },
    { n: 2, label: 'Create a subscription or project', href: '/billing' },
    { n: 3, label: 'Submit a request on their behalf', href: '/requests?new=1' },
    { n: 4, label: 'Connect Stripe for billing', href: '/settings' },
  ]
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
      <h2 className="text-sm font-semibold text-gray-800 mb-0.5">Getting started</h2>
      <p className="text-sm text-gray-500 mb-5">Complete these steps to set up your dashboard.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {steps.map(s => (
          <Link
            key={s.n}
            href={s.href}
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-[var(--color-brand-100)] hover:bg-green-50/40 transition-colors group"
          >
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0" style={{ background: 'var(--color-brand)' }}>
              {s.n}
            </span>
            <span className="text-sm text-gray-700 group-hover:text-gray-900">{s.label}</span>
            <ArrowRight size={13} className="ml-auto text-gray-300 group-hover:text-[var(--color-brand)]" />
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

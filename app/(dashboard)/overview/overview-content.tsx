'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, TrendingUp,
  Plus, Clock, UserPlus, Loader2,
  ArrowRight, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusBadge } from '@/components/tahi/status-badge'
import { formatDistanceToNow } from 'date-fns'

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Admin Overview ──────────────────────────────────────────────────────────

export function AdminOverview({ userName }: { userName: string }) {
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/overview')
      .then(r => r.json() as Promise<{ kpis: KPIs; recentRequests: RecentRequest[] }>)
      .then((data) => {
        setKpis(data.kpis)
        setRecentRequests(data.recentRequests)
      })
      .finally(() => setLoading(false))
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col gap-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {greeting}{userName ? `, ${userName.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Here&apos;s what&apos;s happening at Tahi today.
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2">
          <QuickAction href="/requests?new=1" icon={<Plus size={14} />} label="New Request" primary />
          <QuickAction href="/clients?new=1" icon={<UserPlus size={14} />} label="New Client" />
          <QuickAction href="/time?new=1" icon={<Clock size={14} />} label="Log Time" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active Clients"
          value={loading ? null : kpis?.activeClients ?? 0}
          icon={<Users size={18} />}
          href="/clients"
          colour="brand"
        />
        <KpiCard
          label="Open Requests"
          value={loading ? null : kpis?.openRequests ?? 0}
          icon={<Inbox size={18} />}
          href="/requests"
          colour="blue"
          sub={kpis ? `${kpis.inProgress} in progress` : undefined}
        />
        <KpiCard
          label="Outstanding Invoices"
          value={loading ? null : formatUsd(kpis?.outstandingInvoicesUsd ?? 0)}
          icon={<FileText size={18} />}
          href="/invoices"
          colour={kpis && kpis.outstandingInvoicesUsd > 0 ? 'amber' : 'neutral'}
        />
        <KpiCard
          label="MRR"
          value="—"
          icon={<TrendingUp size={18} />}
          href="/reports"
          colour="green"
          sub="Connect Stripe to track"
        />
      </div>

      {/* Recent requests */}
      <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">Recent Requests</h2>
          <Link
            href="/requests"
            className="text-xs text-[var(--color-brand)] hover:underline flex items-center gap-1"
          >
            View all <ArrowRight size={11} />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-gray-300" size={24} />
          </div>
        ) : recentRequests.length === 0 ? (
          <EmptyState
            icon={<Inbox size={32} className="text-gray-300" />}
            title="No requests yet"
            message="When clients submit requests they'll appear here."
            action={{ label: 'Create first request', href: '/requests?new=1' }}
          />
        ) : (
          <div className="divide-y divide-gray-50">
            {recentRequests.map(req => (
              <Link
                key={req.id}
                href={`/requests/${req.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/60 transition-colors group"
              >
                <StatusBadge status={req.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-800 truncate">{req.title}</p>
                    {req.scopeFlagged && (
                      <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
                    )}
                    {req.priority === 'high' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full flex-shrink-0">
                        High
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {req.orgName ?? 'Unknown client'} · {req.type.replace(/_/g, ' ')}
                  </p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {timeAgo(req.updatedAt)}
                </span>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-gray-400 transition-colors flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Getting started panel — shown when no data yet */}
      {!loading && (kpis?.activeClients ?? 0) === 0 && (
        <GettingStarted />
      )}
    </div>
  )
}

// ─── Client Portal Overview ──────────────────────────────────────────────────

export function ClientOverview({ userName, orgName }: { userName: string; orgName: string }) {
  const [requests, setRequests] = useState<RecentRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/portal/requests?status=active&page=1')
      .then(r => r.json() as Promise<{ requests: RecentRequest[] }>)
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false))
  }, [])

  const open = requests.filter(r => !['delivered', 'archived'].includes(r.status))
  const inReview = requests.filter(r => r.status === 'client_review')

  return (
    <div className="flex flex-col gap-8 max-w-4xl">
      {/* Welcome banner */}
      <div
        className="rounded-[var(--radius-card)] p-6 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, var(--color-brand-dark) 0%, var(--color-brand) 100%)' }}
      >
        <div className="relative z-10">
          <p className="text-sm opacity-80 mb-1">{orgName}</p>
          <h1 className="text-2xl font-semibold">
            Welcome back{userName ? `, ${userName.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-sm opacity-70 mt-2">
            Your Tahi Studio workspace
          </p>
        </div>
        {/* Leaf decoration */}
        <div
          className="absolute -right-8 -top-8 w-40 h-40 opacity-10"
          style={{
            background: 'white',
            borderRadius: '0 40px 0 40px',
          }}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Open Requests"
          value={loading ? null : open.length}
          icon={<Inbox size={18} />}
          href="/requests"
          colour="brand"
        />
        <KpiCard
          label="Awaiting Your Review"
          value={loading ? null : inReview.length}
          icon={<RefreshCw size={18} />}
          href="/requests?status=client_review"
          colour={inReview.length > 0 ? 'amber' : 'neutral'}
        />
        <KpiCard
          label="Invoices Due"
          value="—"
          icon={<FileText size={18} />}
          href="/invoices"
          colour="neutral"
        />
      </div>

      {/* Client review alert */}
      {inReview.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-card)] p-4 flex items-start gap-3">
          <RefreshCw size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">
              {inReview.length} request{inReview.length > 1 ? 's' : ''} waiting for your review
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              Please review and approve or request changes.
            </p>
          </div>
          <Link
            href="/requests?status=client_review"
            className="text-xs font-medium text-amber-700 hover:underline flex items-center gap-1"
          >
            Review now <ArrowRight size={11} />
          </Link>
        </div>
      )}

      {/* Recent requests */}
      <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">Your Requests</h2>
          <div className="flex items-center gap-3">
            <Link href="/requests?new=1" className="text-xs bg-[var(--color-brand)] text-white px-3 py-1.5 rounded-lg flex items-center gap-1 hover:opacity-90 transition-opacity">
              <Plus size={12} />
              New request
            </Link>
            <Link href="/requests" className="text-xs text-[var(--color-brand)] hover:underline flex items-center gap-1">
              View all <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-gray-300" size={24} />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={<Inbox size={32} className="text-gray-300" />}
            title="No requests yet"
            message="Submit your first request and the Tahi team will get started."
            action={{ label: 'Submit a request', href: '/requests?new=1' }}
          />
        ) : (
          <div className="divide-y divide-gray-50">
            {requests.slice(0, 6).map(req => (
              <Link
                key={req.id}
                href={`/requests/${req.id}`}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/60 transition-colors group"
              >
                <StatusBadge status={req.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{req.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{req.type.replace(/_/g, ' ')}</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo(req.updatedAt)}</span>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-gray-400 flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon, href, colour, sub,
}: {
  label: string
  value: number | string | null
  icon: React.ReactNode
  href: string
  colour: 'brand' | 'blue' | 'amber' | 'green' | 'neutral'
  sub?: string
}) {
  const colours = {
    brand:   { bg: 'bg-green-50',  icon: 'text-[var(--color-brand)]',  text: 'text-[var(--color-brand)]' },
    blue:    { bg: 'bg-blue-50',   icon: 'text-blue-500',               text: 'text-blue-600' },
    amber:   { bg: 'bg-amber-50',  icon: 'text-amber-500',              text: 'text-amber-600' },
    green:   { bg: 'bg-emerald-50',icon: 'text-emerald-500',            text: 'text-emerald-600' },
    neutral: { bg: 'bg-gray-50',   icon: 'text-gray-400',               text: 'text-gray-600' },
  }[colour]

  return (
    <Link
      href={href}
      className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-5 hover:border-gray-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg', colours.bg)}>
          <span className={colours.icon}>{icon}</span>
        </div>
      </div>
      {value === null ? (
        <div className="h-8 w-16 bg-gray-100 rounded animate-pulse mb-1" />
      ) : (
        <p className={cn('text-2xl font-bold', colours.text)}>{value}</p>
      )}
      <p className="text-xs text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </Link>
  )
}

function QuickAction({
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
      className={cn(
        'flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors',
        primary
          ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)] hover:bg-[var(--color-brand-dark)]'
          : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50',
      )}
    >
      {icon}
      {label}
    </Link>
  )
}

function EmptyState({
  icon, title, message, action,
}: {
  icon: React.ReactNode
  title: string
  message: string
  action?: { label: string; href: string }
}) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3">
      {icon}
      <div className="text-center">
        <p className="text-sm font-medium text-gray-600">{title}</p>
        <p className="text-xs text-gray-400 mt-1">{message}</p>
      </div>
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

function GettingStarted() {
  const steps = [
    { n: 1, label: 'Add your first client', href: '/clients?new=1' },
    { n: 2, label: 'Create a subscription or project', href: '/billing' },
    { n: 3, label: 'Submit a request on their behalf', href: '/requests?new=1' },
    { n: 4, label: 'Connect Stripe for billing', href: '/settings' },
  ]
  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-6">
      <h2 className="font-semibold text-gray-800 mb-1">Getting started</h2>
      <p className="text-sm text-gray-500 mb-5">Complete these steps to set up your dashboard.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {steps.map(s => (
          <Link
            key={s.n}
            href={s.href}
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-[var(--color-brand)] hover:bg-green-50/30 transition-colors group"
          >
            <span className="w-6 h-6 rounded-full bg-[var(--color-brand)] text-white text-xs flex items-center justify-center font-semibold flex-shrink-0">
              {s.n}
            </span>
            <span className="text-sm text-gray-700 group-hover:text-[var(--color-brand-dark)]">{s.label}</span>
            <ArrowRight size={13} className="ml-auto text-gray-300 group-hover:text-[var(--color-brand)]" />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string) {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

function formatUsd(n: number) {
  if (n === 0) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

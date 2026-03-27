'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Inbox, FileText, TrendingUp,
  Plus, Clock, UserPlus, Loader2,
  ArrowRight, AlertTriangle, RefreshCw,
  ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
      .then((data) => {
        setKpis(data.kpis)
        setRecentRequests(data.recentRequests)
      })
      .finally(() => setLoading(false))
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
            {greeting}{userName ? `, ${userName.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            Here&apos;s what&apos;s happening at Tahi today.
          </p>
        </div>
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
          accent="brand"
        />
        <KpiCard
          label="Open Requests"
          value={loading ? null : kpis?.openRequests ?? 0}
          icon={<Inbox size={18} />}
          href="/requests"
          accent="blue"
          sub={kpis ? `${kpis.inProgress} in progress` : undefined}
        />
        <KpiCard
          label="Outstanding"
          value={loading ? null : formatUsd(kpis?.outstandingInvoicesUsd ?? 0)}
          icon={<FileText size={18} />}
          href="/invoices"
          accent={kpis && kpis.outstandingInvoicesUsd > 0 ? 'amber' : 'neutral'}
          sub="invoices"
        />
        <KpiCard
          label="MRR"
          value="—"
          icon={<TrendingUp size={18} />}
          href="/reports"
          accent="green"
          sub="Connect Stripe to track"
        />
      </div>

      {/* Recent requests */}
      <div
        className="overflow-hidden"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            Recent Requests
          </h2>
          <Link
            href="/requests"
            className="text-xs flex items-center gap-1 hover:underline"
            style={{ color: 'var(--color-brand)' }}
          >
            View all <ArrowRight size={11} />
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin" size={24} style={{ color: 'var(--color-border)' }} />
          </div>
        ) : recentRequests.length === 0 ? (
          <EmptyState
            icon={<Inbox size={28} style={{ color: 'var(--color-border)' }} />}
            title="No requests yet"
            message="When clients submit requests they'll appear here."
            action={{ label: 'Create first request', href: '/requests?new=1' }}
          />
        ) : (
          <div>
            {recentRequests.map((req, i) => (
              <Link
                key={req.id}
                href={`/requests/${req.id}`}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors group"
                style={{ borderBottom: i < recentRequests.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <StatusBadge status={req.status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                      {req.title}
                    </p>
                    {req.scopeFlagged && (
                      <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
                    )}
                    {req.priority === 'high' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full flex-shrink-0">
                        High
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                    {req.orgName ?? 'Unknown client'} · {req.type.replace(/_/g, ' ')}
                  </p>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                  {timeAgo(req.updatedAt)}
                </span>
                <ArrowRight
                  size={14}
                  className="flex-shrink-0 transition-colors"
                  style={{ color: 'var(--color-border)' }}
                />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Getting started — shown when no data */}
      {!loading && (kpis?.activeClients ?? 0) === 0 && (
        <GettingStarted />
      )}
    </div>
  )
}

// ─── Client Portal Overview ───────────────────────────────────────────────────

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
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Welcome banner */}
      <div
        className="rounded-xl p-6 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, var(--color-brand-dark) 0%, var(--color-brand) 100%)' }}
      >
        <div className="relative z-10">
          <p className="text-sm mb-1" style={{ opacity: 0.8 }}>{orgName}</p>
          <h1 className="text-2xl font-bold">
            Welcome back{userName ? `, ${userName.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-sm mt-2" style={{ opacity: 0.7 }}>
            Your Tahi Studio workspace
          </p>
        </div>
        <div
          className="absolute -right-8 -top-8 w-40 h-40 opacity-10"
          style={{ background: 'white', borderRadius: '0 40px 0 40px' }}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Open Requests"
          value={loading ? null : open.length}
          icon={<Inbox size={18} />}
          href="/requests"
          accent="brand"
        />
        <KpiCard
          label="Awaiting Review"
          value={loading ? null : inReview.length}
          icon={<RefreshCw size={18} />}
          href="/requests?status=client_review"
          accent={inReview.length > 0 ? 'amber' : 'neutral'}
        />
        <KpiCard
          label="Invoices Due"
          value="—"
          icon={<FileText size={18} />}
          href="/invoices"
          accent="neutral"
        />
      </div>

      {/* Client review alert */}
      {inReview.length > 0 && (
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{
            background: 'var(--color-warning-bg)',
            border: '1px solid #fed7aa',
          }}
        >
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
      <div
        className="overflow-hidden"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h2 className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
            Your Requests
          </h2>
          <div className="flex items-center gap-3">
            <Link
              href="/requests?new=1"
              className="text-xs flex items-center gap-1 px-3 py-1.5 text-white rounded-lg hover:opacity-90 transition-opacity"
              style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-button)' }}
            >
              <Plus size={12} />
              New request
            </Link>
            <Link
              href="/requests"
              className="text-xs flex items-center gap-1 hover:underline"
              style={{ color: 'var(--color-brand)' }}
            >
              View all <ArrowRight size={11} />
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin" size={24} style={{ color: 'var(--color-border)' }} />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={<Inbox size={28} style={{ color: 'var(--color-border)' }} />}
            title="No requests yet"
            message="Submit your first request and the Tahi team will get started."
            action={{ label: 'Submit a request', href: '/requests?new=1' }}
          />
        ) : (
          <div>
            {requests.slice(0, 6).map((req, i) => (
              <Link
                key={req.id}
                href={`/requests/${req.id}`}
                className="flex items-center gap-4 px-5 py-3.5 transition-colors group"
                style={{ borderBottom: i < Math.min(requests.length, 6) - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <StatusBadge status={req.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {req.title}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>
                    {req.type.replace(/_/g, ' ')}
                  </p>
                </div>
                <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
                  {timeAgo(req.updatedAt)}
                </span>
                <ArrowRight size={14} className="flex-shrink-0" style={{ color: 'var(--color-border)' }} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const ACCENT_MAP = {
  brand:   { bg: 'var(--color-brand-50)',   icon: 'var(--color-brand)',   value: 'var(--color-brand-dark)' },
  blue:    { bg: '#eff6ff',                  icon: '#3b82f6',              value: '#1d4ed8' },
  amber:   { bg: 'var(--color-warning-bg)', icon: 'var(--color-warning)', value: '#92400e' },
  green:   { bg: '#ecfdf5',                  icon: '#10b981',              value: '#065f46' },
  neutral: { bg: 'var(--color-bg-tertiary)', icon: 'var(--color-text-subtle)', value: 'var(--color-text-muted)' },
}

function KpiCard({
  label, value, icon, href, accent, sub,
}: {
  label: string
  value: number | string | null
  icon: React.ReactNode
  href: string
  accent: keyof typeof ACCENT_MAP
  sub?: string
}) {
  const a = ACCENT_MAP[accent]

  return (
    <Link
      href={href}
      className="block p-5 transition-all hover:shadow-md"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-brand-200)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 rounded-lg" style={{ background: a.bg }}>
          <span style={{ color: a.icon }}>{icon}</span>
        </div>
        <ChevronUp size={14} style={{ color: 'var(--color-text-subtle)' }} className="rotate-45 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      {value === null ? (
        <div className="h-8 w-20 rounded animate-pulse mb-1" style={{ background: 'var(--color-bg-tertiary)' }} />
      ) : (
        <p className="text-2xl font-bold" style={{ color: a.value }}>{value}</p>
      )}
      <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-subtle)' }}>{sub}</p>}
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
      className={cn('flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors', primary ? 'text-white' : '')}
      style={
        primary
          ? {
              background: 'var(--color-brand)',
              border: '1px solid var(--color-brand)',
              borderRadius: 'var(--radius-button)',
            }
          : {
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-button)',
            }
      }
      onMouseEnter={(e) => {
        if (!primary) e.currentTarget.style.borderColor = 'var(--color-brand-200)'
      }}
      onMouseLeave={(e) => {
        if (!primary) e.currentTarget.style.borderColor = 'var(--color-border)'
      }}
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
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>{title}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-subtle)' }}>{message}</p>
      </div>
      {action && (
        <Link
          href={action.href}
          className="text-xs flex items-center gap-1 hover:underline"
          style={{ color: 'var(--color-brand)' }}
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
    <div
      className="p-6"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <h2 className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Getting started</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
        Complete these steps to set up your dashboard.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {steps.map(s => (
          <Link
            key={s.n}
            href={s.href}
            className="flex items-center gap-3 p-3 rounded-lg transition-colors"
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-brand)'
              e.currentTarget.style.background = 'var(--color-brand-50)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span
              className="w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-semibold flex-shrink-0"
              style={{ background: 'var(--color-brand)' }}
            >
              {s.n}
            </span>
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>{s.label}</span>
            <ArrowRight size={13} className="ml-auto" style={{ color: 'var(--color-text-subtle)' }} />
          </Link>
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

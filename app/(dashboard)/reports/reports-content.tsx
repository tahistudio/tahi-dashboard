'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Inbox, Clock, CreditCard, BarChart2,
  TrendingUp, RefreshCw, Calendar,
} from 'lucide-react'
import { apiPath } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportData {
  totalClients: number
  totalRequests: number
  openRequests: number
  avgDeliveryDays: number
  totalBillableHours: number
  outstandingInvoiceAmount: number
  requestsByStatus: Record<string, number>
  monthlyTrend: Record<string, number>
}

// ── Status labels ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  in_review: 'In Review',
  in_progress: 'In Progress',
  client_review: 'Client Review',
  delivered: 'Delivered',
  archived: 'Archived',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--status-draft-dot)',
  submitted: 'var(--status-submitted-dot)',
  in_review: 'var(--status-in-review-dot)',
  in_progress: 'var(--status-in-progress-dot)',
  client_review: 'var(--status-client-review-dot)',
  delivered: 'var(--status-delivered-dot)',
  archived: 'var(--status-archived-dot)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatMonthLabel(key: string): string {
  const [year, month] = key.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1)
  return d.toLocaleDateString('en-NZ', { month: 'short', year: '2-digit' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReportsContent() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(apiPath('/api/admin/reports/overview'))
      if (!res.ok) throw new Error('Failed to load')
      const json = await res.json() as ReportData
      setData(json)
    } catch {
      setError(true)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Reports</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Revenue, request throughput, and client overview.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--color-border)',
                padding: '1.25rem',
                height: '6rem',
              }}
            >
              <div className="h-4 rounded" style={{ background: 'var(--color-bg-tertiary)', width: '60%' }} />
              <div className="h-8 rounded mt-3" style={{ background: 'var(--color-bg-tertiary)', width: '40%' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Reports</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Revenue, request throughput, and client overview.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div
            className="w-16 h-16 brand-gradient flex items-center justify-center mb-4"
            style={{ borderRadius: 'var(--radius-leaf)' }}
          >
            <BarChart2 className="w-8 h-8 text-white" />
          </div>
          <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">
            Unable to load reports
          </h3>
          <p className="text-sm text-[var(--color-text-muted)] max-w-sm mb-4">
            There was an error loading the report data. Please try again.
          </p>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    )
  }

  const maxStatusCount = Math.max(...Object.values(data.requestsByStatus), 1)
  const maxMonthlyCount = Math.max(...Object.values(data.monthlyTrend), 1)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Reports</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Revenue, request throughput, and client overview.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={Users}
          label="Total Clients"
          value={String(data.totalClients)}
          accent="emerald"
        />
        <SummaryCard
          icon={Inbox}
          label="Open Requests"
          value={String(data.openRequests)}
          accent="blue"
        />
        <SummaryCard
          icon={Clock}
          label="Billable Hours"
          value={data.totalBillableHours.toFixed(1)}
          accent="amber"
        />
        <SummaryCard
          icon={CreditCard}
          label="Outstanding"
          value={formatCurrency(data.outstandingInvoiceAmount)}
          accent="violet"
        />
      </div>

      {/* Two-column layout for tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Requests by status */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.25rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Requests by Status
          </h3>
          {Object.keys(data.requestsByStatus).length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No requests yet.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.requestsByStatus)
                .sort(([, a], [, b]) => b - a)
                .map(([status, cnt]) => (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-[var(--color-text)]">
                        {STATUS_LABELS[status] ?? status}
                      </span>
                      <span className="text-sm font-medium text-[var(--color-text)]">
                        {cnt}
                      </span>
                    </div>
                    <div
                      style={{
                        height: '0.5rem',
                        borderRadius: 'var(--radius-full)',
                        background: 'var(--color-bg-tertiary)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${(cnt / maxStatusCount) * 100}%`,
                          height: '100%',
                          borderRadius: 'var(--radius-full)',
                          background: STATUS_COLORS[status] ?? 'var(--color-brand)',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Monthly trend */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.25rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Monthly Request Volume
          </h3>
          {Object.keys(data.monthlyTrend).length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No data yet.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(data.monthlyTrend).map(([month, cnt]) => (
                <div key={month}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-[var(--color-text)]">
                      {formatMonthLabel(month)}
                    </span>
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {cnt}
                    </span>
                  </div>
                  <div
                    style={{
                      height: '0.5rem',
                      borderRadius: 'var(--radius-full)',
                      background: 'var(--color-bg-tertiary)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${maxMonthlyCount > 0 ? (cnt / maxMonthlyCount) * 100 : 0}%`,
                        height: '100%',
                        borderRadius: 'var(--radius-full)',
                        background: 'var(--color-brand)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Extra stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total Requests"
          value={String(data.totalRequests)}
          icon={Inbox}
        />
        <StatCard
          label="Avg. Delivery Days"
          value={data.avgDeliveryDays > 0 ? `${data.avgDeliveryDays}d` : 'N/A'}
          icon={Calendar}
        />
        <StatCard
          label="Completion Rate"
          value={
            data.totalRequests > 0
              ? `${Math.round(((data.requestsByStatus['delivered'] ?? 0) / data.totalRequests) * 100)}%`
              : 'N/A'
          }
          icon={TrendingUp}
        />
      </div>
    </div>
  )
}

// ── Summary Card ────────────────────────────────────────────────────────────

const ACCENT_COLORS: Record<string, { bg: string; color: string }> = {
  emerald: { bg: '#d1fae5', color: '#059669' },
  blue:    { bg: '#dbeafe', color: '#2563eb' },
  amber:   { bg: '#fef3c7', color: '#d97706' },
  violet:  { bg: '#ede9fe', color: '#7c3aed' },
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Users
  label: string
  value: string
  accent: string
}) {
  const colors = ACCENT_COLORS[accent] ?? ACCENT_COLORS.emerald

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        padding: '1.25rem',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: '2.5rem',
            height: '2.5rem',
            borderRadius: 'var(--radius-leaf-sm)',
            background: colors.bg,
            color: colors.color,
          }}
        >
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
          <p className="text-xl font-bold text-[var(--color-text)]">{value}</p>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: typeof Inbox
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        padding: '1rem',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-[var(--color-text-subtle)]" aria-hidden="true" />
        <span className="text-xs font-medium text-[var(--color-text-muted)]">{label}</span>
      </div>
      <p className="text-lg font-bold text-[var(--color-text)]">{value}</p>
    </div>
  )
}

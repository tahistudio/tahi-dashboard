'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users, Inbox, Clock, CreditCard, BarChart2,
  TrendingUp, RefreshCw, Calendar, Download, DollarSign,
  Target, Percent, PieChart as PieChartIcon,
  Filter, ArrowDown,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
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
  deliveryTimeTrend?: Record<string, number>
  revenueByPlan?: Record<string, number>
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

const PIE_COLORS = ['#60a5fa', '#22c55e', '#fbbf24', '#a78bfa', '#f87171', '#10b981', '#9ca3af']

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--color-border)',
                padding: '1.5rem',
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

  // Prepare chart data
  const statusChartData = Object.entries(data.requestsByStatus)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => ({
      name: STATUS_LABELS[status] ?? status,
      value: count,
      fill: STATUS_COLORS[status] ?? 'var(--color-brand)',
    }))

  const monthlyChartData = Object.entries(data.monthlyTrend).map(([month, count]) => ({
    name: formatMonthLabel(month),
    requests: count,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Reports</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Revenue, request throughput, and client overview.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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

      {/* Two-column layout for charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Requests by status - Pie chart */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Requests by Status
          </h3>
          {statusChartData.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Data will appear once you have requests and clients.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {statusChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  wrapperStyle={{ fontSize: '0.75rem' }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Monthly trend - Bar chart */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Monthly Request Volume
          </h3>
          {monthlyChartData.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Data will appear once you have requests and clients.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8f0e6" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="requests" fill="#5A824E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Extra stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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

      {/* Delivery time trend + Revenue by plan type */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Delivery time trend */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Delivery Time Trend (avg days per month)
          </h3>
          {data.deliveryTimeTrend && Object.keys(data.deliveryTimeTrend).length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th
                      className="text-left text-xs font-medium text-[var(--color-text-muted)]"
                      style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                    >
                      Month
                    </th>
                    <th
                      className="text-right text-xs font-medium text-[var(--color-text-muted)]"
                      style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                    >
                      Avg Days
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.deliveryTimeTrend)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([month, days]) => (
                      <tr key={month}>
                        <td
                          className="text-sm text-[var(--color-text)]"
                          style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                        >
                          {formatMonthLabel(month)}
                        </td>
                        <td
                          className="text-sm text-[var(--color-text)] text-right font-medium"
                          style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                        >
                          {days > 0 ? `${days}d` : 'N/A'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No delivery data yet.</p>
          )}
        </div>

        {/* Revenue by plan type */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Subscriptions by Plan Type
          </h3>
          {data.revenueByPlan && Object.keys(data.revenueByPlan).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(data.revenueByPlan)
                .sort(([, a], [, b]) => b - a)
                .map(([plan, count]) => (
                  <div key={plan} className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-text)] capitalize">{plan.replace(/_/g, ' ')}</span>
                    <span
                      className="text-sm font-semibold text-[var(--color-text)]"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        padding: '0.125rem 0.5rem',
                        borderRadius: 'var(--radius-button)',
                      }}
                    >
                      {count}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]">No subscription data yet.</p>
          )}
        </div>
      </div>

      {/* Response Time per Team Member */}
      <ResponseTimeSection />

      {/* Sales Pipeline */}
      <SalesPipelineSection />

      {/* Sales Funnel / Close Rates */}
      <SalesFunnelSection />

      {/* Source Breakdown (T390) */}
      <SourceBreakdownSection />
    </div>
  )
}

// ── Response Time Section ──────────────────────────────────────────────────

interface ResponseTimeRow {
  teamMemberId: string
  name: string
  messageCount: number
  avgResponseMinutes: number
}

function ResponseTimeSection() {
  const [rows, setRows] = useState<ResponseTimeRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/reports/response-time'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ items: ResponseTimeRow[] }>
      })
      .then(d => setRows(d.items ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const formatTime = (mins: number): string => {
    if (mins === 0) return 'N/A'
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    const remaining = mins % 60
    if (hours < 24) return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
  }

  const exportCsv = () => {
    const header = 'Team Member,Responses,Avg Response Time (minutes)\n'
    const csvRows = rows.map(r =>
      `"${r.name}",${r.messageCount},${r.avgResponseMinutes}`
    )
    const blob = new Blob([header + csvRows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'response-times.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-card)',
        border: '1px solid var(--color-border)',
        padding: '1.5rem',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Avg Response Time per Team Member
        </h3>
        {rows.length > 0 && (
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 text-xs font-medium transition-colors hover:text-[var(--color-brand)]"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
              padding: '0.375rem 0.75rem',
              cursor: 'pointer',
              minHeight: '2rem',
            }}
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Export CSV
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded" style={{ height: '2.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No response data available yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th
                  className="text-left text-xs font-medium text-[var(--color-text-muted)]"
                  style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  Team Member
                </th>
                <th
                  className="text-right text-xs font-medium text-[var(--color-text-muted)]"
                  style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  Responses
                </th>
                <th
                  className="text-right text-xs font-medium text-[var(--color-text-muted)]"
                  style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  Avg Response Time
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.teamMemberId}>
                  <td
                    className="text-sm text-[var(--color-text)] font-medium"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    {row.name}
                  </td>
                  <td
                    className="text-sm text-[var(--color-text-muted)] text-right"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    {row.messageCount}
                  </td>
                  <td
                    className="text-sm text-right font-medium"
                    style={{
                      padding: '0.5rem 0.75rem',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      color: row.avgResponseMinutes === 0
                        ? 'var(--color-text-subtle)'
                        : row.avgResponseMinutes <= 60
                          ? 'var(--color-success)'
                          : row.avgResponseMinutes <= 480
                            ? 'var(--color-warning)'
                            : 'var(--color-danger)',
                    }}
                  >
                    {formatTime(row.avgResponseMinutes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Sales Pipeline Section ─────────────────────────────────────────────────

interface SalesStage {
  id: string
  name: string
  slug: string
  probability: number
  position: number
  colour: string | null
  isClosedWon: number
  isClosedLost: number
  dealCount: number
  totalValue: number
}

interface SalesData {
  stages: SalesStage[]
  totalPipelineValue: number
  weightedPipelineValue: number
  winRate: number
  avgDealSize: number
  avgDaysToClose: number
  totalDeals: number
  wonCount: number
  lostCount: number
}

function formatNzd(amount: number): string {
  return new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: 'NZD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function SalesPipelineSection() {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/reports/sales'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<SalesData>
      })
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">Sales Pipeline</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-card)',
                border: '1px solid var(--color-border)',
                padding: '1.5rem',
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

  if (!data) {
    return (
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h2 className="text-lg font-semibold text-[var(--color-text)] mb-2">Sales Pipeline</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Unable to load sales data.</p>
      </div>
    )
  }

  // Chart data: deal count by stage, excluding closed stages with 0 deals for cleaner chart
  const stageChartData = data.stages
    .filter(s => s.dealCount > 0 || (!s.isClosedWon && !s.isClosedLost))
    .map(s => ({
      name: s.name,
      deals: s.dealCount,
      fill: s.colour ?? '#5A824E',
    }))

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[var(--color-text)]">Sales Pipeline</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <SummaryCard
          icon={DollarSign}
          label="Total Pipeline Value"
          value={formatNzd(data.totalPipelineValue)}
          accent="emerald"
        />
        <SummaryCard
          icon={Target}
          label="Weighted Forecast"
          value={formatNzd(data.weightedPipelineValue)}
          accent="blue"
        />
        <SummaryCard
          icon={Percent}
          label="Win Rate"
          value={data.winRate > 0 ? `${data.winRate}%` : 'N/A'}
          accent="amber"
        />
        <SummaryCard
          icon={PieChartIcon}
          label="Avg Deal Size"
          value={data.avgDealSize > 0 ? formatNzd(data.avgDealSize) : 'N/A'}
          accent="violet"
        />
      </div>

      {/* Deal count by stage bar chart */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Deals by Stage
        </h3>
        {stageChartData.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No deals in the pipeline yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stageChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8f0e6" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="deals" fill="#5A824E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ── Sales Funnel Section ─────────────────────────────────────────────────────

interface StageConversion {
  fromStage: string
  fromSlug: string
  toStage: string
  toSlug: string
  entered: number
  converted: number
  conversionRate: number
}

interface CloseRateData {
  stageConversions: StageConversion[]
  monthlyWinLoss: Array<{
    month: string
    won: number
    lost: number
    wonValue: number
    lostValue: number
  }>
  revenueByStage: Array<{
    stageId: string
    stageName: string
    stageSlug: string
    position: number
    dealCount: number
    totalValue: number
  }>
}

const FUNNEL_COLORS = [
  '#5A824E', '#4a9b3f', '#60a5fa', '#a78bfa', '#fbbf24', '#f87171', '#9ca3af',
]

function SalesFunnelSection() {
  const [data, setData] = useState<CloseRateData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/reports/close-rates'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<CloseRateData>
      })
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Sales Funnel
        </h3>
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="animate-pulse rounded" style={{ height: '3.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.stageConversions.length === 0) {
    return (
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Sales Funnel
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          No funnel data available yet. Add deals to your pipeline to see conversion rates.
        </p>
      </div>
    )
  }

  // Build funnel stages: first stage entry count + each subsequent stage
  const funnelStages: Array<{ name: string; count: number; color: string }> = []
  if (data.stageConversions.length > 0) {
    funnelStages.push({
      name: data.stageConversions[0].fromStage,
      count: data.stageConversions[0].entered,
      color: FUNNEL_COLORS[0],
    })
    for (let i = 0; i < data.stageConversions.length; i++) {
      funnelStages.push({
        name: data.stageConversions[i].toStage,
        count: data.stageConversions[i].converted,
        color: FUNNEL_COLORS[(i + 1) % FUNNEL_COLORS.length],
      })
    }
  }

  const maxCount = Math.max(...funnelStages.map(s => s.count), 1)

  return (
    <div className="space-y-6">
      {/* Funnel visualization */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Sales Funnel
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {funnelStages.map((stage, idx) => {
            const widthPct = maxCount > 0 ? Math.max((stage.count / maxCount) * 100, 8) : 8
            return (
              <div key={stage.name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span
                  className="flex-shrink-0 text-right truncate"
                  style={{
                    width: '7.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {stage.name}
                </span>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div
                    className="transition-all"
                    style={{
                      height: '2rem',
                      width: `${widthPct}%`,
                      background: stage.color,
                      borderRadius: '0.25rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '2rem',
                      opacity: 0.85 + (0.15 * (1 - idx / Math.max(funnelStages.length - 1, 1))),
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ffffff' }}>
                      {stage.count}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Stage-to-stage conversion rates */}
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <ArrowDown className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Stage Conversion Rates
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {data.stageConversions.map(conv => {
            const rateColor = conv.conversionRate >= 70
              ? 'var(--color-success)'
              : conv.conversionRate >= 40
                ? 'var(--color-warning)'
                : 'var(--color-danger)'
            return (
              <div
                key={`${conv.fromSlug}-${conv.toSlug}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.625rem 0.75rem',
                  background: 'var(--color-bg-secondary)',
                  borderRadius: '0.5rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                  <span className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
                    {conv.fromStage}
                  </span>
                  <ArrowDown style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0, transform: 'rotate(-90deg)' }} />
                  <span className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text)' }}>
                    {conv.toStage}
                  </span>
                </div>
                <div className="flex items-center flex-shrink-0" style={{ gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {conv.converted}/{conv.entered}
                  </span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: rateColor, minWidth: '3.5rem', textAlign: 'right' }}>
                    {conv.conversionRate}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Revenue by stage */}
      {data.revenueByStage.some(s => s.totalValue > 0) && (
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Revenue by Stage
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th
                    className="text-left text-xs font-medium text-[var(--color-text-muted)]"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    Stage
                  </th>
                  <th
                    className="text-right text-xs font-medium text-[var(--color-text-muted)]"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    Deals
                  </th>
                  <th
                    className="text-right text-xs font-medium text-[var(--color-text-muted)]"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    Total Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.revenueByStage
                  .filter(s => s.dealCount > 0)
                  .sort((a, b) => a.position - b.position)
                  .map(stage => (
                    <tr key={stage.stageId}>
                      <td
                        className="text-sm text-[var(--color-text)] font-medium"
                        style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                      >
                        {stage.stageName}
                      </td>
                      <td
                        className="text-sm text-[var(--color-text-muted)] text-right"
                        style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                      >
                        {stage.dealCount}
                      </td>
                      <td
                        className="text-sm text-[var(--color-text)] text-right font-medium"
                        style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                      >
                        {formatCurrency(stage.totalValue)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
        padding: '1.5rem',
      }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: '2.75rem',
            height: '2.75rem',
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
        padding: '1.5rem',
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

// ── Source Breakdown Section (T390) ──────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  referral: 'Referral',
  linkedin: 'LinkedIn',
  website: 'Website',
  cold: 'Cold Outreach',
  cold_outreach: 'Cold Outreach',
  partner: 'Partner',
  webflow: 'Webflow',
  existing_client: 'Existing Client',
  other: 'Other',
}

const SOURCE_CHART_COLORS = [
  '#5A824E', '#60a5fa', '#fbbf24', '#a78bfa', '#fb923c',
  '#4ade80', '#f87171', '#22d3ee', '#e879f9',
]

interface SourceDeal {
  source: string | null
  valueNzd: number
}

function SourceBreakdownSection() {
  const [deals, setDeals] = useState<SourceDeal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch all deals to group by source
    fetch(apiPath('/api/admin/deals?limit=500'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ items: Array<{ source: string | null; valueNzd: number; value: number }> }>
      })
      .then(d => {
        const items = (d.items ?? []).map(deal => ({
          source: deal.source,
          valueNzd: deal.valueNzd ?? deal.value,
        }))
        setDeals(items)
      })
      .catch(() => setDeals([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Deals by Source
        </h3>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded" style={{ height: '2.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  // Group by source
  const sourceMap = new Map<string, { count: number; revenue: number }>()
  for (const deal of deals) {
    const key = deal.source ?? 'unknown'
    const existing = sourceMap.get(key) ?? { count: 0, revenue: 0 }
    existing.count += 1
    existing.revenue += deal.valueNzd
    sourceMap.set(key, existing)
  }

  const sourceData = Array.from(sourceMap.entries())
    .map(([source, data]) => ({
      name: SOURCE_LABELS[source] ?? (source === 'unknown' ? 'Unknown' : source),
      deals: data.count,
      revenue: data.revenue,
    }))
    .sort((a, b) => b.deals - a.deals)

  if (sourceData.length === 0) {
    return (
      <div
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Deals by Source
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">No deal source data available yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[var(--color-text)]">Source Breakdown</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Deal count by source bar chart */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Deals by Source
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={sourceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e8f0e6" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11 }}
                width={100}
              />
              <Tooltip />
              <Bar dataKey="deals" radius={[0, 4, 4, 0]}>
                {sourceData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={SOURCE_CHART_COLORS[index % SOURCE_CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Revenue by source */}
        <div
          style={{
            background: 'var(--color-bg)',
            borderRadius: 'var(--radius-card)',
            border: '1px solid var(--color-border)',
            padding: '1.5rem',
          }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Revenue by Source
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th
                    className="text-left text-xs font-medium text-[var(--color-text-muted)]"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    Source
                  </th>
                  <th
                    className="text-right text-xs font-medium text-[var(--color-text-muted)]"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    Deals
                  </th>
                  <th
                    className="text-right text-xs font-medium text-[var(--color-text-muted)]"
                    style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                  >
                    Revenue (NZD)
                  </th>
                </tr>
              </thead>
              <tbody>
                {sourceData.map((row, idx) => (
                  <tr key={row.name}>
                    <td
                      className="text-sm font-medium"
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderBottom: '1px solid var(--color-border-subtle)',
                        color: 'var(--color-text)',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          style={{
                            width: '0.625rem',
                            height: '0.625rem',
                            borderRadius: '50%',
                            background: SOURCE_CHART_COLORS[idx % SOURCE_CHART_COLORS.length],
                            flexShrink: 0,
                          }}
                        />
                        {row.name}
                      </div>
                    </td>
                    <td
                      className="text-sm text-[var(--color-text-muted)] text-right"
                      style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                    >
                      {row.deals}
                    </td>
                    <td
                      className="text-sm text-[var(--color-text)] text-right font-medium"
                      style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                    >
                      {formatNzd(row.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

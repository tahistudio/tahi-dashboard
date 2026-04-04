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
  LineChart, Line,
} from 'recharts'
import { apiPath } from '@/lib/api'

// ── Currency options ─────────────────────────────────────────────────────────

const CURRENCY_OPTIONS = ['NZD', 'USD', 'AUD', 'GBP', 'EUR'] as const
type DisplayCurrency = typeof CURRENCY_OPTIONS[number]

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
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('NZD')
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({})

  // Fetch exchange rates for currency conversion
  useEffect(() => {
    fetch(apiPath('/api/admin/exchange-rates'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ rates: Record<string, number> }>
      })
      .then(d => setExchangeRates(d.rates ?? {}))
      .catch(() => setExchangeRates({}))
  }, [])

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

  // Convert NZD amount to display currency
  const convertAmount = (nzdAmount: number): number => {
    if (displayCurrency === 'NZD') return nzdAmount
    const nzdRate = exchangeRates['NZD'] ?? 1
    const targetRate = exchangeRates[displayCurrency] ?? 1
    return Math.round(nzdAmount * (targetRate / nzdRate))
  }

  const formatInCurrency = (amount: number): string => {
    try {
      return new Intl.NumberFormat('en-NZ', {
        style: 'currency',
        currency: displayCurrency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(convertAmount(amount))
    } catch {
      return `${displayCurrency} ${convertAmount(amount).toLocaleString()}`
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Reports</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Revenue, request throughput, and client overview.
          </p>
        </div>
        {/* Currency selector (T340) */}
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          <select
            value={displayCurrency}
            onChange={(e) => setDisplayCurrency(e.target.value as DisplayCurrency)}
            className="text-sm font-medium"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
              padding: '0.375rem 0.75rem',
              color: 'var(--color-text)',
              cursor: 'pointer',
              minHeight: '2.25rem',
            }}
            aria-label="Display currency"
          >
            {CURRENCY_OPTIONS.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
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
          value={formatInCurrency(data.outstandingInvoiceAmount)}
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
      <SalesPipelineSection displayCurrency={displayCurrency} exchangeRates={exchangeRates} />

      {/* Sales Funnel / Close Rates */}
      <SalesFunnelSection displayCurrency={displayCurrency} exchangeRates={exchangeRates} />

      {/* Stage Velocity (T355) */}
      <StageVelocitySection />

      {/* Close Rate Source Breakdown (T476) */}
      <CloseRateSourceBreakdownSection displayCurrency={displayCurrency} exchangeRates={exchangeRates} />

      {/* Source Breakdown (T390) */}
      <SourceBreakdownSection displayCurrency={displayCurrency} exchangeRates={exchangeRates} />

      {/* Sales Cycle Length (T391) */}
      <SalesCycleLengthSection />

      {/* Revenue Forecast (T326) */}
      <RevenueForecastSection displayCurrency={displayCurrency} exchangeRates={exchangeRates} />
    </div>
  )
}

// ── Currency conversion helper ────────────────────────────────────────────

interface CurrencyProps {
  displayCurrency: DisplayCurrency
  exchangeRates: Record<string, number>
}

function convertNzd(amount: number, displayCurrency: DisplayCurrency, exchangeRates: Record<string, number>): number {
  if (displayCurrency === 'NZD') return amount
  const nzdRate = exchangeRates['NZD'] ?? 1
  const targetRate = exchangeRates[displayCurrency] ?? 1
  return Math.round(amount * (targetRate / nzdRate))
}

function formatInCur(amount: number, currency: DisplayCurrency, rates: Record<string, number>): string {
  const converted = convertNzd(amount, currency, rates)
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(converted)
  } catch {
    return `${currency} ${converted.toLocaleString()}`
  }
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

function SalesPipelineSection({ displayCurrency, exchangeRates }: CurrencyProps) {
  const [data, setData] = useState<SalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const fmtCur = (v: number) => formatInCur(v, displayCurrency, exchangeRates)

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
          value={fmtCur(data.totalPipelineValue)}
          accent="emerald"
        />
        <SummaryCard
          icon={Target}
          label="Weighted Forecast"
          value={fmtCur(data.weightedPipelineValue)}
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
          value={data.avgDealSize > 0 ? fmtCur(data.avgDealSize) : 'N/A'}
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

function SalesFunnelSection({ displayCurrency, exchangeRates }: CurrencyProps) {
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
                        {formatInCur(stage.totalValue, displayCurrency, exchangeRates)}
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

function SourceBreakdownSection({ displayCurrency, exchangeRates }: CurrencyProps) {
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
                    Revenue ({displayCurrency})
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
                      {formatInCur(row.revenue, displayCurrency, exchangeRates)}
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

// ── Stage Velocity Section (T355) ────────────────────────────────────────────

interface StageVelocityItem {
  stageId: string
  stageName: string
  stageSlug: string
  position: number
  avgDays: number
  dealCount: number
}

function StageVelocitySection() {
  const [data, setData] = useState<StageVelocityItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/reports/close-rates'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ stageVelocity?: StageVelocityItem[] }>
      })
      .then(d => setData(d.stageVelocity ?? []))
      .catch(() => setData([]))
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
          <Clock className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Stage Velocity
        </h3>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded" style={{ height: '2.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  const filtered = data.filter(s => s.avgDays > 0 || s.dealCount > 0)

  if (filtered.length === 0) {
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
          <Clock className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Stage Velocity
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Not enough stage transition data yet. Move deals through your pipeline to see velocity.
        </p>
      </div>
    )
  }

  const VELOCITY_COLORS = ['#5A824E', '#60a5fa', '#fbbf24', '#a78bfa', '#fb923c', '#4ade80', '#f87171']

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
        <Clock className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
        Stage Velocity (avg days per stage)
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={filtered} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#e8f0e6" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} unit=" days" />
          <YAxis type="category" dataKey="stageName" tick={{ fontSize: 11 }} width={110} />
          <Tooltip
            formatter={(value: number) => [`${value} days`, 'Avg Duration']}
            contentStyle={{
              fontSize: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border)',
            }}
          />
          <Bar dataKey="avgDays" radius={[0, 4, 4, 0]}>
            {filtered.map((_, index) => (
              <Cell key={`vel-${index}`} fill={VELOCITY_COLORS[index % VELOCITY_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Close Rate Source Breakdown (T476) ────────────────────────────────────────

interface CloseRateSourceData {
  source: string
  wonCount: number
  lostCount: number
  totalCount: number
  closeRate: number
  avgDealSize: number
  avgCycleDays: number
}

function CloseRateSourceBreakdownSection({ displayCurrency, exchangeRates }: CurrencyProps) {
  const [sourceData, setSourceData] = useState<CloseRateSourceData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch deals and compute close rates by source
    fetch(apiPath('/api/admin/deals?limit=500'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{
          items: Array<{
            source: string | null
            valueNzd: number
            value: number
            stageIsClosedWon: number | null
            stageIsClosedLost: number | null
            createdAt: string
            closedAt: string | null
          }>
        }>
      })
      .then(d => {
        const items = d.items ?? []
        const sourceMap = new Map<string, {
          won: number; lost: number; total: number; totalValue: number; totalDays: number; closedCount: number
        }>()

        for (const deal of items) {
          const key = deal.source ?? 'unknown'
          const existing = sourceMap.get(key) ?? { won: 0, lost: 0, total: 0, totalValue: 0, totalDays: 0, closedCount: 0 }
          existing.total++

          if (deal.stageIsClosedWon) {
            existing.won++
            existing.totalValue += deal.valueNzd ?? deal.value
          } else if (deal.stageIsClosedLost) {
            existing.lost++
          }

          if (deal.closedAt && deal.createdAt) {
            const days = Math.max(0, (new Date(deal.closedAt).getTime() - new Date(deal.createdAt).getTime()) / (1000 * 60 * 60 * 24))
            existing.totalDays += days
            existing.closedCount++
          }

          sourceMap.set(key, existing)
        }

        const result: CloseRateSourceData[] = Array.from(sourceMap.entries())
          .map(([source, data]) => ({
            source: SOURCE_LABELS[source] ?? (source === 'unknown' ? 'Unknown' : source),
            wonCount: data.won,
            lostCount: data.lost,
            totalCount: data.total,
            closeRate: data.total > 0 ? Math.round((data.won / data.total) * 100) : 0,
            avgDealSize: data.won > 0 ? Math.round(data.totalValue / data.won) : 0,
            avgCycleDays: data.closedCount > 0 ? Math.round(data.totalDays / data.closedCount) : 0,
          }))
          .filter(s => s.totalCount > 0)
          .sort((a, b) => b.closeRate - a.closeRate)

        setSourceData(result)
      })
      .catch(() => setSourceData([]))
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
          <Target className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Close Rate by Source
        </h3>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded" style={{ height: '2.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

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
          <Target className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Close Rate by Source
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          No close rate data available yet. Close some deals to see source analytics.
        </p>
      </div>
    )
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
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Target className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
        Close Rate by Source
      </h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Source', 'Won', 'Lost', 'Total', 'Close Rate', `Avg Size (${displayCurrency})`, 'Avg Cycle'].map(h => (
                <th
                  key={h}
                  className={`text-xs font-medium text-[var(--color-text-muted)] ${h === 'Source' ? 'text-left' : 'text-right'}`}
                  style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sourceData.map(row => {
              const rateColor = row.closeRate >= 50
                ? 'var(--color-success)'
                : row.closeRate >= 25
                  ? 'var(--color-warning)'
                  : 'var(--color-danger)'
              return (
                <tr key={row.source}>
                  <td className="text-sm font-medium text-[var(--color-text)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    {row.source}
                  </td>
                  <td className="text-sm text-right" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)', color: 'var(--color-success)' }}>
                    {row.wonCount}
                  </td>
                  <td className="text-sm text-right" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)', color: 'var(--color-danger)' }}>
                    {row.lostCount}
                  </td>
                  <td className="text-sm text-right text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    {row.totalCount}
                  </td>
                  <td className="text-sm text-right font-semibold" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)', color: rateColor }}>
                    {row.closeRate}%
                  </td>
                  <td className="text-sm text-right text-[var(--color-text)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    {row.avgDealSize > 0 ? formatInCur(row.avgDealSize, displayCurrency, exchangeRates) : '--'}
                  </td>
                  <td className="text-sm text-right text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
                    {row.avgCycleDays > 0 ? `${row.avgCycleDays}d` : '--'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Sales Cycle Length Section (T391) ─────────────────────────────────────────

function SalesCycleLengthSection() {
  const [monthlyData, setMonthlyData] = useState<Array<{ month: string; avgDays: number; count: number }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/deals?limit=500'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{
          items: Array<{
            createdAt: string
            closedAt: string | null
            stageIsClosedWon: number | null
          }>
        }>
      })
      .then(d => {
        const items = d.items ?? []
        const monthMap = new Map<string, { totalDays: number; count: number }>()

        for (const deal of items) {
          if (!deal.stageIsClosedWon || !deal.closedAt) continue
          const closed = new Date(deal.closedAt)
          const created = new Date(deal.createdAt)
          const days = Math.max(0, (closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
          const key = `${closed.getFullYear()}-${String(closed.getMonth() + 1).padStart(2, '0')}`
          const existing = monthMap.get(key) ?? { totalDays: 0, count: 0 }
          existing.totalDays += days
          existing.count++
          monthMap.set(key, existing)
        }

        const result = Array.from(monthMap.entries())
          .map(([month, data]) => ({
            month: formatMonthLabel(month),
            avgDays: Math.round(data.totalDays / data.count),
            count: data.count,
          }))
          .sort((a, b) => a.month.localeCompare(b.month))

        setMonthlyData(result)
      })
      .catch(() => setMonthlyData([]))
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
          <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Sales Cycle Length
        </h3>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded" style={{ height: '2.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (monthlyData.length === 0) {
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
          <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Sales Cycle Length
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          No won deals yet. Close deals to see sales cycle trends over time.
        </p>
      </div>
    )
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
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
        Sales Cycle Length (avg days from Inquiry to Won)
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={monthlyData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8f0e6" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit=" days" />
          <Tooltip
            formatter={(value: number, name: string) => [
              `${value} days${name === 'count' ? '' : ''}`,
              name === 'avgDays' ? 'Avg Cycle' : 'Deals Won',
            ]}
            contentStyle={{
              fontSize: '0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border)',
            }}
          />
          <Line
            type="monotone"
            dataKey="avgDays"
            stroke="#5A824E"
            strokeWidth={2}
            dot={{ fill: '#5A824E', r: 4 }}
            name="Avg Cycle"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Revenue Forecast Section (T326) ──────────────────────────────────────────

interface ForecastMonth {
  month: string
  revenue: number
  bestCase: number
  worstCase: number
}

interface ForecastData {
  months: ForecastMonth[]
  totalWeightedValue: number
  totalBestCase: number
  totalWorstCase: number
}

function RevenueForecastSection({ displayCurrency, exchangeRates }: CurrencyProps) {
  const [forecastData, setForecastData] = useState<ForecastData | null>(null)
  const [forecastLoading, setForecastLoading] = useState(true)
  const fmtCur = (v: number) => formatInCur(v, displayCurrency, exchangeRates)

  useEffect(() => {
    let cancelled = false
    const loadForecast = async () => {
      try {
        const res = await fetch(apiPath('/api/admin/capacity/forecast'))
        if (!res.ok) throw new Error('Failed')
        const d = await res.json() as ForecastData
        if (!cancelled) setForecastData(d)
      } catch {
        // Fallback: build forecast from sales data
        try {
          const salesRes = await fetch(apiPath('/api/admin/reports/sales'))
          if (!salesRes.ok) throw new Error('Failed')
          const salesJson = await salesRes.json() as { weightedPipelineValue?: number }
          const weighted = salesJson.weightedPipelineValue ?? 0
          if (weighted > 0 && !cancelled) {
            const monthlyWeighted = weighted / 6
            const months: ForecastMonth[] = []
            const now = new Date()
            for (let i = 0; i < 6; i++) {
              const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1)
              const label = d.toLocaleDateString('en-NZ', { month: 'short', year: '2-digit' })
              months.push({
                month: label,
                revenue: Math.round(monthlyWeighted),
                bestCase: Math.round(monthlyWeighted * 1.5),
                worstCase: Math.round(monthlyWeighted * 0.5),
              })
            }
            setForecastData({
              months,
              totalWeightedValue: weighted,
              totalBestCase: Math.round(weighted * 1.5),
              totalWorstCase: Math.round(weighted * 0.5),
            })
          }
        } catch {
          // silent
        }
      } finally {
        if (!cancelled) setForecastLoading(false)
      }
    }
    loadForecast()
    return () => { cancelled = true }
  }, [])

  if (forecastLoading) {
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
          <TrendingUp className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Revenue Forecast
        </h3>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded" style={{ height: '2.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (!forecastData || forecastData.months.length === 0) {
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
          <TrendingUp className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Revenue Forecast
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          No forecast data available. Add deals to the pipeline to generate a revenue forecast.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[var(--color-text)]">Revenue Forecast</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <SummaryCard
          icon={DollarSign}
          label="Weighted Forecast (6mo)"
          value={fmtCur(forecastData.totalWeightedValue)}
          accent="emerald"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Best Case"
          value={fmtCur(forecastData.totalBestCase)}
          accent="blue"
        />
        <SummaryCard
          icon={Target}
          label="Worst Case"
          value={fmtCur(forecastData.totalWorstCase)}
          accent="amber"
        />
      </div>

      {/* Bar chart */}
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
          Forecasted Revenue by Month (next 6 months)
        </h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={forecastData.months}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8f0e6" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
            />
            <Tooltip
              formatter={(value: number) => [formatNzd(value), '']}
              contentStyle={{
                fontSize: '0.75rem',
                borderRadius: '0.5rem',
                border: '1px solid var(--color-border)',
              }}
            />
            <Bar dataKey="worstCase" fill="#fbbf24" radius={[4, 4, 0, 0]} name="Worst Case" />
            <Bar dataKey="revenue" fill="#5A824E" radius={[4, 4, 0, 0]} name="Weighted" />
            <Bar dataKey="bestCase" fill="#60a5fa" radius={[4, 4, 0, 0]} name="Best Case" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

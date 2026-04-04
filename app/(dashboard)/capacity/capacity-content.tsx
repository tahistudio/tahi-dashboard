'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Gauge, Users, TrendingUp, Calendar,
  RefreshCw, Phone, Clock, BarChart2,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { apiPath } from '@/lib/api'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'

// ── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  name: string
  weeklyCapacityHours: number | null
}

interface StartDateResult {
  earliestDate: string | null
  availableHoursPerWeek: number
  totalTeamCapacity: number
  committedHours: number
  weeksOut: number
}

interface ForecastDeal {
  id: string
  title: string
  valueNzd: number
  estimatedHoursPerWeek: number
  probability: number
  expectedCloseDate: string | null
}

interface ForecastMonth {
  month: string
  dealCount: number
  totalHoursPerWeek: number
  weightedHoursPerWeek: number
  totalValueNzd: number
  weightedValueNzd: number
  deals: ForecastDeal[]
}

interface ForecastData {
  months: ForecastMonth[]
  totalWeightedHoursPerWeek: number
  totalWeightedValueNzd: number
  totalOpenDeals: number
}

interface WeekProjection {
  week: string
  total: number
  committed: number
  forecasted: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function getWeekLabel(weekOffset: number): string {
  const now = new Date()
  const day = now.getDay()
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day
  const start = new Date(now)
  start.setDate(start.getDate() + daysUntilMonday + weekOffset * 7)
  return start.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

// ── Component ────────────────────────────────────────────────────────────────

export function CapacityContent() {
  const [capacityData, setCapacityData] = useState<StartDateResult | null>(null)
  const [forecast, setForecast] = useState<ForecastData | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Sales call helper
  const [callHours, setCallHours] = useState('')
  const [callResult, setCallResult] = useState<StartDateResult | null>(null)
  const [callLoading, setCallLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [capRes, forecastRes, teamRes] = await Promise.all([
        fetch(apiPath('/api/admin/capacity/start-date'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estimatedHoursPerWeek: 1 }),
        }),
        fetch(apiPath('/api/admin/capacity/forecast')),
        fetch(apiPath('/api/admin/team-members')),
      ])

      if (capRes.ok) {
        const data = await capRes.json() as StartDateResult
        setCapacityData(data)
      }

      if (forecastRes.ok) {
        const data = await forecastRes.json() as ForecastData
        setForecast(data)
      }

      if (teamRes.ok) {
        const data = await teamRes.json() as { items: TeamMember[] }
        setTeamMembers(data.items ?? [])
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const buildTimeline = (): WeekProjection[] => {
    if (!capacityData) return []
    const totalCap = capacityData.totalTeamCapacity
    const committed = capacityData.committedHours
    const weightedForecast = forecast?.totalWeightedHoursPerWeek ?? 0

    const weeks: WeekProjection[] = []
    for (let i = 0; i < 8; i++) {
      weeks.push({
        week: getWeekLabel(i),
        total: totalCap,
        committed,
        forecasted: committed + weightedForecast,
      })
    }
    return weeks
  }

  const handleCallCalculate = async () => {
    const hours = parseFloat(callHours)
    if (!hours || hours <= 0) return
    setCallLoading(true)
    setCallResult(null)
    try {
      const res = await fetch(apiPath('/api/admin/capacity/start-date'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimatedHoursPerWeek: hours }),
      })
      if (res.ok) {
        const data = await res.json() as StartDateResult
        setCallResult(data)
      }
    } catch {
      // silent
    } finally {
      setCallLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Capacity</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Team utilization, projected capacity, and pipeline impact.</p>
        </div>
        <LoadingSkeleton rows={8} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Capacity</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Team utilization, projected capacity, and pipeline impact.</p>
        </div>
        <EmptyState
          icon={<Gauge className="w-8 h-8 text-white" />}
          title="Unable to load capacity data"
          description="There was an error loading the capacity data. Please try again."
          ctaLabel="Retry"
          onCtaClick={fetchData}
        />
      </div>
    )
  }

  const totalCapacity = capacityData?.totalTeamCapacity ?? 0
  const committedHours = capacityData?.committedHours ?? 0
  const availableHours = capacityData?.availableHoursPerWeek ?? 0
  const utilizationPct = totalCapacity > 0 ? Math.round((committedHours / totalCapacity) * 100) : 0
  const forecastedHours = forecast?.totalWeightedHoursPerWeek ?? 0
  const bestCaseHours = forecast?.months.reduce((sum, m) => sum + m.totalHoursPerWeek, 0) ?? 0
  // Worst case: only deals with >50% probability
  const worstCaseHours = forecast?.months.reduce((sum, m) => {
    return sum + (m.deals ?? [])
      .filter(d => d.probability > 50)
      .reduce((ds, d) => ds + d.estimatedHoursPerWeek, 0)
  }, 0) ?? 0
  const timelineData = buildTimeline()

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Capacity</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Team utilization, projected capacity, and pipeline impact.</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-button)', color: 'var(--color-text)', cursor: 'pointer', minHeight: '2.75rem' }}
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* T331: Projected Capacity KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <CapacityKPI icon={Users} label="Total Team Capacity" value={`${totalCapacity} hrs/wk`} accent="emerald" />
        <CapacityKPI icon={Clock} label="Committed (Subscriptions)" value={`${committedHours} hrs/wk`} accent="blue" />
        <CapacityKPI icon={Gauge} label="Utilization" value={`${utilizationPct}%`} accent="amber" />
        <CapacityKPI icon={TrendingUp} label="Available" value={`${availableHours} hrs/wk`} accent={availableHours > 0 ? 'emerald' : 'red'} />
      </div>

      {/* Utilization bar */}
      <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Team Utilization
        </h3>
        <div style={{ width: '100%', height: '1.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.75rem', overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: `${Math.min(utilizationPct, 100)}%`, height: '100%', background: utilizationPct > 90 ? 'var(--color-danger)' : utilizationPct > 70 ? 'var(--color-warning)' : 'var(--color-brand)', borderRadius: '0.75rem', transition: 'width 0.5s ease' }} />
          {forecastedHours > 0 && totalCapacity > 0 && (
            <div style={{ position: 'absolute', left: `${Math.min(utilizationPct, 100)}%`, top: 0, width: `${Math.min((forecastedHours / totalCapacity) * 100, 100 - utilizationPct)}%`, height: '100%', background: 'var(--color-brand-light)', opacity: 0.4 }} />
          )}
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-text-muted)] flex-wrap">
          <span className="flex items-center gap-1">
            <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: 'var(--color-brand)', display: 'inline-block' }} />
            Committed: {committedHours}h
          </span>
          {forecastedHours > 0 && (
            <span className="flex items-center gap-1">
              <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: 'var(--color-brand-light)', opacity: 0.6, display: 'inline-block' }} />
              Pipeline (weighted): +{forecastedHours.toFixed(1)}h
            </span>
          )}
          <span className="flex items-center gap-1">
            <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', display: 'inline-block' }} />
            Available: {availableHours}h
          </span>
        </div>
      </div>

      {/* T332: Pipeline Capacity Impact */}
      <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Pipeline Capacity Impact
        </h3>
        {forecast && forecast.totalOpenDeals > 0 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div style={{ padding: '1rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-button)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Weighted</p>
                <p className="text-lg font-bold" style={{ color: 'var(--color-brand)' }}>+{forecast.totalWeightedHoursPerWeek} hrs/wk</p>
                <p className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>pipeline value * probability</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{totalCapacity > 0 ? `${Math.round(((committedHours + forecastedHours) / totalCapacity) * 100)}% utilization` : 'N/A'}</p>
              </div>
              <div style={{ padding: '1rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-button)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Worst Case</p>
                <p className="text-lg font-bold" style={{ color: 'var(--color-warning)' }}>+{worstCaseHours} hrs/wk</p>
                <p className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>only deals with {'>'}50% probability</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{totalCapacity > 0 ? `${Math.round(((committedHours + worstCaseHours) / totalCapacity) * 100)}% utilization` : 'N/A'}</p>
              </div>
              <div style={{ padding: '1rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-button)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Best Case</p>
                <p className="text-lg font-bold" style={{ color: 'var(--color-danger)' }}>+{bestCaseHours} hrs/wk</p>
                <p className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>all open deals close</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{totalCapacity > 0 ? `${Math.round(((committedHours + bestCaseHours) / totalCapacity) * 100)}% utilization` : 'N/A'}</p>
              </div>
            </div>
            {forecast.months.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th className="text-left text-xs font-medium text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>Month</th>
                      <th className="text-right text-xs font-medium text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>Deals</th>
                      <th className="text-right text-xs font-medium text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>Total hrs/wk</th>
                      <th className="text-right text-xs font-medium text-[var(--color-text-muted)]" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>Weighted hrs/wk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.months.map(m => (
                      <tr key={m.month}>
                        <td className="text-sm text-[var(--color-text)] font-medium" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>{m.month === 'unscheduled' ? 'No date set' : m.month}</td>
                        <td className="text-sm text-[var(--color-text-muted)] text-right" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>{m.dealCount}</td>
                        <td className="text-sm text-[var(--color-text)] text-right font-medium" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)' }}>{m.totalHoursPerWeek}</td>
                        <td className="text-sm text-right font-medium" style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border-subtle)', color: 'var(--color-brand)' }}>{m.weightedHoursPerWeek.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">No open deals in the pipeline. Add deals to see capacity forecasting.</p>
        )}
      </div>

      {/* T333: Timeline Chart */}
      <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Capacity Timeline (next 8 weeks)
        </h3>
        {timelineData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e8f0e6" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="h" />
              <Tooltip
                contentStyle={{ fontSize: '0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}
                formatter={(value: number, name: string) => [`${value} hrs/wk`, name]}
              />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              <Line type="monotone" dataKey="total" stroke="#5A824E" strokeWidth={2} name="Total Capacity" dot={false} />
              <Line type="monotone" dataKey="committed" stroke="#60a5fa" strokeWidth={2} name="Committed" dot={false} />
              <Line type="monotone" dataKey="forecasted" stroke="#fbbf24" strokeWidth={2} strokeDasharray="5 5" name="Committed + Pipeline" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">No capacity data available to chart.</p>
        )}
      </div>

      {/* Team Members */}
      {teamMembers.length > 0 && (
        <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
            Team Member Capacity
          </h3>
          <div className="space-y-3">
            {teamMembers.map((m, idx) => {
              const cap = m.weeklyCapacityHours ?? 40
              return (
                <div key={idx} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--color-text)] truncate flex-shrink-0" style={{ width: '8rem' }}>{m.name}</span>
                  <div style={{ flex: 1, height: '0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }}>
                    <div style={{ width: `${Math.min((cap / (totalCapacity > 0 ? totalCapacity : 1)) * teamMembers.length * 100, 100)}%`, height: '100%', background: 'var(--color-brand)', borderRadius: '0.25rem' }} />
                  </div>
                  <span className="text-xs font-medium text-[var(--color-text-muted)] flex-shrink-0 text-right" style={{ width: '4rem' }}>{cap}h/wk</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* T335: Sales Call Helper */}
      <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.5rem' }}>
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <Phone className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          Sales Call Helper
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div style={{ padding: '1rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-button)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Current Utilization</p>
            <p className="text-2xl font-bold" style={{ color: utilizationPct > 90 ? 'var(--color-danger)' : utilizationPct > 70 ? 'var(--color-warning)' : 'var(--color-brand)' }}>{utilizationPct}%</p>
          </div>
          <div style={{ padding: '1rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-button)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Free Hours</p>
            <p className="text-2xl font-bold" style={{ color: 'var(--color-brand)' }}>{availableHours} hrs/wk</p>
          </div>
          <div style={{ padding: '1rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-button)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>Next Opening</p>
            <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>{availableHours > 0 ? 'Now' : capacityData?.earliestDate ? formatDate(capacityData.earliestDate) : 'TBD'}</p>
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '1rem' }}>
          <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2" style={{ textTransform: 'uppercase', letterSpacing: '0.03em' }}>Deal Impact Calculator</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Hours/week"
              value={callHours}
              onChange={e => setCallHours(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCallCalculate()}
              className="text-sm"
              style={{ width: '8rem', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', minHeight: '2.5rem' }}
            />
            <button
              onClick={handleCallCalculate}
              disabled={callLoading}
              className="text-sm font-medium text-white transition-colors"
              style={{ padding: '0.5rem 1rem', borderRadius: 'var(--radius-button)', background: 'var(--color-brand)', border: 'none', cursor: callLoading ? 'wait' : 'pointer', minHeight: '2.5rem', opacity: callLoading ? 0.7 : 1 }}
            >
              {callLoading ? 'Calculating...' : 'Check Availability'}
            </button>
          </div>
          {callResult && (() => {
            const dealHrs = parseFloat(callHours) || 0
            const newUtilization = totalCapacity > 0 ? Math.round(((committedHours + dealHrs) / totalCapacity) * 100) : 0
            return (
              <div className="mt-3" style={{ padding: '0.75rem 1rem', background: callResult.availableHoursPerWeek >= dealHrs ? 'var(--color-brand-50, #f0f7ee)' : '#fef2f2', borderRadius: 'var(--radius-button)' }}>
                {callResult.earliestDate ? (
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                      <Calendar className="w-3.5 h-3.5 inline-block mr-1" aria-hidden="true" style={{ verticalAlign: 'text-bottom' }} />
                      Earliest start: <span className="font-bold">{formatDate(callResult.earliestDate)}</span>
                      {callResult.weeksOut > 0 && <span className="text-[var(--color-text-muted)]"> ({callResult.weeksOut} {callResult.weeksOut === 1 ? 'week' : 'weeks'} out)</span>}
                    </p>
                    <p className="text-xs mt-1" style={{ color: newUtilization > 90 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                      If this deal closes, capacity drops to {newUtilization}% utilization
                    </p>
                  </div>
                ) : (
                  <p className="text-sm font-medium" style={{ color: 'var(--color-danger)' }}>Not enough capacity in the next 12 weeks. Team may need to scale up.</p>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

const ACCENT_COLORS: Record<string, { bg: string; color: string }> = {
  emerald: { bg: '#d1fae5', color: '#059669' },
  blue:    { bg: '#dbeafe', color: '#2563eb' },
  amber:   { bg: '#fef3c7', color: '#d97706' },
  violet:  { bg: '#ede9fe', color: '#7c3aed' },
  red:     { bg: '#fef2f2', color: '#dc2626' },
}

function CapacityKPI({ icon: Icon, label, value, accent }: { icon: typeof Users; label: string; value: string; accent: string }) {
  const colors = ACCENT_COLORS[accent] ?? ACCENT_COLORS.emerald
  return (
    <div style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: '1.25rem' }}>
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: '2.5rem', height: '2.5rem', borderRadius: 'var(--radius-leaf-sm)', background: colors.bg, color: colors.color }}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
          <p className="text-lg font-bold text-[var(--color-text)]">{value}</p>
        </div>
      </div>
    </div>
  )
}

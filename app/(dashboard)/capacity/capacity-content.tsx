'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, TrendingUp, Clock, Calculator } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'

interface CapacityData {
  totalTeamCapacity: number
  committedHours: number
  availableHours: number
}

interface ForecastMonth {
  month: string
  weightedHours: number
  dealCount: number
}

export function CapacityContent() {
  const [capacity, setCapacity] = useState<CapacityData | null>(null)
  const [forecast, setForecast] = useState<ForecastMonth[]>([])
  const [loading, setLoading] = useState(true)
  const [startDateInput, setStartDateInput] = useState('')
  const [startDateResult, setStartDateResult] = useState<{ earliestDate: string | null; weeksOut: number } | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [capRes, forecastRes] = await Promise.all([
        fetch(apiPath('/api/admin/capacity/start-date'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estimatedHoursPerWeek: 1 }),
        }),
        fetch(apiPath('/api/admin/capacity/forecast')),
      ])
      if (capRes.ok) {
        const data = await capRes.json() as CapacityData & { earliestDate: string | null; weeksOut: number }
        const available = 'availableHoursPerWeek' in data ? (data as unknown as { availableHoursPerWeek: number }).availableHoursPerWeek : data.totalTeamCapacity - data.committedHours
        setCapacity({ totalTeamCapacity: data.totalTeamCapacity, committedHours: data.committedHours, availableHours: available })
      }
      if (forecastRes.ok) {
        const data = await forecastRes.json() as { months: ForecastMonth[] }
        setForecast(data.months ?? [])
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function calculateStartDate() {
    const hours = parseFloat(startDateInput)
    if (!hours || hours <= 0) return
    try {
      const res = await fetch(apiPath('/api/admin/capacity/start-date'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimatedHoursPerWeek: hours }),
      })
      if (res.ok) {
        const data = await res.json() as { earliestDate: string | null; weeksOut: number }
        setStartDateResult(data)
      }
    } catch { /* ignore */ }
  }

  if (loading) return <div className="p-6"><LoadingSkeleton rows={8} /></div>

  const utilization = capacity ? Math.round((capacity.committedHours / capacity.totalTeamCapacity) * 100) : 0

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Capacity</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">Team utilization and capacity forecasting</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users style={{ width: '1rem', height: '1rem', color: 'var(--color-brand)' }} />
            <span className="text-xs text-[var(--color-text-muted)]">Total Capacity</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text)]">{capacity?.totalTeamCapacity ?? 0}h/week</p>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock style={{ width: '1rem', height: '1rem', color: 'var(--color-warning)' }} />
            <span className="text-xs text-[var(--color-text-muted)]">Committed</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text)]">{capacity?.committedHours ?? 0}h/week</p>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp style={{ width: '1rem', height: '1rem', color: 'var(--color-success)' }} />
            <span className="text-xs text-[var(--color-text-muted)]">Available</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text)]">{capacity?.availableHours ?? 0}h/week</p>
        </div>
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Calculator style={{ width: '1rem', height: '1rem', color: 'var(--color-info)' }} />
            <span className="text-xs text-[var(--color-text-muted)]">Utilization</span>
          </div>
          <p className="text-xl font-bold text-[var(--color-text)]">{utilization}%</p>
          <div className="mt-2 h-2 rounded-full bg-[var(--color-bg-tertiary)] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(utilization, 100)}%`, background: utilization > 90 ? 'var(--color-danger)' : utilization > 70 ? 'var(--color-warning)' : 'var(--color-brand)' }} />
          </div>
        </div>
      </div>

      {/* Start Date Calculator */}
      <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-5">
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Earliest Start Date Calculator</h2>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={startDateInput}
            onChange={e => setStartDateInput(e.target.value)}
            placeholder="Hours/week needed"
            className="w-48 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          />
          <button
            onClick={calculateStartDate}
            className="px-4 py-2 text-sm font-medium rounded-lg cursor-pointer transition-opacity hover:opacity-90"
            style={{ background: 'var(--color-brand)', color: 'white' }}
          >
            Calculate
          </button>
        </div>
        {startDateResult && (
          <div className="mt-3 text-sm">
            {startDateResult.earliestDate ? (
              <p className="text-[var(--color-text)]">
                Earliest start: <strong>{new Date(startDateResult.earliestDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                <span className="text-[var(--color-text-muted)]"> ({startDateResult.weeksOut} weeks out)</span>
              </p>
            ) : (
              <p className="text-[var(--color-warning)]">No capacity available in the next 12 weeks</p>
            )}
          </div>
        )}
      </div>

      {/* Pipeline Forecast */}
      {forecast.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Pipeline Capacity Impact</h2>
          <div className="space-y-2">
            {forecast.map(m => (
              <div key={m.month} className="flex items-center justify-between text-sm">
                <span className="text-[var(--color-text-muted)]">{m.month}</span>
                <span className="text-[var(--color-text)]">{m.dealCount} deals, ~{Math.round(m.weightedHours)}h/week weighted</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

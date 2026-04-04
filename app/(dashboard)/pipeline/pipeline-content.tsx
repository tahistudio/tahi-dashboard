'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Search, LayoutList, Columns3,
  TrendingUp, DollarSign, Target,
  Calendar, User, Building2,
  ChevronDown, BarChart3, Award,
  Trophy, XCircle, Filter, X,
} from 'lucide-react'
import { apiPath } from '@/lib/api'

// ---- Types ---------------------------------------------------------------

interface PipelineStage {
  id: string
  name: string
  slug: string
  probability: number
  position: number
  colour: string | null
  isDefault: number
  isClosedWon: number
  isClosedLost: number
  isClosed?: number
  closedType?: string | null
}

interface Deal {
  id: string
  title: string
  orgId: string | null
  stageId: string
  ownerId: string | null
  value: number
  currency: string
  valueNzd: number
  source: string | null
  estimatedHoursPerWeek: number | null
  expectedCloseDate: string | null
  closedAt: string | null
  closeReason: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  stageEnteredAt: string | null
  orgName: string | null
  stageName: string | null
  stageColour: string | null
  stageProbability: number | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  ownerName: string | null
  ownerAvatarUrl: string | null
  contactCount: number
}

type ViewMode = 'kanban' | 'list'
type SortKey = 'updatedAt' | 'value' | 'expectedCloseDate' | 'title'

// ---- Default pipeline stages (fallback when API has none) ----------------

const DEFAULT_STAGES: PipelineStage[] = [
  { id: '_inquiry',       name: 'Inquiry',       slug: 'inquiry',       probability: 5,   position: 0, colour: '#60a5fa', isDefault: 1, isClosedWon: 0, isClosedLost: 0 },
  { id: '_contacted',     name: 'Contacted',     slug: 'contacted',     probability: 15,  position: 1, colour: '#a78bfa', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { id: '_discovery',     name: 'Discovery',     slug: 'discovery',     probability: 35,  position: 2, colour: '#fbbf24', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { id: '_proposal_sent', name: 'Proposal Sent', slug: 'proposal_sent', probability: 60,  position: 3, colour: '#fb923c', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { id: '_won',           name: 'Won',           slug: 'won',           probability: 100, position: 4, colour: '#4ade80', isDefault: 0, isClosedWon: 1, isClosedLost: 0, isClosed: 1, closedType: 'won' },
  { id: '_lost',          name: 'Lost',          slug: 'lost',          probability: 0,   position: 5, colour: '#f87171', isDefault: 0, isClosedWon: 0, isClosedLost: 1, isClosed: 1, closedType: 'lost' },
  { id: '_stalled',       name: 'Stalled',       slug: 'stalled',       probability: 0,   position: 6, colour: '#8a9987', isDefault: 0, isClosedWon: 0, isClosedLost: 1, isClosed: 1, closedType: 'lost' },
]

// ---- Helpers -------------------------------------------------------------

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: '2-digit' })
  } catch { return '--' }
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function daysInStage(stageEnteredAt: string | null, updatedAt: string): number {
  const ref = stageEnteredAt ?? updatedAt
  if (!ref) return 0
  const diff = Date.now() - new Date(ref).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

const SOURCE_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  referral:         { label: 'Referral',        bg: '#fef3c7', text: '#d97706' },
  linkedin:         { label: 'LinkedIn',        bg: '#dbeafe', text: '#1d4ed8' },
  website:          { label: 'Website',         bg: '#d1fae5', text: '#059669' },
  cold:             { label: 'Cold Outreach',   bg: '#e0e7ff', text: '#4338ca' },
  cold_outreach:    { label: 'Cold Outreach',   bg: '#e0e7ff', text: '#4338ca' },
  partner:          { label: 'Partner',         bg: '#fce7f3', text: '#be185d' },
  webflow:          { label: 'Webflow',         bg: '#dbeafe', text: '#2563eb' },
  existing_client:  { label: 'Existing Client', bg: '#fef3c7', text: '#d97706' },
  other:            { label: 'Other',           bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-subtle)' },
}

// ---- Main component ------------------------------------------------------

interface TeamMemberOption {
  id: string
  name: string
}

export function PipelineContent() {
  const searchParams = useSearchParams()
  const [view, setView] = useState<ViewMode>('kanban')
  const [search, setSearch] = useState('')
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [showNewDeal, setShowNewDeal] = useState(false)
  const [initialOrgId, setInitialOrgId] = useState<string | null>(null)

  // Filter state (T299)
  const [filterOwner, setFilterOwner] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterValueMin, setFilterValueMin] = useState('')
  const [filterValueMax, setFilterValueMax] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])

  // Open new deal dialog from query params (T361)
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setInitialOrgId(searchParams.get('orgId'))
      setShowNewDeal(true)
    }
  }, [searchParams])

  // Fetch team members for filter
  useEffect(() => {
    async function loadTeam() {
      try {
        const res = await fetch(apiPath('/api/admin/team'))
        if (!res.ok) return
        const data = await res.json() as { members?: TeamMemberOption[] }
        setTeamMembers(data.members ?? [])
      } catch {
        // silent
      }
    }
    void loadTeam()
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [stagesRes, dealsRes] = await Promise.all([
        fetch(apiPath('/api/admin/pipeline/stages')),
        fetch(apiPath('/api/admin/deals?limit=100')),
      ])
      if (stagesRes.ok) {
        const sData = await stagesRes.json() as { stages: PipelineStage[] }
        const fetched = sData.stages ?? []
        setStages(fetched.length > 0 ? fetched : DEFAULT_STAGES)
      } else {
        setStages(DEFAULT_STAGES)
      }
      if (dealsRes.ok) {
        const dData = await dealsRes.json() as { items: Deal[] }
        setDeals(dData.items ?? [])
      }
    } catch {
      setStages(DEFAULT_STAGES)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Filter by search + filters (T299)
  const filtered = deals.filter(d => {
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!d.title.toLowerCase().includes(q) && !(d.orgName ?? '').toLowerCase().includes(q)) return false
    }
    if (filterOwner && d.ownerId !== filterOwner) return false
    if (filterSource && d.source !== filterSource) return false
    if (filterValueMin) {
      const min = parseFloat(filterValueMin)
      if (!isNaN(min) && d.value < min) return false
    }
    if (filterValueMax) {
      const max = parseFloat(filterValueMax)
      if (!isNaN(max) && d.value > max) return false
    }
    return true
  })

  const hasActiveFilters = !!(filterOwner || filterSource || filterValueMin || filterValueMax)

  function clearFilters() {
    setFilterOwner('')
    setFilterSource('')
    setFilterValueMin('')
    setFilterValueMax('')
  }

  // Non-closed deals for summary
  const openDeals = filtered.filter(d => !d.stageIsClosedWon && !d.stageIsClosedLost)
  const closedDeals = filtered.filter(d => d.stageIsClosedWon || d.stageIsClosedLost)
  const wonDeals = filtered.filter(d => d.stageIsClosedWon)
  const totalValue = openDeals.reduce((s, d) => s + (d.valueNzd ?? d.value), 0)
  const weightedForecast = openDeals.reduce((s, d) => {
    const prob = d.stageProbability ?? 0
    return s + ((d.valueNzd ?? d.value) * prob / 100)
  }, 0)
  const winRate = closedDeals.length > 0
    ? Math.round((wonDeals.length / closedDeals.length) * 100)
    : 0
  const avgDealSize = openDeals.length > 0
    ? Math.round(totalValue / openDeals.length)
    : 0

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 className="font-bold" style={{ fontSize: '1.5rem', color: 'var(--color-text)' }}>
            Sales Pipeline
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Track and manage deals through your sales process
          </p>
        </div>
        <button
          onClick={() => setShowNewDeal(true)}
          className="inline-flex items-center gap-2 font-medium transition-colors rounded-xl"
          style={{
            padding: '0.625rem 1.25rem',
            fontSize: '0.875rem',
            background: 'var(--color-brand)',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            minHeight: '2.75rem',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-dark)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-brand)' }}
        >
          <Plus className="w-4 h-4" />
          New Deal
        </button>
      </div>

      {/* KPI summary bar */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4"
        style={{ marginBottom: '1.5rem' }}
      >
        <SummaryCard
          icon={DollarSign}
          label="Total Pipeline Value"
          value={formatCurrency(totalValue, 'NZD')}
          accent="emerald"
        />
        <SummaryCard
          icon={Target}
          label="Weighted Forecast"
          value={formatCurrency(weightedForecast, 'NZD')}
          accent="blue"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Open Deals"
          value={String(openDeals.length)}
          accent="amber"
        />
        <SummaryCard
          icon={Award}
          label="Win Rate"
          value={closedDeals.length > 0 ? `${winRate}%` : '--'}
          accent="purple"
        />
        <SummaryCard
          icon={BarChart3}
          label="Avg Deal Size"
          value={openDeals.length > 0 ? formatCurrency(avgDealSize, 'NZD') : '--'}
          accent="rose"
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3" style={{ marginBottom: '1rem' }}>
        {/* Search */}
        <div className="relative flex-1" style={{ maxWidth: '20rem' }}>
          <Search
            className="absolute pointer-events-none"
            style={{ width: '1rem', height: '1rem', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }}
          />
          <input
            type="text"
            placeholder="Search deals..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg transition-colors"
            style={{
              padding: '0.5rem 0.75rem 0.5rem 2.25rem',
              fontSize: '0.875rem',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              outline: 'none',
              minHeight: '2.75rem',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
          />
        </div>

        {/* View toggle */}
        <div
          className="inline-flex rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <button
            onClick={() => setView('kanban')}
            className="inline-flex items-center gap-1.5 transition-colors"
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              fontWeight: 500,
              background: view === 'kanban' ? 'var(--color-brand)' : 'var(--color-bg)',
              color: view === 'kanban' ? 'white' : 'var(--color-text-muted)',
              border: 'none',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            <Columns3 className="w-4 h-4" />
            Board
          </button>
          <button
            onClick={() => setView('list')}
            className="inline-flex items-center gap-1.5 transition-colors"
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              fontWeight: 500,
              background: view === 'list' ? 'var(--color-brand)' : 'var(--color-bg)',
              color: view === 'list' ? 'white' : 'var(--color-text-muted)',
              border: 'none',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            <LayoutList className="w-4 h-4" />
            List
          </button>
        </div>

        {/* Sort (list view only) */}
        {view === 'list' && (
          <div className="relative">
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="appearance-none rounded-lg cursor-pointer transition-colors"
              style={{
                padding: '0.5rem 2rem 0.5rem 0.75rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                minHeight: '2.75rem',
              }}
            >
              <option value="updatedAt">Last Updated</option>
              <option value="value">Value</option>
              <option value="expectedCloseDate">Expected Close</option>
              <option value="title">Title</option>
            </select>
            <ChevronDown
              className="absolute pointer-events-none"
              style={{ width: '0.875rem', height: '0.875rem', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }}
            />
          </div>
        )}

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="inline-flex items-center gap-1.5 transition-colors rounded-lg"
          style={{
            padding: '0.5rem 0.75rem',
            fontSize: '0.8125rem',
            fontWeight: 500,
            border: `1px solid ${showFilters || hasActiveFilters ? 'var(--color-brand)' : 'var(--color-border)'}`,
            background: showFilters || hasActiveFilters ? 'var(--color-brand-50)' : 'var(--color-bg)',
            color: showFilters || hasActiveFilters ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
            cursor: 'pointer',
            minHeight: '2.75rem',
          }}
        >
          <Filter className="w-4 h-4" />
          Filters
          {hasActiveFilters && (
            <span
              className="inline-flex items-center justify-center rounded-full text-white font-semibold"
              style={{
                width: '1.125rem',
                height: '1.125rem',
                fontSize: '0.625rem',
                background: 'var(--color-brand)',
              }}
            >
              {[filterOwner, filterSource, filterValueMin, filterValueMax].filter(Boolean).length}
            </span>
          )}
        </button>
      </div>

      {/* Filter panel (T299) */}
      {showFilters && (
        <div
          className="flex flex-col sm:flex-row sm:items-end gap-3 rounded-xl"
          style={{
            padding: '1rem',
            marginBottom: '1rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Owner filter */}
          <div className="flex-1" style={{ minWidth: '10rem' }}>
            <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Owner
            </label>
            <select
              value={filterOwner}
              onChange={e => setFilterOwner(e.target.value)}
              className="w-full rounded-lg cursor-pointer"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.5rem',
              }}
            >
              <option value="">All owners</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Source filter */}
          <div className="flex-1" style={{ minWidth: '10rem' }}>
            <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Source
            </label>
            <select
              value={filterSource}
              onChange={e => setFilterSource(e.target.value)}
              className="w-full rounded-lg cursor-pointer"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.5rem',
              }}
            >
              <option value="">All sources</option>
              <option value="referral">Referral</option>
              <option value="linkedin">LinkedIn</option>
              <option value="website">Website</option>
              <option value="cold">Cold Outreach</option>
              <option value="cold_outreach">Cold Outreach</option>
              <option value="partner">Partner</option>
              <option value="webflow">Webflow</option>
              <option value="existing_client">Existing Client</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Value min */}
          <div style={{ minWidth: '7rem' }}>
            <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Min Value
            </label>
            <input
              type="number"
              value={filterValueMin}
              onChange={e => setFilterValueMin(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.5rem',
              }}
            />
          </div>

          {/* Value max */}
          <div style={{ minWidth: '7rem' }}>
            <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Max Value
            </label>
            <input
              type="number"
              value={filterValueMax}
              onChange={e => setFilterValueMax(e.target.value)}
              placeholder="No limit"
              className="w-full rounded-lg"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.5rem',
              }}
            />
          </div>

          {/* Clear button */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-lg transition-colors self-end"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                fontWeight: 500,
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                minHeight: '2.5rem',
              }}
            >
              <X className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : view === 'kanban' ? (
        <KanbanView
          deals={filtered}
          stages={stages}
          onStageChange={fetchData}
        />
      ) : (
        <ListView
          deals={filtered}
          stages={stages}
          sortKey={sortKey}
        />
      )}

      {/* New Deal Dialog */}
      {showNewDeal && (
        <NewDealDialog
          stages={stages}
          initialOrgId={initialOrgId}
          onClose={() => { setShowNewDeal(false); setInitialOrgId(null) }}
          onCreated={() => {
            setShowNewDeal(false)
            setInitialOrgId(null)
            fetchData()
          }}
        />
      )}
    </div>
  )
}

// ---- Loading Skeleton ----------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="flex-shrink-0" style={{ width: '17rem' }}>
          <div className="animate-pulse rounded-t-lg" style={{ height: '2.5rem', background: '#f3f4f6' }} />
          <div className="flex flex-col gap-2" style={{ padding: '0.5rem' }}>
            {[1, 2].map(j => (
              <div key={j} className="animate-pulse rounded-lg" style={{ height: '7rem', background: '#f3f4f6' }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Summary Card --------------------------------------------------------

const ACCENT_MAP = {
  emerald: { bg: '#d1fae5', icon: '#059669' },
  blue:    { bg: '#dbeafe', icon: '#2563eb' },
  amber:   { bg: '#fef3c7', icon: '#d97706' },
  purple:  { bg: '#ede9fe', icon: '#7c3aed' },
  rose:    { bg: '#ffe4e6', icon: '#e11d48' },
} as const

function SummaryCard({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  value: string
  accent: keyof typeof ACCENT_MAP
}) {
  const a = ACCENT_MAP[accent]
  return (
    <div
      className="rounded-xl border shadow-sm"
      style={{ padding: '1.25rem 1.5rem', background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ width: '2.5rem', height: '2.5rem', background: a.bg }}
        >
          <Icon className="w-5 h-5" style={{ color: a.icon }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {label}
          </p>
          <p className="font-bold truncate" style={{ fontSize: '1.125rem', color: 'var(--color-text)', marginTop: '0.125rem' }}>
            {value}
          </p>
        </div>
      </div>
    </div>
  )
}

// ---- Kanban View ---------------------------------------------------------

function KanbanView({ deals, stages, onStageChange }: {
  deals: Deal[]
  stages: PipelineStage[]
  onStageChange: () => void
}) {
  const byStage = (stageId: string) => deals.filter(d => d.stageId === stageId)

  // State for the deal close dialog (shown when dropping onto Won/Lost)
  const [pendingClose, setPendingClose] = useState<{
    dealId: string
    stageId: string
    type: 'won' | 'lost'
    dealTitle: string
  } | null>(null)

  const handleDrop = async (e: React.DragEvent, newStageId: string) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.style.borderColor = 'var(--color-border)'
    const dealId = e.dataTransfer.getData('dealId')
    const fromStageId = e.dataTransfer.getData('fromStageId')
    if (!dealId || fromStageId === newStageId) return

    // Check if the target stage is a closed Won or Lost stage
    const targetStage = stages.find(s => s.id === newStageId)
    if (targetStage && (targetStage.isClosedWon || targetStage.isClosedLost)) {
      const deal = deals.find(d => d.id === dealId)
      setPendingClose({
        dealId,
        stageId: newStageId,
        type: targetStage.isClosedWon ? 'won' : 'lost',
        dealTitle: deal?.title ?? 'this deal',
      })
      return
    }

    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId: newStageId }),
      })
      onStageChange()
    } catch {
      // silent
    }
  }

  const handleCloseConfirm = async (payload: { wonSource?: string; lostReason?: string }) => {
    if (!pendingClose) return
    try {
      await fetch(apiPath(`/api/admin/deals/${pendingClose.dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageId: pendingClose.stageId,
          status: pendingClose.type,
          ...(payload.wonSource ? { wonSource: payload.wonSource } : {}),
          ...(payload.lostReason ? { lostReason: payload.lostReason } : {}),
        }),
      })
      onStageChange()
    } catch {
      // silent
    } finally {
      setPendingClose(null)
    }
  }

  return (
    <>
    <div
      className="flex gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide"
      style={{ paddingBottom: '1.25rem', WebkitOverflowScrolling: 'touch', height: 'calc(100vh - 24rem)' }}
    >
      {stages.map(stage => {
        const cards = byStage(stage.id)
        const stageValue = cards.reduce((s, d) => s + d.value, 0)
        const colour = stage.colour ?? 'var(--color-brand)'

        return (
          <div
            key={stage.id}
            className="flex flex-col flex-shrink-0"
            style={{ width: '17rem', minWidth: '17rem' }}
          >
            {/* Column header */}
            <div
              className="flex items-center justify-between"
              style={{
                padding: '0.625rem 0.75rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderBottom: 'none',
                borderRadius: '0.5rem 0.5rem 0 0',
                borderTop: `3px solid ${colour}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full flex-shrink-0"
                  style={{ width: '0.5rem', height: '0.5rem', background: colour, display: 'inline-block' }}
                />
                <span
                  className="font-semibold uppercase tracking-wide"
                  style={{
                    fontSize: '0.625rem',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.3,
                    wordBreak: 'break-word',
                  }}
                  title={stage.name}
                >
                  {stage.name}
                </span>
                <span
                  className="font-semibold rounded-full"
                  style={{ padding: '0.125rem 0.4375rem', fontSize: '0.6875rem', background: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)' }}
                >
                  {cards.length}
                </span>
              </div>
              {stageValue > 0 && (
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}>
                  {formatCurrency(stageValue, 'NZD')}
                </span>
              )}
            </div>

            {/* Drop zone */}
            <div
              className="flex flex-col gap-2 overflow-y-auto"
              style={{
                padding: '0.5rem',
                background: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderTop: 'none',
                borderRadius: '0 0 0.5rem 0.5rem',
                minHeight: '10rem',
                maxHeight: 'calc(100vh - 28rem)',
                transition: 'border-color 0.15s',
              }}
              onDragOver={e => {
                e.preventDefault()
                e.currentTarget.style.borderColor = '#5A824E'
              }}
              onDragLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
              onDrop={e => handleDrop(e, stage.id)}
            >
              {cards.length === 0 ? (
                <div
                  className="flex items-center justify-center rounded-lg"
                  style={{
                    padding: '1.75rem 0',
                    fontSize: '0.75rem',
                    color: 'var(--color-text-subtle)',
                    border: '1px dashed var(--color-border)',
                  }}
                >
                  No deals
                </div>
              ) : (
                cards.map(deal => (
                  <DealCard key={deal.id} deal={deal} stages={stages} />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>

    {/* Deal close dialog */}
    {pendingClose && (
      <DealCloseDialog
        type={pendingClose.type}
        dealTitle={pendingClose.dealTitle}
        onConfirm={handleCloseConfirm}
        onCancel={() => setPendingClose(null)}
      />
    )}
    </>
  )
}

// ---- Deal Close Dialog ---------------------------------------------------

const WON_SOURCE_OPTIONS = [
  { value: 'referral', label: 'Referral' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'website', label: 'Website' },
  { value: 'cold_outreach', label: 'Cold Outreach' },
  { value: 'partner', label: 'Partner' },
  { value: 'other', label: 'Other' },
]

function DealCloseDialog({ type, dealTitle, onConfirm, onCancel }: {
  type: 'won' | 'lost'
  dealTitle: string
  onConfirm: (payload: { wonSource?: string; lostReason?: string }) => void
  onCancel: () => void
}) {
  const [wonSource, setWonSource] = useState('')
  const [lostReason, setLostReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isWon = type === 'won'
  const canConfirm = isWon ? wonSource !== '' : lostReason.trim() !== ''

  const handleConfirm = async () => {
    if (!canConfirm) return
    setSubmitting(true)
    await onConfirm(
      isWon ? { wonSource } : { lostReason: lostReason.trim() }
    )
    setSubmitting(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        className="rounded-xl shadow-lg w-full"
        style={{
          maxWidth: '26rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        {/* Icon + title */}
        <div className="flex items-center gap-3" style={{ marginBottom: '1.25rem' }}>
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: '2.75rem',
              height: '2.75rem',
              borderRadius: '0 0.75rem 0 0.75rem',
              background: isWon
                ? 'linear-gradient(135deg, #4ade80, #059669)'
                : 'linear-gradient(135deg, #f87171, #dc2626)',
            }}
          >
            {isWon
              ? <Trophy style={{ width: '1.25rem', height: '1.25rem', color: 'white' }} />
              : <XCircle style={{ width: '1.25rem', height: '1.25rem', color: 'white' }} />
            }
          </div>
          <div>
            <h2 className="font-bold" style={{ fontSize: '1.0625rem', color: 'var(--color-text)' }}>
              {isWon ? 'Mark Deal as Won' : 'Mark Deal as Lost'}
            </h2>
            <p className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', maxWidth: '18rem' }}>
              {dealTitle}
            </p>
          </div>
        </div>

        {/* Body */}
        {isWon ? (
          <div>
            <label
              className="block font-medium"
              style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}
            >
              How was this deal won?
            </label>
            <div className="flex flex-col gap-2">
              {WON_SOURCE_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className="flex items-center gap-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    padding: '0.625rem 0.75rem',
                    border: `1px solid ${wonSource === opt.value ? 'var(--color-brand)' : 'var(--color-border)'}`,
                    background: wonSource === opt.value ? 'var(--color-brand-50)' : 'var(--color-bg)',
                    fontSize: '0.875rem',
                    color: 'var(--color-text)',
                  }}
                >
                  <input
                    type="radio"
                    name="wonSource"
                    value={opt.value}
                    checked={wonSource === opt.value}
                    onChange={() => setWonSource(opt.value)}
                    style={{ accentColor: '#5A824E' }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label
              className="block font-medium"
              style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}
            >
              Why was this deal lost?
            </label>
            <textarea
              value={lostReason}
              onChange={e => setLostReason(e.target.value)}
              placeholder="e.g. Budget constraints, chose competitor, timing not right..."
              rows={3}
              className="w-full rounded-lg"
              style={{
                padding: '0.625rem 0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                resize: 'vertical',
                minHeight: '5rem',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              autoFocus
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3" style={{ marginTop: '1.25rem' }}>
          <button
            type="button"
            onClick={onCancel}
            className="font-medium rounded-lg transition-colors"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || submitting}
            className="font-medium rounded-lg transition-colors"
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              background: isWon ? '#059669' : '#dc2626',
              color: 'white',
              border: 'none',
              cursor: !canConfirm || submitting ? 'not-allowed' : 'pointer',
              opacity: !canConfirm || submitting ? 0.6 : 1,
              minHeight: '2.75rem',
            }}
            onMouseEnter={e => {
              if (canConfirm && !submitting) {
                e.currentTarget.style.background = isWon ? '#047857' : '#b91c1c'
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = isWon ? '#059669' : '#dc2626'
            }}
          >
            {submitting ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Deal Card -----------------------------------------------------------

function DealCard({ deal, stages }: { deal: Deal; stages: PipelineStage[] }) {
  const stage = stages.find(s => s.id === deal.stageId)
  const probability = deal.stageProbability ?? stage?.probability ?? 0
  const days = daysInStage(deal.stageEnteredAt ?? null, deal.updatedAt)
  const srcCfg = SOURCE_LABELS[deal.source ?? '']

  return (
    <Link
      href={`/pipeline/${deal.id}`}
      className="block rounded-lg transition-all"
      draggable
      onDragStart={e => {
        e.dataTransfer.setData('dealId', deal.id)
        e.dataTransfer.setData('fromStageId', deal.stageId)
        e.dataTransfer.effectAllowed = 'move'
        ;(e.currentTarget as HTMLElement).style.opacity = '0.5'
      }}
      onDragEnd={e => {
        ;(e.currentTarget as HTMLElement).style.opacity = '1'
      }}
      style={{
        padding: '0.75rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
        textDecoration: 'none',
        cursor: 'grab',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
      }}
    >
      {/* Title */}
      <p className="font-medium truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text)', marginBottom: '0.375rem' }}>
        {deal.title}
      </p>

      {/* Company */}
      {deal.orgName && (
        <div className="flex items-center gap-1.5" style={{ marginBottom: '0.375rem' }}>
          <Building2 style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <span className="truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {deal.orgName}
          </span>
        </div>
      )}

      {/* Value + Probability row */}
      <div className="flex items-center gap-2" style={{ marginBottom: '0.375rem' }}>
        <p className="font-semibold" style={{ fontSize: '0.875rem', color: 'var(--color-brand)' }}>
          {formatCurrency(deal.value, deal.currency)}
        </p>
        <span
          className="inline-flex items-center rounded-full font-medium"
          style={{
            padding: '0.0625rem 0.375rem',
            fontSize: '0.625rem',
            background: probability >= 60 ? '#d1fae520' : probability >= 25 ? '#fef3c720' : '#dbeafe20',
            color: probability >= 60 ? '#059669' : probability >= 25 ? '#d97706' : '#2563eb',
            border: `1px solid ${probability >= 60 ? '#d1fae5' : probability >= 25 ? '#fef3c7' : '#dbeafe'}`,
          }}
        >
          {probability}%
        </span>
      </div>

      {/* Source badge */}
      {srcCfg && (
        <div style={{ marginBottom: '0.375rem' }}>
          <span
            className="inline-flex rounded-full font-medium"
            style={{ padding: '0.0625rem 0.375rem', fontSize: '0.625rem', background: srcCfg.bg, color: srcCfg.text }}
          >
            {srcCfg.label}
          </span>
        </div>
      )}

      {/* Footer: owner + close date + days in stage */}
      <div className="flex items-center justify-between" style={{ marginTop: '0.25rem' }}>
        {deal.ownerName ? (
          <div className="flex items-center gap-1.5">
            {deal.ownerAvatarUrl ? (
              <img
                src={deal.ownerAvatarUrl}
                alt={deal.ownerName}
                className="rounded-full"
                style={{ width: '1.25rem', height: '1.25rem' }}
              />
            ) : (
              <div
                className="rounded-full flex items-center justify-center font-semibold"
                style={{ width: '1.25rem', height: '1.25rem', fontSize: '0.5rem', background: 'var(--color-brand)', color: 'white' }}
              >
                {getInitials(deal.ownerName)}
              </div>
            )}
            <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
              {deal.ownerName.split(' ')[0]}
            </span>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            <User style={{ width: '0.75rem', height: '0.75rem' }} /> Unassigned
          </span>
        )}

        <div className="flex items-center gap-2">
          {deal.expectedCloseDate && (
            <span className="inline-flex items-center gap-1" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
              <Calendar style={{ width: '0.625rem', height: '0.625rem' }} />
              {formatDate(deal.expectedCloseDate)}
            </span>
          )}
          {days > 0 && (
            <span style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', opacity: 0.8 }}>
              {days}d
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

// ---- List View -----------------------------------------------------------

function ListView({ deals, stages, sortKey }: {
  deals: Deal[]
  stages: PipelineStage[]
  sortKey: SortKey
}) {
  const sorted = [...deals].sort((a, b) => {
    if (sortKey === 'value') return (b.value ?? 0) - (a.value ?? 0)
    if (sortKey === 'expectedCloseDate') {
      if (!a.expectedCloseDate && !b.expectedCloseDate) return 0
      if (!a.expectedCloseDate) return 1
      if (!b.expectedCloseDate) return -1
      return a.expectedCloseDate.localeCompare(b.expectedCloseDate)
    }
    if (sortKey === 'title') return a.title.localeCompare(b.title)
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  })

  const stageMap = Object.fromEntries(stages.map(s => [s.id, s]))

  if (sorted.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl border"
        style={{ padding: '4rem 2rem', background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            width: '3.5rem',
            height: '3.5rem',
            borderRadius: '0 1rem 0 1rem',
            background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
            marginBottom: '1rem',
          }}
        >
          <TrendingUp style={{ width: '1.5rem', height: '1.5rem', color: 'white' }} />
        </div>
        <p className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)', marginBottom: '0.25rem' }}>
          No deals yet
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          Create your first deal to get started
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full" style={{ fontSize: '0.8125rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
              {['Title', 'Company', 'Stage', 'Value', 'Probability', 'Owner', 'Source', 'Expected Close', 'Days in Stage'].map(h => (
                <th
                  key={h}
                  className="text-left font-semibold uppercase tracking-wide"
                  style={{ padding: '0.75rem 1rem', fontSize: '0.6875rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(deal => {
              const stage = stageMap[deal.stageId]
              const srcCfg = SOURCE_LABELS[deal.source ?? '']
              const probability = deal.stageProbability ?? stage?.probability ?? 0
              const days = daysInStage(deal.stageEnteredAt ?? null, deal.updatedAt)
              return (
                <tr
                  key={deal.id}
                  className="transition-colors cursor-pointer"
                  style={{ borderBottom: '1px solid var(--color-border-subtle)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <Link
                      href={`/pipeline/${deal.id}`}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--color-text)', textDecoration: 'none' }}
                    >
                      {deal.title}
                    </Link>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {deal.orgName ?? '--'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {stage && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full font-medium"
                        style={{
                          padding: '0.125rem 0.5rem',
                          fontSize: '0.75rem',
                          background: `${stage.colour}20`,
                          color: stage.colour ?? 'var(--color-text-muted)',
                        }}
                      >
                        <span className="rounded-full" style={{ width: '0.375rem', height: '0.375rem', background: stage.colour ?? 'var(--color-text-subtle)', display: 'inline-block' }} />
                        {stage.name}
                      </span>
                    )}
                  </td>
                  <td className="font-semibold" style={{ padding: '0.75rem 1rem', color: 'var(--color-text)', whiteSpace: 'nowrap' }}>
                    {formatCurrency(deal.value, deal.currency)}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}>
                    <span
                      className="inline-flex rounded-full font-medium"
                      style={{
                        padding: '0.125rem 0.5rem',
                        fontSize: '0.75rem',
                        background: probability >= 60 ? '#d1fae5' : probability >= 25 ? '#fef3c7' : '#dbeafe',
                        color: probability >= 60 ? '#059669' : probability >= 25 ? '#d97706' : '#2563eb',
                      }}
                    >
                      {probability}%
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {deal.ownerName ?? '--'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {srcCfg ? (
                      <span
                        className="inline-flex rounded-full font-medium"
                        style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: srcCfg.bg, color: srcCfg.text }}
                      >
                        {srcCfg.label}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-subtle)' }}>--</span>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                    {formatDate(deal.expectedCloseDate)}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap' }}>
                    {days > 0 ? `${days} days` : '--'}
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

// ---- New Deal Dialog -----------------------------------------------------

function NewDealDialog({ stages, initialOrgId, onClose, onCreated }: {
  stages: PipelineStage[]
  initialOrgId?: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [stageId, setStageId] = useState(() => {
    const def = stages.find(s => s.isDefault)
    return def?.id ?? stages[0]?.id ?? ''
  })
  const [value, setValue] = useState('')
  const [currency, setCurrency] = useState('NZD')
  const [source, setSource] = useState('')
  const [expectedCloseDate, setExpectedCloseDate] = useState('')
  const [orgId] = useState(initialOrgId ?? '')
  const [saving, setSaving] = useState(false)
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({})
  const [loadingRates, setLoadingRates] = useState(false)

  // Fetch exchange rates for conversion preview (T341)
  useEffect(() => {
    setLoadingRates(true)
    fetch(apiPath('/api/admin/exchange-rates'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ rates: Record<string, number> }>
      })
      .then(d => setExchangeRates(d.rates ?? {}))
      .catch(() => setExchangeRates({}))
      .finally(() => setLoadingRates(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !stageId) return

    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/deals'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          stageId,
          value: parseFloat(value) || 0,
          currency,
          source: source || undefined,
          expectedCloseDate: expectedCloseDate || undefined,
          orgId: orgId || undefined,
        }),
      })
      if (res.ok) {
        onCreated()
      }
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rounded-xl shadow-lg w-full"
        style={{
          maxWidth: '28rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h2 className="font-bold" style={{ fontSize: '1.125rem', color: 'var(--color-text)', marginBottom: '1.25rem' }}>
          New Deal
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Title */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.75rem',
              }}
              autoFocus
            />
          </div>

          {/* Stage */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Stage
            </label>
            <select
              value={stageId}
              onChange={e => setStageId(e.target.value)}
              className="w-full rounded-lg cursor-pointer"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.75rem',
              }}
            >
              {stages.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.probability}%)
                </option>
              ))}
            </select>
          </div>

          {/* Value + Currency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
                Value
              </label>
              <input
                type="number"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg"
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.875rem',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  minHeight: '2.75rem',
                }}
              />
            </div>
            <div>
              <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
                Currency
              </label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full rounded-lg cursor-pointer"
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.875rem',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  minHeight: '2.75rem',
                }}
              >
                {['NZD', 'USD', 'AUD', 'GBP', 'EUR', 'CAD', 'SGD', 'HKD', 'JPY', 'CHF'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Conversion preview (T341) */}
          {value && currency !== 'NZD' && !loadingRates && (() => {
            const numVal = parseFloat(value)
            if (isNaN(numVal) || numVal <= 0) return null
            const rate = exchangeRates[currency]
            if (!rate || rate <= 0) return null
            const nzdValue = Math.round(numVal / rate)
            return (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '-0.5rem' }}>
                {currency} {numVal.toLocaleString()} ≈ NZD {nzdValue.toLocaleString()}
              </p>
            )
          })()}

          {/* Source */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Lead Source
            </label>
            <select
              value={source}
              onChange={e => setSource(e.target.value)}
              className="w-full rounded-lg cursor-pointer"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.75rem',
              }}
            >
              <option value="">Select source...</option>
              <option value="referral">Referral</option>
              <option value="linkedin">LinkedIn</option>
              <option value="website">Website</option>
              <option value="cold">Cold Outreach</option>
              <option value="partner">Partner</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Expected Close Date */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Expected Close Date
            </label>
            <input
              type="date"
              value={expectedCloseDate}
              onChange={e => setExpectedCloseDate(e.target.value)}
              className="w-full rounded-lg cursor-pointer"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.75rem',
              }}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="font-medium rounded-lg transition-colors"
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                minHeight: '2.75rem',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="font-medium rounded-lg transition-colors"
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                background: 'var(--color-brand)',
                color: 'white',
                border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving || !title.trim() ? 0.6 : 1,
                minHeight: '2.75rem',
              }}
            >
              {saving ? 'Creating...' : 'Create Deal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Plus, Search, Filter, LayoutList, Columns3,
  AlertTriangle, ChevronDown, Inbox, MoreHorizontal,
  Calendar, Zap, RefreshCw,
} from 'lucide-react'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Request {
  id: string
  title: string
  status: string
  type: string
  category: string | null
  priority: string | null
  revisionCount: number | null
  scopeFlagged: boolean | null
  orgName?: string | null
  updatedAt: string | null
  createdAt: string | null
}

type ViewMode = 'list' | 'board'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  draft:         { label: 'Draft',         dot: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-600 border border-gray-200' },
  submitted:     { label: 'Submitted',     dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 border border-blue-100' },
  in_review:     { label: 'In Review',     dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border border-amber-100' },
  in_progress:   { label: 'In Progress',   dot: 'bg-green-500',   badge: 'bg-green-50 text-green-700 border border-green-100' },
  client_review: { label: 'Client Review', dot: 'bg-purple-400',  badge: 'bg-purple-50 text-purple-700 border border-purple-100' },
  delivered:     { label: 'Delivered',     dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-100' },
  archived:      { label: 'Archived',      dot: 'bg-gray-300',    badge: 'bg-gray-50 text-gray-500 border border-gray-200' },
}

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  high:     { label: 'High',     className: 'bg-red-50 text-red-600 border border-red-100' },
  standard: { label: 'Standard', className: 'bg-gray-50 text-gray-500 border border-gray-200' },
}

const BOARD_COLUMNS = [
  { status: 'submitted',     colorClass: 'border-t-blue-400' },
  { status: 'in_review',     colorClass: 'border-t-amber-400' },
  { status: 'in_progress',   colorClass: 'border-t-green-400' },
  { status: 'client_review', colorClass: 'border-t-purple-400' },
  { status: 'delivered',     colorClass: 'border-t-emerald-400' },
]

const ADMIN_TABS = [
  { label: 'Open',           value: 'active' },
  { label: 'All',            value: 'all' },
  { label: 'Unassigned',     value: 'unassigned' },
  { label: 'Completed',      value: 'delivered' },
]

const CLIENT_TABS = [
  { label: 'Active',    value: 'active' },
  { label: 'Completed', value: 'delivered' },
  { label: 'All',       value: 'all' },
]

const CATEGORY_COLOURS: Record<string, string> = {
  design:      'bg-pink-100 text-pink-700',
  development: 'bg-blue-100 text-blue-700',
  content:     'bg-amber-100 text-amber-700',
  strategy:    'bg-purple-100 text-purple-700',
  admin:       'bg-gray-100 text-gray-600',
  bug:         'bg-red-100 text-red-700',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return '—'
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
    return date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
  } catch {
    return '—'
  }
}

function formatType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.submitted
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

// ─── Priority Badge ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || priority === 'standard') {
    return <span className="text-xs text-gray-400">—</span>
  }
  const cfg = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.standard
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.className}`}>
      {priority === 'high' && <Zap className="w-2.5 h-2.5" />}
      {cfg.label}
    </span>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-6 h-6 text-[10px]' : 'w-8 h-8 text-xs'
  return (
    <div
      className={`${dim} rounded-full bg-[var(--color-brand)] text-white flex items-center justify-center font-semibold flex-shrink-0`}
    >
      {getInitials(name)}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RequestList({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<ViewMode>('list')
  const [activeTab, setActiveTab] = useState('active')
  const [search, setSearch] = useState('')
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const tabs = isAdmin ? ADMIN_TABS : CLIENT_TABS

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: activeTab })
      const endpoint = isAdmin ? '/api/admin/requests' : '/api/portal/requests'
      const res = await fetch(`${endpoint}?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { requests?: Request[] }
      setRequests(data.requests ?? [])
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, isAdmin])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  const filtered = search.trim()
    ? requests.filter(r =>
        r.title.toLowerCase().includes(search.toLowerCase()) ||
        (r.orgName ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : requests

  return (
    <>
      <NewRequestDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); fetchRequests() }}
        isAdmin={isAdmin}
      />

      {/* Full-bleed layout: break out of the p-6 from layout */}
      <div className="-mx-6 -mt-6">

        {/* Page header */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between bg-[var(--color-bg)]">
          <h1 className="text-xl font-bold text-[var(--color-text)]">Requests</h1>
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-colors hover:opacity-90"
            style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-button)' }}
          >
            <Plus className="w-4 h-4" />
            Create Request
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 pb-3 flex items-center gap-2 bg-[var(--color-bg)]">
          {/* Search */}
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-text-subtle)] pointer-events-none" />
            <input
              type="text"
              placeholder="Search requests..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:border-[var(--color-brand)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                borderRadius: 'var(--radius-input)',
              }}
            />
          </div>

          {/* Filters */}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-text)]"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-button)',
            }}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            <ChevronDown className="w-3 h-3 opacity-50" />
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* View toggle */}
          <div
            className="flex items-center overflow-hidden"
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
            }}
          >
            <button
              onClick={() => setView('list')}
              className="p-2 transition-colors"
              style={{
                background: view === 'list' ? 'var(--color-brand)' : 'var(--color-bg)',
                color: view === 'list' ? 'white' : 'var(--color-text-muted)',
              }}
              title="List view"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('board')}
              className="p-2 transition-colors"
              style={{
                background: view === 'board' ? 'var(--color-brand)' : 'var(--color-bg)',
                color: view === 'board' ? 'white' : 'var(--color-text-muted)',
              }}
              title="Board view"
            >
              <Columns3 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex items-end gap-0 overflow-x-auto px-6 bg-[var(--color-bg)]"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className="px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors flex-shrink-0"
              style={
                activeTab === tab.value
                  ? { borderColor: 'var(--color-brand)', color: 'var(--color-brand-dark)' }
                  : { borderColor: 'transparent', color: 'var(--color-text-muted)' }
              }
            >
              {tab.label}
            </button>
          ))}
          {loading && (
            <RefreshCw className="w-3.5 h-3.5 text-[var(--color-text-subtle)] animate-spin ml-2 mb-3 flex-shrink-0" />
          )}
        </div>

        {/* Content */}
        <div className="px-6 pt-4 pb-8 bg-[var(--color-bg-secondary)] min-h-[60vh]">
          {loading ? (
            <LoadingSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />
          ) : view === 'list' ? (
            <ListView requests={filtered} isAdmin={isAdmin} />
          ) : (
            <BoardView requests={filtered} />
          )}
        </div>
      </div>
    </>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ requests, isAdmin }: { requests: Request[]; isAdmin: boolean }) {
  return (
    <div
      className="overflow-hidden"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      {/* Table header */}
      <div
        className="grid text-xs font-semibold uppercase tracking-wide px-4 py-3"
        style={{
          gridTemplateColumns: isAdmin
            ? '1fr 110px 130px 120px 80px 90px'
            : '1fr 130px 120px 80px 90px',
          borderBottom: '1px solid var(--color-border)',
          color: 'var(--color-text-subtle)',
          background: 'var(--color-bg-secondary)',
        }}
      >
        <span>Title</span>
        {isAdmin && <span>Client</span>}
        <span>Category</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Updated</span>
      </div>

      {/* Rows */}
      <div style={{ borderRadius: '0 0 var(--radius-card) var(--radius-card)' }}>
        {requests.map((req, i) => (
          <ListRow
            key={req.id}
            req={req}
            isAdmin={isAdmin}
            isLast={i === requests.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

function ListRow({
  req,
  isAdmin,
  isLast,
}: {
  req: Request
  isAdmin: boolean
  isLast: boolean
}) {
  const catColour = CATEGORY_COLOURS[req.category ?? ''] ?? 'bg-gray-100 text-gray-600'

  return (
    <Link
      href={`/requests/${req.id}`}
      className="grid items-center px-4 py-3 transition-colors group"
      style={{
        gridTemplateColumns: isAdmin
          ? '1fr 110px 130px 120px 80px 90px'
          : '1fr 130px 120px 80px 90px',
        borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {/* Title */}
      <div className="flex items-center gap-2 min-w-0 pr-3">
        {req.scopeFlagged && (
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" aria-label="Scope flagged" />
        )}
        <span
          className="text-sm font-medium truncate transition-colors"
          style={{ color: 'var(--color-text)' }}
        >
          {req.title}
        </span>
      </div>

      {/* Client (admin only) */}
      {isAdmin && (
        <span className="text-sm truncate pr-3" style={{ color: 'var(--color-text-muted)' }}>
          {req.orgName ?? '—'}
        </span>
      )}

      {/* Category */}
      <div className="pr-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${catColour}`}>
          {formatType(req.type)}
        </span>
      </div>

      {/* Status */}
      <div className="pr-3">
        <StatusPill status={req.status} />
      </div>

      {/* Priority */}
      <div className="pr-3">
        <PriorityBadge priority={req.priority} />
      </div>

      {/* Updated */}
      <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
        {formatRelative(req.updatedAt ?? req.createdAt)}
      </span>
    </Link>
  )
}

// ─── Board View ───────────────────────────────────────────────────────────────

function BoardView({ requests }: { requests: Request[] }) {
  const byStatus = (status: string) => requests.filter(r => r.status === status)

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-6 px-6">
      {BOARD_COLUMNS.map(col => {
        const cards = byStatus(col.status)
        const cfg = STATUS_CONFIG[col.status]
        return (
          <div
            key={col.status}
            className="flex-shrink-0 w-72 flex flex-col"
            style={{ minWidth: '17rem' }}
          >
            {/* Column header */}
            <div
              className={`px-3 py-2.5 rounded-t-xl border-t-2 ${col.colorClass} flex items-center justify-between`}
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderTopWidth: '2px',
              }}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                  {cfg.label}
                </span>
              </div>
              <span
                className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                style={{
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-subtle)',
                }}
              >
                {cards.length}
              </span>
            </div>

            {/* Cards */}
            <div
              className="flex flex-col gap-2 p-2 flex-1 rounded-b-xl overflow-y-auto"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderTop: 'none',
                minHeight: '12rem',
                maxHeight: '70vh',
              }}
            >
              {cards.length === 0 ? (
                <div
                  className="flex items-center justify-center py-8 text-xs rounded-lg"
                  style={{ color: 'var(--color-text-subtle)', border: '1px dashed var(--color-border)' }}
                >
                  No requests
                </div>
              ) : (
                cards.map(req => <KanbanCard key={req.id} req={req} />)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KanbanCard({ req }: { req: Request }) {
  const catColour = CATEGORY_COLOURS[req.category ?? ''] ?? 'bg-gray-100 text-gray-600'

  return (
    <Link
      href={`/requests/${req.id}`}
      className="block p-3 rounded-lg transition-all group"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
    >
      {/* Category pill */}
      <div className="mb-2">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${catColour}`}>
          {formatType(req.type)}
        </span>
      </div>

      {/* Title */}
      <div className="flex items-start gap-1.5 mb-3">
        {req.scopeFlagged && (
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
        )}
        <p
          className="text-sm font-medium leading-snug line-clamp-2"
          style={{ color: 'var(--color-text)' }}
        >
          {req.title}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {req.orgName && (
            <span className="text-xs truncate max-w-[100px]" style={{ color: 'var(--color-text-subtle)' }}>
              {req.orgName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <PriorityBadge priority={req.priority} />
          <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-subtle)' }}>
            <Calendar className="w-3 h-3" />
            <span>{formatRelative(req.updatedAt ?? req.createdAt)}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div
      className="overflow-hidden"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div
        className="h-10"
        style={{
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border)',
        }}
      />
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="px-4 py-3.5 flex items-center gap-4 animate-pulse"
          style={{ borderBottom: i < 4 ? '1px solid var(--color-border-subtle)' : 'none' }}
        >
          <div className="h-4 rounded flex-1" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-4 rounded w-24" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-5 rounded-full w-20" style={{ background: 'var(--color-bg-tertiary)' }} />
          <div className="h-4 rounded w-16" style={{ background: 'var(--color-bg-tertiary)' }} />
        </div>
      ))}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ isAdmin, onNew }: { isAdmin: boolean; onNew: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-20 text-center"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div
        className="w-14 h-14 brand-gradient flex items-center justify-center mb-4"
        style={{ borderRadius: 'var(--radius-leaf)' }}
      >
        <Inbox className="w-7 h-7 text-white" />
      </div>
      <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
        No requests found
      </h3>
      <p className="text-sm max-w-sm mb-5" style={{ color: 'var(--color-text-muted)' }}>
        {isAdmin
          ? 'Requests will appear here once clients start submitting work.'
          : "Submit your first request and the Tahi team will get started."}
      </p>
      {!isAdmin && (
        <button
          onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-opacity hover:opacity-90"
          style={{ background: 'var(--color-brand)', borderRadius: 'var(--radius-button)' }}
        >
          <Plus className="w-4 h-4" />
          Submit a request
        </button>
      )}
    </div>
  )
}

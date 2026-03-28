'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Plus, Search, Filter, LayoutList, Columns3,
  AlertTriangle, ChevronDown, Inbox, RefreshCw,
  Calendar, Zap, Clock, ArrowUpDown, Download,
} from 'lucide-react'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { apiPath } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Request {
  id: string
  title: string
  status: string
  type: string
  category: string | null
  priority: string | null
  estimatedHours: number | null
  startDate: string | null
  dueDate: string | null
  revisionCount: number | null
  scopeFlagged: boolean | null
  orgName?: string | null
  assigneeId?: string | null
  updatedAt: string | null
  createdAt: string | null
}

type ViewMode = 'list' | 'board'
type SortKey = 'updatedAt' | 'dueDate' | 'priority' | 'status'

// ─── Config using CSS variables ────────────────────────────────────────────────
// Colors live in globals.css @theme; change once, updates everywhere.

const STATUS_CFG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  draft:         { label: 'Draft',         dot: 'var(--status-draft-dot)',          bg: 'var(--status-draft-bg)',          text: 'var(--status-draft-text)',         border: 'var(--status-draft-border)'         },
  submitted:     { label: 'Submitted',     dot: 'var(--status-submitted-dot)',      bg: 'var(--status-submitted-bg)',      text: 'var(--status-submitted-text)',     border: 'var(--status-submitted-border)'     },
  in_review:     { label: 'In Review',     dot: 'var(--status-in-review-dot)',      bg: 'var(--status-in-review-bg)',      text: 'var(--status-in-review-text)',     border: 'var(--status-in-review-border)'     },
  in_progress:   { label: 'In Progress',   dot: 'var(--status-in-progress-dot)',    bg: 'var(--status-in-progress-bg)',    text: 'var(--status-in-progress-text)',   border: 'var(--status-in-progress-border)'   },
  client_review: { label: 'Client Review', dot: 'var(--status-client-review-dot)',  bg: 'var(--status-client-review-bg)',  text: 'var(--status-client-review-text)', border: 'var(--status-client-review-border)' },
  delivered:     { label: 'Delivered',     dot: 'var(--status-delivered-dot)',      bg: 'var(--status-delivered-bg)',      text: 'var(--status-delivered-text)',     border: 'var(--status-delivered-border)'     },
  archived:      { label: 'Archived',      dot: 'var(--status-archived-dot)',       bg: 'var(--status-archived-bg)',       text: 'var(--status-archived-text)',      border: 'var(--status-archived-border)'      },
}

const CAT_CFG: Record<string, { bg: string; color: string }> = {
  design:      { bg: 'var(--cat-design-bg)',      color: 'var(--cat-design-text)'      },
  development: { bg: 'var(--cat-development-bg)', color: 'var(--cat-development-text)' },
  content:     { bg: 'var(--cat-content-bg)',      color: 'var(--cat-content-text)'     },
  strategy:    { bg: 'var(--cat-strategy-bg)',     color: 'var(--cat-strategy-text)'    },
  admin:       { bg: 'var(--cat-admin-bg)',        color: 'var(--cat-admin-text)'       },
  bug:         { bg: 'var(--cat-bug-bg)',          color: 'var(--cat-bug-text)'         },
}

const BOARD_COLS = [
  { status: 'submitted',     topColor: 'var(--status-submitted-dot)'      },
  { status: 'in_review',     topColor: 'var(--status-in-review-dot)'      },
  { status: 'in_progress',   topColor: 'var(--status-in-progress-dot)'    },
  { status: 'client_review', topColor: 'var(--status-client-review-dot)'  },
  { status: 'delivered',     topColor: 'var(--status-delivered-dot)'      },
]

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, standard: 2 }

const ADMIN_TABS = [
  { label: 'Open',       value: 'active'     },
  { label: 'All',        value: 'all'        },
  { label: 'Unassigned', value: 'unassigned' },
  { label: 'Completed',  value: 'delivered'  },
]

const CLIENT_TABS = [
  { label: 'Active',    value: 'active'   },
  { label: 'Completed', value: 'delivered'},
  { label: 'All',       value: 'all'      },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
  } catch { return '--' }
}

function getDueDateState(dueDate: string | null, status: string): 'overdue' | 'due-soon' | 'on-track' | null {
  if (!dueDate || status === 'delivered' || status === 'archived') return null
  const due = new Date(dueDate + 'T23:59:59')
  const now = new Date()
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 3) return 'due-soon'
  return 'on-track'
}

function formatType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function sortRequests(requests: Request[], sortKey: SortKey): Request[] {
  return [...requests].sort((a, b) => {
    if (sortKey === 'dueDate') {
      if (!a.dueDate && !b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate)
    }
    if (sortKey === 'priority') {
      return (PRIORITY_ORDER[a.priority ?? 'standard'] ?? 2) - (PRIORITY_ORDER[b.priority ?? 'standard'] ?? 2)
    }
    if (sortKey === 'status') {
      return (a.status ?? '').localeCompare(b.status ?? '')
    }
    // default: updatedAt desc
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.submitted
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap font-medium"
      style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      <span
        className="rounded-full flex-shrink-0"
        style={{ width: '0.375rem', height: '0.375rem', background: c.dot, display: 'inline-block' }}
      />
      {c.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || priority === 'standard') {
    return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.75rem' }}>--</span>
  }
  if (priority === 'urgent') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full font-medium"
        style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: 'var(--priority-urgent-bg)', color: 'var(--priority-urgent-text)', border: '1px solid var(--priority-urgent-border)' }}
      >
        <Zap className="w-2.5 h-2.5" />
        Urgent
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full font-medium"
      style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: 'var(--priority-high-bg)', color: 'var(--priority-high-text)', border: '1px solid var(--priority-high-border)' }}
    >
      <Zap className="w-2.5 h-2.5" />
      High
    </span>
  )
}

function DueDateChip({ dueDate, status }: { dueDate: string | null; status: string }) {
  const state = getDueDateState(dueDate, status)
  if (!dueDate) return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.75rem' }}>--</span>

  const bgMap = {
    overdue: 'var(--color-overdue-bg)',
    'due-soon': 'var(--color-due-soon-bg)',
    'on-track': 'transparent',
  }
  const colorMap = {
    overdue: 'var(--color-overdue-text)',
    'due-soon': 'var(--color-due-soon-text)',
    'on-track': 'var(--color-text-muted)',
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded font-medium"
      style={{
        padding: state !== 'on-track' ? '0.125rem 0.375rem' : '0',
        fontSize: '0.75rem',
        background: state ? bgMap[state] : 'transparent',
        color: state ? colorMap[state] : 'var(--color-text-muted)',
      }}
    >
      {state === 'overdue' && <AlertTriangle style={{ width: '0.625rem', height: '0.625rem' }} />}
      <Calendar style={{ width: '0.625rem', height: '0.625rem' }} />
      {formatDate(dueDate)}
    </span>
  )
}

function OrgAvatar({ name }: { name: string }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
      style={{ width: '1.375rem', height: '1.375rem', fontSize: '0.5625rem', background: 'var(--color-brand)', color: 'white' }}
    >
      {getInitials(name)}
    </div>
  )
}

function HoursChip({ hours }: { hours: number | null }) {
  if (!hours) return null
  return (
    <span
      className="inline-flex items-center gap-0.5"
      style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}
      title={`${hours}h estimated`}
    >
      <Clock style={{ width: '0.625rem', height: '0.625rem' }} />
      {hours}h
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BoardColumn {
  status: string
  topColor: string
  label?: string
}

export function RequestList({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<ViewMode>('list')
  const [activeTab, setActiveTab] = useState('active')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>(BOARD_COLS)

  const tabs = isAdmin ? ADMIN_TABS : CLIENT_TABS

  // Fetch custom kanban columns (admin only)
  useEffect(() => {
    if (!isAdmin) return
    fetch(apiPath('/api/admin/kanban-columns'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ columns: Array<{ statusValue: string; colour: string | null; label: string; position: number }> }>
      })
      .then(data => {
        if (data.columns && data.columns.length > 0) {
          const mapped: BoardColumn[] = data.columns
            .sort((a, b) => a.position - b.position)
            .map(c => ({
              status: c.statusValue,
              topColor: c.colour ?? `var(--status-${c.statusValue.replace(/_/g, '-')}-dot)`,
              label: c.label,
            }))
          setBoardColumns(mapped)
        }
      })
      .catch(() => {
        // Keep defaults
      })
  }, [isAdmin])

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: activeTab })
      const endpoint = isAdmin ? apiPath('/api/admin/requests') : apiPath('/api/portal/requests')
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

  const sorted = sortRequests(filtered, sortKey)

  return (
    <>
      <NewRequestDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); fetchRequests() }}
        isAdmin={isAdmin}
      />

      {/* Page header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 className="font-bold" style={{ fontSize: '1.25rem', color: 'var(--color-text)', lineHeight: 1.2 }}>Requests</h1>
          {!loading && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
              {filtered.length} {filtered.length === 1 ? 'request' : 'requests'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const link = document.createElement('a')
              link.href = apiPath('/api/admin/export/requests')
              link.download = 'requests.csv'
              link.click()
            }}
            className="flex items-center gap-2 font-medium transition-opacity hover:opacity-80"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              color: 'var(--color-text)',
            }}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>
          <button
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-2 font-semibold text-white transition-opacity hover:opacity-90"
            style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', background: 'var(--color-brand)', borderRadius: '0.375rem', border: 'none', cursor: 'pointer' }}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Request</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>
      </div>

      {/* Main card */}
      <div
        className="overflow-hidden"
        style={{
          background: 'white',
          border: '1px solid var(--color-border)',
          borderRadius: '0.75rem',
          boxShadow: 'var(--shadow-sm)',
        }}
      >

        {/* Toolbar */}
        <div
          className="flex flex-wrap items-center gap-2"
          style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border-subtle)', background: 'white' }}
        >
          {/* Search */}
          <div className="relative" style={{ width: '16rem', minWidth: '8rem', flexShrink: 1 }}>
            <Search
              className="absolute top-1/2 pointer-events-none"
              style={{ left: '0.625rem', transform: 'translateY(-50%)', width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)' }}
            />
            <input
              type="text"
              placeholder="Search requests…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5A824E] focus-visible:ring-offset-1"
              style={{
                paddingTop: '0.4375rem',
                paddingBottom: '0.4375rem',
                paddingLeft: '2rem',
                paddingRight: '0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                background: 'var(--color-bg-secondary)',
                color: 'var(--color-text)',
              }}
            />
          </div>

          {/* Sort */}
          <div className="relative hidden sm:block">
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="appearance-none focus:outline-none"
              style={{
                padding: '0.4375rem 2rem 0.4375rem 0.75rem',
                fontSize: '0.8125rem',
                border: '1px solid var(--color-border)',
                borderRadius: '0.5rem',
                color: 'var(--color-text-muted)',
                background: 'white',
                cursor: 'pointer',
              }}
            >
              <option value="updatedAt">Sort: Updated</option>
              <option value="dueDate">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="status">Sort: Status</option>
            </select>
            <ArrowUpDown
              className="absolute top-1/2 pointer-events-none"
              style={{ right: '0.5rem', transform: 'translateY(-50%)', width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }}
            />
          </div>

          {/* Filter button */}
          <button
            className="hidden sm:flex items-center gap-1.5 font-medium flex-shrink-0 transition-colors"
            style={{
              padding: '0.4375rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              color: 'var(--color-text-muted)',
              background: 'white',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
            <ChevronDown className="w-3 h-3 opacity-50" />
          </button>

          <div className="flex-1" />

          {/* View toggle */}
          <div
            className="flex items-center overflow-hidden flex-shrink-0"
            style={{ border: '1px solid var(--color-border)', borderRadius: '0.5rem' }}
          >
            <button
              onClick={() => setView('list')}
              className="flex items-center justify-center transition-colors"
              style={{
                padding: '0.5rem',
                background: view === 'list' ? 'var(--color-brand)' : 'white',
                color: view === 'list' ? 'white' : 'var(--color-text-muted)',
                cursor: 'pointer',
                border: 'none',
              }}
              aria-label="List view"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setView('board')}
              className="flex items-center justify-center transition-colors"
              style={{
                padding: '0.5rem',
                background: view === 'board' ? 'var(--color-brand)' : 'white',
                color: view === 'board' ? 'white' : 'var(--color-text-muted)',
                border: 'none',
                borderLeft: '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
              aria-label="Board view"
            >
              <Columns3 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex items-end overflow-x-auto"
          style={{ borderBottom: '1px solid var(--color-border)', paddingLeft: '0.25rem', paddingRight: '1rem', background: 'white' }}
        >
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className="font-medium whitespace-nowrap flex-shrink-0 transition-colors"
              style={{
                padding: '0.625rem 1rem',
                fontSize: '0.875rem',
                border: 0,
                borderBottom: activeTab === tab.value ? '2px solid var(--color-brand)' : '2px solid transparent',
                marginBottom: '-1px',
                color: activeTab === tab.value ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
          {loading && (
            <RefreshCw
              className="animate-spin flex-shrink-0"
              style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)', marginLeft: '0.5rem', marginBottom: '0.75rem' }}
            />
          )}
        </div>

        {/* Content area */}
        <div style={{ background: view === 'board' ? 'var(--color-bg-secondary)' : 'white' }}>
          {loading ? (
            <LoadingSkeleton />
          ) : sorted.length === 0 ? (
            <EmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />
          ) : view === 'list' ? (
            <ListView requests={sorted} isAdmin={isAdmin} />
          ) : (
            <BoardView requests={sorted} columns={boardColumns} />
          )}
        </div>
      </div>
    </>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({ requests, isAdmin }: { requests: Request[]; isAdmin: boolean }) {
  return (
    <div>
      {/* Table header: hidden on mobile, visible md+ */}
      <div
        className="hidden md:grid text-xs font-semibold uppercase tracking-wide"
        style={{
          gridTemplateColumns: isAdmin
            ? '1fr 7.5rem 9rem 8rem 5.5rem 6rem 5.5rem'
            : '1fr 8.75rem 8rem 5.5rem 5.5rem 5.5rem',
          padding: '0.625rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          color: 'var(--color-th-text)',
          background: 'var(--color-th-bg)',
        }}
      >
        <span>Title</span>
        {isAdmin && <span>Client</span>}
        <span>Type</span>
        <span>Status</span>
        <span>Due</span>
        <span>Est.</span>
        <span>Priority</span>
      </div>

      {/* Rows */}
      <div>
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

function ListRow({ req, isAdmin, isLast }: { req: Request; isAdmin: boolean; isLast: boolean }) {
  const cat = CAT_CFG[req.category ?? ''] ?? { bg: 'var(--cat-admin-bg)', color: 'var(--cat-admin-text)' }

  return (
    <Link
      href={`/requests/${req.id}`}
      style={{ textDecoration: 'none', display: 'block' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-row-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'white' }}
    >
      {/* Mobile layout (< md): card-style */}
      <div
        className="flex flex-col gap-2 md:hidden"
        style={{
          padding: '0.875rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
          background: 'inherit',
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {req.scopeFlagged && <AlertTriangle style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-danger)', flexShrink: 0 }} />}
            <span className="font-medium truncate" style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>{req.title}</span>
          </div>
          <StatusPill status={req.status} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && req.orgName && (
            <div className="flex items-center gap-1">
              <OrgAvatar name={req.orgName} />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{req.orgName}</span>
            </div>
          )}
          <span
            className="inline-flex items-center rounded"
            style={{ padding: '0.125rem 0.5rem', fontSize: '0.6875rem', background: cat.bg, color: cat.color }}
          >
            {formatType(req.type)}
          </span>
          <PriorityBadge priority={req.priority} />
          {req.dueDate && <DueDateChip dueDate={req.dueDate} status={req.status} />}
          <HoursChip hours={req.estimatedHours} />
        </div>
      </div>

      {/* Desktop layout (md+): grid table row */}
      <div
        className="hidden md:grid items-center"
        style={{
          gridTemplateColumns: isAdmin
            ? '1fr 7.5rem 9rem 8rem 5.5rem 6rem 5.5rem'
            : '1fr 8.75rem 8rem 5.5rem 5.5rem 5.5rem',
          padding: '0.75rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
          background: 'inherit',
        }}
      >
        {/* Title */}
        <div className="flex items-center gap-2 min-w-0" style={{ paddingRight: '0.75rem' }}>
          {req.scopeFlagged && (
            <AlertTriangle style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-danger)', flexShrink: 0 }} aria-label="Scope flagged" />
          )}
          <span className="font-medium truncate" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>
            {req.title}
          </span>
        </div>

        {/* Client (admin only) */}
        {isAdmin && (
          <div className="flex items-center gap-1.5 min-w-0" style={{ paddingRight: '0.75rem' }}>
            {req.orgName && <OrgAvatar name={req.orgName} />}
            <span className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              {req.orgName ?? '--'}
            </span>
          </div>
        )}

        {/* Type / category */}
        <div style={{ paddingRight: '0.75rem' }}>
          <span
            className="inline-flex items-center rounded"
            style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: cat.bg, color: cat.color }}
          >
            {formatType(req.type)}
          </span>
        </div>

        {/* Status */}
        <div style={{ paddingRight: '0.75rem' }}>
          <StatusPill status={req.status} />
        </div>

        {/* Due date */}
        <div style={{ paddingRight: '0.75rem' }}>
          <DueDateChip dueDate={req.dueDate} status={req.status} />
        </div>

        {/* Estimated hours */}
        <div style={{ paddingRight: '0.75rem' }}>
          <HoursChip hours={req.estimatedHours} />
        </div>

        {/* Priority */}
        <div>
          <PriorityBadge priority={req.priority} />
        </div>
      </div>
    </Link>
  )
}

// ─── Board View ───────────────────────────────────────────────────────────────

function BoardView({ requests, columns }: { requests: Request[]; columns: BoardColumn[] }) {
  const byStatus = (status: string) => requests.filter(r => r.status === status)

  return (
    <div
      className="flex gap-3 overflow-x-auto"
      style={{ padding: '1rem', paddingBottom: '1.25rem', background: 'var(--color-bg-secondary)' }}
    >
      {columns.map(col => {
        const cards = byStatus(col.status)
        const cfg = STATUS_CFG[col.status] ?? { label: col.label ?? col.status, dot: col.topColor, bg: 'var(--color-bg-secondary)', text: 'var(--color-text-muted)', border: 'var(--color-border)' }
        return (
          <div
            key={col.status}
            className="flex flex-col flex-shrink-0"
            style={{ width: '17rem' }}
          >
            {/* Column header */}
            <div
              className="flex items-center justify-between"
              style={{
                padding: '0.625rem 0.75rem',
                background: 'white',
                border: '1px solid var(--color-border)',
                borderBottom: 'none',
                borderRadius: '0.5rem 0.5rem 0 0',
                borderTop: `3px solid ${col.topColor}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full flex-shrink-0"
                  style={{ width: '0.5rem', height: '0.5rem', background: cfg.dot, display: 'inline-block' }}
                />
                <span
                  className="font-semibold uppercase tracking-wide"
                  style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}
                >
                  {cfg.label}
                </span>
              </div>
              <span
                className="font-semibold rounded-full"
                style={{ padding: '0.125rem 0.4375rem', fontSize: '0.6875rem', background: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)' }}
              >
                {cards.length}
              </span>
            </div>

            {/* Cards area */}
            <div
              className="flex flex-col gap-2 overflow-y-auto"
              style={{
                padding: '0.5rem',
                background: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderTop: 'none',
                borderRadius: '0 0 0.5rem 0.5rem',
                minHeight: '10rem',
                maxHeight: '68vh',
              }}
            >
              {cards.length === 0 ? (
                <div
                  className="flex items-center justify-center rounded-lg"
                  style={{
                    padding: '1.75rem 0',
                    fontSize: '0.75rem',
                    color: 'var(--color-text-subtle)',
                    border: '1px dashed var(--color-border)',
                    background: 'transparent',
                  }}
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
  const cat = CAT_CFG[req.category ?? ''] ?? { bg: 'var(--cat-admin-bg)', color: 'var(--cat-admin-text)' }

  return (
    <Link
      href={`/requests/${req.id}`}
      className="block rounded-lg transition-all"
      style={{
        padding: '0.75rem',
        background: 'white',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)',
        textDecoration: 'none',
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
      {/* Type + scope flag */}
      <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
        <span
          className="inline-flex items-center rounded"
          style={{ padding: '0.125rem 0.4375rem', fontSize: '0.6875rem', background: cat.bg, color: cat.color }}
        >
          {formatType(req.type)}
        </span>
        {req.scopeFlagged && (
          <AlertTriangle style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-danger)', flexShrink: 0 }} />
        )}
      </div>

      {/* Title */}
      <p
        className="font-medium leading-snug line-clamp-2"
        style={{ fontSize: '0.875rem', color: 'var(--color-text)', marginBottom: '0.625rem' }}
      >
        {req.title}
      </p>

      {/* Due date bar (when set) */}
      {req.dueDate && (
        <div style={{ marginBottom: '0.5rem' }}>
          <DueDateChip dueDate={req.dueDate} status={req.status} />
        </div>
      )}

      {/* Footer: org + meta */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {req.orgName && (
            <>
              <OrgAvatar name={req.orgName} />
              <span className="truncate" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', maxWidth: '5.625rem' }}>
                {req.orgName}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <HoursChip hours={req.estimatedHours} />
          <PriorityBadge priority={req.priority} />
        </div>
      </div>
    </Link>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div>
      <div style={{ height: '2.5rem', background: 'var(--color-th-bg)', borderBottom: '1px solid var(--color-border-subtle)' }} />
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 animate-pulse"
          style={{
            padding: '0.875rem 1rem',
            borderBottom: i < 4 ? '1px solid var(--color-row-border)' : 'none',
          }}
        >
          <div className="h-4 rounded flex-1" style={{ background: 'var(--color-border-subtle)' }} />
          <div className="h-4 rounded hidden sm:block" style={{ background: 'var(--color-border-subtle)', width: '6rem' }} />
          <div className="h-5 rounded-full" style={{ background: 'var(--color-border-subtle)', width: '5rem' }} />
          <div className="h-4 rounded hidden md:block" style={{ background: 'var(--color-border-subtle)', width: '4rem' }} />
        </div>
      ))}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ isAdmin, onNew }: { isAdmin: boolean; onNew: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: '4rem 1.5rem', background: 'white' }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: '3.5rem',
          height: '3.5rem',
          borderRadius: 'var(--radius-leaf)',
          background: 'linear-gradient(135deg, var(--color-brand-light), var(--color-brand-dark))',
          marginBottom: '1rem',
        }}
      >
        <Inbox style={{ width: '1.75rem', height: '1.75rem', color: 'white' }} />
      </div>
      <h3 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)', marginBottom: '0.5rem' }}>
        No requests found
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '20rem', marginBottom: '1.25rem' }}>
        {isAdmin
          ? 'Requests will appear here once clients start submitting work.'
          : 'Submit your first request and the Tahi team will get started.'}
      </p>
      {!isAdmin && (
        <button
          onClick={onNew}
          className="flex items-center gap-2 font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', background: 'var(--color-brand)', borderRadius: '0.375rem', border: 'none', cursor: 'pointer' }}
        >
          <Plus className="w-4 h-4" />
          Submit a request
        </button>
      )}
    </div>
  )
}

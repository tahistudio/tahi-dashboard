'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Search, LayoutList, Columns3, BarChart3,
  AlertTriangle, ChevronDown, Inbox, RefreshCw,
  Calendar, Zap, Clock, ArrowUpDown, Download,
  CheckSquare, Square, Users, Loader2, X,
} from 'lucide-react'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { DateRangePicker, type DateRange } from '@/components/tahi/date-range-picker'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

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
  requestNumber?: number | null
}

type ViewMode = 'list' | 'board' | 'workload'
type SortKey = 'updatedAt' | 'dueDate' | 'priority' | 'status'

// ─── Config using CSS variables ────────────────────────────────────────────────
// Colors live in globals.css @theme; change once, updates everywhere.

import { REQUEST_STATUS_CONFIG as STATUS_CFG, CATEGORY_CONFIG as CAT_CFG } from '@/lib/status-config'

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

const ALL_STATUSES = ['submitted', 'in_review', 'in_progress', 'client_review', 'on_hold', 'delivered', 'cancelled']

function StatusPill({ status, requestId, isAdmin, onStatusChange }: {
  status: string
  requestId?: string
  isAdmin?: boolean
  onStatusChange?: (id: string, newStatus: string) => void
}) {
  const [open, setOpen] = useState(false)
  const c = STATUS_CFG[status] ?? STATUS_CFG.submitted
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (!isAdmin || !requestId || !onStatusChange) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap font-medium"
        style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      >
        <span className="rounded-full flex-shrink-0" style={{ width: '0.375rem', height: '0.375rem', background: c.dot, display: 'inline-block' }} />
        {c.label}
      </span>
    )
  }

  return (
    <div ref={ref} className="relative" style={{ display: 'inline-block' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(!open) }}
        className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap font-medium cursor-pointer transition-opacity hover:opacity-80"
        style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      >
        <span className="rounded-full flex-shrink-0" style={{ width: '0.375rem', height: '0.375rem', background: c.dot, display: 'inline-block' }} />
        {c.label}
        <ChevronDown style={{ width: '0.625rem', height: '0.625rem', opacity: 0.6 }} />
      </button>
      {open && (
        <div
          className="absolute left-0 z-50 mt-1 rounded-lg border shadow-lg overflow-hidden"
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', minWidth: '9rem' }}
        >
          {ALL_STATUSES.map(s => {
            const sc = STATUS_CFG[s] ?? STATUS_CFG.submitted
            return (
              <button
                key={s}
                onClick={e => {
                  e.stopPropagation()
                  onStatusChange(requestId, s)
                  setOpen(false)
                }}
                className="w-full text-left flex items-center gap-2 cursor-pointer transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.75rem',
                  color: s === status ? sc.text : 'var(--color-text-muted)',
                  fontWeight: s === status ? 600 : 400,
                }}
              >
                <span className="rounded-full flex-shrink-0" style={{ width: '0.375rem', height: '0.375rem', background: sc.dot }} />
                {sc.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
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

function getStoredPreference<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const stored = localStorage.getItem(key)
    return stored ? (stored as T) : fallback
  } catch {
    return fallback
  }
}

export function RequestList({ isAdmin }: { isAdmin: boolean }) {
  const searchParams = useSearchParams()
  const [view, setViewRaw] = useState<ViewMode>(() => getStoredPreference<ViewMode>('tahi-request-view', 'list'))
  const [activeTab, setActiveTab] = useState('active')
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [sortKey, setSortKeyRaw] = useState<SortKey>(() => getStoredPreference<SortKey>('tahi-request-sort', 'updatedAt'))

  const setView = useCallback((v: ViewMode) => {
    setViewRaw(v)
    try { localStorage.setItem('tahi-request-view', v) } catch { /* noop */ }
  }, [])

  const setSortKey = useCallback((k: SortKey) => {
    setSortKeyRaw(k)
    try { localStorage.setItem('tahi-request-sort', k) } catch { /* noop */ }
  }, [])
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(() => searchParams.get('new') === '1')
  const defaultClientId = searchParams.get('client') ?? undefined
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false)

  // Listen for keyboard shortcut events
  useEffect(() => {
    function handleShortcut(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail === 'new-request') setDialogOpen(true)
    }
    window.addEventListener('tahi:shortcut', handleShortcut)
    return () => window.removeEventListener('tahi:shortcut', handleShortcut)
  }, [])
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>(BOARD_COLS)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { showToast } = useToast()

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

  // Inline status change from list view
  const handleStatusChange = useCallback(async (requestId: string, newStatus: string) => {
    // Optimistic update
    setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: newStatus } : r))
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
    } catch {
      fetchRequests() // Revert on failure
    }
  }, [fetchRequests])

  // Clear selection when tab changes
  useEffect(() => { setSelectedIds(new Set()) }, [activeTab])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const filtered = requests.filter(r => {
    // Text search
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!r.title.toLowerCase().includes(q) && !(r.orgName ?? '').toLowerCase().includes(q)) return false
    }
    // Date range filter (on createdAt)
    if (dateRange.from && dateRange.to && r.createdAt) {
      const d = new Date(r.createdAt).getTime()
      if (d < dateRange.from.getTime() || d > dateRange.to.getTime()) return false
    }
    // Category filter
    if (categoryFilter !== 'all' && (r.category ?? '') !== categoryFilter) return false
    // Type filter
    if (typeFilter !== 'all' && r.type !== typeFilter) return false
    return true
  })

  const sorted = sortRequests(filtered, sortKey)

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === sorted.length) return new Set()
      return new Set(sorted.map(r => r.id))
    })
  }, [sorted])

  return (
    <>
      <NewRequestDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); fetchRequests(); showToast('Request created successfully') }}
        isAdmin={isAdmin}
        defaultOrgId={defaultClientId}
      />

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Requests</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {!loading
              ? `${filtered.length} ${filtered.length === 1 ? 'request' : 'requests'}`
              : 'Manage all work items and track progress'}
          </p>
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
          {isAdmin && (
            <button
              onClick={() => setBulkCreateOpen(true)}
              className="hidden sm:flex items-center gap-2 font-medium transition-opacity hover:opacity-80"
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
              <Users className="w-4 h-4" />
              Bulk Create
            </button>
          )}
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
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.75rem',
          boxShadow: 'var(--shadow-sm)',
        }}
      >

        {/* Toolbar */}
        <div
          className="flex flex-wrap items-center gap-2"
          style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border-subtle)', background: 'var(--color-bg)' }}
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
              className="w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-1"
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
                background: 'var(--color-bg)',
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

          {/* Filters */}
          <DateRangePicker value={dateRange} onChange={setDateRange} label="Created date" />
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="hidden sm:block appearance-none focus:outline-none"
            style={{
              padding: '0.4375rem 2rem 0.4375rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              color: categoryFilter !== 'all' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
              background: categoryFilter !== 'all' ? 'var(--color-brand-50)' : 'var(--color-bg)',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Categories</option>
            <option value="design">Design</option>
            <option value="development">Development</option>
            <option value="strategy">Strategy</option>
            <option value="content">Content</option>
            <option value="marketing">Marketing</option>
            <option value="other">Other</option>
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="hidden sm:block appearance-none focus:outline-none"
            style={{
              padding: '0.4375rem 2rem 0.4375rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              color: typeFilter !== 'all' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
              background: typeFilter !== 'all' ? 'var(--color-brand-50)' : 'var(--color-bg)',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Types</option>
            <option value="small_task">Small Task</option>
            <option value="large_task">Large Task</option>
          </select>

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
                background: view === 'list' ? 'var(--color-brand)' : 'var(--color-bg)',
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
                background: view === 'board' ? 'var(--color-brand)' : 'var(--color-bg)',
                color: view === 'board' ? 'white' : 'var(--color-text-muted)',
                border: 'none',
                borderLeft: '1px solid var(--color-border)',
                cursor: 'pointer',
              }}
              aria-label="Board view"
            >
              <Columns3 className="w-4 h-4" />
            </button>
            {isAdmin && (
              <button
                onClick={() => setView('workload')}
                className="flex items-center justify-center transition-colors"
                style={{
                  padding: '0.5rem',
                  background: view === 'workload' ? 'var(--color-brand)' : 'var(--color-bg)',
                  color: view === 'workload' ? 'white' : 'var(--color-text-muted)',
                  border: 'none',
                  borderLeft: '1px solid var(--color-border)',
                  cursor: 'pointer',
                }}
                aria-label="Workload view"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div
          className="flex items-end overflow-x-auto overflow-y-hidden scrollbar-hide"
          style={{ borderBottom: '1px solid var(--color-border)', paddingLeft: '0.25rem', paddingRight: '1rem', background: 'var(--color-bg)', WebkitOverflowScrolling: 'touch' }}
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

        {/* Bulk action bar */}
        {isAdmin && selectedIds.size > 0 && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            selectedIds={selectedIds}
            onClear={() => setSelectedIds(new Set())}
            onDone={() => { setSelectedIds(new Set()); fetchRequests() }}
          />
        )}

        {/* Content area */}
        <div style={{ background: view === 'board' || view === 'workload' ? 'var(--color-bg-secondary)' : 'var(--color-bg)' }}>
          {loading ? (
            <LoadingSkeleton />
          ) : view === 'workload' && isAdmin ? (
            <WorkloadView requests={sorted} />
          ) : sorted.length === 0 ? (
            <EmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />
          ) : view === 'list' ? (
            <ListView
              requests={sorted}
              isAdmin={isAdmin}
              selectedIds={selectedIds}
              onToggleSelect={isAdmin ? toggleSelect : undefined}
              onToggleAll={isAdmin ? toggleSelectAll : undefined}
              onStatusChange={isAdmin ? handleStatusChange : undefined}
            />
          ) : (
            <BoardView requests={sorted} columns={boardColumns} isAdmin={isAdmin} onStatusChange={fetchRequests} />
          )}
        </div>
      </div>

      {/* Bulk Create Dialog */}
      {bulkCreateOpen && (
        <BulkCreateDialog
          onClose={() => setBulkCreateOpen(false)}
          onCreated={() => { setBulkCreateOpen(false); fetchRequests() }}
        />
      )}
    </>
  )
}

// ─── List View ────────────────────────────────────────────────────────────────

function ListView({
  requests,
  isAdmin,
  selectedIds,
  onToggleSelect,
  onToggleAll,
  onStatusChange,
}: {
  requests: Request[]
  isAdmin: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onStatusChange?: (id: string, status: string) => void
  onToggleAll?: () => void
}) {
  const showCheckboxes = isAdmin && onToggleSelect
  const allSelected = showCheckboxes && selectedIds && selectedIds.size === requests.length && requests.length > 0

  return (
    <div>
      {/* Table header: hidden on mobile, visible md+ */}
      <div
        className="hidden md:grid text-xs font-semibold uppercase tracking-wide items-center"
        style={{
          gridTemplateColumns: showCheckboxes
            ? '2rem 1fr 7.5rem 9rem 8rem 5.5rem 6rem 5.5rem'
            : isAdmin
              ? '1fr 7.5rem 9rem 8rem 5.5rem 6rem 5.5rem'
              : '1fr 8.75rem 8rem 5.5rem 5.5rem 5.5rem',
          padding: '0.625rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          color: 'var(--color-th-text)',
          background: 'var(--color-th-bg)',
        }}
      >
        {showCheckboxes && (
          <button
            onClick={e => { e.preventDefault(); onToggleAll?.() }}
            className="flex items-center justify-center"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            aria-label={allSelected ? 'Deselect all' : 'Select all'}
          >
            {allSelected
              ? <CheckSquare className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />
              : <Square className="w-4 h-4" style={{ color: 'var(--color-text-subtle)' }} />}
          </button>
        )}
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
            isSelected={selectedIds?.has(req.id)}
            onToggleSelect={onToggleSelect}
            onStatusChange={onStatusChange}
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
  isSelected,
  onToggleSelect,
  onStatusChange,
}: {
  req: Request
  isAdmin: boolean
  isLast: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  onStatusChange?: (id: string, status: string) => void
}) {
  const cat = CAT_CFG[req.category ?? ''] ?? { bg: 'var(--cat-admin-bg)', color: 'var(--cat-admin-text)' }
  const showCheckbox = isAdmin && onToggleSelect

  return (
    <Link
      href={`/requests/${req.id}`}
      style={{ textDecoration: 'none', display: 'block' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-row-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--color-brand-50)' : 'var(--color-bg)' }}
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
            {req.requestNumber != null && (
              <span className="flex-shrink-0 font-mono font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                #{String(req.requestNumber).padStart(3, '0')}
              </span>
            )}
            <span className="font-medium truncate" style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>{req.title}</span>
          </div>
          <StatusPill status={req.status} requestId={req.id} isAdmin={isAdmin} onStatusChange={onStatusChange} />
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
          gridTemplateColumns: showCheckbox
            ? '2rem 1fr 7.5rem 9rem 8rem 5.5rem 6rem 5.5rem'
            : isAdmin
              ? '1fr 7.5rem 9rem 8rem 5.5rem 6rem 5.5rem'
              : '1fr 8.75rem 8rem 5.5rem 5.5rem 5.5rem',
          padding: '0.75rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
          background: isSelected ? 'var(--color-brand-50)' : 'inherit',
        }}
      >
        {/* Checkbox */}
        {showCheckbox && (
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSelect(req.id) }}
            className="flex items-center justify-center"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            aria-label={isSelected ? 'Deselect' : 'Select'}
          >
            {isSelected
              ? <CheckSquare className="w-4 h-4" style={{ color: 'var(--color-brand)' }} />
              : <Square className="w-4 h-4" style={{ color: 'var(--color-text-subtle)' }} />}
          </button>
        )}
        {/* Title */}
        <div className="flex items-center gap-2 min-w-0" style={{ paddingRight: '0.75rem' }}>
          {req.scopeFlagged && (
            <AlertTriangle style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-danger)', flexShrink: 0 }} aria-label="Scope flagged" />
          )}
          {req.requestNumber != null && (
            <span className="flex-shrink-0 font-mono font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              #{String(req.requestNumber).padStart(3, '0')}
            </span>
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
          <StatusPill status={req.status} requestId={req.id} isAdmin={isAdmin} onStatusChange={onStatusChange} />
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

function BoardView({ requests, columns, isAdmin, onStatusChange }: { requests: Request[]; columns: BoardColumn[]; isAdmin: boolean; onStatusChange: () => void }) {
  const byStatus = (status: string) => requests.filter(r => r.status === status)

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.style.borderColor = 'var(--color-border)'
    const requestId = e.dataTransfer.getData('requestId')
    const fromStatus = e.dataTransfer.getData('fromStatus')
    if (!requestId || fromStatus === newStatus) return
    if (!isAdmin) return
    try {
      await fetch(apiPath(`/api/admin/requests/${requestId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      onStatusChange()
    } catch {
      // silent
    }
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide"
      style={{ padding: '1rem', paddingBottom: '1.25rem', background: 'var(--color-bg-secondary)', WebkitOverflowScrolling: 'touch', height: 'calc(100vh - 14rem)' }}
    >
      {columns.map(col => {
        const cards = byStatus(col.status)
        const cfg = STATUS_CFG[col.status] ?? { label: col.label ?? col.status, dot: col.topColor, bg: 'var(--color-bg-secondary)', text: 'var(--color-text-muted)', border: 'var(--color-border)' }
        return (
          <div
            key={col.status}
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

            {/* Cards area - drop target */}
            <div
              className="flex flex-col gap-2 overflow-y-auto"
              style={{
                padding: '0.5rem',
                background: 'var(--color-bg-tertiary)',
                border: '1px solid var(--color-border)',
                borderTop: 'none',
                borderRadius: '0 0 0.5rem 0.5rem',
                minHeight: '10rem',
                maxHeight: 'calc(100vh - 18rem)',
                transition: 'border-color 0.15s',
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.currentTarget.style.borderColor = '#5A824E'
              }}
              onDragLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
              onDrop={(e) => { handleDrop(e, col.status) }}
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
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('requestId', req.id)
        e.dataTransfer.setData('fromStatus', req.status)
        e.dataTransfer.effectAllowed = 'move'
        ;(e.currentTarget as HTMLElement).style.opacity = '0.5'
      }}
      onDragEnd={(e) => {
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

// ─── Workload View ───────────────────────────────────────────────────────────

interface WorkloadTeamMember {
  id: string
  name: string
  role: string | null
  avatarUrl: string | null
}

function WorkloadView({ requests }: { requests: Request[] }) {
  const [members, setMembers] = useState<WorkloadTeamMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/team-members'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ items: WorkloadTeamMember[] }>
      })
      .then(data => setMembers(data.items ?? []))
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false))
  }, [])

  if (loadingMembers) {
    return (
      <div style={{ padding: '1.5rem' }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse" style={{ marginBottom: '1rem' }}>
            <div className="rounded-full" style={{ width: '2rem', height: '2rem', background: 'var(--color-border-subtle)' }} />
            <div className="h-4 rounded" style={{ width: '8rem', background: 'var(--color-border-subtle)' }} />
            <div className="h-4 rounded" style={{ width: '3rem', background: 'var(--color-border-subtle)', marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    )
  }

  // Count assigned requests per team member
  const assignmentMap = new Map<string, Request[]>()
  const unassigned: Request[] = []

  for (const req of requests) {
    if (req.assigneeId) {
      const existing = assignmentMap.get(req.assigneeId) ?? []
      existing.push(req)
      assignmentMap.set(req.assigneeId, existing)
    } else {
      unassigned.push(req)
    }
  }

  const maxCount = Math.max(
    1,
    ...members.map(m => (assignmentMap.get(m.id) ?? []).length),
    unassigned.length
  )

  return (
    <div style={{ padding: '1rem' }}>
      <div
        className="bg-[var(--color-bg)] rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--color-border)' }}
      >
        {/* Table header */}
        <div
          className="grid text-xs font-semibold uppercase tracking-wide"
          style={{
            gridTemplateColumns: '1fr 5rem 1fr',
            padding: '0.625rem 1rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            color: 'var(--color-th-text)',
            background: 'var(--color-th-bg)',
          }}
        >
          <span>Team Member</span>
          <span style={{ textAlign: 'center' }}>Assigned</span>
          <span>Capacity</span>
        </div>

        {members.map((member, i) => {
          const assigned = assignmentMap.get(member.id) ?? []
          const pct = maxCount > 0 ? Math.round((assigned.length / maxCount) * 100) : 0
          const isLast = i === members.length - 1 && unassigned.length === 0

          return (
            <div
              key={member.id}
              className="grid items-center"
              style={{
                gridTemplateColumns: '1fr 5rem 1fr',
                padding: '0.75rem 1rem',
                borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
              }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="flex items-center justify-center rounded-full flex-shrink-0 font-semibold"
                  style={{
                    width: '2rem',
                    height: '2rem',
                    fontSize: '0.6875rem',
                    background: 'var(--color-brand)',
                    color: 'white',
                  }}
                >
                  {getInitials(member.name)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {member.name}
                  </p>
                  {member.role && (
                    <p className="text-xs truncate" style={{ color: 'var(--color-text-subtle)' }}>
                      {member.role}
                    </p>
                  )}
                </div>
              </div>
              <span
                className="text-sm font-semibold"
                style={{ textAlign: 'center', color: assigned.length > 0 ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
              >
                {assigned.length}
              </span>
              <div className="flex items-center gap-2">
                <div
                  style={{
                    flex: 1,
                    height: '0.5rem',
                    background: 'var(--color-bg-tertiary)',
                    borderRadius: '0.25rem',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: pct > 75 ? 'var(--color-warning)' : 'var(--color-brand)',
                      borderRadius: '0.25rem',
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}

        {/* Unassigned row */}
        {unassigned.length > 0 && (
          <div
            className="grid items-center"
            style={{
              gridTemplateColumns: '1fr 5rem 1fr',
              padding: '0.75rem 1rem',
              background: 'var(--color-bg-secondary)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="flex items-center justify-center rounded-full flex-shrink-0"
                style={{
                  width: '2rem',
                  height: '2rem',
                  background: 'var(--color-bg-tertiary)',
                  color: 'var(--color-text-subtle)',
                }}
              >
                <Inbox style={{ width: '0.875rem', height: '0.875rem' }} />
              </div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
                Unassigned
              </p>
            </div>
            <span
              className="text-sm font-semibold"
              style={{ textAlign: 'center', color: 'var(--color-warning)' }}
            >
              {unassigned.length}
            </span>
            <div className="flex items-center gap-2">
              <div
                style={{
                  flex: 1,
                  height: '0.5rem',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: '0.25rem',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round((unassigned.length / maxCount) * 100)}%`,
                    height: '100%',
                    background: 'var(--color-danger)',
                    borderRadius: '0.25rem',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {members.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center" style={{ padding: '3rem 1.5rem' }}>
            <Users style={{ width: '2rem', height: '2rem', color: 'var(--color-text-subtle)', marginBottom: '0.75rem' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>No team members</p>
            <p className="text-xs" style={{ color: 'var(--color-text-subtle)', marginTop: '0.25rem' }}>
              Add team members to see workload distribution.
            </p>
          </div>
        )}
      </div>
    </div>
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

// ─── Bulk Action Bar ─────────────────────────────────────────────────────────

function BulkActionBar({
  selectedCount,
  selectedIds,
  onClear,
  onDone,
}: {
  selectedCount: number
  selectedIds: Set<string>
  onClear: () => void
  onDone: () => void
}) {
  const [actionLoading, setActionLoading] = useState(false)
  const [statusDropdown, setStatusDropdown] = useState(false)

  const handleBulkStatus = async (status: string) => {
    setActionLoading(true)
    setStatusDropdown(false)
    try {
      const res = await fetch(apiPath('/api/admin/requests/bulk'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      })
      if (res.ok) onDone()
    } finally {
      setActionLoading(false)
    }
  }

  const handleBulkArchive = async () => {
    setActionLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/requests/bulk'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), archived: true }),
      })
      if (res.ok) onDone()
    } finally {
      setActionLoading(false)
    }
  }

  const statuses = ['submitted', 'in_review', 'in_progress', 'client_review', 'delivered', 'archived']

  return (
    <div
      className="flex items-center gap-3 flex-wrap"
      style={{
        padding: '0.5rem 1rem',
        background: 'var(--color-brand-50)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <span className="text-sm font-medium" style={{ color: 'var(--color-brand-dark)' }}>
        {selectedCount} selected
      </span>

      {/* Change Status dropdown */}
      <div className="relative">
        <button
          onClick={() => setStatusDropdown(!statusDropdown)}
          disabled={actionLoading}
          className="flex items-center gap-1 text-sm font-medium transition-colors"
          style={{
            padding: '0.25rem 0.625rem',
            borderRadius: '0.375rem',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            cursor: 'pointer',
            color: 'var(--color-text)',
          }}
        >
          {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Change Status
          <ChevronDown className="w-3 h-3" />
        </button>
        {statusDropdown && (
          <div
            className="absolute z-[70] mt-1"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              boxShadow: 'var(--shadow-md)',
              minWidth: '10rem',
            }}
          >
            {statuses.map(s => {
              const cfg = STATUS_CFG[s]
              return (
                <button
                  key={s}
                  onClick={() => handleBulkStatus(s)}
                  className="w-full text-left text-sm px-3 py-2 hover:bg-[var(--color-bg-secondary)] transition-colors"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
                >
                  {cfg?.label ?? s}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Archive button */}
      <button
        onClick={handleBulkArchive}
        disabled={actionLoading}
        className="flex items-center gap-1 text-sm font-medium transition-colors"
        style={{
          padding: '0.25rem 0.625rem',
          borderRadius: '0.375rem',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          cursor: 'pointer',
          color: 'var(--color-danger)',
        }}
      >
        Archive
      </button>

      <div className="flex-1" />

      <button
        onClick={onClear}
        className="text-sm font-medium transition-colors"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
      >
        Clear selection
      </button>
    </div>
  )
}

// ─── Bulk Create Dialog ──────────────────────────────────────────────────────

interface OrgOption {
  id: string
  name: string
  planType: string | null
}

function BulkCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [orgsLoading, setOrgsLoading] = useState(true)
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [type, setType] = useState('small_task')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [filterPlan, setFilterPlan] = useState('all')
  const [searchOrg, setSearchOrg] = useState('')

  useEffect(() => {
    fetch(apiPath('/api/admin/clients'))
      .then(r => r.json() as Promise<{ clients: OrgOption[] }>)
      .then(data => {
        setOrgs(data.clients ?? [])
      })
      .catch(() => setOrgs([]))
      .finally(() => setOrgsLoading(false))
  }, [])

  const filteredOrgs = orgs.filter(o => {
    if (filterPlan !== 'all' && o.planType !== filterPlan) return false
    if (searchOrg && !o.name.toLowerCase().includes(searchOrg.toLowerCase())) return false
    return true
  })

  const toggleOrg = (id: string) => {
    setSelectedOrgIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelectedOrgIds(prev => {
      const next = new Set(prev)
      for (const o of filteredOrgs) next.add(o.id)
      return next
    })
  }

  const handleCreate = async () => {
    if (!title.trim()) { setErrorMsg('Title is required'); return }
    if (selectedOrgIds.size === 0) { setErrorMsg('Select at least one client'); return }

    setCreating(true)
    setErrorMsg('')
    try {
      const res = await fetch(apiPath('/api/admin/requests/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgIds: Array.from(selectedOrgIds),
          title: title.trim(),
          category: category || undefined,
          type,
          description: description.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? 'Failed to create')
      }
      const result = await res.json() as { created: number }
      onCreated()
      setErrorMsg(`Created ${result.created} requests`)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create')
    } finally {
      setCreating(false)
    }
  }

  const plans = [...new Set(orgs.map(o => o.planType).filter(Boolean))]

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto"
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-card)',
          boxShadow: 'var(--shadow-lg)',
          padding: '1.5rem',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Bulk Create Requests</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label htmlFor="bulk-title" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Title (applied to all)
            </label>
            <input
              id="bulk-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Request title..."
              className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
          </div>

          {/* Category + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="bulk-category" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Category
              </label>
              <select
                id="bulk-category"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full text-sm text-[var(--color-text)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.75rem',
                }}
              >
                <option value="">None</option>
                <option value="design">Design</option>
                <option value="development">Development</option>
                <option value="content">Content</option>
                <option value="strategy">Strategy</option>
                <option value="admin">Admin</option>
                <option value="bug">Bug</option>
              </select>
            </div>
            <div>
              <label htmlFor="bulk-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Type
              </label>
              <select
                id="bulk-type"
                value={type}
                onChange={e => setType(e.target.value)}
                className="w-full text-sm text-[var(--color-text)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.75rem',
                }}
              >
                <option value="small_task">Small Task</option>
                <option value="large_task">Large Task</option>
                <option value="bug_fix">Bug Fix</option>
                <option value="content_update">Content Update</option>
                <option value="new_feature">New Feature</option>
                <option value="consultation">Consultation</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="bulk-desc" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Description (optional)
            </label>
            <textarea
              id="bulk-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Shared description..."
              rows={2}
              className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] resize-none"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
              }}
            />
          </div>

          {/* Client selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text)]">
                Clients ({selectedOrgIds.size} selected)
              </label>
              <button
                onClick={selectAllFiltered}
                className="text-xs font-medium"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-brand)' }}
              >
                Select all visible
              </button>
            </div>

            {/* Filters */}
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="Search clients..."
                value={searchOrg}
                onChange={e => setSearchOrg(e.target.value)}
                className="flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.375rem 0.625rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-secondary)',
                }}
              />
              <select
                value={filterPlan}
                onChange={e => setFilterPlan(e.target.value)}
                className="text-sm text-[var(--color-text)]"
                style={{
                  padding: '0.375rem 0.625rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                }}
              >
                <option value="all">All plans</option>
                {plans.map(p => (
                  <option key={p} value={p ?? ''}>{p}</option>
                ))}
              </select>
            </div>

            {/* Client list */}
            <div
              className="overflow-y-auto space-y-0.5"
              style={{
                maxHeight: '12rem',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-input)',
                padding: '0.25rem',
              }}
            >
              {orgsLoading ? (
                <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">Loading clients...</div>
              ) : filteredOrgs.length === 0 ? (
                <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">No clients found</div>
              ) : (
                filteredOrgs.map(o => (
                  <button
                    key={o.id}
                    onClick={() => toggleOrg(o.id)}
                    className="w-full flex items-center gap-2 text-left text-sm transition-colors rounded"
                    style={{
                      padding: '0.375rem 0.5rem',
                      background: selectedOrgIds.has(o.id) ? 'var(--color-brand-50)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text)',
                    }}
                  >
                    {selectedOrgIds.has(o.id)
                      ? <CheckSquare className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-brand)' }} />
                      : <Square className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} />}
                    <span className="truncate">{o.name}</span>
                    {o.planType && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-subtle)' }}
                      >
                        {o.planType}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {errorMsg && (
            <div aria-live="polite" className="text-sm" style={{ color: 'var(--color-danger)' }}>
              {errorMsg}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium transition-colors"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              minHeight: '2.75rem',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim() || selectedOrgIds.size === 0}
            className="px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{
              background: 'var(--color-brand)',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              cursor: creating ? 'not-allowed' : 'pointer',
              opacity: creating || !title.trim() || selectedOrgIds.size === 0 ? 0.6 : 1,
              minHeight: '2.75rem',
            }}
          >
            {creating ? 'Creating...' : `Create ${selectedOrgIds.size} Request${selectedOrgIds.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ isAdmin, onNew }: { isAdmin: boolean; onNew: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: '4rem 1.5rem', background: 'var(--color-bg)' }}
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

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Search, Filter, LayoutList, Columns3,
  AlertTriangle, ChevronDown, Inbox, RefreshCw,
  Calendar, Zap,
} from 'lucide-react'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Config — all hex, no dynamic Tailwind classes ────────────────────────────

const STATUS_CFG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  draft:         { label: 'Draft',         dot: '#9ca3af', bg: '#f3f4f6', text: '#4b5563', border: '#e5e7eb' },
  submitted:     { label: 'Submitted',     dot: '#60a5fa', bg: '#eff6ff', text: '#1d4ed8', border: '#dbeafe' },
  in_review:     { label: 'In Review',     dot: '#fbbf24', bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  in_progress:   { label: 'In Progress',   dot: '#22c55e', bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  client_review: { label: 'Client Review', dot: '#a78bfa', bg: '#f5f3ff', text: '#7c3aed', border: '#ede9fe' },
  delivered:     { label: 'Delivered',     dot: '#10b981', bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
  archived:      { label: 'Archived',      dot: '#d1d5db', bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' },
}

const CAT_CFG: Record<string, { bg: string; color: string }> = {
  design:      { bg: '#fce7f3', color: '#be185d' },
  development: { bg: '#dbeafe', color: '#1d4ed8' },
  content:     { bg: '#fef3c7', color: '#b45309' },
  strategy:    { bg: '#f3e8ff', color: '#7e22ce' },
  admin:       { bg: '#f3f4f6', color: '#4b5563' },
  bug:         { bg: '#fee2e2', color: '#dc2626' },
}

const BOARD_COLS = [
  { status: 'submitted',     topColor: '#60a5fa' },
  { status: 'in_review',     topColor: '#fbbf24' },
  { status: 'in_progress',   topColor: '#22c55e' },
  { status: 'client_review', topColor: '#a78bfa' },
  { status: 'delivered',     topColor: '#10b981' },
]

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

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return '-'
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
  } catch { return '-' }
}

function formatType(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.submitted
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ padding: '2px 8px', background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      <span
        className="rounded-full flex-shrink-0"
        style={{ width: 6, height: 6, background: c.dot, display: 'inline-block' }}
      />
      {c.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || priority === 'standard') {
    return <span className="text-xs" style={{ color: '#9ca3af' }}>-</span>
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full text-xs font-medium"
      style={{ padding: '2px 8px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fee2e2' }}
    >
      <Zap className="w-2.5 h-2.5" />
      High
    </span>
  )
}

function OrgAvatar({ name }: { name: string }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
      style={{ width: 22, height: 22, fontSize: 9, background: '#5A824E', color: 'white' }}
    >
      {getInitials(name)}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RequestList({ isAdmin }: { isAdmin: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const view = (searchParams.get('view') as ViewMode) ?? 'list'
  const activeTab = searchParams.get('tab') ?? 'active'
  const search = searchParams.get('q') ?? ''

  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  // Local search input state for debouncing
  const [searchInput, setSearchInput] = useState(search)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tabs = isAdmin ? ADMIN_TABS : CLIENT_TABS

  function setView(v: ViewMode) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', v)
    router.replace(`${pathname}?${params.toString()}`)
  }

  function setActiveTab(tab: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.replace(`${pathname}?${params.toString()}`)
  }

  function handleSearchChange(value: string) {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (value.trim()) {
        params.set('q', value.trim())
      } else {
        params.delete('q')
      }
      router.replace(`${pathname}?${params.toString()}`)
    }, 300)
  }

  // Sync searchInput if URL changes externally
  useEffect(() => {
    setSearchInput(search)
  }, [search])

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

      {/* Page header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 24 }}>
        <h1 className="text-2xl font-bold" style={{ color: '#111827' }}>Requests</h1>
        <button
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '8px 16px', background: '#5A824E', borderRadius: 6 }}
        >
          <Plus className="w-4 h-4" />
          Create Request
        </button>
      </div>

      {/* Main card */}
      <div
        className="overflow-hidden"
        style={{
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >

        {/* Toolbar */}
        <div
          className="flex items-center gap-2"
          style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', background: 'white' }}
        >
          {/* Search */}
          <div className="relative flex-shrink-0" style={{ width: '100%', maxWidth: 260 }}>
            <Search
              className="absolute top-1/2 pointer-events-none"
              style={{ left: 10, transform: 'translateY(-50%)', width: 14, height: 14, color: '#9ca3af' }}
            />
            <input
              type="text"
              placeholder="Search requests..."
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5A824E] focus-visible:ring-offset-1"
              style={{
                paddingTop: 7,
                paddingBottom: 7,
                paddingLeft: 32,
                paddingRight: 12,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: '#f9fafb',
                color: '#111827',
              }}
            />
          </div>

          {/* Filter */}
          <button
            className="flex items-center gap-1.5 text-sm font-medium flex-shrink-0 transition-colors"
            style={{
              padding: '10px 12px',
              minHeight: 44,
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              color: '#6b7280',
              background: 'white',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#5A824E'; e.currentTarget.style.color = '#374151' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#6b7280' }}
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            <ChevronDown className="w-3 h-3 opacity-50" />
          </button>

          <div className="flex-1" />

          {/* View toggle */}
          <div
            className="flex items-center overflow-hidden flex-shrink-0"
            style={{ border: '1px solid #e5e7eb', borderRadius: 8 }}
          >
            <button
              onClick={() => setView('list')}
              className="flex items-center justify-center transition-colors"
              style={{
                padding: 10,
                minWidth: 44,
                minHeight: 44,
                background: view === 'list' ? '#5A824E' : 'white',
                color: view === 'list' ? 'white' : '#6b7280',
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
                padding: 10,
                minWidth: 44,
                minHeight: 44,
                background: view === 'board' ? '#5A824E' : 'white',
                color: view === 'board' ? 'white' : '#6b7280',
                border: 'none',
                borderLeft: '1px solid #e5e7eb',
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
          style={{ borderBottom: '1px solid #e5e7eb', paddingLeft: 4, paddingRight: 16, background: 'white' }}
        >
          {tabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className="text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors"
              style={{
                padding: '12px 16px',
                minHeight: 44,
                border: 0,
                borderBottom: activeTab === tab.value ? '2px solid #5A824E' : '2px solid transparent',
                marginBottom: -1,
                color: activeTab === tab.value ? '#425F39' : '#6b7280',
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
              style={{ width: 14, height: 14, color: '#9ca3af', marginLeft: 8, marginBottom: 12 }}
            />
          )}
        </div>

        {/* Content area */}
        <div style={{ background: view === 'board' ? '#f9fafb' : 'white' }}>
          {loading ? (
            <LoadingSkeleton rows={5} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Inbox style={{ width: 28, height: 28, color: 'white' }} />}
              title="No requests found"
              description={isAdmin
                ? 'Requests will appear here once clients start submitting work.'
                : 'Submit your first request and the Tahi team will get started.'}
              ctaLabel={isAdmin ? undefined : 'Submit a request'}
              onCtaClick={isAdmin ? undefined : () => setDialogOpen(true)}
            />
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
  // Desktop: full columns. Mobile: title + status + updated only
  const colsMd = isAdmin
    ? '1fr 120px 140px 130px 80px 90px'
    : '1fr 140px 130px 80px 90px'
  const colsSm = '1fr 130px 90px'

  return (
    <div>
      {/* Table header — desktop */}
      <div
        className="hidden md:grid text-xs font-semibold uppercase tracking-wide"
        style={{
          gridTemplateColumns: colsMd,
          padding: '10px 16px',
          borderBottom: '1px solid #f3f4f6',
          color: '#9ca3af',
          background: '#f9fafb',
        }}
      >
        <span>Title</span>
        {isAdmin && <span>Client</span>}
        <span>Type</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Updated</span>
      </div>

      {/* Table header — mobile */}
      <div
        className="grid md:hidden text-xs font-semibold uppercase tracking-wide"
        style={{
          gridTemplateColumns: colsSm,
          padding: '10px 16px',
          borderBottom: '1px solid #f3f4f6',
          color: '#9ca3af',
          background: '#f9fafb',
        }}
      >
        <span>Title</span>
        <span>Status</span>
        <span>Updated</span>
      </div>

      {/* Rows */}
      <div>
        {requests.map((req, i) => (
          <ListRow
            key={req.id}
            req={req}
            isAdmin={isAdmin}
            colsMd={colsMd}
            colsSm={colsSm}
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
  colsMd,
  colsSm,
  isLast,
}: {
  req: Request
  isAdmin: boolean
  colsMd: string
  colsSm: string
  isLast: boolean
}) {
  const cat = CAT_CFG[req.category ?? ''] ?? { bg: '#f3f4f6', color: '#4b5563' }
  const rowBase = {
    padding: '12px 16px',
    borderBottom: isLast ? 'none' : '1px solid #f9fafb',
    textDecoration: 'none',
    background: 'white',
  }

  return (
    <>
      {/* Desktop row */}
      <Link
        href={`/requests/${req.id}`}
        className="hidden md:grid items-center"
        style={{ ...rowBase, gridTemplateColumns: colsMd }}
        onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'white' }}
      >
        <div className="flex items-center gap-2 min-w-0" style={{ paddingRight: 12 }}>
          {req.scopeFlagged && (
            <AlertTriangle style={{ width: 14, height: 14, color: '#f87171', flexShrink: 0 }} aria-label="Scope flagged" />
          )}
          <span className="text-sm font-medium truncate" style={{ color: '#111827' }}>{req.title}</span>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1.5 min-w-0" style={{ paddingRight: 12 }}>
            {req.orgName && <OrgAvatar name={req.orgName} />}
            <span className="text-sm truncate" style={{ color: '#6b7280', fontSize: 13 }}>{req.orgName ?? '-'}</span>
          </div>
        )}
        <div style={{ paddingRight: 12 }}>
          <span className="inline-flex items-center rounded text-xs font-medium" style={{ padding: '2px 8px', background: cat.bg, color: cat.color }}>
            {formatType(req.type)}
          </span>
        </div>
        <div style={{ paddingRight: 12 }}><StatusPill status={req.status} /></div>
        <div style={{ paddingRight: 12 }}><PriorityBadge priority={req.priority} /></div>
        <span className="text-xs" style={{ color: '#9ca3af' }}>{formatRelative(req.updatedAt ?? req.createdAt)}</span>
      </Link>

      {/* Mobile row — title, status, updated only */}
      <Link
        href={`/requests/${req.id}`}
        className="grid md:hidden items-center"
        style={{ ...rowBase, gridTemplateColumns: colsSm }}
        onMouseEnter={e => { e.currentTarget.style.background = '#fafafa' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'white' }}
      >
        <div className="flex items-center gap-2 min-w-0" style={{ paddingRight: 12 }}>
          {req.scopeFlagged && (
            <AlertTriangle style={{ width: 12, height: 12, color: '#f87171', flexShrink: 0 }} aria-label="Scope flagged" />
          )}
          <span className="text-sm font-medium truncate" style={{ color: '#111827' }}>{req.title}</span>
        </div>
        <div><StatusPill status={req.status} /></div>
        <span className="text-xs" style={{ color: '#9ca3af' }}>{formatRelative(req.updatedAt ?? req.createdAt)}</span>
      </Link>
    </>
  )
}

// ─── Board View ───────────────────────────────────────────────────────────────

function BoardView({ requests }: { requests: Request[] }) {
  const byStatus = (status: string) => requests.filter(r => r.status === status)

  return (
    <div
      className="flex gap-3 overflow-x-auto"
      style={{ padding: 16, paddingBottom: 20, background: '#f9fafb' }}
    >
      {BOARD_COLS.map(col => {
        const cards = byStatus(col.status)
        const cfg = STATUS_CFG[col.status]
        return (
          <div
            key={col.status}
            className="flex flex-col flex-shrink-0"
            style={{ minWidth: 272, width: 272 }}
          >
            {/* Column header */}
            <div
              className="flex items-center justify-between"
              style={{
                padding: '10px 12px',
                background: 'white',
                border: '1px solid #e5e7eb',
                borderBottom: 'none',
                borderRadius: '8px 8px 0 0',
                borderTop: `3px solid ${col.topColor}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="rounded-full flex-shrink-0"
                  style={{ width: 8, height: 8, background: cfg.dot, display: 'inline-block' }}
                />
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: '#6b7280' }}
                >
                  {cfg.label}
                </span>
              </div>
              <span
                className="text-xs font-semibold rounded-full"
                style={{ padding: '2px 7px', background: '#f3f4f6', color: '#9ca3af' }}
              >
                {cards.length}
              </span>
            </div>

            {/* Cards area */}
            <div
              className="flex flex-col gap-2 overflow-y-auto"
              style={{
                padding: 8,
                background: '#f3f4f6',
                border: '1px solid #e5e7eb',
                borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                minHeight: 160,
                maxHeight: '68vh',
              }}
            >
              {cards.length === 0 ? (
                <div
                  className="flex items-center justify-center rounded-lg text-xs"
                  style={{
                    padding: '28px 0',
                    color: '#9ca3af',
                    border: '1px dashed #d1d5db',
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
  const cat = CAT_CFG[req.category ?? ''] ?? { bg: '#f3f4f6', color: '#4b5563' }

  return (
    <Link
      href={`/requests/${req.id}`}
      className="block rounded-lg transition-all"
      style={{
        padding: 12,
        background: 'white',
        border: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        textDecoration: 'none',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#5A824E'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)' }}
    >
      {/* Type pill */}
      <div style={{ marginBottom: 8 }}>
        <span
          className="inline-flex items-center rounded text-xs font-medium"
          style={{ padding: '2px 7px', background: cat.bg, color: cat.color }}
        >
          {formatType(req.type)}
        </span>
      </div>

      {/* Title */}
      <div className="flex items-start gap-1.5" style={{ marginBottom: 10 }}>
        {req.scopeFlagged && (
          <AlertTriangle style={{ width: 12, height: 12, color: '#f87171', flexShrink: 0, marginTop: 2 }} />
        )}
        <p
          className="text-sm font-medium leading-snug line-clamp-2"
          style={{ color: '#111827' }}
        >
          {req.title}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {req.orgName && (
            <>
              <OrgAvatar name={req.orgName} />
              <span className="text-xs truncate" style={{ color: '#9ca3af', maxWidth: 90 }}>
                {req.orgName}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <PriorityBadge priority={req.priority} />
          <span className="text-xs flex items-center gap-1" style={{ color: '#9ca3af' }}>
            <Calendar style={{ width: 11, height: 11 }} />
            {formatRelative(req.updatedAt ?? req.createdAt)}
          </span>
        </div>
      </div>
    </Link>
  )
}

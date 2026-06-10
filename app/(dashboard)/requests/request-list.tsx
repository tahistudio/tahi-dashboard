'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, LayoutList, Columns3, BarChart3,
  AlertTriangle, ChevronDown, Inbox, RefreshCw,
  Calendar, Zap, Download,
  CheckSquare, Square, Users, Loader2, X, Sparkles,
} from 'lucide-react'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { AiRequestWizard } from '@/components/tahi/ai-request-wizard'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { ViewToggle } from '@/components/tahi/view-toggle'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge, statusTone, priorityTone } from '@/components/tahi/badge'
import { Avatar } from '@/components/tahi/avatar'
import { EmptyState as SharedEmptyState } from '@/components/tahi/empty-state'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import {
  BoardView,
  type BoardItem,
  type BoardColumn as BoardViewColumn,
  type BoardPriority,
  type BoardTag,
} from '@/components/tahi/board-view'

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
  orgId?: string | null
  orgName?: string | null
  assigneeId?: string | null
  updatedAt: string | null
  createdAt: string | null
  requestNumber?: number | null
  parentRequestId?: string | null
  // JSON array string of the owning org's free-form tags
  orgTags?: string | null
}

/** Parse an org's tags JSON column into a clean string[]. */
function parseOrgTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

type ViewMode = 'list' | 'board' | 'workload'
type SortKey = 'updatedAt' | 'dueDate' | 'priority' | 'status'

/** ISO from/to date range used by the FilterBar created-date chip. */
interface DateRange {
  from: string | null
  to: string | null
}

// ─── Config using CSS variables ────────────────────────────────────────────────
// Colors live in globals.css @theme; change once, updates everywhere.

import { REQUEST_STATUS_CONFIG as STATUS_CFG, CATEGORY_CONFIG as CAT_CFG } from '@/lib/status-config'

// Default board columns mapped to the shared BoardView column shape. Used as a
// fallback when no per-client custom kanban columns are configured.
const BOARD_COLS: BoardViewColumn[] = [
  { id: 'submitted',     label: 'Submitted',     statusValue: 'submitted',     color: 'var(--status-submitted-dot)'     },
  { id: 'in_review',     label: 'In Review',     statusValue: 'in_review',     color: 'var(--status-in-review-dot)'     },
  { id: 'in_progress',   label: 'In Progress',   statusValue: 'in_progress',   color: 'var(--status-in-progress-dot)'   },
  { id: 'client_review', label: 'Client Review', statusValue: 'client_review', color: 'var(--status-client-review-dot)' },
  { id: 'delivered',     label: 'Delivered',     statusValue: 'delivered',     color: 'var(--status-delivered-dot)'     },
]

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, standard: 2 }

// Status filter options that fold in the old Open/All/Unassigned/Completed tab
// strip. Admin and client see different subsets; the selected value maps 1:1
// to the existing activeTab state + fetch param.
const ADMIN_STATUS_OPTIONS = [
  { value: 'active',     label: 'Active'     },
  { value: 'all',        label: 'All'        },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'delivered',  label: 'Delivered'  },
]

const CLIENT_STATUS_OPTIONS = [
  { value: 'active',    label: 'Active'    },
  { value: 'delivered', label: 'Delivered' },
  { value: 'all',       label: 'All'       },
]

const CATEGORY_OPTIONS = [
  { value: 'design',      label: 'Design'      },
  { value: 'development', label: 'Development' },
  { value: 'strategy',    label: 'Strategy'    },
  { value: 'content',     label: 'Content'     },
  { value: 'marketing',   label: 'Marketing'   },
  { value: 'other',       label: 'Other'       },
]

const TYPE_OPTIONS = [
  { value: 'small_task', label: 'Small Task' },
  { value: 'large_task', label: 'Large Task' },
]

/** Map a request priority to the BoardView priority scale. The legacy
 *  "standard" priority maps to "medium"; low / high / urgent pass through. */
function toBoardPriority(priority: string | null): BoardPriority | undefined {
  switch (priority) {
    case 'urgent': return 'urgent'
    case 'high':   return 'high'
    case 'low':    return 'low'
    case 'standard': return 'medium'
    default: return undefined
  }
}

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

// Status values offered in the inline status-chip column + bulk actions. Maps
// each to a Badge tone for the DataTable ChipCell options.
const ALL_STATUSES = ['submitted', 'in_review', 'in_progress', 'client_review', 'on_hold', 'delivered', 'cancelled']

// Read-only status badge for the client (non-admin) status column.
function StatusBadgeCell({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.submitted
  return (
    <Badge tone={statusTone(status)} variant="soft" size="sm" leader="dot">
      {c.label}
    </Badge>
  )
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || priority === 'standard') {
    return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.75rem' }}>--</span>
  }
  const label = priority === 'urgent' ? 'Urgent' : 'High'
  return (
    <Badge
      tone={priorityTone(priority)}
      variant="soft"
      size="sm"
      leader="icon"
      icon={<Zap className="w-2.5 h-2.5" />}
    >
      {label}
    </Badge>
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


// ─── Main component ───────────────────────────────────────────────────────────

export function RequestList({ isAdmin: isAdminProp }: { isAdmin: boolean }) {
  const { isImpersonatingClient, isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  // Check if impersonated team member is a viewer
  const isViewerImpersonation = isImpersonatingTeamMember &&
    impersonatedAccessRules.length > 0 &&
    impersonatedAccessRules.every(r => r.role === 'viewer')
  const searchParams = useSearchParams()
  const router = useRouter()
  // Persisted per-user preferences (Decision #047).
  const [view, setView] = useUserPreference<ViewMode>(
    'requests.viewMode',
    'list',
    { validator: oneOf<ViewMode>(['list', 'board', 'workload']) },
  )
  // Persisted default ordering applied before the table / board renders.
  // The DataTable also exposes per-column header sorting on top of this.
  const [sortKey] = useUserPreference<SortKey>(
    'requests.sortKey',
    'updatedAt',
    { validator: oneOf<SortKey>(['updatedAt', 'dueDate', 'priority', 'status']) },
  )
  const [activeTab, setActiveTab] = useUserPreference(
    'requests.activeTab',
    'active',
    { validator: oneOf(['active', 'submitted', 'in_progress', 'in_review', 'client_review', 'delivered', 'on_hold', 'cancelled', 'all']) },
  )
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(() => searchParams.get('new') === '1')
  const defaultClientId = searchParams.get('client') ?? undefined
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false)
  const [aiWizardOpen, setAiWizardOpen] = useState(false)

  // Listen for keyboard shortcut events
  useEffect(() => {
    function handleShortcut(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail === 'new-request') setDialogOpen(true)
    }
    window.addEventListener('tahi:shortcut', handleShortcut)
    return () => window.removeEventListener('tahi:shortcut', handleShortcut)
  }, [])
  const [boardColumns, setBoardColumns] = useState<BoardViewColumn[]>(BOARD_COLS)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const statusOptions = isAdmin ? ADMIN_STATUS_OPTIONS : CLIENT_STATUS_OPTIONS

  // Fetch custom kanban columns (admin only). Mapped to the shared BoardView
  // column shape; falls back to BOARD_COLS when none are configured.
  useEffect(() => {
    if (!isAdmin) return
    fetch(apiPath('/api/admin/kanban-columns'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ columns: Array<{ statusValue: string; colour: string | null; label: string; position: number }> }>
      })
      .then(data => {
        if (data.columns && data.columns.length > 0) {
          const mapped: BoardViewColumn[] = data.columns
            .sort((a, b) => a.position - b.position)
            .map(c => ({
              id: c.statusValue,
              label: c.label,
              statusValue: c.statusValue,
              color: c.colour ?? `var(--status-${c.statusValue.replace(/_/g, '-')}-dot)`,
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

  const filtered = requests.filter(r => {
    // Text search
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!r.title.toLowerCase().includes(q) && !(r.orgName ?? '').toLowerCase().includes(q)) return false
    }
    // Date range filter (on createdAt). FilterBar gives ISO YYYY-MM-DD strings.
    if (dateRange.from && r.createdAt) {
      const d = r.createdAt.slice(0, 10)
      if (d < dateRange.from) return false
    }
    if (dateRange.to && r.createdAt) {
      const d = r.createdAt.slice(0, 10)
      if (d > dateRange.to) return false
    }
    // Category filter
    if (categoryFilter !== 'all' && (r.category ?? '') !== categoryFilter) return false
    // Type filter
    if (typeFilter !== 'all' && r.type !== typeFilter) return false
    // Client tag filter (matches against the owning org's tags)
    if (tagFilter !== 'all' && !parseOrgTags(r.orgTags).includes(tagFilter)) return false
    return true
  })

  // Union of all client tags present in the loaded set, for the filter dropdown.
  const availableTags = Array.from(
    new Set(requests.flatMap(r => parseOrgTags(r.orgTags))),
  ).sort((a, b) => a.localeCompare(b))

  const sorted = sortRequests(filtered, sortKey)

  // ── FilterBar wiring ──────────────────────────────────────────────────────
  // FilterBar drives the same individual filter state vars used by `filtered`.
  // Status + Category + Type chips are permanent (nonRemovable). The client-tag
  // and created-date chips appear when relevant.
  const filterDefs: FilterDef[] = useMemo(() => {
    const defs: FilterDef[] = [
      {
        id: 'status',
        label: 'Status',
        kind: 'select',
        nonRemovable: true,
        options: statusOptions,
      },
      {
        id: 'category',
        label: 'Category',
        kind: 'select',
        nonRemovable: true,
        options: [{ value: 'all', label: 'All' }, ...CATEGORY_OPTIONS],
      },
      {
        id: 'type',
        label: 'Type',
        kind: 'select',
        nonRemovable: true,
        options: [{ value: 'all', label: 'All' }, ...TYPE_OPTIONS],
      },
      {
        id: 'created',
        label: 'Created',
        kind: 'daterange',
        options: [],
      },
    ]
    if (availableTags.length > 0) {
      defs.splice(3, 0, {
        id: 'tag',
        label: 'Client tag',
        kind: 'select',
        options: [{ value: 'all', label: 'All' }, ...availableTags.map(t => ({ value: t, label: t }))],
      })
    }
    return defs
  }, [statusOptions, availableTags])

  const activeFilters: ActiveFilter[] = useMemo(() => {
    const list: ActiveFilter[] = [
      { id: 'status', value: activeTab },
      { id: 'category', value: categoryFilter },
      { id: 'type', value: typeFilter },
    ]
    if (availableTags.length > 0 && tagFilter !== 'all') {
      list.push({ id: 'tag', value: tagFilter })
    }
    if (dateRange.from || dateRange.to) {
      list.push({ id: 'created', from: dateRange.from, to: dateRange.to })
    }
    return list
  }, [activeTab, categoryFilter, typeFilter, tagFilter, dateRange, availableTags])

  const handleFiltersChange = useCallback((next: ActiveFilter[]) => {
    const byId = new Map(next.map(a => [a.id, a]))
    setActiveTab(byId.get('status')?.value ?? 'active')
    setCategoryFilter(byId.get('category')?.value ?? 'all')
    setTypeFilter(byId.get('type')?.value ?? 'all')
    setTagFilter(byId.get('tag')?.value ?? 'all')
    const created = byId.get('created')
    setDateRange({ from: created?.from ?? null, to: created?.to ?? null })
  }, [setActiveTab])

  // ── DataTable selection bridge ────────────────────────────────────────────
  // DataTable owns selection through selectedIds + onSelectionChange. We bridge
  // those to the existing bulk-selection Set state so the BulkActionBar keeps
  // working unchanged.
  const handleSelectionChange = useCallback((nextSel: Set<string>) => {
    setSelectedIds(nextSel)
  }, [])

  // ── Inline status change as a DataTable edit chip ─────────────────────────
  const handleRowStatusChange = useCallback((row: Request, next: string) => {
    handleStatusChange(row.id, next)
  }, [handleStatusChange])

  // ── Board: map requests → BoardItem (top-level + nested children) ─────────
  const boardItems: BoardItem[] = useMemo(() => {
    const childrenByParent = new Map<string, Request[]>()
    for (const r of sorted) {
      if (r.parentRequestId) {
        const list = childrenByParent.get(r.parentRequestId) ?? []
        list.push(r)
        childrenByParent.set(r.parentRequestId, list)
      }
    }
    const toItem = (r: Request): BoardItem => {
      const tags: BoardTag[] = []
      if (r.category) {
        const cat = CAT_CFG[r.category]
        tags.push({ id: `cat-${r.category}`, label: formatType(r.category), color: cat?.color })
      }
      for (const t of parseOrgTags(r.orgTags)) {
        tags.push({ id: `tag-${t}`, label: t })
      }
      const overdue = getDueDateState(r.dueDate, r.status) === 'overdue'
      return {
        id: r.id,
        status: r.status,
        title: r.requestNumber != null
          ? `#${String(r.requestNumber).padStart(3, '0')} ${r.title}`
          : r.title,
        priority: toBoardPriority(r.priority),
        tags: tags.length > 0 ? tags : undefined,
        dueDate: r.dueDate ?? undefined,
        startDate: r.startDate ?? undefined,
        isOverdue: overdue,
      }
    }
    return sorted
      .filter(r => !r.parentRequestId)
      .map(r => {
        const item = toItem(r)
        const kids = childrenByParent.get(r.id)
        if (kids && kids.length > 0) item.children = kids.map(toItem)
        return item
      })
  }, [sorted])

  // Drag source context for the cross-client guard. dataTransfer is empty during
  // dragover, so we mirror the dragged request's org into a ref via boardItems
  // lookup at move/nest time.
  const requestById = useMemo(() => {
    const m = new Map<string, Request>()
    for (const r of requests) m.set(r.id, r)
    return m
  }, [requests])

  const [nestPrompt, setNestPrompt] = useState<{
    sourceId: string
    sourceTitle: string
    targetId: string
    targetTitle: string
  } | null>(null)
  const [nestError, setNestError] = useState<string | null>(null)

  // Board move: status change, and un-nest-on-column-drop (moving a nested child
  // onto a column clears its parent, matching the legacy board).
  const handleBoardMove = useCallback(async (itemId: string, toStatus: string) => {
    if (!isAdmin) return
    const src = requestById.get(itemId)
    if (!src) return
    const fromStatus = src.status
    const wasChild = !!src.parentRequestId
    try {
      if (wasChild) {
        await fetch(apiPath(`/api/admin/requests/${itemId}/nest`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parentRequestId: null }),
        })
      }
      if (fromStatus !== toStatus) {
        await fetch(apiPath(`/api/admin/requests/${itemId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: toStatus }),
        })
      }
      if (wasChild || fromStatus !== toStatus) fetchRequests()
    } catch {
      // silent
    }
  }, [isAdmin, requestById, fetchRequests])

  // Board nest: dropping card A onto card B nests A under B. Cross-client drops
  // are refused before the confirm dialog opens (same guard the backend enforces).
  const handleBoardNest = useCallback((childId: string, parentId: string) => {
    if (!isAdmin || childId === parentId) return
    const source = requestById.get(childId)
    const target = requestById.get(parentId)
    if (!source || !target) return
    if ((source.orgId ?? null) !== (target.orgId ?? null)) return
    setNestError(null)
    setNestPrompt({
      sourceId: childId,
      sourceTitle: source.title,
      targetId: parentId,
      targetTitle: target.title,
    })
  }, [isAdmin, requestById])

  const confirmNest = useCallback(async () => {
    if (!nestPrompt) return
    setNestError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${nestPrompt.sourceId}/nest`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentRequestId: nestPrompt.targetId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        setNestError(j.error ?? 'Failed to nest request')
        return
      }
      setNestPrompt(null)
      fetchRequests()
    } catch {
      setNestError('Failed to nest request (network)')
    }
  }, [nestPrompt, fetchRequests])

  // ── DataTable columns ─────────────────────────────────────────────────────
  const columns = useMemo<DataTableColumn<Request>[]>(() => {
    const cols: DataTableColumn<Request>[] = [
      {
        key: 'title',
        header: 'Title',
        sortable: true,
        sortValue: r => r.title.toLowerCase(),
        minWidth: '18rem',
        render: r => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
            {r.scopeFlagged && (
              <AlertTriangle
                size={13}
                aria-label="Scope flagged"
                style={{ color: 'var(--color-danger)', flexShrink: 0 }}
              />
            )}
            {r.requestNumber != null && (
              <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }}>
                #{String(r.requestNumber).padStart(3, '0')}
              </span>
            )}
            <Link
              href={`/requests/${r.id}`}
              onClick={e => e.stopPropagation()}
              style={{
                fontWeight: 600,
                color: 'var(--color-text)',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
            >
              {r.title}
            </Link>
          </div>
        ),
      },
    ]

    if (isAdmin) {
      cols.push({
        key: 'client',
        header: 'Client',
        sortable: true,
        sortValue: r => (r.orgName ?? '').toLowerCase(),
        minWidth: '10rem',
        render: r => (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0 }}>
            {r.orgName && <Avatar name={r.orgName} size="xs" />}
            <span style={{
              fontSize: '0.8125rem',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {r.orgName ?? '--'}
            </span>
          </div>
        ),
      })
    }

    cols.push({
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      width: '11rem',
      // Admin gets an editable chip wired to the optimistic status PUT; clients
      // see a read-only status badge.
      ...(isAdmin
        ? {
            edit: {
              value: (r: Request) => r.status,
              options: ALL_STATUSES.map(s => ({
                value: s,
                label: STATUS_CFG[s]?.label ?? s,
                tone: statusTone(s),
              })),
              onChange: handleRowStatusChange,
            },
          }
        : {
            render: (r: Request) => <StatusBadgeCell status={r.status} />,
          }),
    })

    cols.push({
      key: 'priority',
      header: 'Priority',
      sortable: true,
      sortValue: r => PRIORITY_ORDER[r.priority ?? 'standard'] ?? 2,
      width: '7rem',
      render: r => <PriorityBadge priority={r.priority} />,
    })

    cols.push({
      key: 'dueDate',
      header: 'Due',
      sortable: true,
      sortValue: r => r.dueDate ?? '',
      width: '7rem',
      render: r => <DueDateChip dueDate={r.dueDate} status={r.status} />,
    })

    cols.push({
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      sortValue: r => r.updatedAt ?? '',
      width: '7rem',
      render: r => (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {formatDate(r.updatedAt ? r.updatedAt.slice(0, 10) : null)}
        </span>
      ),
    })

    return cols
  }, [isAdmin, handleRowStatusChange])

  return (
    <>
      <NewRequestDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); fetchRequests() }}
        isAdmin={isAdmin}
        defaultOrgId={defaultClientId}
      />

      <AiRequestWizard
        open={aiWizardOpen}
        onClose={() => setAiWizardOpen(false)}
        onRequestsCreated={() => { setAiWizardOpen(false); fetchRequests() }}
        context={isAdmin
          ? { orgId: defaultClientId, speaker: 'admin' }
          : { speaker: 'client' }}
        wizardEndpoint={isAdmin ? '/api/admin/ai/request-wizard' : '/api/portal/ai/request-wizard'}
        submitEndpoint={isAdmin ? '/api/admin/requests' : '/api/portal/requests'}
      />

      <div style={{ padding: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {/* Page header */}
        <PageHeader
          title="Requests"
          subtitle={loading
            ? 'Manage all work items and track progress'
            : `${filtered.length} ${filtered.length === 1 ? 'request' : 'requests'}`}
        >
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => {
              const link = document.createElement('a')
              link.href = apiPath('/api/admin/export/requests')
              link.download = 'requests.csv'
              link.click()
            }}
            iconLeft={<Download className="w-3.5 h-3.5" />}
            aria-label="Export CSV"
          >
            <span className="hidden sm:inline">Export CSV</span>
          </TahiButton>
          {isAdmin && (
            <TahiButton
              variant="secondary"
              size="sm"
              onClick={() => setBulkCreateOpen(true)}
              iconLeft={<Users className="w-3.5 h-3.5" />}
              className="hidden sm:inline-flex"
            >
              Bulk Create
            </TahiButton>
          )}
          {!isViewerImpersonation && (
            <TahiButton
              variant="secondary"
              size="sm"
              onClick={() => setAiWizardOpen(true)}
              iconLeft={<Sparkles className="w-3.5 h-3.5" />}
              title="Draft a request with AI"
              className="hidden sm:inline-flex"
            >
              AI draft
            </TahiButton>
          )}
          {!isViewerImpersonation && (
            <TahiButton
              variant="primary"
              size="sm"
              onClick={() => setDialogOpen(true)}
              iconLeft={<Plus className="w-3.5 h-3.5" />}
            >
              <span className="hidden sm:inline">New Request</span>
              <span className="sm:hidden">New</span>
            </TahiButton>
          )}
        </PageHeader>

        {/* Filter row + view toggle */}
        <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: '14rem' }}>
            <FilterBar
              filters={filterDefs}
              active={activeFilters}
              onChange={handleFiltersChange}
              search={{
                value: search,
                onChange: setSearch,
                placeholder: 'Search requests',
              }}
              size="sm"
            />
          </div>
          <div className="flex items-center" style={{ gap: '0.5rem' }}>
            {loading && (
              <RefreshCw
                className="animate-spin flex-shrink-0"
                aria-hidden="true"
                style={{ width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)' }}
              />
            )}
            <ViewToggle
              value={view}
              onChange={v => setView(v)}
              size="sm"
              options={
                isAdmin
                  ? [
                      { value: 'list',     icon: LayoutList, label: 'List view'     },
                      { value: 'board',    icon: Columns3,   label: 'Board view'    },
                      { value: 'workload', icon: BarChart3,  label: 'Workload view' },
                    ]
                  : [
                      { value: 'list',  icon: LayoutList, label: 'List view'  },
                      { value: 'board', icon: Columns3,   label: 'Board view' },
                    ]
              }
            />
          </div>
        </div>

        {/* Bulk action bar */}
        {isAdmin && selectedIds.size > 0 && (
          <Card padding="none" style={{ overflow: 'visible' }}>
            <BulkActionBar
              selectedCount={selectedIds.size}
              selectedIds={selectedIds}
              onClear={() => setSelectedIds(new Set())}
              onDone={() => { setSelectedIds(new Set()); fetchRequests() }}
            />
          </Card>
        )}

        {/* Content area */}
        {view === 'workload' && isAdmin ? (
          // WorkloadView keeps its own card surface, so it isn't re-wrapped.
          <WorkloadView requests={sorted} />
        ) : view === 'board' ? (
          <BoardView
            views={['kanban', 'timeline']}
            defaultView="kanban"
            columns={boardColumns}
            items={boardItems}
            searchPlaceholder="Search requests"
            onMove={isAdmin ? handleBoardMove : undefined}
            onNest={isAdmin ? handleBoardNest : undefined}
            onItemClick={(item) => { router.push(`/requests/${item.id}`) }}
            readOnly={!isAdmin}
          />
        ) : (
          <Card padding="none">
            <DataTable<Request>
              ariaLabel="Requests"
              columns={columns}
              rows={sorted}
              getRowId={r => r.id}
              loading={loading}
              selectable={isAdmin}
              selectedIds={isAdmin ? selectedIds : undefined}
              onSelectionChange={isAdmin ? handleSelectionChange : undefined}
              onRowClick={(r) => { router.push(`/requests/${r.id}`) }}
              empty={<EmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />}
            />
          </Card>
        )}
      </div>

      {/* Drag-to-nest confirm dialog (board view) */}
      {nestPrompt && (
        <ConfirmDialog
          open
          title="Make this a sub-request?"
          description={
            nestError
              ? `${nestError}`
              : `Make "${nestPrompt.sourceTitle}" a sub-request of "${nestPrompt.targetTitle}"? Only works when both belong to the same client.`
          }
          confirmLabel={nestError ? 'Try again' : 'Make sub-request'}
          variant="warning"
          onConfirm={confirmNest}
          onCancel={() => { setNestPrompt(null); setNestError(null) }}
        />
      )}

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
                      background: pct > 100 ? 'var(--color-danger)' : pct > 75 ? 'var(--color-warning)' : 'var(--color-brand)',
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
  const [assignDropdown, setAssignDropdown] = useState(false)
  const [assignRole, setAssignRole] = useState<'pm' | 'assignee' | 'follower'>('assignee')
  const [teamMembers, setTeamMembers] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    if (!assignDropdown || teamMembers.length > 0) return
    fetch(apiPath('/api/admin/team-members'))
      .then(r => r.json() as Promise<{ items: Array<{ id: string; name: string }> }>)
      .then(d => setTeamMembers(d.items ?? []))
      .catch(() => setTeamMembers([]))
  }, [assignDropdown, teamMembers.length])

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

  const handleBulkAssign = async (memberId: string) => {
    setActionLoading(true)
    setAssignDropdown(false)
    try {
      const res = await fetch(apiPath('/api/admin/requests/bulk-assign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestIds: Array.from(selectedIds),
          participants: [{ participantId: memberId, participantType: 'team_member', role: assignRole }],
        }),
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

      {/* Bulk assign people */}
      <div className="relative">
        <button
          onClick={() => setAssignDropdown(v => !v)}
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
          aria-label="Assign people to selected requests"
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          Assign
          <ChevronDown className="w-3 h-3" aria-hidden="true" />
        </button>
        {assignDropdown && (
          <div
            className="absolute z-[70] mt-1"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              boxShadow: 'var(--shadow-md)',
              minWidth: '14rem',
              padding: '0.5rem',
            }}
          >
            {/* Role tabs */}
            <div
              role="tablist"
              aria-label="Role"
              style={{
                display: 'flex',
                gap: '0.25rem',
                marginBottom: '0.5rem',
                padding: '0.25rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: '0.375rem',
              }}
            >
              {(['pm', 'assignee', 'follower'] as const).map(r => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={assignRole === r}
                  onClick={() => setAssignRole(r)}
                  style={{
                    flex: 1,
                    padding: '0.25rem 0.5rem',
                    fontSize: '0.6875rem',
                    fontWeight: 500,
                    borderRadius: '0.25rem',
                    background: assignRole === r ? 'var(--color-bg)' : 'transparent',
                    color: assignRole === r ? 'var(--color-brand)' : 'var(--color-text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                    boxShadow: assignRole === r ? 'var(--shadow-xs)' : 'none',
                  }}
                >
                  {r === 'pm' ? 'PM' : r}
                </button>
              ))}
            </div>
            {/* Team member list */}
            <div style={{ maxHeight: '16rem', overflowY: 'auto' }}>
              {teamMembers.length === 0 ? (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', padding: '0.5rem', margin: 0 }}>
                  Loading team members…
                </p>
              ) : (
                teamMembers.map(tm => (
                  <button
                    key={tm.id}
                    onClick={() => handleBulkAssign(tm.id)}
                    className="w-full text-left text-sm transition-colors"
                    style={{
                      padding: '0.375rem 0.5rem',
                      borderRadius: '0.25rem',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: 'var(--color-text)',
                      fontSize: '0.8125rem',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {tm.name}
                  </button>
                ))
              )}
            </div>
            <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', padding: '0.375rem 0.5rem 0', margin: 0 }}>
              Adds this person as <strong>{assignRole === 'pm' ? 'PM' : assignRole}</strong> on all {selectedCount} selected.
            </p>
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
    <SharedEmptyState
      icon={<Inbox className="w-7 h-7" />}
      title="No requests found"
      description={isAdmin
        ? 'Requests will appear here once clients start submitting work.'
        : 'Submit your first request and the Tahi team will get started.'}
      action={!isAdmin ? (
        <TahiButton size="md" onClick={onNew} iconLeft={<Plus className="w-4 h-4" />}>
          Submit a request
        </TahiButton>
      ) : undefined}
    />
  )
}

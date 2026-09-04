'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import {
  Plus, Search, Inbox, RefreshCw,
  Calendar, Zap, AlertTriangle, X, Loader2,
  CheckCircle2, Circle, Link2, Clock,
  ChevronRight, ChevronDown, Trash2, GitBranch, Users,
  Briefcase, Shield, Sparkles, Play,
  LayoutList, Columns3, CheckSquare, Square, ListChecks,
} from 'lucide-react'
import { notifyTimerChanged } from '@/lib/timer-events'
import { apiPath } from '@/lib/api'
import { getInitials } from '@/lib/utils'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { DateRangePicker, type DateRange } from '@/components/tahi/date-range-picker'
import { useToast } from '@/components/tahi/toast'
import { PageHeader } from '@/components/tahi/page-header'
import { ViewToggle } from '@/components/tahi/view-toggle'
import { Input, Select } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Avatar } from '@/components/tahi/avatar'
import { Callout } from '@/components/tahi/callout'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { KPIStrip, KPICell } from '@/components/tahi/kpi-strip'
import { useUserPreference, oneOf } from '@/lib/use-user-preference'
import { fetchSchedulePhaseOptions } from '@/lib/schedule-phases'
import { TASK_PRIORITIES, taskPriorityLabel } from '@/lib/task-priorities'
import {
  groupTasksByDue,
  TASK_BUCKET_ORDER,
  TASK_BUCKET_LABELS,
  type TaskBucketId,
} from '@/lib/task-buckets'

// Local YYYY-MM-DD for "today"; drives the My Work time buckets. Kept as a
// helper (not a top-level const) so it re-evaluates per render across midnight.
function todayYmd(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type ViewMode = 'my_work' | 'list' | 'board'

// AI wizard modal -- only opened on click, defer to reduce first-paint JS.
const AiTaskWizard = dynamic(
  () => import('@/components/tahi/ai-task-wizard').then(m => ({ default: m.AiTaskWizard })),
  { ssr: false }
)

// ── Types ────────────────────────────────────────────────────────────────────

interface Task {
  id: string
  type: string
  orgId: string | null
  title: string
  description: string | null
  status: string
  priority: string
  assigneeId: string | null
  assigneeType: string | null
  dueDate: string | null
  completedAt: string | null
  createdById: string | null
  tags: string | null
  trackId?: string | null
  requestId?: string | null
  scheduleRowId?: string | null
  position?: number | null
  createdAt: string | null
  updatedAt: string | null
  orgName: string | null
  assigneeName?: string | null
  subtaskCount?: number
  subtaskDone?: number
  blockedByCount?: number
}

interface Subtask {
  id: string
  taskId: string
  title: string
  completed: boolean
  createdAt: string
}

// Matches the GET /api/admin/tasks/[id]/dependencies `blockedBy` rows: the
// tasks that block this one, with the blocking task's title + status.
interface BlockedByDep {
  depId: string
  taskId: string
  taskTitle: string | null
  taskStatus: string | null
  createdAt: string
}

interface TaskTimeEntry {
  id: string
  hours: number
  billable: boolean | null
  notes: string | null
  date: string
  teamMemberName: string | null
}

interface TeamMember {
  id: string
  name: string
  email: string
  title: string | null
  role: string | null
  avatarUrl: string | null
}

interface OrgOption {
  id: string
  name: string
}

interface TaskTemplate {
  id: string
  name: string
  type: string
  category: string | null
  description: string | null
  defaultPriority: string
  subtasks: string
  estimatedHours: number | null
}

// ── Status config ────────────────────────────────────────────────────────────

// Kept for legacy code paths that still reference dot/bg/text/border
// inline (kanban column header dots, etc.). New chip rendering goes
// through <Badge tone={...}>.
const TASK_STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  todo:        { label: 'To Do',       dot: 'var(--status-submitted-dot)',    bg: 'var(--status-submitted-bg)',    text: 'var(--status-submitted-text)',    border: 'var(--status-submitted-border)'    },
  in_progress: { label: 'In Progress', dot: 'var(--status-in-progress-dot)', bg: 'var(--status-in-progress-bg)', text: 'var(--status-in-progress-text)', border: 'var(--status-in-progress-border)' },
  blocked:     { label: 'Blocked',     dot: 'var(--status-in-review-dot)',    bg: 'var(--status-in-review-bg)',    text: 'var(--status-in-review-text)',    border: 'var(--status-in-review-border)'    },
  done:        { label: 'Done',        dot: 'var(--status-delivered-dot)',    bg: 'var(--status-delivered-bg)',    text: 'var(--status-delivered-text)',    border: 'var(--status-delivered-border)'    },
}

// Badge tone mapping for the locked design system. Used by StatusPill.
const TASK_STATUS_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  todo:        { label: 'To Do',       tone: 'info'     },
  in_progress: { label: 'In Progress', tone: 'teal'     },
  blocked:     { label: 'Blocked',     tone: 'danger'   },
  done:        { label: 'Done',        tone: 'positive' },
}

// Decision #046 (2026-04-21): tasks are always Tahi-internal. Clients
// never see them. The only distinction is whether a task is for a client
// (orgId present) or for us (orgId null). We keep the legacy `type` column
// in the DB populated for backward compat but never show the distinction
// in the UI.
const TASK_TYPE_LABELS: Record<string, string> = {
  client_task: 'For a client',
  internal_client_task: 'For a client',
  tahi_internal: 'For us',
}

/** UI helper: is this task "for a client" or "for us"? */
export function taskBucket(task: { orgId: string | null; type?: string }): 'for_client' | 'for_us' {
  // orgId presence is the source of truth; legacy `type` is a fallback.
  if (task.orgId) return 'for_client'
  if (task.type === 'tahi_internal') return 'for_us'
  return 'for_us'
}

const TYPE_TABS = [
  { label: 'All tasks',    value: 'all',        icon: Briefcase },
  { label: 'For us',       value: 'for_us',     icon: Shield },
  { label: 'For a client', value: 'for_client', icon: Users },
]

const STATUS_TABS = [
  { label: 'All',         value: 'all'         },
  { label: 'To Do',       value: 'todo'        },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Blocked',     value: 'blocked'     },
  { label: 'Done',        value: 'done'        },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
  } catch { return '--' }
}

function getDueDateState(dueDate: string | null, status: string): 'overdue' | 'due-soon' | 'on-track' | null {
  if (!dueDate || status === 'done') return null
  const due = new Date(dueDate + 'T23:59:59')
  const now = new Date()
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 3) return 'due-soon'
  return 'on-track'
}

function formatType(type: string): string {
  return TASK_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const c = TASK_STATUS_TONE[status] ?? TASK_STATUS_TONE.todo
  return (
    <Badge tone={c.tone} variant="soft" size="sm" leader="dot">
      {c.label}
    </Badge>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'standard') {
    return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.75rem' }}>--</span>
  }
  if (priority === 'urgent') {
    return (
      <Badge tone="danger" variant="soft" size="sm" leader="icon" icon={<Zap />}>
        Urgent
      </Badge>
    )
  }
  return (
    <Badge tone="warning" variant="soft" size="sm" leader="icon" icon={<Zap />}>
      High
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

function OrgAvatar({ name }: { name: string }) {
  // Shared <Avatar> primitive. xs = 20px, matches the original 1.375rem
  // org dot. Tooltip suppressed because the org name already sits next
  // to the avatar in the row layouts that use it.
  return <Avatar name={name} size="xs" tooltip={false} />
}

function AssigneeAvatar({ name }: { name: string }) {
  // sm = 24px, matching the original 1.5rem assignee chip. Tooltip on
  // by default - Avatar handles it.
  return <Avatar name={name} size="sm" />
}

function SubtaskProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null
  const pct = Math.round((done / total) * 100)
  return (
    <div className="flex items-center gap-1.5" style={{ minWidth: '4rem' }}>
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: '0.25rem', background: 'var(--color-border-subtle)' }}
      >
        <div
          className="rounded-full"
          style={{
            width: `${pct}%`,
            height: '100%',
            background: pct === 100 ? 'var(--color-success)' : 'var(--color-brand)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap' }}>
        {done}/{total}
      </span>
    </div>
  )
}

function BlockedIndicator() {
  return (
    <span
      className="inline-flex items-center"
      title="This task has unresolved dependencies"
      style={{ color: 'var(--color-danger)', marginRight: '0.25rem' }}
    >
      <GitBranch style={{ width: '0.75rem', height: '0.75rem' }} />
    </span>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function TasksContent({ isAdmin }: { isAdmin: boolean }) {
  const { showToast } = useToast()
  // Persisted UI preferences \u2014 remembered per user, per surface.
  const [typeTab, setTypeTab] = useUserPreference(
    'tasks.typeTab',
    'all',
    { validator: oneOf(['all', 'for_us', 'for_client']) },
  )
  const [statusTab, setStatusTab] = useUserPreference(
    'tasks.statusTab',
    'all',
    { validator: oneOf(['all', 'todo', 'in_progress', 'blocked', 'done']) },
  )
  // Default lens is My Work (assigned-to-me, grouped by when it is due). All
  // tasks + Board remain one segment away.
  const [viewMode, setViewMode] = useUserPreference<ViewMode>(
    'tasks.viewMode',
    'my_work',
    { validator: oneOf<ViewMode>(['my_work', 'list', 'board']) },
  )
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [priorityFilter, setPriorityFilter] = useState('all')
  // Deep-linkable detail: /tasks?task=<id> opens the slide-over on load.
  const searchParams = useSearchParams()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    () => searchParams.get('task'),
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const isMyWork = viewMode === 'my_work'

  // Decision #046: always load every task, filter client-side. That way the
  // tab count next to "For us" or "For a client" always reflects the true
  // total regardless of which tab is currently selected. The status tab is the
  // only server-side filter, so it lives in the SWR key (each tab caches
  // separately; keepPreviousData avoids a spinner flash). mutateTasks()
  // replaces every old fetchTasks() refresh.
  // My Work fetches assignee=me (the server resolves it to the signed-in team
  // member). The other lenses keep the status tab as the only server filter.
  const tasksKey = isMyWork
    ? '/api/admin/tasks?assignee=me'
    : `/api/admin/tasks${statusTab !== 'all' ? `?status=${statusTab}` : ''}`
  const { data: tasksData, isLoading: loading, mutate: mutateTasks } = useSWR<{ tasks?: Task[] }>(tasksKey)
  const tasks = useMemo(() => tasksData?.tasks ?? [], [tasksData])

  // Team members (admin only) for assignee display.
  const { data: teamMembersData } = useSWR<{ items: TeamMember[] }>(
    isAdmin ? '/api/admin/team-members' : null,
  )
  const teamMembers = teamMembersData?.items ?? []

  // Clear selection when tabs change
  useEffect(() => { setSelectedIds(new Set()) }, [typeTab, statusTab])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const teamMap = new Map(teamMembers.map(m => [m.id, m]))

  const filtered = tasks.filter(t => {
    if (typeTab !== 'all' && taskBucket(t) !== typeTab) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!t.title.toLowerCase().includes(q) && !(t.orgName ?? '').toLowerCase().includes(q)) return false
    }
    if (dateRange.from && dateRange.to && t.dueDate) {
      const d = new Date(t.dueDate).getTime()
      if (d < dateRange.from.getTime() || d > dateRange.to.getTime()) return false
    }
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
    return true
  })

  // My Work: open tasks assigned to me, grouped by when they are due. The
  // bucketing is shared with the teammate Overview home via lib/task-buckets
  // so the two surfaces always agree.
  const myWorkOpen = useMemo(() => tasks.filter(t => t.status !== 'done'), [tasks])
  const myWorkGroups = useMemo(() => groupTasksByDue(myWorkOpen, todayYmd()), [myWorkOpen])
  const heroOverdue = myWorkGroups.overdue.length
  const heroToday = myWorkGroups.today.length
  const heroBlocked = myWorkOpen.filter(
    t => t.status === 'blocked' || (t.blockedByCount ?? 0) > 0,
  ).length

  // Tab counts \u2014 always computed from the full task list, NOT the active
  // tab's filtered view. This way "For a client" shows its true count even
  // when you're currently viewing "For us".
  const typeCounts: Record<string, number> = { all: tasks.length, for_us: 0, for_client: 0 }
  for (const t of tasks) {
    typeCounts[taskBucket(t)]++
  }

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === filtered.length) return new Set()
      return new Set(filtered.map(t => t.id))
    })
  }, [filtered])

  // The selected task usually lives in the loaded list, but a deep link
  // (/tasks?task=<id>) may point at a task the active lens filtered out, so
  // fall back to fetching the single task by id.
  const selectedInList = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) ?? null : null
  const { data: fetchedSelected } = useSWR<{ task?: Task }>(
    selectedTaskId && !selectedInList ? `/api/admin/tasks/${selectedTaskId}` : null,
  )
  const selectedTask = selectedInList ?? fetchedSelected?.task ?? null

  // Open / close the slide-over and keep the URL shareable without triggering
  // a Next navigation (history.replaceState leaves SWR caches untouched).
  const selectTask = useCallback((id: string | null) => {
    setSelectedTaskId(id)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('task', id)
    else url.searchParams.delete('task')
    window.history.replaceState(window.history.state, '', url.toString())
  }, [])

  // Optimistic board move: the card jumps columns immediately, then rolls back
  // and toasts if the PATCH fails (the previous version swallowed errors).
  const moveTaskStatus = useCallback(async (taskId: string, newStatus: string) => {
    try {
      await mutateTasks(
        async () => {
          const res = await fetch(apiPath(`/api/admin/tasks/${taskId}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          })
          if (!res.ok) throw new Error('Failed to move task')
          return undefined
        },
        {
          optimisticData: (cur?: { tasks?: Task[] }) => ({
            tasks: (cur?.tasks ?? []).map(t => (t.id === taskId ? { ...t, status: newStatus } : t)),
          }),
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      )
    } catch {
      showToast('Could not move the task. Try again.', 'error')
    }
  }, [mutateTasks, showToast])

  return (
    <>
      {dialogOpen && (
        <NewTaskDialog
          onClose={() => {
            setDialogOpen(false)
            mutateTasks()
          }}
        />
      )}

      {selectedTask && (
        <TaskDetailPanel
          key={selectedTask.id}
          task={selectedTask}
          isAdmin={isAdmin}
          teamMembers={teamMembers}
          onClose={() => selectTask(null)}
          onRefresh={() => { mutateTasks() }}
          onDeleted={() => { selectTask(null); mutateTasks() }}
        />
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <PageHeader
          title="Tasks"
          subtitle={
            loading
              ? (isAdmin ? 'All tasks: client-facing, internal, and Tahi Studio.' : 'Tasks assigned to you by the Tahi team.')
              : isMyWork
                ? `${myWorkOpen.length} ${myWorkOpen.length === 1 ? 'task' : 'tasks'} on your plate`
                : `${filtered.length} ${filtered.length === 1 ? 'task' : 'tasks'}`
          }
        >
          {isAdmin && (
            <>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => setWizardOpen(true)}
                iconLeft={<Sparkles className="w-3.5 h-3.5" />}
              >
                <span className="hidden sm:inline">AI Help</span>
                <span className="sm:hidden">AI</span>
              </TahiButton>
              <TahiButton
                variant="primary"
                size="sm"
                onClick={() => setDialogOpen(true)}
                iconLeft={<Plus className="w-4 h-4" />}
              >
                <span className="hidden sm:inline">Create Task</span>
                <span className="sm:hidden">New</span>
              </TahiButton>
            </>
          )}
        </PageHeader>
      </div>

      {/* Hero counts (My Work lens only): the one hero zone. */}
      {isMyWork && (
        <div style={{ marginBottom: '0.75rem' }}>
          <KPIStrip desktopCols={3}>
            <KPICell
              icon={AlertTriangle}
              label="Overdue"
              value={loading ? '--' : heroOverdue}
              tone={heroOverdue > 0 ? 'danger' : 'neutral'}
            />
            <KPICell
              icon={Calendar}
              label="Due today"
              value={loading ? '--' : heroToday}
              tone="brand"
            />
            <KPICell
              icon={GitBranch}
              label="Blocked"
              value={loading ? '--' : heroBlocked}
              tone={heroBlocked > 0 ? 'danger' : 'neutral'}
            />
          </KPIStrip>
        </div>
      )}

      {/* Type tabs (top-level filter). Hidden in My Work, which has no filter bar. */}
      {isAdmin && !isMyWork && (
        <div className="flex items-center gap-1 flex-wrap" style={{ marginBottom: '0.75rem' }}>
          {TYPE_TABS.map(tab => {
            const active = typeTab === tab.value
            const Icon = tab.icon
            const count = typeCounts[tab.value] ?? 0
            return (
              <button
                key={tab.value}
                onClick={() => setTypeTab(tab.value)}
                className="flex items-center gap-1.5 font-medium transition-colors"
                style={{
                  padding: '0.4375rem 0.75rem',
                  fontSize: '0.8125rem',
                  borderRadius: '0.5rem',
                  border: active ? '1px solid var(--color-brand)' : '1px solid transparent',
                  background: active ? 'var(--color-brand-50)' : 'transparent',
                  color: active ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--color-bg-tertiary)'
                    e.currentTarget.style.color = 'var(--color-text)'
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--color-text-muted)'
                  }
                }}
              >
                <Icon style={{ width: '0.875rem', height: '0.875rem' }} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span
                  className="rounded-full"
                  style={{
                    padding: '0 0.375rem',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    background: active ? 'var(--color-brand)' : 'var(--color-border-subtle)',
                    color: active ? 'white' : 'var(--color-text-subtle)',
                    lineHeight: '1.375rem',
                  }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

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
          {/* Search + filters: the All tasks / Board slicing surface. My Work
              is deliberately filter-free (it is your day, ordered by urgency). */}
          {!isMyWork && (
            <>
              <div style={{ width: '16rem', minWidth: '8rem', flexShrink: 1 }}>
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search tasks..."
                  leadingIcon={<Search size={14} aria-hidden="true" />}
                  style={{ width: '100%' }}
                />
              </div>

              <DateRangePicker value={dateRange} onChange={setDateRange} label="Due date" />
              <div className="hidden sm:block">
                <Select
                  value={priorityFilter}
                  onChange={e => setPriorityFilter(e.target.value)}
                  aria-label="Priority filter"
                  highlightActive
                  options={[
                    { value: 'all', label: 'All Priorities' },
                    ...TASK_PRIORITIES.map(p => ({ value: p, label: taskPriorityLabel(p) })),
                  ]}
                />
              </div>
            </>
          )}

          <div className="flex-1" />

          {/* View toggle: My Work / All tasks / Board */}
          <ViewToggle
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'my_work', icon: ListChecks, label: 'My Work'   },
              { value: 'list',    icon: LayoutList, label: 'All tasks' },
              { value: 'board',   icon: Columns3,   label: 'Board view' },
            ]}
          />
        </div>

        {/* Status tabs (hidden in My Work). */}
        {!isMyWork && (
        <div
          className="flex items-end overflow-x-auto overflow-y-hidden scrollbar-hide"
          style={{ borderBottom: '1px solid var(--color-border)', paddingLeft: '0.25rem', paddingRight: '1rem', background: 'var(--color-bg)', WebkitOverflowScrolling: 'touch' }}
        >
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusTab(tab.value)}
              className="font-medium whitespace-nowrap flex-shrink-0 transition-colors"
              style={{
                padding: '0.625rem 1rem',
                fontSize: '0.875rem',
                border: 0,
                borderBottom: statusTab === tab.value ? '2px solid var(--color-brand)' : '2px solid transparent',
                marginBottom: '-1px',
                color: statusTab === tab.value ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
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
        )}

        {/* Bulk action bar */}
        {isAdmin && !isMyWork && selectedIds.size > 0 && (
          <TaskBulkActionBar
            selectedCount={selectedIds.size}
            selectedIds={selectedIds}
            teamMembers={teamMembers}
            onClear={() => setSelectedIds(new Set())}
            onDone={() => { setSelectedIds(new Set()); mutateTasks() }}
          />
        )}

        {/* Content area */}
        <div style={{ background: viewMode === 'board' ? 'var(--color-bg-secondary)' : 'var(--color-bg)' }}>
          {loading ? (
            <LoadingSkeleton />
          ) : isMyWork ? (
            myWorkOpen.length === 0 ? (
              <MyWorkEmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />
            ) : (
              <MyWorkView groups={myWorkGroups} teamMap={teamMap} onSelect={selectTask} />
            )
          ) : filtered.length === 0 ? (
            <EmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />
          ) : viewMode === 'board' ? (
            <TaskBoardView tasks={filtered} isAdmin={isAdmin} teamMap={teamMap} onSelect={selectTask} onMove={moveTaskStatus} />
          ) : (
            <TaskListView
              tasks={filtered}
              isAdmin={isAdmin}
              teamMap={teamMap}
              onSelect={selectTask}
              selectedIds={selectedIds}
              onToggleSelect={isAdmin ? toggleSelect : undefined}
              onToggleAll={isAdmin ? toggleSelectAll : undefined}
            />
          )}
        </div>
      </div>

      {/* AI Task Wizard */}
      <AiTaskWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onTasksCreated={() => { mutateTasks() }}
      />
    </>
  )
}

// ── Task List View ───────────────────────────────────────────────────────────

function TaskListView({ tasks, isAdmin, teamMap, onSelect, selectedIds, onToggleSelect, onToggleAll }: {
  tasks: Task[]
  isAdmin: boolean
  teamMap: Map<string, TeamMember>
  onSelect: (id: string) => void
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onToggleAll?: () => void
}) {
  const showCheckboxes = isAdmin && onToggleSelect
  const allSelected = showCheckboxes && selectedIds && selectedIds.size === tasks.length && tasks.length > 0

  return (
    <div>
      {/* Table header */}
      <div
        className="hidden md:grid text-xs font-semibold uppercase tracking-wide items-center"
        style={{
          gridTemplateColumns: showCheckboxes
            ? (isAdmin ? '2rem 1fr 8rem 7rem 7rem 5.5rem 5.5rem 6rem' : '2rem 1fr 7rem 7rem 5.5rem 5.5rem')
            : (isAdmin ? '1fr 8rem 7rem 7rem 5.5rem 5.5rem 6rem' : '1fr 7rem 7rem 5.5rem 5.5rem'),
          padding: '0.625rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
          color: 'var(--color-th-text)',
          background: 'var(--color-th-bg)',
        }}
      >
        {showCheckboxes && (
          <button
            onClick={onToggleAll}
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
        <span>Priority</span>
        {isAdmin && <span>Assignee</span>}
      </div>

      {/* Rows */}
      <div>
        {tasks.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            isAdmin={isAdmin}
            isLast={i === tasks.length - 1}
            teamMap={teamMap}
            onSelect={onSelect}
            isSelected={selectedIds?.has(task.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task, isAdmin, isLast, teamMap, onSelect, isSelected, onToggleSelect }: {
  task: Task
  isAdmin: boolean
  isLast: boolean
  teamMap: Map<string, TeamMember>
  onSelect: (id: string) => void
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const assignee = task.assigneeId ? teamMap.get(task.assigneeId) : null
  const hasSubtasks = (task.subtaskCount ?? 0) > 0
  const isBlocked = (task.blockedByCount ?? 0) > 0
  const showCheckbox = isAdmin && onToggleSelect

  return (
    <div
      style={{ textDecoration: 'none', display: 'block', cursor: 'pointer' }}
      onClick={() => onSelect(task.id)}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-row-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? 'var(--color-brand-50)' : 'var(--color-bg)' }}
    >
      {/* Mobile layout */}
      <div
        className="flex flex-col gap-2 md:hidden"
        style={{
          padding: '0.875rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0">
            {isBlocked && <BlockedIndicator />}
            <span data-private className="font-medium truncate" style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>{task.title}</span>
          </div>
          <StatusPill status={task.status} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && task.orgName && (
            <div className="flex items-center gap-1">
              <OrgAvatar name={task.orgName} />
              <span data-private style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{task.orgName}</span>
            </div>
          )}
          <span
            className="inline-flex items-center rounded"
            style={{ padding: '0.125rem 0.5rem', fontSize: '0.6875rem', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
          >
            {formatType(task.type)}
          </span>
          <PriorityBadge priority={task.priority} />
          {task.dueDate && <DueDateChip dueDate={task.dueDate} status={task.status} />}
          {hasSubtasks && <SubtaskProgress done={task.subtaskDone ?? 0} total={task.subtaskCount ?? 0} />}
          {assignee && (
            <div className="flex items-center gap-1">
              <AssigneeAvatar name={assignee.name} />
              <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{assignee.name.split(' ')[0]}</span>
            </div>
          )}
        </div>
      </div>

      {/* Desktop layout */}
      <div
        className="hidden md:grid items-center"
        style={{
          gridTemplateColumns: showCheckbox
            ? (isAdmin ? '2rem 1fr 8rem 7rem 7rem 5.5rem 5.5rem 6rem' : '2rem 1fr 7rem 7rem 5.5rem 5.5rem')
            : (isAdmin ? '1fr 8rem 7rem 7rem 5.5rem 5.5rem 6rem' : '1fr 7rem 7rem 5.5rem 5.5rem'),
          padding: '0.75rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
          background: isSelected ? 'var(--color-brand-50)' : 'inherit',
        }}
      >
        {/* Checkbox */}
        {showCheckbox && (
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); onToggleSelect(task.id) }}
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
        <div className="flex items-center gap-1.5 min-w-0">
          {isBlocked && <BlockedIndicator />}
          <span data-private className="font-medium truncate" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{task.title}</span>
          {hasSubtasks && (
            <SubtaskProgress done={task.subtaskDone ?? 0} total={task.subtaskCount ?? 0} />
          )}
          <ChevronRight style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
        </div>

        {/* Client */}
        {isAdmin && (
          <div className="flex items-center gap-1.5 min-w-0">
            {task.orgName ? (
              <>
                <OrgAvatar name={task.orgName} />
                <span data-private className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{task.orgName}</span>
              </>
            ) : (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>--</span>
            )}
          </div>
        )}

        {/* Type */}
        <span
          className="inline-flex items-center rounded w-fit"
          style={{ padding: '0.125rem 0.5rem', fontSize: '0.6875rem', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
        >
          {formatType(task.type)}
        </span>

        {/* Status */}
        <StatusPill status={task.status} />

        {/* Due */}
        <DueDateChip dueDate={task.dueDate} status={task.status} />

        {/* Priority */}
        <PriorityBadge priority={task.priority} />

        {/* Assignee */}
        {isAdmin && (
          <div className="flex items-center gap-1 min-w-0">
            {assignee ? (
              <>
                <AssigneeAvatar name={assignee.name} />
                <span className="truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{assignee.name.split(' ')[0]}</span>
              </>
            ) : (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>--</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Board View ──────────────────────────────────────────────────────────────

const BOARD_COLUMNS = [
  { status: 'todo',        label: 'To Do',       topColor: 'var(--status-submitted-dot)' },
  { status: 'in_progress', label: 'In Progress', topColor: 'var(--status-in-progress-dot)' },
  { status: 'blocked',     label: 'Blocked',     topColor: 'var(--color-danger)' },
  { status: 'done',        label: 'Done',        topColor: 'var(--status-delivered-dot)' },
]

function TaskBoardView({ tasks, isAdmin, teamMap, onSelect, onMove }: {
  tasks: Task[]
  isAdmin: boolean
  teamMap: Map<string, TeamMember>
  onSelect: (id: string) => void
  onMove: (taskId: string, newStatus: string) => void | Promise<void>
}) {
  const byStatus = (status: string) => tasks.filter(t => t.status === status)

  const handleDrop = (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.style.borderColor = 'var(--color-border)'
    const taskId = e.dataTransfer.getData('taskId')
    const fromStatus = e.dataTransfer.getData('fromStatus')
    if (!taskId || fromStatus === newStatus) return
    if (!isAdmin) return
    // Optimistic move + toast-on-failure lives in the parent (moveTaskStatus).
    void onMove(taskId, newStatus)
  }

  return (
    <div
      className="flex gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide"
      style={{ padding: '1rem', paddingBottom: '1.25rem', background: 'var(--color-bg-secondary)', WebkitOverflowScrolling: 'touch', height: 'calc(100vh - 14rem)' }}
    >
      {BOARD_COLUMNS.map(col => {
        const cards = byStatus(col.status)
        const cfg = TASK_STATUS_CONFIG[col.status] ?? TASK_STATUS_CONFIG.todo
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
                e.currentTarget.style.borderColor = 'var(--color-brand)'
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
                  No tasks
                </div>
              ) : (
                cards.map(task => <TaskKanbanCard key={task.id} task={task} teamMap={teamMap} onSelect={onSelect} />)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskKanbanCard({ task, teamMap, onSelect }: { task: Task; teamMap: Map<string, TeamMember>; onSelect: (id: string) => void }) {
  const assignee = task.assigneeId ? teamMap.get(task.assigneeId) : null
  const hasSubtasks = (task.subtaskCount ?? 0) > 0
  const dueDateState = getDueDateState(task.dueDate, task.status)

  // A button (not a Link): opens the canonical slide-over via onSelect. This
  // also removes the desktop drag-then-navigate collision the old <Link> had.
  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      className="block w-full text-left rounded-lg transition-all"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('taskId', task.id)
        e.dataTransfer.setData('fromStatus', task.status)
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
      {/* Type badge */}
      <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
        <span
          className="inline-flex items-center rounded"
          style={{ padding: '0.125rem 0.4375rem', fontSize: '0.6875rem', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
        >
          {formatType(task.type)}
        </span>
        {(task.blockedByCount ?? 0) > 0 && (
          <GitBranch style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-danger)', flexShrink: 0 }} />
        )}
      </div>

      {/* Title */}
      <p
        data-private
        className="font-medium leading-snug line-clamp-2"
        style={{ fontSize: '0.875rem', color: 'var(--color-text)', marginBottom: '0.625rem' }}
      >
        {task.title}
      </p>

      {/* Due date */}
      {task.dueDate && (
        <div className="flex items-center gap-1" style={{ marginBottom: '0.5rem' }}>
          {dueDateState === 'overdue' && <AlertTriangle style={{ width: '0.625rem', height: '0.625rem', color: 'var(--color-overdue-text)' }} />}
          <Calendar style={{ width: '0.625rem', height: '0.625rem', color: dueDateState === 'overdue' ? 'var(--color-overdue-text)' : dueDateState === 'due-soon' ? 'var(--color-due-soon-text)' : 'var(--color-text-muted)' }} />
          <span style={{
            fontSize: '0.75rem',
            color: dueDateState === 'overdue' ? 'var(--color-overdue-text)' : dueDateState === 'due-soon' ? 'var(--color-due-soon-text)' : 'var(--color-text-muted)',
          }}>
            {formatDate(task.dueDate)}
          </span>
        </div>
      )}

      {/* Subtask progress */}
      {hasSubtasks && (
        <div className="flex items-center gap-1.5" style={{ marginBottom: '0.5rem' }}>
          <div
            className="flex-1 rounded-full overflow-hidden"
            style={{ height: '0.25rem', background: 'var(--color-border-subtle)' }}
          >
            <div
              className="rounded-full"
              style={{
                width: `${(task.subtaskCount ?? 0) > 0 ? Math.round(((task.subtaskDone ?? 0) / (task.subtaskCount ?? 1)) * 100) : 0}%`,
                height: '100%',
                background: (task.subtaskDone ?? 0) === (task.subtaskCount ?? 0) ? 'var(--color-success)' : 'var(--color-brand)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap' }}>
            {task.subtaskDone ?? 0}/{task.subtaskCount ?? 0}
          </span>
        </div>
      )}

      {/* Footer: org + assignee + priority */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {task.orgName && (
            <>
              <OrgAvatar name={task.orgName} />
              <span data-private className="truncate" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', maxWidth: '5.625rem' }}>
                {task.orgName}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <PriorityBadge priority={task.priority} />
          {assignee && (
            <div
              className="flex items-center justify-center font-semibold flex-shrink-0"
              style={{
                width: '1.5rem',
                height: '1.5rem',
                fontSize: '0.5625rem',
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand-dark)',
                borderRadius: 'var(--radius-leaf-sm)',
                border: '1px solid var(--color-brand-100)',
              }}
              title={assignee.name}
            >
              {getInitials(assignee.name)}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

// ── Task Bulk Action Bar ─────────────────────────────────────────────────────

function TaskBulkActionBar({
  selectedCount,
  selectedIds,
  teamMembers,
  onClear,
  onDone,
}: {
  selectedCount: number
  selectedIds: Set<string>
  teamMembers: TeamMember[]
  onClear: () => void
  onDone: () => void
}) {
  const [actionLoading, setActionLoading] = useState(false)
  const [statusDropdown, setStatusDropdown] = useState(false)
  const [priorityDropdown, setPriorityDropdown] = useState(false)
  const [assignDropdown, setAssignDropdown] = useState(false)
  const { showToast } = useToast()

  const handleBulkUpdate = async (updates: { status?: string; priority?: string; assigneeId?: string | null }) => {
    setActionLoading(true)
    setStatusDropdown(false)
    setPriorityDropdown(false)
    setAssignDropdown(false)
    try {
      const res = await fetch(apiPath('/api/admin/tasks/bulk'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: Array.from(selectedIds), updates }),
      })
      if (res.ok) {
        showToast(`Updated ${selectedCount} task${selectedCount !== 1 ? 's' : ''}`, 'success')
        onDone()
      }
    } catch {
      showToast('Failed to update tasks', 'error')
    } finally {
      setActionLoading(false)
    }
  }

  const statuses = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'done', label: 'Done' },
  ]

  const priorities = [
    { value: 'standard', label: 'Standard' },
    { value: 'high', label: 'High' },
    { value: 'urgent', label: 'Urgent' },
  ]

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
          onClick={() => { setStatusDropdown(!statusDropdown); setPriorityDropdown(false); setAssignDropdown(false) }}
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
            {statuses.map(s => (
              <button
                key={s.value}
                onClick={() => handleBulkUpdate({ status: s.value })}
                className="w-full text-left text-sm px-3 py-2 transition-colors"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Change Priority dropdown */}
      <div className="relative">
        <button
          onClick={() => { setPriorityDropdown(!priorityDropdown); setStatusDropdown(false); setAssignDropdown(false) }}
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
          Change Priority
          <ChevronDown className="w-3 h-3" />
        </button>
        {priorityDropdown && (
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
            {priorities.map(p => (
              <button
                key={p.value}
                onClick={() => handleBulkUpdate({ priority: p.value })}
                className="w-full text-left text-sm px-3 py-2 transition-colors"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Assign dropdown */}
      <div className="relative">
        <button
          onClick={() => { setAssignDropdown(!assignDropdown); setStatusDropdown(false); setPriorityDropdown(false) }}
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
          Assign
          <ChevronDown className="w-3 h-3" />
        </button>
        {assignDropdown && (
          <div
            className="absolute z-[70] mt-1"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              boxShadow: 'var(--shadow-md)',
              minWidth: '12rem',
              maxHeight: '15rem',
              overflowY: 'auto',
            }}
          >
            <button
              onClick={() => handleBulkUpdate({ assigneeId: null })}
              className="w-full text-left text-sm px-3 py-2 transition-colors"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontStyle: 'italic' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
            >
              Unassign
            </button>
            {teamMembers.map(m => (
              <button
                key={m.id}
                onClick={() => handleBulkUpdate({ assigneeId: m.id })}
                className="w-full text-left text-sm px-3 py-2 transition-colors flex items-center gap-2"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                <AssigneeAvatar name={m.name} />
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>

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

// ── Loading skeleton ─────────────────────────────────────────────────────────

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

// ── Empty state ──────────────────────────────────────────────────────────────

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
        No tasks found
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '20rem', marginBottom: '1.25rem' }}>
        {isAdmin
          ? 'Create your first task to start managing work across clients and your team.'
          : 'Tasks will appear here once the Tahi team assigns work to you.'}
      </p>
      {isAdmin && (
        <button
          onClick={onNew}
          className="flex items-center gap-2 font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', background: 'var(--color-brand)', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}
        >
          <Plus className="w-4 h-4" />
          Create a task
        </button>
      )}
    </div>
  )
}

// ── My Work View ─────────────────────────────────────────────────────────────

function MyWorkView({ groups, teamMap, onSelect }: {
  groups: Record<TaskBucketId, Task[]>
  teamMap: Map<string, TeamMember>
  onSelect: (id: string) => void
}) {
  return (
    <div>
      {TASK_BUCKET_ORDER.map(bucketId => {
        const items = groups[bucketId]
        if (items.length === 0) return null
        // Only the Overdue header is ever tinted, and only when it has rows.
        const isOverdue = bucketId === 'overdue'
        return (
          <div key={bucketId}>
            <div
              className="flex items-center gap-2"
              style={{
                padding: '0.875rem 1rem 0.5rem',
                fontSize: '0.6875rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              <span style={{ color: isOverdue ? 'var(--color-danger)' : 'var(--color-text-subtle)' }}>
                {TASK_BUCKET_LABELS[bucketId]}
              </span>
              <span className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {items.length}
              </span>
            </div>
            {items.map((task, i) => (
              <MyWorkRow
                key={task.id}
                task={task}
                teamMap={teamMap}
                onSelect={onSelect}
                isLast={i === items.length - 1}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function MyWorkRow({ task, teamMap, onSelect, isLast }: {
  task: Task
  teamMap: Map<string, TeamMember>
  onSelect: (id: string) => void
  isLast: boolean
}) {
  const assignee = task.assigneeId ? teamMap.get(task.assigneeId) : null
  const hasSubtasks = (task.subtaskCount ?? 0) > 0
  const blockedCount = task.blockedByCount ?? 0

  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      className="flex items-center gap-3 w-full text-left"
      style={{
        padding: '0.75rem 1rem',
        minHeight: '3.25rem',
        background: 'transparent',
        border: 'none',
        borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-row-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <div className="flex items-center gap-2 min-w-0" style={{ flex: 1 }}>
        <span data-private className="font-medium truncate" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>
          {task.title}
        </span>
        {hasSubtasks && (
          <SubtaskProgress done={task.subtaskDone ?? 0} total={task.subtaskCount ?? 0} />
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {task.orgName && (
          <span
            className="hidden sm:inline-flex items-center rounded truncate"
            data-private
            style={{ padding: '0.125rem 0.5rem', fontSize: '0.6875rem', fontWeight: 600, background: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', maxWidth: '9rem' }}
          >
            For {task.orgName}
          </span>
        )}
        <DueDateChip dueDate={task.dueDate} status={task.status} />
        {blockedCount > 0 && (
          <span
            className="inline-flex items-center gap-1"
            style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-danger)' }}
          >
            <GitBranch style={{ width: '0.75rem', height: '0.75rem' }} />
            <span className="hidden sm:inline">Blocked by {blockedCount}</span>
          </span>
        )}
        {assignee && <AssigneeAvatar name={assignee.name} />}
      </div>
    </button>
  )
}

function MyWorkEmptyState({ isAdmin, onNew }: { isAdmin: boolean; onNew: () => void }) {
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
        <CheckCircle2 style={{ width: '1.75rem', height: '1.75rem', color: 'white' }} />
      </div>
      <h3 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)', marginBottom: '0.5rem' }}>
        You are all caught up.
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '20rem', marginBottom: '1.25rem' }}>
        Nothing assigned to you is open right now. Add a task or check the studio board.
      </p>
      {isAdmin && (
        <button
          onClick={onNew}
          className="flex items-center gap-2 font-semibold text-white transition-opacity hover:opacity-90"
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', background: 'var(--color-brand)', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}
        >
          <Plus className="w-4 h-4" />
          New task
        </button>
      )}
    </div>
  )
}

// ── Task Detail Panel (slide-over) ──────────────────────────────────────────

function TaskDetailPanel({ task, isAdmin, teamMembers, onClose, onRefresh, onDeleted }: {
  task: Task
  isAdmin: boolean
  teamMembers: TeamMember[]
  onClose: () => void
  onRefresh: () => void
  onDeleted: () => void
}) {
  const { showToast } = useToast()
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [editingStatus, setEditingStatus] = useState(task.status)
  // Editable field mirrors, seeded from the task. The panel is keyed by task id
  // in the parent, so these reset when a different task opens.
  const [priority, setPriority] = useState(task.priority)
  const [dueDate, setDueDate] = useState(task.dueDate ?? '')
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? '')
  const [saving, setSaving] = useState(false)
  const [confirmKind, setConfirmKind] = useState<'subtasks' | 'blocked' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const teamMap = new Map(teamMembers.map(m => [m.id, m]))
  const assignee = assigneeId ? teamMap.get(assigneeId) : null

  // Delivery-phase options for the spine selector. Org-scoped: tahi_internal
  // tasks have no org, so the conditional key skips the fetch. Non-fatal.
  const { data: phaseOptionsData } = useSWR(
    isAdmin && task.orgId ? `schedule-phases:${task.orgId}` : null,
    () => fetchSchedulePhaseOptions(task.orgId as string),
  )
  const phaseOptions = phaseOptionsData ?? []

  // Subtasks via SWR, mirrored into local state because they are optimistically
  // toggled / appended below (toggleSubtask, addSubtask).
  const { data: subtasksData, isLoading: subtasksLoading } =
    useSWR<{ subtasks?: Subtask[] }>(`/api/admin/tasks/${task.id}/subtasks`)
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  useEffect(() => {
    if (subtasksData) setSubtasks(subtasksData.subtasks ?? [])
  }, [subtasksData])

  // Dependencies via SWR. `blockedBy` = the tasks blocking this one.
  const { data: depsData, isLoading: depsLoading } =
    useSWR<{ blockedBy?: BlockedByDep[]; blocks?: unknown[] }>(`/api/admin/tasks/${task.id}/dependencies`)
  const dependencies = depsData?.blockedBy ?? []

  // Real logged time for this task (was a hardcoded placeholder).
  const { data: timeData } = useSWR<{ items?: TaskTimeEntry[]; totalHours?: number }>(
    `/api/admin/time-entries?taskId=${task.id}`,
  )
  const timeEntries = timeData?.items ?? []
  const totalHours = timeData?.totalHours ?? 0

  const openBlockers = dependencies.filter(d => d.taskStatus !== 'done').length
  const openSubtasks = subtasks.filter(s => !s.completed).length

  async function toggleSubtask(sub: Subtask) {
    const previous = subtasks
    const updated = subtasks.map(s => s.id === sub.id ? { ...s, completed: !s.completed } : s)
    setSubtasks(updated)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${task.id}/subtasks/${sub.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // The API validates `isCompleted`; sending `completed` silently 400s.
        body: JSON.stringify({ isCompleted: !sub.completed }),
      })
      if (!res.ok) throw new Error('Failed to update subtask')
    } catch {
      setSubtasks(previous)
      showToast('That did not save. Try again.', 'error')
    }
  }

  async function addSubtask() {
    if (!newSubtaskTitle.trim()) return
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${task.id}/subtasks`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newSubtaskTitle.trim() }),
      })
      if (res.ok) {
        const data = await res.json() as { subtask?: Subtask; id?: string }
        const newSub: Subtask = data.subtask ?? {
          id: data.id ?? crypto.randomUUID(),
          taskId: task.id,
          title: newSubtaskTitle.trim(),
          completed: false,
          createdAt: new Date().toISOString(),
        }
        setSubtasks(prev => [...prev, newSub])
        setNewSubtaskTitle('')
      } else {
        showToast('Failed to add subtask', 'error')
      }
    } catch {
      showToast('Failed to add subtask', 'error')
    }
  }

  // One PATCH path for the inline-editable controls (priority, due, assignee).
  async function patchField(updates: Record<string, unknown>, successMsg: string) {
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${task.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to save')
      showToast(successMsg)
      onRefresh()
    } catch {
      showToast('That did not save. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  function updatePriority(next: string) {
    setPriority(next)
    void patchField({ priority: next }, 'Priority updated')
  }

  function updateDueDate(next: string) {
    setDueDate(next)
    void patchField({ dueDate: next || null }, 'Due date updated')
  }

  function updateAssignee(next: string) {
    setAssigneeId(next)
    void patchField(
      { assigneeId: next || null, assigneeType: next ? 'team_member' : null },
      'Assignee updated',
    )
  }

  async function applyStatus(newStatus: string) {
    setEditingStatus(newStatus)
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${task.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed to save')
      showToast('Status updated')
      onRefresh()
    } catch {
      setEditingStatus(task.status)
      showToast('That did not save. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Completing is never silent past a live dependency or open subtasks.
  function requestStatusChange(newStatus: string) {
    setEditingStatus(newStatus)
    if (newStatus === 'done') {
      if (openBlockers > 0) { setConfirmKind('blocked'); return }
      if (openSubtasks > 0) { setConfirmKind('subtasks'); return }
    }
    void applyStatus(newStatus)
  }

  async function deleteTask() {
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${task.id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      showToast('Task deleted')
      onDeleted()
    } catch {
      showToast('Could not delete the task.', 'error')
    } finally {
      setConfirmDelete(false)
    }
  }

  async function updateScheduleRow(scheduleRowId: string | null) {
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${task.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleRowId }),
      })
      if (res.ok) {
        const label = scheduleRowId ? phaseOptions.find(o => o.value === scheduleRowId)?.label : null
        showToast(scheduleRowId ? `Linked to ${label ?? 'schedule phase'}` : 'Unlinked from schedule')
        onRefresh()
      } else {
        showToast('Failed to update delivery phase')
      }
    } catch {
      showToast('Failed to update delivery phase')
    } finally {
      setSaving(false)
    }
  }

  const subtasksDone = subtasks.filter(s => s.completed).length

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(2px)',
          zIndex: 60,
        }}
        onClick={onClose}
      />

      {/* Slide-over */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '100%',
          maxWidth: '36rem',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 70,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 data-private id="task-detail-title" style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, lineHeight: 1.4 }}>
              {task.title}
            </h2>
            <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: '0.375rem' }}>
              <span
                className="inline-flex items-center rounded"
                style={{ padding: '0.125rem 0.5rem', fontSize: '0.6875rem', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
              >
                {formatType(task.type)}
              </span>
              {task.orgName && (
                <div className="flex items-center gap-1">
                  <OrgAvatar name={task.orgName} />
                  <span data-private style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{task.orgName}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center flex-shrink-0" style={{ gap: '0.25rem', marginLeft: '0.75rem' }}>
            {isAdmin && <TaskTimerButton taskId={task.id} />}
            {isAdmin && (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  padding: '0.375rem',
                  borderRadius: 'var(--radius-button)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-bg)'; e.currentTarget.style.color = 'var(--color-danger)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                aria-label="Delete task"
              >
                <Trash2 size={17} />
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                padding: '0.375rem',
                borderRadius: 'var(--radius-button)',
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text-subtle)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Status + Priority + Due row. Priority / Due / Assignee are the
                fields people change most, so they PATCH inline on change. */}
            <div className="grid grid-cols-3 gap-3">
              <DetailField label="Status">
                {isAdmin ? (
                  <select
                    value={editingStatus}
                    onChange={e => requestStatusChange(e.target.value)}
                    disabled={saving}
                    style={{
                      width: '100%',
                      padding: '0.375rem 0.5rem',
                      fontSize: '0.8125rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.5rem',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                  </select>
                ) : (
                  <StatusPill status={task.status} />
                )}
              </DetailField>

              <DetailField label="Priority">
                {isAdmin ? (
                  <select
                    value={priority}
                    onChange={e => updatePriority(e.target.value)}
                    disabled={saving}
                    style={{
                      width: '100%',
                      padding: '0.375rem 0.5rem',
                      fontSize: '0.8125rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.5rem',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    {TASK_PRIORITIES.map(p => (
                      <option key={p} value={p}>{taskPriorityLabel(p)}</option>
                    ))}
                  </select>
                ) : (
                  <PriorityBadge priority={task.priority} />
                )}
              </DetailField>

              <DetailField label="Due Date">
                {isAdmin ? (
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => updateDueDate(e.target.value)}
                    disabled={saving}
                    style={{
                      width: '100%',
                      padding: '0.375rem 0.5rem',
                      fontSize: '0.8125rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.5rem',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  />
                ) : (
                  <DueDateChip dueDate={task.dueDate} status={task.status} />
                )}
              </DetailField>
            </div>

            {/* Assignee */}
            <DetailField label="Assignee">
              {isAdmin ? (
                <div style={{ maxWidth: '20rem' }}>
                  <SearchableSelect
                    options={teamMembers.map(m => ({ value: m.id, label: m.name, subtitle: m.title ?? m.email }))}
                    value={assigneeId || null}
                    onChange={v => updateAssignee(v ?? '')}
                    placeholder="Unassigned"
                    searchPlaceholder="Search team members..."
                    allowClear
                    disabled={saving}
                    size="sm"
                  />
                </div>
              ) : assignee ? (
                <div className="flex items-center gap-2">
                  <AssigneeAvatar name={assignee.name} />
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)', margin: 0 }}>{assignee.name}</p>
                    {assignee.title && <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: 0 }}>{assignee.title}</p>}
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>Unassigned</span>
              )}
            </DetailField>

            {/* Linked Request */}
            {task.requestId && (
              <DetailField label="Linked Request">
                <a
                  href={`/requests/${task.requestId}`}
                  className="inline-flex items-center gap-1"
                  style={{ fontSize: '0.8125rem', color: 'var(--color-brand)', textDecoration: 'none' }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
                >
                  <Link2 style={{ width: '0.75rem', height: '0.75rem' }} />
                  View Request
                </a>
              </DetailField>
            )}

            {/* Delivery phase - links this task to a schedule gantt row so the
                schedule shows live delivery status (spine #148). Admin-only;
                hidden when the org has no schedule phases. */}
            {isAdmin && task.orgId && (phaseOptions.length > 0 || task.scheduleRowId) && (
              <DetailField label="Delivery Phase">
                <div style={{ maxWidth: '16rem' }}>
                  <SearchableSelect
                    options={phaseOptions}
                    value={task.scheduleRowId ?? ''}
                    onChange={v => updateScheduleRow(v || null)}
                    placeholder="Not linked"
                    searchPlaceholder="Search phases..."
                    emptyMessage="No schedule phases"
                    allowClear
                    disabled={saving}
                    size="sm"
                  />
                </div>
              </DetailField>
            )}

            {/* Description */}
            <DetailField label="Description">
              {task.description ? (
                <p data-private style={{ fontSize: '0.875rem', color: 'var(--color-text)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {task.description}
                </p>
              ) : (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', margin: 0, fontStyle: 'italic' }}>
                  No description provided.
                </p>
              )}
            </DetailField>

            {/* Subtasks */}
            <DetailField label={`Subtasks${subtasks.length > 0 ? ` (${subtasksDone}/${subtasks.length})` : ''}`}>
              {subtasks.length > 0 && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <SubtaskProgress done={subtasksDone} total={subtasks.length} />
                </div>
              )}

              {subtasksLoading ? (
                <div className="flex items-center gap-2" style={{ padding: '0.5rem 0' }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>Loading...</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {subtasks.map(sub => (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2"
                      style={{
                        padding: '0.375rem 0.5rem',
                        borderRadius: '0.375rem',
                        cursor: 'pointer',
                      }}
                      onClick={() => toggleSubtask(sub)}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {sub.completed ? (
                        <CheckCircle2 style={{ width: '1rem', height: '1rem', color: 'var(--color-success)', flexShrink: 0 }} />
                      ) : (
                        <Circle style={{ width: '1rem', height: '1rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                      )}
                      <span data-private style={{
                        fontSize: '0.8125rem',
                        color: sub.completed ? 'var(--color-text-subtle)' : 'var(--color-text)',
                        textDecoration: sub.completed ? 'line-through' : 'none',
                      }}>
                        {sub.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Add subtask inline */}
              {isAdmin && (
                <div className="flex items-center gap-2" style={{ marginTop: '0.5rem' }}>
                  <input
                    type="text"
                    placeholder="Add a subtask..."
                    value={newSubtaskTitle}
                    onChange={e => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }}
                    style={{
                      flex: 1,
                      padding: '0.375rem 0.625rem',
                      fontSize: '0.8125rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.375rem',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text)',
                      outline: 'none',
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                  />
                  <button
                    type="button"
                    onClick={addSubtask}
                    disabled={!newSubtaskTitle.trim()}
                    style={{
                      padding: '0.375rem 0.625rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: '0.375rem',
                      border: 'none',
                      background: newSubtaskTitle.trim() ? 'var(--color-brand)' : 'var(--color-border-subtle)',
                      color: newSubtaskTitle.trim() ? 'white' : 'var(--color-text-subtle)',
                      cursor: newSubtaskTitle.trim() ? 'pointer' : 'not-allowed',
                    }}
                  >
                    <Plus style={{ width: '0.75rem', height: '0.75rem' }} />
                  </button>
                </div>
              )}
            </DetailField>

            {/* Dependencies (Blocked by) */}
            <DetailField label="Blocked By">
              {depsLoading ? (
                <div className="flex items-center gap-2" style={{ padding: '0.5rem 0' }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>Loading...</span>
                </div>
              ) : dependencies.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {openBlockers > 0 && (
                    <Callout tone="danger">
                      {openBlockers === 1
                        ? '1 blocking task is not done yet.'
                        : `${openBlockers} blocking tasks are not done yet.`}
                    </Callout>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {dependencies.map(dep => (
                      <div
                        key={dep.depId}
                        className="flex items-center gap-2"
                        style={{
                          padding: '0.375rem 0.625rem',
                          borderRadius: '0.375rem',
                          border: '1px solid var(--color-border-subtle)',
                          background: 'var(--color-bg-secondary)',
                        }}
                      >
                        <GitBranch style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                        <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text)', flex: 1 }}>
                          {dep.taskTitle ?? dep.taskId}
                        </span>
                        {dep.taskStatus && <StatusPill status={dep.taskStatus} />}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                  No dependencies.
                </span>
              )}
            </DetailField>

            {/* Time logged: real entries from timeEntries (idx_time_task). */}
            <DetailField label="Time Logged">
              {timeEntries.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <div className="flex items-center gap-1.5">
                    <Clock style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }} />
                    <span className="tabular-nums" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                      {Math.round(totalHours * 100) / 100}h logged
                    </span>
                  </div>
                  {timeEntries.slice(0, 5).map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2"
                      style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}
                    >
                      <span data-private className="truncate">
                        {formatDate(entry.date)}
                        {entry.teamMemberName ? ` · ${entry.teamMemberName}` : ''}
                      </span>
                      <span className="tabular-nums flex-shrink-0">{Math.round(entry.hours * 100) / 100}h</span>
                    </div>
                  ))}
                  <a
                    href={`/time?task=${task.id}`}
                    style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-brand)', textDecoration: 'none' }}
                    onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                    onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
                  >
                    View all in Time
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Clock style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                    No time logged yet.
                  </span>
                </div>
              )}
            </DetailField>
          </div>
        </div>
      </div>

      {/* Complete-with-open-subtasks confirm. */}
      <ConfirmDialog
        open={confirmKind === 'subtasks'}
        variant="warning"
        title="Finish this task?"
        description={`${openSubtasks} subtask${openSubtasks === 1 ? ' is' : 's are'} still open. Mark the task done anyway?`}
        confirmLabel="Mark done"
        cancelLabel="Keep working"
        onConfirm={async () => { await applyStatus('done'); setConfirmKind(null) }}
        onCancel={() => { setConfirmKind(null); setEditingStatus(task.status) }}
      />

      {/* Complete-while-blocked confirm. */}
      <ConfirmDialog
        open={confirmKind === 'blocked'}
        variant="warning"
        title="Finish this task?"
        description={`This task is blocked by ${openBlockers} task${openBlockers === 1 ? ' that is' : 's that are'} not done. Mark it done anyway?`}
        confirmLabel="Mark done"
        cancelLabel="Keep working"
        onConfirm={async () => { await applyStatus('done'); setConfirmKind(null) }}
        onCancel={() => { setConfirmKind(null); setEditingStatus(task.status) }}
      />

      {/* Delete confirm. */}
      <ConfirmDialog
        open={confirmDelete}
        variant="danger"
        title="Delete this task?"
        description="This removes the task and its subtasks. This cannot be undone."
        confirmLabel="Delete task"
        cancelLabel="Cancel"
        onConfirm={deleteTask}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}

// Start/Stop control for the task's own timer, mirroring the nav TimerChip
// contract: POST /api/admin/timers { taskId } (409 if one already runs),
// DELETE ...?action=log to stop. Broadcasts so the nav chip resyncs, and
// revalidates the Time Logged list after a stop.
function TaskTimerButton({ taskId }: { taskId: string }) {
  const { showToast } = useToast()
  const { mutate: globalMutate } = useSWRConfig()
  const { data, mutate } = useSWR<{ timer: { id: string; taskId: string | null } | null }>('/api/admin/timers')
  const active = data?.timer ?? null
  const runningThis = active?.taskId === taskId
  const [busy, setBusy] = useState(false)

  async function start() {
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/timers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      if (res.status === 409) {
        showToast('Stop the active timer first', 'warning')
      } else if (res.ok) {
        showToast('Timer started', 'success')
        notifyTimerChanged()
        await mutate()
      } else {
        showToast('Could not start timer', 'error')
      }
    } catch {
      showToast('Network error. Timer not started.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (!active) return
    setBusy(true)
    try {
      const res = await fetch(apiPath(`/api/admin/timers/${active.id}?action=log`), { method: 'DELETE' })
      if (res.ok) {
        // The route stops the timer either way, but only reports
        // logged:true when a time entry was actually written. Saying
        // "stopped" over lost hours is how the tracking silently died.
        const data = await res.json().catch(() => null) as
          | { logged?: boolean; hours?: number; reasonMessage?: string }
          | null
        if (data && data.logged === false) {
          showToast(data.reasonMessage ?? 'Timer stopped. The hours were not logged.', 'warning')
        } else {
          showToast('Timer stopped', 'success')
        }
        notifyTimerChanged()
        await mutate()
        void globalMutate(`/api/admin/time-entries?taskId=${taskId}`)
      } else {
        showToast('Could not stop timer', 'error')
      }
    } catch {
      showToast('Network error. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => (runningThis ? stop() : start())}
      disabled={busy}
      className="inline-flex items-center gap-1.5"
      style={{
        padding: '0.375rem 0.625rem',
        borderRadius: 'var(--radius-button)',
        border: '1px solid var(--color-border)',
        background: runningThis ? 'var(--color-danger-bg)' : 'var(--color-bg)',
        color: runningThis ? 'var(--color-danger)' : 'var(--color-text-muted)',
        fontSize: '0.75rem',
        fontWeight: 600,
        cursor: busy ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={e => { if (!busy && !runningThis) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { if (!runningThis) e.currentTarget.style.background = 'var(--color-bg)' }}
      aria-label={runningThis ? 'Stop timer' : 'Start timer'}
    >
      {busy
        ? <Loader2 size={13} className="animate-spin" />
        : runningThis ? <Square size={12} /> : <Play size={12} />}
      <span className="hidden sm:inline">{runningThis ? 'Stop timer' : 'Start timer'}</span>
    </button>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--color-text-subtle)',
        margin: '0 0 0.375rem',
      }}>
        {label}
      </p>
      {children}
    </div>
  )
}

// ── New Task Dialog ──────────────────────────────────────────────────────────

function NewTaskDialog({ onClose }: { onClose: () => void }) {
  const { showToast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form fields
  const [title, setTitle] = useState('')
  // Decision #046: "for a client" or "for us". The old 3-way picker is gone.
  const [isForClient, setIsForClient] = useState(false)
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('standard')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [clientOrgId, setClientOrgId] = useState('')
  const [subtaskTitles, setSubtaskTitles] = useState<string[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [showPriorityWarning, setShowPriorityWarning] = useState(false)
  const [pendingPriority, setPendingPriority] = useState<string | null>(null)

  // Data for selectors, loaded via SWR when the dialog mounts (it is only
  // rendered while open). The clients endpoint returns { organisations }.
  const { data: clientsData, isLoading: clientsLoading } =
    useSWR<{ organisations: Array<{ id: string; name: string }> }>('/api/admin/clients?status=active')
  const clients: OrgOption[] = (clientsData?.organisations ?? []).map(o => ({ id: o.id, name: o.name }))

  const { data: teamData, isLoading: teamLoading } =
    useSWR<{ items: TeamMember[] }>('/api/admin/team-members')
  const teamMembers = teamData?.items ?? []

  const { data: templatesData } = useSWR<{ templates?: TaskTemplate[] }>('/api/admin/task-templates')
  const templates = templatesData?.templates ?? []

  const showClientPicker = isForClient

  function applyTemplate(tplId: string) {
    setTemplateId(tplId)
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    if (tpl.description) setDescription(tpl.description)
    if (tpl.defaultPriority) setPriority(tpl.defaultPriority)
    // Legacy templates may have type = client_task / internal_client_task / tahi_internal.
    // Map to the new binary: anything non-tahi_internal is "for a client".
    if (tpl.type) setIsForClient(tpl.type !== 'tahi_internal')
    try {
      const subs = JSON.parse(tpl.subtasks || '[]') as string[]
      if (Array.isArray(subs) && subs.length > 0) setSubtaskTitles(subs)
    } catch { /* ignore parse errors */ }
  }

  function addSubtask() {
    if (!newSubtask.trim()) return
    setSubtaskTitles(prev => [...prev, newSubtask.trim()])
    setNewSubtask('')
  }

  function removeSubtask(index: number) {
    setSubtaskTitles(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    if (showClientPicker && !clientOrgId) {
      setError('Please select a client.')
      return
    }
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch(apiPath('/api/admin/tasks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          // Auto-derive legacy type from orgId presence (Decision #046).
          // API will also do this server-side so MCP callers get the same
          // treatment when they don't pass `type`.
          type: isForClient ? 'client_task' : 'tahi_internal',
          orgId: isForClient ? clientOrgId : null,
          description: description || null,
          priority,
          assigneeId: assigneeId || null,
          assigneeType: assigneeId ? 'team_member' : null,
          dueDate: dueDate || null,
          subtasks: subtaskTitles.length > 0 ? subtaskTitles : undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Something went wrong. Please try again.')
        return
      }

      showToast('Task created successfully')
      onClose()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(2px)',
          zIndex: 60,
        }}
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-dialog-title"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: '100%',
          maxWidth: '32.5rem',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 70,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          <div>
            <h2 id="new-task-dialog-title" style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
              Create a task
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
              Add a new task for your team or a client.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '0.375rem',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-subtle)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginLeft: '0.75rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable form body */}
        <form
          id="new-task-form"
          onSubmit={handleSubmit}
          style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Template picker */}
            {templates.length > 0 && (
              <FieldGroup label="Template" htmlFor="task-template">
                <select
                  id="task-template"
                  value={templateId}
                  onChange={e => applyTemplate(e.target.value)}
                  style={{
                    width: '100%',
                    height: '2.625rem',
                    padding: '0 0.75rem',
                    fontSize: '0.875rem',
                    color: templateId ? 'var(--color-text)' : 'var(--color-text-subtle)',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-input)',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">Choose a template (optional)</option>
                  {templates.map(tpl => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </select>
              </FieldGroup>
            )}

            {/* Who is this for? Binary picker \u2014 clients never see tasks
                either way, this just tags it internally. */}
            <FieldGroup label="Who is this for?" required>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {[
                  { value: false, label: 'For us',       desc: 'Tahi internal \u2014 not tied to a client' },
                  { value: true,  label: 'For a client', desc: 'Work we\u2019re doing on a client\u2019s behalf' },
                ].map(opt => {
                  const active = isForClient === opt.value
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => {
                        setIsForClient(opt.value)
                        if (!opt.value) setClientOrgId('')
                      }}
                      style={{
                        padding: '0.75rem',
                        borderRadius: 'var(--radius-card)',
                        border: active ? '2px solid var(--color-brand)' : '2px solid var(--color-border)',
                        background: active ? 'var(--color-brand-50)' : 'var(--color-bg)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'border-color 0.1s, background 0.1s',
                      }}
                      onMouseEnter={e => {
                        if (!active) {
                          e.currentTarget.style.borderColor = 'var(--color-brand-light)'
                          e.currentTarget.style.background = 'var(--color-bg-secondary)'
                        }
                      }}
                      onMouseLeave={e => {
                        if (!active) {
                          e.currentTarget.style.borderColor = 'var(--color-border)'
                          e.currentTarget.style.background = 'var(--color-bg)'
                        }
                      }}
                    >
                      <p style={{
                        fontSize: '0.875rem', fontWeight: 600,
                        color: active ? 'var(--color-brand-dark)' : 'var(--color-text)',
                        margin: 0,
                      }}>
                        {opt.label}
                      </p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: '0.25rem 0 0', lineHeight: 1.4 }}>
                        {opt.desc}
                      </p>
                    </button>
                  )
                })}
              </div>
            </FieldGroup>

            {/* Title */}
            <FieldGroup label="Task title" required htmlFor="task-title">
              <StyledInput
                id="task-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                maxLength={200}
                placeholder="e.g. Set up analytics dashboard"
              />
            </FieldGroup>

            {/* Client selector */}
            {showClientPicker && (
              <FieldGroup label="Client" required htmlFor="task-client">
                {clientsLoading ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    height: '2.625rem', padding: '0 0.75rem',
                    border: '1px solid var(--color-border)', borderRadius: 'var(--radius-input)',
                    fontSize: '0.8125rem', color: 'var(--color-text-subtle)',
                  }}>
                    <Loader2 size={13} className="animate-spin" />
                    Loading clients...
                  </div>
                ) : (
                  <SearchableSelect
                    options={clients.map(c => ({ value: c.id, label: c.name }))}
                    value={clientOrgId || null}
                    onChange={(v) => setClientOrgId(v ?? '')}
                    placeholder="Select a client..."
                    searchPlaceholder="Search clients..."
                  />
                )}
              </FieldGroup>
            )}

            {/* Description */}
            <FieldGroup label="Description" htmlFor="task-desc">
              <StyledTextarea
                id="task-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Describe what needs to be done..."
                rows={4}
              />
            </FieldGroup>

            {/* Priority + Due date row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <FieldGroup label="Priority">
                <div style={{ display: 'flex', gap: '0.375rem' }}>
                  {(['standard', 'high', 'urgent'] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        if ((p === 'high' || p === 'urgent') && priority !== p) {
                          setPendingPriority(p)
                          setShowPriorityWarning(true)
                        } else {
                          setPriority(p)
                        }
                      }}
                      style={{
                        flex: 1,
                        height: '2.625rem',
                        borderRadius: 'var(--radius-button)',
                        border: priority === p
                          ? p === 'urgent' ? '2px solid var(--color-danger)' : p === 'high' ? '2px solid var(--status-in-review-dot)' : '2px solid var(--color-brand)'
                          : '2px solid var(--color-border)',
                        background: priority === p
                          ? p === 'urgent' ? 'var(--color-danger-bg)' : p === 'high' ? 'var(--status-in-review-bg)' : 'var(--color-brand-50)'
                          : 'var(--color-bg)',
                        color: priority === p
                          ? p === 'urgent' ? 'var(--color-danger)' : p === 'high' ? 'var(--status-in-review-text)' : 'var(--color-brand-dark)'
                          : 'var(--color-text-muted)',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.25rem',
                        transition: 'all 0.1s',
                      }}
                    >
                      {(p === 'high' || p === 'urgent') && <Zap size={11} />}
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </FieldGroup>

              <FieldGroup label="Due date" htmlFor="task-due">
                <StyledInput
                  id="task-due"
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              </FieldGroup>
            </div>

            {/* Assignee */}
            <FieldGroup label="Assignee" htmlFor="task-assignee">
              {teamLoading ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  height: '2.625rem', padding: '0 0.75rem',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-input)',
                  fontSize: '0.8125rem', color: 'var(--color-text-subtle)',
                }}>
                  <Loader2 size={13} className="animate-spin" />
                  Loading team...
                </div>
              ) : (
                <SearchableSelect
                  options={teamMembers.map(m => ({ value: m.id, label: m.name, subtitle: m.title ?? m.email }))}
                  value={assigneeId || null}
                  onChange={(v) => setAssigneeId(v ?? '')}
                  placeholder="Select assignee..."
                  searchPlaceholder="Search team members..."
                  allowClear
                />
              )}
            </FieldGroup>

            {/* Subtasks */}
            <FieldGroup label="Subtasks">
              {subtaskTitles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '0.5rem' }}>
                  {subtaskTitles.map((st, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2"
                      style={{
                        padding: '0.375rem 0.625rem',
                        borderRadius: '0.375rem',
                        border: '1px solid var(--color-border-subtle)',
                        background: 'var(--color-bg-secondary)',
                      }}
                    >
                      <Circle style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                      <span data-private style={{ fontSize: '0.8125rem', color: 'var(--color-text)', flex: 1 }}>{st}</span>
                      <button
                        type="button"
                        onClick={() => removeSubtask(i)}
                        style={{
                          padding: '0.125rem',
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--color-text-subtle)',
                          cursor: 'pointer',
                          flexShrink: 0,
                          display: 'flex',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                        aria-label="Remove subtask"
                      >
                        <Trash2 style={{ width: '0.75rem', height: '0.75rem' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Add a subtask..."
                  value={newSubtask}
                  onChange={e => setNewSubtask(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }}
                  style={{
                    flex: 1,
                    height: '2.25rem',
                    padding: '0 0.625rem',
                    fontSize: '0.8125rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: '0.375rem',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    outline: 'none',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                />
                <button
                  type="button"
                  onClick={addSubtask}
                  disabled={!newSubtask.trim()}
                  style={{
                    height: '2.25rem',
                    padding: '0 0.75rem',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    borderRadius: '0.375rem',
                    border: 'none',
                    background: newSubtask.trim() ? 'var(--color-brand)' : 'var(--color-border-subtle)',
                    color: newSubtask.trim() ? 'white' : 'var(--color-text-subtle)',
                    cursor: newSubtask.trim() ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Plus style={{ width: '0.75rem', height: '0.75rem' }} />
                  Add
                </button>
              </div>
            </FieldGroup>

            {/* Error */}
            {error && (
              <div style={{
                padding: '0.625rem 0.75rem',
                borderRadius: 'var(--radius-card)',
                background: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger)',
                fontSize: '0.8125rem',
                color: 'var(--color-danger)',
              }}>
                {error}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--color-border-subtle)',
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="new-task-form"
            disabled={submitting || !title.trim()}
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: submitting || !title.trim() ? 'var(--color-text-subtle)' : 'var(--color-brand)',
              color: 'white',
              cursor: submitting || !title.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Create Task
          </button>
        </div>
      </div>

      {/* Priority Warning Dialog (T435) */}
      {showPriorityWarning && pendingPriority && (
        <>
          <div
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 80,
            }}
            onClick={() => {
              setShowPriorityWarning(false)
              setPendingPriority(null)
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="priority-warning-title"
            style={{
              position: 'fixed',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '100%',
              maxWidth: '26rem',
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 90,
              padding: '1.5rem',
            }}
          >
            <div className="flex items-start gap-3 mb-4">
              <div
                className="flex-shrink-0 flex items-center justify-center"
                style={{
                  width: '2.5rem',
                  height: '2.5rem',
                  borderRadius: 'var(--radius-leaf-sm)',
                  background: pendingPriority === 'urgent' ? 'var(--color-danger-bg)' : 'var(--status-in-review-bg)',
                }}
              >
                <AlertTriangle
                  className="w-5 h-5"
                  style={{
                    color: pendingPriority === 'urgent' ? 'var(--color-danger)' : 'var(--status-in-review-dot)',
                  }}
                  aria-hidden="true"
                />
              </div>
              <div>
                <h3 id="priority-warning-title" className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Set {pendingPriority} priority?
                </h3>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {pendingPriority === 'urgent'
                    ? 'Urgent tasks will jump to the top of the queue and may displace the currently active task in the assigned track. The team will be notified immediately.'
                    : 'High priority tasks will be prioritized over standard tasks in the queue. This may affect the order of other queued work.'}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPriorityWarning(false)
                  setPendingPriority(null)
                }}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderRadius: 'var(--radius-button)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setPriority(pendingPriority)
                  setShowPriorityWarning(false)
                  setPendingPriority(null)
                }}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-button)',
                  border: 'none',
                  background: pendingPriority === 'urgent' ? 'var(--color-danger)' : 'var(--status-in-review-dot)',
                  color: 'white',
                  cursor: 'pointer',
                }}
              >
                Set {pendingPriority}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ── Form helpers (matching new-request-dialog patterns) ──────────────────────

function FieldGroup({
  label, required, htmlFor, children,
}: {
  label: string
  required?: boolean
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <label htmlFor={htmlFor} style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
        {label}
        {required && <span style={{ color: 'var(--color-danger)', marginLeft: '0.125rem' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

const BRAND_HEX = 'var(--color-brand)'

function StyledInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        height: '2.625rem',
        padding: '0 0.75rem',
        fontSize: '0.875rem',
        color: 'var(--color-text)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-input)',
        outline: 'none',
        boxSizing: 'border-box',
        ...props.style,
      }}
      onFocus={e => {
        e.currentTarget.style.borderColor = BRAND_HEX
        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(90,130,78,0.12)'
      }}
      onBlur={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    />
  )
}

function StyledTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      style={{
        width: '100%',
        padding: '0.625rem 0.75rem',
        fontSize: '0.875rem',
        color: 'var(--color-text)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-input)',
        outline: 'none',
        resize: 'vertical',
        minHeight: '5rem',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        lineHeight: '1.5',
        ...props.style,
      }}
      onFocus={e => {
        e.currentTarget.style.borderColor = BRAND_HEX
        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(90,130,78,0.12)'
      }}
      onBlur={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    />
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Search, Inbox, RefreshCw,
  Calendar, Zap, AlertTriangle, X, Loader2,
  CheckCircle2, Circle, Link2, Clock,
  ChevronRight, ChevronDown, Trash2, GitBranch, Users,
  Building2, Briefcase, Shield, Sparkles,
  LayoutList, Columns3, CheckSquare, Square,
} from 'lucide-react'
import Link from 'next/link'
import { apiPath } from '@/lib/api'
import { AiTaskWizard } from '@/components/tahi/ai-task-wizard'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { DateRangePicker, type DateRange } from '@/components/tahi/date-range-picker'
import { useToast } from '@/components/tahi/toast'

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

interface TaskDependency {
  id: string
  taskId: string
  dependsOnTaskId: string
  dependsOnTitle?: string
  dependsOnStatus?: string
  createdAt: string
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

const TASK_STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  todo:        { label: 'To Do',       dot: 'var(--status-submitted-dot)',    bg: 'var(--status-submitted-bg)',    text: 'var(--status-submitted-text)',    border: 'var(--status-submitted-border)'    },
  in_progress: { label: 'In Progress', dot: 'var(--status-in-progress-dot)', bg: 'var(--status-in-progress-bg)', text: 'var(--status-in-progress-text)', border: 'var(--status-in-progress-border)' },
  blocked:     { label: 'Blocked',     dot: 'var(--color-danger)',            bg: 'var(--color-danger-bg)',        text: 'var(--color-danger)',             border: 'var(--color-danger)'              },
  done:        { label: 'Done',        dot: 'var(--status-delivered-dot)',    bg: 'var(--status-delivered-bg)',    text: 'var(--status-delivered-text)',    border: 'var(--status-delivered-border)'    },
}

const TASK_TYPE_LABELS: Record<string, string> = {
  client_task: 'Client Tasks',
  internal_client_task: 'Internal Client',
  tahi_internal: 'Tahi Internal',
}

const TYPE_TABS = [
  { label: 'All Tasks',        value: 'all',                    icon: Briefcase },
  { label: 'Client Tasks',     value: 'client_task',            icon: Users },
  { label: 'Internal Client',  value: 'internal_client_task',   icon: Building2 },
  { label: 'Tahi Internal',    value: 'tahi_internal',          icon: Shield },
]

const STATUS_TABS = [
  { label: 'All',         value: 'all'         },
  { label: 'To Do',       value: 'todo'        },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Blocked',     value: 'blocked'     },
  { label: 'Done',        value: 'done'        },
]

const TASK_TYPES = [
  { value: 'client_task',          label: 'Client Task',          desc: 'Visible to the client' },
  { value: 'internal_client_task', label: 'Internal Client Task', desc: 'Hidden from client' },
  { value: 'tahi_internal',        label: 'Tahi Internal',        desc: 'Studio-only task' },
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

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const c = TASK_STATUS_CONFIG[status] ?? TASK_STATUS_CONFIG.todo
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

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'standard') {
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

function AssigneeAvatar({ name }: { name: string }) {
  return (
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
    >
      {getInitials(name)}
    </div>
  )
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
  const [typeTab, setTypeTab] = useState('all')
  const [statusTab, setStatusTab] = useState('all')
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusTab !== 'all') params.set('status', statusTab)
      if (typeTab !== 'all') params.set('type', typeTab)
      const endpoint = apiPath('/api/admin/tasks')
      const res = await fetch(`${endpoint}?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { tasks?: Task[] }
      setTasks(data.tasks ?? [])
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }, [statusTab, typeTab])

  // Load team members for assignee display
  useEffect(() => {
    if (!isAdmin) return
    fetch(apiPath('/api/admin/team-members'))
      .then(r => r.json() as Promise<{ items: TeamMember[] }>)
      .then(data => setTeamMembers(data.items ?? []))
      .catch(() => setTeamMembers([]))
  }, [isAdmin])

  useEffect(() => { fetchTasks() }, [fetchTasks])

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

  // Type tab counts
  const typeCounts: Record<string, number> = { all: tasks.length }
  for (const t of tasks) {
    typeCounts[t.type] = (typeCounts[t.type] ?? 0) + 1
  }

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === filtered.length) return new Set()
      return new Set(filtered.map(t => t.id))
    })
  }, [filtered])

  const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) ?? null : null

  return (
    <>
      {dialogOpen && (
        <NewTaskDialog
          onClose={() => {
            setDialogOpen(false)
            fetchTasks()
          }}
        />
      )}

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isAdmin={isAdmin}
          teamMembers={teamMembers}
          onClose={() => setSelectedTaskId(null)}
          onRefresh={fetchTasks}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '1.5rem' }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Tasks</h1>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            {!loading
              ? `${filtered.length} ${filtered.length === 1 ? 'task' : 'tasks'}`
              : isAdmin ? 'All tasks: client-facing, internal, and Tahi Studio.' : 'Tasks assigned to you by the Tahi team.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <button
                onClick={() => setWizardOpen(true)}
                className="flex items-center gap-2 font-medium transition-colors hover:opacity-90"
                style={{
                  padding: '0.5rem 0.875rem', fontSize: '0.875rem',
                  background: 'var(--color-bg-tertiary)', color: 'var(--color-brand)',
                  borderRadius: '0.5rem', border: '1px solid var(--color-brand-light)', cursor: 'pointer',
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">AI Help</span>
              </button>
              <button
                onClick={() => setDialogOpen(true)}
                className="flex items-center gap-2 font-semibold text-white transition-opacity hover:opacity-90"
                style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', background: 'var(--color-brand)', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Create Task</span>
                <span className="sm:hidden">New</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Type tabs (top-level filter) */}
      {isAdmin && (
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
          {/* Search */}
          <div className="relative" style={{ width: '16rem', minWidth: '8rem', flexShrink: 1 }}>
            <Search
              className="absolute top-1/2 pointer-events-none"
              style={{ left: '0.625rem', transform: 'translateY(-50%)', width: '0.875rem', height: '0.875rem', color: 'var(--color-text-subtle)' }}
            />
            <input
              type="text"
              placeholder="Search tasks..."
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

          {/* Filters */}
          <DateRangePicker value={dateRange} onChange={setDateRange} label="Due date" />
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className="hidden sm:block appearance-none focus:outline-none"
            style={{
              padding: '0.4375rem 2rem 0.4375rem 0.75rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              color: priorityFilter !== 'all' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
              background: priorityFilter !== 'all' ? 'var(--color-brand-50)' : 'var(--color-bg)',
              cursor: 'pointer',
            }}
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="standard">Standard</option>
            <option value="low">Low</option>
          </select>

          <div className="flex-1" />

          {/* View toggle */}
          <div
            className="flex items-center overflow-hidden flex-shrink-0"
            style={{ border: '1px solid var(--color-border)', borderRadius: '0.5rem' }}
          >
            <button
              onClick={() => setViewMode('list')}
              className="flex items-center justify-center transition-colors"
              style={{
                padding: '0.5rem',
                background: viewMode === 'list' ? 'var(--color-brand)' : 'var(--color-bg)',
                color: viewMode === 'list' ? 'white' : 'var(--color-text-muted)',
                cursor: 'pointer',
                border: 'none',
              }}
              aria-label="List view"
            >
              <LayoutList className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('board')}
              className="flex items-center justify-center transition-colors"
              style={{
                padding: '0.5rem',
                background: viewMode === 'board' ? 'var(--color-brand)' : 'var(--color-bg)',
                color: viewMode === 'board' ? 'white' : 'var(--color-text-muted)',
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

        {/* Status tabs */}
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

        {/* Content area */}
        <div style={{ background: viewMode === 'board' ? 'var(--color-bg-secondary)' : 'var(--color-bg)' }}>
          {loading ? (
            <LoadingSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />
          ) : viewMode === 'board' ? (
            <TaskBoardView tasks={filtered} isAdmin={isAdmin} teamMap={teamMap} onStatusChange={fetchTasks} />
          ) : (
            <TaskListView tasks={filtered} isAdmin={isAdmin} teamMap={teamMap} onSelect={setSelectedTaskId} />
          )}
        </div>
      </div>

      {/* AI Task Wizard */}
      <AiTaskWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onTasksCreated={fetchTasks}
      />
    </>
  )
}

// ── Task List View ───────────────────────────────────────────────────────────

function TaskListView({ tasks, isAdmin, teamMap, onSelect }: {
  tasks: Task[]
  isAdmin: boolean
  teamMap: Map<string, TeamMember>
  onSelect: (id: string) => void
}) {
  return (
    <div>
      {/* Table header */}
      <div
        className="hidden md:grid text-xs font-semibold uppercase tracking-wide items-center"
        style={{
          gridTemplateColumns: isAdmin
            ? '1fr 8rem 7rem 7rem 5.5rem 5.5rem 6rem'
            : '1fr 7rem 7rem 5.5rem 5.5rem',
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
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task, isAdmin, isLast, teamMap, onSelect }: {
  task: Task
  isAdmin: boolean
  isLast: boolean
  teamMap: Map<string, TeamMember>
  onSelect: (id: string) => void
}) {
  const assignee = task.assigneeId ? teamMap.get(task.assigneeId) : null
  const hasSubtasks = (task.subtaskCount ?? 0) > 0
  const isBlocked = (task.blockedByCount ?? 0) > 0

  return (
    <div
      style={{ textDecoration: 'none', display: 'block', cursor: 'pointer' }}
      onClick={() => onSelect(task.id)}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-row-hover)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg)' }}
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
            <span className="font-medium truncate" style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>{task.title}</span>
          </div>
          <StatusPill status={task.status} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && task.orgName && (
            <div className="flex items-center gap-1">
              <OrgAvatar name={task.orgName} />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{task.orgName}</span>
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
          gridTemplateColumns: isAdmin
            ? '1fr 8rem 7rem 7rem 5.5rem 5.5rem 6rem'
            : '1fr 7rem 7rem 5.5rem 5.5rem',
          padding: '0.75rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
        }}
      >
        {/* Title */}
        <div className="flex items-center gap-1.5 min-w-0">
          {isBlocked && <BlockedIndicator />}
          <span className="font-medium truncate" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{task.title}</span>
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
                <span className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{task.orgName}</span>
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

function TaskBoardView({ tasks, isAdmin, teamMap, onStatusChange }: {
  tasks: Task[]
  isAdmin: boolean
  teamMap: Map<string, TeamMember>
  onStatusChange: () => void
}) {
  const byStatus = (status: string) => tasks.filter(t => t.status === status)

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.style.borderColor = 'var(--color-border)'
    const taskId = e.dataTransfer.getData('taskId')
    const fromStatus = e.dataTransfer.getData('fromStatus')
    if (!taskId || fromStatus === newStatus) return
    if (!isAdmin) return
    try {
      await fetch(apiPath(`/api/admin/tasks/${taskId}`), {
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
                  No tasks
                </div>
              ) : (
                cards.map(task => <TaskKanbanCard key={task.id} task={task} teamMap={teamMap} />)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TaskKanbanCard({ task, teamMap }: { task: Task; teamMap: Map<string, TeamMember> }) {
  const assignee = task.assigneeId ? teamMap.get(task.assigneeId) : null
  const hasSubtasks = (task.subtaskCount ?? 0) > 0
  const dueDateState = getDueDateState(task.dueDate, task.status)

  return (
    <Link
      href={`/tasks/${task.id}`}
      className="block rounded-lg transition-all"
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
              <span className="truncate" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', maxWidth: '5.625rem' }}>
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
    </Link>
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

// ── Task Detail Panel (slide-over) ──────────────────────────────────────────

function TaskDetailPanel({ task, isAdmin, teamMembers, onClose, onRefresh }: {
  task: Task
  isAdmin: boolean
  teamMembers: TeamMember[]
  onClose: () => void
  onRefresh: () => void
}) {
  const { showToast } = useToast()
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [subtasksLoading, setSubtasksLoading] = useState(true)
  const [dependencies, setDependencies] = useState<TaskDependency[]>([])
  const [depsLoading, setDepsLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [editingStatus, setEditingStatus] = useState(task.status)
  const [saving, setSaving] = useState(false)

  const teamMap = new Map(teamMembers.map(m => [m.id, m]))
  const assignee = task.assigneeId ? teamMap.get(task.assigneeId) : null

  // Fetch subtasks
  useEffect(() => {
    setSubtasksLoading(true)
    fetch(apiPath(`/api/admin/tasks/${task.id}/subtasks`))
      .then(r => {
        if (!r.ok) throw new Error('Not found')
        return r.json() as Promise<{ subtasks?: Subtask[] }>
      })
      .then(data => setSubtasks(data.subtasks ?? []))
      .catch(() => setSubtasks([]))
      .finally(() => setSubtasksLoading(false))
  }, [task.id])

  // Fetch dependencies
  useEffect(() => {
    setDepsLoading(true)
    fetch(apiPath(`/api/admin/tasks/${task.id}/dependencies`))
      .then(r => {
        if (!r.ok) throw new Error('Not found')
        return r.json() as Promise<{ dependencies?: TaskDependency[] }>
      })
      .then(data => setDependencies(data.dependencies ?? []))
      .catch(() => setDependencies([]))
      .finally(() => setDepsLoading(false))
  }, [task.id])

  async function toggleSubtask(sub: Subtask) {
    const updated = subtasks.map(s => s.id === sub.id ? { ...s, completed: !s.completed } : s)
    setSubtasks(updated)
    try {
      await fetch(apiPath(`/api/admin/tasks/${task.id}/subtasks/${sub.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !sub.completed }),
      })
    } catch {
      // Revert on error
      setSubtasks(subtasks)
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
      }
    } catch {
      showToast('Failed to add subtask')
    }
  }

  async function updateStatus(newStatus: string) {
    setEditingStatus(newStatus)
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${task.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        showToast('Status updated')
        onRefresh()
      }
    } catch {
      setEditingStatus(task.status)
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
            <h2 id="task-detail-title" style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text)', margin: 0, lineHeight: 1.4 }}>
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
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{task.orgName}</span>
                </div>
              )}
            </div>
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

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Status + Priority + Due row */}
            <div className="grid grid-cols-3 gap-3">
              <DetailField label="Status">
                {isAdmin ? (
                  <select
                    value={editingStatus}
                    onChange={e => updateStatus(e.target.value)}
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
                <PriorityBadge priority={task.priority} />
              </DetailField>

              <DetailField label="Due Date">
                <DueDateChip dueDate={task.dueDate} status={task.status} />
              </DetailField>
            </div>

            {/* Assignee */}
            <DetailField label="Assignee">
              {assignee ? (
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

            {/* Description */}
            <DetailField label="Description">
              {task.description ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
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
                      <span style={{
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {dependencies.map(dep => (
                    <div
                      key={dep.id}
                      className="flex items-center gap-2"
                      style={{
                        padding: '0.375rem 0.625rem',
                        borderRadius: '0.375rem',
                        border: '1px solid var(--color-border-subtle)',
                        background: 'var(--color-bg-secondary)',
                      }}
                    >
                      <GitBranch style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', flex: 1 }}>
                        {dep.dependsOnTitle ?? dep.dependsOnTaskId}
                      </span>
                      {dep.dependsOnStatus && <StatusPill status={dep.dependsOnStatus} />}
                    </div>
                  ))}
                </div>
              ) : (
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                  No dependencies.
                </span>
              )}
            </DetailField>

            {/* Time logged placeholder */}
            <DetailField label="Time Logged">
              <div className="flex items-center gap-1.5">
                <Clock style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }} />
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                  No time entries yet.
                </span>
              </div>
            </DetailField>

            {/* Activity / Comments */}
            <DetailField label="Activity">
              <div style={{ marginTop: '0.25rem' }}>
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Add a comment or note..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.75rem',
                    fontSize: '0.8125rem',
                    color: 'var(--color-text)',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '0.5rem',
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: '4rem',
                    fontFamily: 'inherit',
                    lineHeight: '1.5',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                />
                <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: '0.375rem 0 0' }}>
                  Use @name to mention someone (coming soon).
                </p>
              </div>
            </DetailField>
          </div>
        </div>
      </div>

    </>
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
  const [type, setType] = useState('client_task')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('standard')
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [clientOrgId, setClientOrgId] = useState('')
  const [subtaskTitles, setSubtaskTitles] = useState<string[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [templateId, setTemplateId] = useState('')

  // Data for selectors
  const [clients, setClients] = useState<OrgOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [, setTemplatesLoading] = useState(false)

  const showClientPicker = type === 'client_task' || type === 'internal_client_task'

  // Load clients, team, and templates on open
  useEffect(() => {
    setClientsLoading(true)
    fetch(apiPath('/api/admin/clients?status=active'))
      .then(r => r.json() as Promise<{ organisations: Array<{ id: string; name: string }> }>)
      .then(data => setClients((data.organisations ?? []).map(o => ({ id: o.id, name: o.name }))))
      .catch(() => setClients([]))
      .finally(() => setClientsLoading(false))

    setTeamLoading(true)
    fetch(apiPath('/api/admin/team-members'))
      .then(r => r.json() as Promise<{ items: TeamMember[] }>)
      .then(data => setTeamMembers(data.items ?? []))
      .catch(() => setTeamMembers([]))
      .finally(() => setTeamLoading(false))

    setTemplatesLoading(true)
    fetch(apiPath('/api/admin/task-templates'))
      .then(r => {
        if (!r.ok) throw new Error('Not found')
        return r.json() as Promise<{ templates?: TaskTemplate[] }>
      })
      .then(data => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]))
      .finally(() => setTemplatesLoading(false))
  }, [])

  function applyTemplate(tplId: string) {
    setTemplateId(tplId)
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    if (tpl.description) setDescription(tpl.description)
    if (tpl.defaultPriority) setPriority(tpl.defaultPriority)
    if (tpl.type) setType(tpl.type)
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
          type,
          orgId: showClientPicker ? clientOrgId : null,
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

            {/* Task type selector */}
            <FieldGroup label="Task type" required>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                {TASK_TYPES.map(t => {
                  const active = type === t.value
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => {
                        setType(t.value)
                        if (t.value === 'tahi_internal') setClientOrgId('')
                      }}
                      style={{
                        padding: '0.625rem 0.5rem',
                        borderRadius: 'var(--radius-card)',
                        border: active ? '2px solid var(--color-brand)' : '2px solid var(--color-border)',
                        background: active ? 'var(--color-brand-50)' : 'var(--color-bg)',
                        cursor: 'pointer',
                        textAlign: 'center',
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
                        fontSize: '0.8125rem', fontWeight: 600,
                        color: active ? 'var(--color-brand-dark)' : 'var(--color-text)',
                        margin: 0,
                      }}>
                        {t.label}
                      </p>
                      <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: '0.125rem 0 0', lineHeight: 1.4 }}>
                        {t.desc}
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
                      onClick={() => setPriority(p)}
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
                      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', flex: 1 }}>{st}</span>
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

const BRAND_HEX = '#5A824E'

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

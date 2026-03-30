'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Search, Inbox, RefreshCw,
  Calendar, Zap, AlertTriangle, X, Loader2,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { SearchableSelect } from '@/components/tahi/searchable-select'
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
  createdAt: string | null
  updatedAt: string | null
  orgName: string | null
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

// ── Status config ────────────────────────────────────────────────────────────

const TASK_STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  todo:        { label: 'To Do',       dot: 'var(--status-submitted-dot)',    bg: 'var(--status-submitted-bg)',    text: 'var(--status-submitted-text)',    border: 'var(--status-submitted-border)'    },
  in_progress: { label: 'In Progress', dot: 'var(--status-in-progress-dot)', bg: 'var(--status-in-progress-bg)', text: 'var(--status-in-progress-text)', border: 'var(--status-in-progress-border)' },
  blocked:     { label: 'Blocked',     dot: 'var(--color-danger)',            bg: 'var(--color-danger-bg)',        text: 'var(--color-danger)',             border: 'var(--color-danger)'              },
  done:        { label: 'Done',        dot: 'var(--status-delivered-dot)',    bg: 'var(--status-delivered-bg)',    text: 'var(--status-delivered-text)',    border: 'var(--status-delivered-border)'    },
}

const TASK_TYPE_LABELS: Record<string, string> = {
  client_task: 'Client Task',
  internal_client_task: 'Internal Client',
  tahi_internal: 'Tahi Internal',
}

const TABS = [
  { label: 'All',         value: 'all'         },
  { label: 'To Do',       value: 'todo'        },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Blocked',     value: 'blocked'     },
  { label: 'Done',        value: 'done'        },
]

const BRAND_HEX = '#5A824E'

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

// ── Main component ───────────────────────────────────────────────────────────

export function TasksContent({ isAdmin }: { isAdmin: boolean }) {
  const [activeTab, setActiveTab] = useState('all')
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeTab !== 'all') params.set('status', activeTab)
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
  }, [activeTab])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const filtered = search.trim()
    ? tasks.filter(t =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        (t.orgName ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : tasks

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

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Tasks</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {!loading
              ? `${filtered.length} ${filtered.length === 1 ? 'task' : 'tasks'}`
              : isAdmin ? 'All tasks: client-facing, internal, and Tahi Studio.' : 'Tasks assigned to you by the Tahi team.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-2 font-semibold text-white transition-opacity hover:opacity-90"
              style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', background: 'var(--color-brand)', borderRadius: '0.375rem', border: 'none', cursor: 'pointer' }}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Create Task</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
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

          <div className="flex-1" />
        </div>

        {/* Tabs */}
        <div
          className="flex items-end overflow-x-auto overflow-y-hidden scrollbar-hide"
          style={{ borderBottom: '1px solid var(--color-border)', paddingLeft: '0.25rem', paddingRight: '1rem', background: 'var(--color-bg)', WebkitOverflowScrolling: 'touch' }}
        >
          {TABS.map(tab => (
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
        <div style={{ background: 'var(--color-bg)' }}>
          {loading ? (
            <LoadingSkeleton />
          ) : filtered.length === 0 ? (
            <EmptyState isAdmin={isAdmin} onNew={() => setDialogOpen(true)} />
          ) : (
            <TaskListView tasks={filtered} isAdmin={isAdmin} />
          )}
        </div>
      </div>
    </>
  )
}

// ── Task List View ───────────────────────────────────────────────────────────

function TaskListView({ tasks, isAdmin }: { tasks: Task[]; isAdmin: boolean }) {
  return (
    <div>
      {/* Table header */}
      <div
        className="hidden md:grid text-xs font-semibold uppercase tracking-wide items-center"
        style={{
          gridTemplateColumns: isAdmin
            ? '1fr 8rem 7.5rem 7rem 5.5rem 5.5rem'
            : '1fr 7.5rem 7rem 5.5rem 5.5rem',
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
      </div>

      {/* Rows */}
      <div>
        {tasks.map((task, i) => (
          <TaskRow
            key={task.id}
            task={task}
            isAdmin={isAdmin}
            isLast={i === tasks.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task, isAdmin, isLast }: { task: Task; isAdmin: boolean; isLast: boolean }) {
  return (
    <div
      style={{ textDecoration: 'none', display: 'block' }}
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
          <span className="font-medium truncate" style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>{task.title}</span>
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
        </div>
      </div>

      {/* Desktop layout */}
      <div
        className="hidden md:grid items-center"
        style={{
          gridTemplateColumns: isAdmin
            ? '1fr 8rem 7.5rem 7rem 5.5rem 5.5rem'
            : '1fr 7.5rem 7rem 5.5rem 5.5rem',
          padding: '0.75rem 1rem',
          borderBottom: isLast ? 'none' : '1px solid var(--color-row-border)',
        }}
      >
        {/* Title */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-medium truncate" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>{task.title}</span>
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
      </div>
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
          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', background: 'var(--color-brand)', borderRadius: '0.375rem', border: 'none', cursor: 'pointer' }}
        >
          <Plus className="w-4 h-4" />
          Create a task
        </button>
      )}
    </div>
  )
}

// ── New Task Dialog ──────────────────────────────────────────────────────────

const TASK_TYPES = [
  { value: 'client_task',          label: 'Client Task',          desc: 'Visible to the client' },
  { value: 'internal_client_task', label: 'Internal Client Task', desc: 'Hidden from client' },
  { value: 'tahi_internal',        label: 'Tahi Internal',        desc: 'Studio-only task' },
]

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

  // Data for selectors
  const [clients, setClients] = useState<OrgOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [teamLoading, setTeamLoading] = useState(false)

  const showClientPicker = type === 'client_task' || type === 'internal_client_task'

  // Load clients and team members on open
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
  }, [])

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

            {/* Type selector */}
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

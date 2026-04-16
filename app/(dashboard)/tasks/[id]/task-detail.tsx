'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiPath } from '@/lib/api'
import {
  AlertTriangle, Loader2,
  FileText, Calendar, Plus, Trash2,
  Clock, CheckCircle2, Circle, Link2,
  GitBranch, Users, Building2, Shield, Zap, X,
  Pencil, Save,
} from 'lucide-react'
import Link from 'next/link'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { useToast } from '@/components/tahi/toast'

// ---- Constants ---------------------------------------------------------------

// Brand color references now use var(--color-brand) directly in styles

const TASK_STATUS_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; border: string }> = {
  todo:        { label: 'To Do',       dot: 'var(--status-submitted-dot)',    bg: 'var(--status-submitted-bg)',    text: 'var(--status-submitted-text)',    border: 'var(--status-submitted-border)'    },
  in_progress: { label: 'In Progress', dot: 'var(--status-in-progress-dot)', bg: 'var(--status-in-progress-bg)', text: 'var(--status-in-progress-text)', border: 'var(--status-in-progress-border)' },
  blocked:     { label: 'Blocked',     dot: 'var(--color-danger)',            bg: 'var(--color-danger-bg)',        text: 'var(--color-danger)',             border: 'var(--color-danger)'              },
  done:        { label: 'Done',        dot: 'var(--status-delivered-dot)',    bg: 'var(--status-delivered-bg)',    text: 'var(--status-delivered-text)',    border: 'var(--status-delivered-border)'    },
}

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
]

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const TASK_TYPE_LABELS: Record<string, string> = {
  client_task: 'Client Task',
  internal_client_task: 'Internal Client',
  tahi_internal: 'Tahi Internal',
}

const TYPE_ICON_MAP: Record<string, React.ElementType> = {
  client_task: Users,
  internal_client_task: Building2,
  tahi_internal: Shield,
}

// ---- Types -------------------------------------------------------------------

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
  trackId: string | null
  requestId: string | null
  position: number | null
  createdAt: string | null
  updatedAt: string | null
  orgName: string | null
  assigneeName: string | null
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

interface TeamMemberOption {
  id: string
  name: string
  title?: string | null
}

interface TimeEntry {
  id: string
  description: string | null
  hours: number
  billable: boolean
  createdAt: string
  teamMemberName?: string | null
}

interface TaskDetailProps {
  taskId: string
  isAdmin: boolean
  currentUserId?: string
}

// ---- Helpers -----------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '--' }
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '--' }
}

function formatType(type: string): string {
  return TASK_TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// ---- Sub-components ----------------------------------------------------------

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
  if (priority === 'standard' || priority === 'low') {
    return <span className="capitalize" style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>{priority}</span>
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

function TypeBadge({ type }: { type: string }) {
  const Icon = TYPE_ICON_MAP[type] ?? Users
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded"
      style={{ padding: '0.125rem 0.5rem', fontSize: '0.6875rem', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
    >
      <Icon style={{ width: '0.75rem', height: '0.75rem' }} />
      {formatType(type)}
    </span>
  )
}

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="bg-[var(--color-bg)] rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
    >
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-row-border)',
        }}
      >
        <h3
          className="text-xs font-semibold uppercase"
          style={{ color: 'var(--color-text-muted)', letterSpacing: '0.04em' }}
        >
          {title}
        </h3>
      </div>
      <div style={{ padding: '1rem' }}>
        {children}
      </div>
    </div>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
      <dt className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--color-text-subtle)', paddingTop: '0.1875rem' }}>
        {label}
      </dt>
      <dd className="text-sm text-right" style={{ color: 'var(--color-text)' }}>
        {children}
      </dd>
    </div>
  )
}

// ---- Main Component ----------------------------------------------------------

export function TaskDetail({ taskId, isAdmin, currentUserId }: TaskDetailProps) {
  const { showToast } = useToast()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  // Editable fields
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState('')
  const [editingDesc, setEditingDesc] = useState(false)
  const [descInput, setDescInput] = useState('')
  const [editingDueDate, setEditingDueDate] = useState(false)
  const [dueDateInput, setDueDateInput] = useState('')
  const [statusUpdating, setStatusUpdating] = useState(false)

  // Related data
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [subtasksLoading, setSubtasksLoading] = useState(true)
  const [dependencies, setDependencies] = useState<TaskDependency[]>([])
  const [depsLoading, setDepsLoading] = useState(true)
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [timeLoading, setTimeLoading] = useState(true)
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [comment, setComment] = useState('')

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Suppress unused variable warnings
  void currentUserId

  const loadTask = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { task?: Task }
      setTask(data.task ?? null)
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  const loadSubtasks = useCallback(async () => {
    setSubtasksLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks`))
      if (!res.ok) throw new Error('Not found')
      const data = await res.json() as { subtasks?: Subtask[] }
      setSubtasks(data.subtasks ?? [])
    } catch {
      setSubtasks([])
    } finally {
      setSubtasksLoading(false)
    }
  }, [taskId])

  const loadDependencies = useCallback(async () => {
    setDepsLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/dependencies`))
      if (!res.ok) throw new Error('Not found')
      const data = await res.json() as { dependencies?: TaskDependency[] }
      setDependencies(data.dependencies ?? [])
    } catch {
      setDependencies([])
    } finally {
      setDepsLoading(false)
    }
  }, [taskId])

  const loadTimeEntries = useCallback(async () => {
    setTimeLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/time-entries?taskId=${taskId}`))
      if (!res.ok) throw new Error('Not found')
      const data = await res.json() as { items?: TimeEntry[] }
      setTimeEntries(data.items ?? [])
    } catch {
      setTimeEntries([])
    } finally {
      setTimeLoading(false)
    }
  }, [taskId])

  const loadTeamMembers = useCallback(async () => {
    if (!isAdmin) return
    try {
      const res = await fetch(apiPath('/api/admin/team-members'))
      if (res.ok) {
        const data = await res.json() as { items: TeamMemberOption[] }
        setTeamMembers(data.items ?? [])
      }
    } catch {
      // non-fatal
    }
  }, [isAdmin])

  useEffect(() => {
    loadTask()
    loadSubtasks()
    loadDependencies()
    loadTimeEntries()
    loadTeamMembers()
  }, [loadTask, loadSubtasks, loadDependencies, loadTimeEntries, loadTeamMembers])

  // ---- Mutation handlers -------------------------------------------------------

  async function handleFieldUpdate(field: string, value: unknown) {
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (res.ok) {
        await loadTask()
        showToast(`${field.charAt(0).toUpperCase() + field.slice(1)} updated`)
      }
    } catch {
      showToast('Failed to update task')
    }
  }

  async function handleStatusChange(newStatus: string) {
    setStatusUpdating(true)
    await handleFieldUpdate('status', newStatus)
    setStatusUpdating(false)
  }

  async function handlePriorityChange(priority: string | null) {
    if (!priority) return
    await handleFieldUpdate('priority', priority)
  }

  async function handleAssigneeChange(assigneeId: string | null) {
    await handleFieldUpdate('assigneeId', assigneeId || null)
  }

  async function handleDueDateSave() {
    await handleFieldUpdate('dueDate', dueDateInput || null)
    setEditingDueDate(false)
  }

  async function handleTitleSave() {
    if (!titleInput.trim()) return
    await handleFieldUpdate('title', titleInput.trim())
    setEditingTitle(false)
  }

  async function handleDescriptionSave() {
    await handleFieldUpdate('description', descInput || null)
    setEditingDesc(false)
  }

  async function toggleSubtask(sub: Subtask) {
    const updated = subtasks.map(s => s.id === sub.id ? { ...s, completed: !s.completed } : s)
    setSubtasks(updated)
    try {
      await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks/${sub.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !sub.completed }),
      })
    } catch {
      setSubtasks(subtasks)
    }
  }

  async function addSubtask() {
    if (!newSubtaskTitle.trim()) return
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}/subtasks`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newSubtaskTitle.trim() }),
      })
      if (res.ok) {
        const data = await res.json() as { subtask?: Subtask; id?: string }
        const newSub: Subtask = data.subtask ?? {
          id: data.id ?? crypto.randomUUID(),
          taskId,
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

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(apiPath(`/api/admin/tasks/${taskId}`), {
        method: 'DELETE',
      })
      if (res.ok) {
        showToast('Task deleted')
        window.location.href = '/tasks'
      } else {
        showToast('Failed to delete task')
      }
    } catch {
      showToast('Failed to delete task')
    } finally {
      setDeleting(false)
    }
  }

  // ---- Loading state -----------------------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-col" style={{ gap: '2rem', maxWidth: '68.75rem' }}>
        <div className="animate-pulse rounded" style={{ height: 16, width: 120, background: 'var(--color-bg-tertiary)' }} />
        <div
          className="bg-[var(--color-bg)] rounded-xl"
          style={{ padding: '1.5rem', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
        >
          <div className="flex items-center gap-3 animate-pulse" style={{ marginBottom: '1rem' }}>
            <div className="rounded-full" style={{ width: 80, height: 22, background: 'var(--color-bg-tertiary)' }} />
            <div className="rounded-full" style={{ width: 64, height: 22, background: 'var(--color-bg-tertiary)' }} />
          </div>
          <div className="animate-pulse rounded" style={{ height: 28, width: '60%', background: 'var(--color-bg-tertiary)', marginBottom: '0.5rem' }} />
          <div className="animate-pulse rounded" style={{ height: 14, width: '30%', background: 'var(--color-bg-tertiary)' }} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] lg:grid-cols-[1fr_20rem] gap-6">
          <div className="bg-[var(--color-bg)] rounded-xl animate-pulse" style={{ height: 300, border: '1px solid var(--color-border)' }} />
          <div className="bg-[var(--color-bg)] rounded-xl animate-pulse" style={{ height: 300, border: '1px solid var(--color-border)' }} />
        </div>
      </div>
    )
  }

  // ---- Error state -------------------------------------------------------------

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '4rem 1.5rem', gap: '0.75rem' }}>
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 48, height: 48, background: 'var(--color-danger-bg)' }}
        >
          <AlertTriangle size={22} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Failed to load task</p>
        <p className="text-xs" style={{ color: 'var(--color-text-subtle)', maxWidth: 280 }}>
          Please check your connection and refresh the page.
        </p>
      </div>
    )
  }

  // ---- Not found ---------------------------------------------------------------

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '4rem 1.5rem', gap: '0.75rem' }}>
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 48, height: 48, background: 'var(--color-bg-secondary)' }}
        >
          <FileText size={22} style={{ color: 'var(--color-text-subtle)' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Task not found</p>
        <Link
          href="/tasks"
          className="text-xs font-medium hover:underline"
          style={{ color: 'var(--color-brand)', marginTop: '0.25rem' }}
        >
          Back to tasks
        </Link>
      </div>
    )
  }

  // ---- Computed values ---------------------------------------------------------

  const teamMemberOptions = [
    { value: '', label: 'Unassigned', subtitle: 'No one assigned' },
    ...teamMembers.map(tm => ({ value: tm.id, label: tm.name })),
  ]

  const subtasksDone = subtasks.filter(s => s.completed).length
  const totalHours = timeEntries.reduce((sum, te) => sum + te.hours, 0)

  // ---- Render ------------------------------------------------------------------

  return (
    <div className="flex flex-col" style={{ gap: '1.5rem', maxWidth: '68.75rem' }}>
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Tasks', href: '/tasks' },
          { label: task.title },
        ]}
      />

      {/* Header card */}
      <div
        className="bg-[var(--color-bg)] rounded-xl"
        style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
      >
        <div style={{ padding: '1.5rem' }}>
          {/* Badges row */}
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: '0.75rem' }}>
            <StatusPill status={task.status} />
            <TypeBadge type={task.type} />
            {task.priority === 'high' || task.priority === 'urgent' ? (
              <PriorityBadge priority={task.priority} />
            ) : null}
          </div>

          {/* Title (editable inline) */}
          <div className="flex items-start gap-3">
            {editingTitle ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="text"
                  value={titleInput}
                  onChange={e => setTitleInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setEditingTitle(false) }}
                  autoFocus
                  className="flex-1 focus:outline-none"
                  style={{
                    fontSize: '1.5rem',
                    fontWeight: 700,
                    color: 'var(--color-text)',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-brand)',
                    borderRadius: '0.5rem',
                    padding: '0.25rem 0.5rem',
                    lineHeight: 1.3,
                  }}
                />
                <button
                  onClick={handleTitleSave}
                  style={{
                    padding: '0.375rem',
                    borderRadius: 'var(--radius-button)',
                    border: 'none',
                    background: 'var(--color-brand)',
                    color: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Save size={14} />
                </button>
                <button
                  onClick={() => setEditingTitle(false)}
                  style={{
                    padding: '0.375rem',
                    borderRadius: 'var(--radius-button)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-subtle)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <h1
                className="text-2xl font-bold tracking-tight flex-1 group"
                style={{ color: 'var(--color-text)', margin: 0, lineHeight: 1.3, cursor: isAdmin ? 'pointer' : 'default' }}
                onClick={() => {
                  if (isAdmin) {
                    setTitleInput(task.title)
                    setEditingTitle(true)
                  }
                }}
              >
                {task.title}
                {isAdmin && (
                  <Pencil
                    size={14}
                    className="inline-block align-text-top opacity-0 group-hover:opacity-50 transition-opacity"
                    style={{ marginLeft: '0.375rem', color: 'var(--color-text-subtle)' }}
                  />
                )}
              </h1>
            )}
          </div>

          {/* Client name + created date */}
          <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: '0.5rem' }}>
            {task.orgName && (
              <div className="flex items-center gap-1.5">
                <div
                  className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
                  style={{ width: '1.375rem', height: '1.375rem', fontSize: '0.5625rem', background: 'var(--color-brand)', color: 'white' }}
                >
                  {getInitials(task.orgName)}
                </div>
                <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  {task.orgName}
                </span>
              </div>
            )}
            <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
              Created {formatDateTime(task.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] lg:grid-cols-[1fr_20rem] gap-6">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Description */}
          <div
            className="bg-[var(--color-bg)] rounded-xl"
            style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
          >
            <div
              className="flex items-center justify-between"
              style={{
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid var(--color-row-border)',
              }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Description
              </h2>
              {isAdmin && !editingDesc && (
                <button
                  onClick={() => { setDescInput(task.description ?? ''); setEditingDesc(true) }}
                  className="flex items-center gap-1 text-xs font-medium"
                  style={{
                    padding: '0.25rem 0.5rem',
                    borderRadius: 'var(--radius-button)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; e.currentTarget.style.color = 'var(--color-brand)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
                >
                  <Pencil size={11} />
                  Edit
                </button>
              )}
            </div>
            <div style={{ padding: '1.25rem' }}>
              {editingDesc ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    value={descInput}
                    onChange={e => setDescInput(e.target.value)}
                    rows={6}
                    autoFocus
                    style={{
                      width: '100%',
                      padding: '0.625rem 0.75rem',
                      fontSize: '0.875rem',
                      color: 'var(--color-text)',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-brand)',
                      borderRadius: '0.5rem',
                      outline: 'none',
                      resize: 'vertical',
                      minHeight: '6rem',
                      fontFamily: 'inherit',
                      lineHeight: '1.6',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDescriptionSave}
                      className="flex items-center gap-1.5 font-semibold text-white"
                      style={{
                        padding: '0.375rem 0.75rem',
                        fontSize: '0.8125rem',
                        background: 'var(--color-brand)',
                        borderRadius: 'var(--radius-button)',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <Save size={13} />
                      Save
                    </button>
                    <button
                      onClick={() => setEditingDesc(false)}
                      className="font-medium"
                      style={{
                        padding: '0.375rem 0.75rem',
                        fontSize: '0.8125rem',
                        background: 'var(--color-bg)',
                        color: 'var(--color-text-muted)',
                        borderRadius: 'var(--radius-button)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : task.description ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {task.description}
                </p>
              ) : (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', margin: 0, fontStyle: 'italic' }}>
                  No description provided.
                </p>
              )}
            </div>
          </div>

          {/* Subtasks */}
          <div
            className="bg-[var(--color-bg)] rounded-xl"
            style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
          >
            <div
              className="flex items-center justify-between"
              style={{
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid var(--color-row-border)',
              }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                Subtasks
                {subtasks.length > 0 && (
                  <span
                    className="text-xs font-normal rounded-full"
                    style={{
                      padding: '0.0625rem 0.4375rem',
                      background: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-subtle)',
                    }}
                  >
                    {subtasksDone}/{subtasks.length}
                  </span>
                )}
              </h2>
            </div>
            <div style={{ padding: '1.25rem' }}>
              {/* Progress bar */}
              {subtasks.length > 0 && (
                <div className="flex items-center gap-2" style={{ marginBottom: '0.75rem' }}>
                  <div
                    className="flex-1 rounded-full overflow-hidden"
                    style={{ height: '0.375rem', background: 'var(--color-border-subtle)' }}
                  >
                    <div
                      className="rounded-full"
                      style={{
                        width: `${subtasks.length > 0 ? Math.round((subtasksDone / subtasks.length) * 100) : 0}%`,
                        height: '100%',
                        background: subtasksDone === subtasks.length ? 'var(--color-success)' : 'var(--color-brand)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap' }}>
                    {subtasks.length > 0 ? Math.round((subtasksDone / subtasks.length) * 100) : 0}%
                  </span>
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
                        padding: '0.5rem 0.625rem',
                        borderRadius: '0.375rem',
                        cursor: 'pointer',
                      }}
                      onClick={() => toggleSubtask(sub)}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      {sub.completed ? (
                        <CheckCircle2 style={{ width: '1.125rem', height: '1.125rem', color: 'var(--color-success)', flexShrink: 0 }} />
                      ) : (
                        <Circle style={{ width: '1.125rem', height: '1.125rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                      )}
                      <span style={{
                        fontSize: '0.875rem',
                        color: sub.completed ? 'var(--color-text-subtle)' : 'var(--color-text)',
                        textDecoration: sub.completed ? 'line-through' : 'none',
                      }}>
                        {sub.title}
                      </span>
                    </div>
                  ))}
                  {subtasks.length === 0 && !subtasksLoading && (
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic', margin: 0 }}>
                      No subtasks yet.
                    </p>
                  )}
                </div>
              )}

              {/* Add subtask inline */}
              {isAdmin && (
                <div className="flex items-center gap-2" style={{ marginTop: '0.75rem' }}>
                  <input
                    type="text"
                    placeholder="Add a subtask..."
                    value={newSubtaskTitle}
                    onChange={e => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }}
                    style={{
                      flex: 1,
                      padding: '0.4375rem 0.75rem',
                      fontSize: '0.8125rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: '0.5rem',
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
                      padding: '0.4375rem 0.75rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: '0.5rem',
                      border: 'none',
                      background: newSubtaskTitle.trim() ? 'var(--color-brand)' : 'var(--color-border-subtle)',
                      color: newSubtaskTitle.trim() ? 'white' : 'var(--color-text-subtle)',
                      cursor: newSubtaskTitle.trim() ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    <Plus style={{ width: '0.75rem', height: '0.75rem' }} />
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Dependencies (Blocked by) */}
          <div
            className="bg-[var(--color-bg)] rounded-xl"
            style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
          >
            <div
              style={{
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid var(--color-row-border)',
              }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <GitBranch size={14} style={{ color: 'var(--color-text-subtle)' }} />
                Blocked By
                {dependencies.length > 0 && (
                  <span
                    className="text-xs font-normal rounded-full"
                    style={{
                      padding: '0.0625rem 0.4375rem',
                      background: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-subtle)',
                    }}
                  >
                    {dependencies.length}
                  </span>
                )}
              </h2>
            </div>
            <div style={{ padding: '1.25rem' }}>
              {depsLoading ? (
                <div className="flex items-center gap-2" style={{ padding: '0.5rem 0' }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>Loading...</span>
                </div>
              ) : dependencies.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {dependencies.map(dep => (
                    <Link
                      key={dep.id}
                      href={`/tasks/${dep.dependsOnTaskId}`}
                      className="flex items-center gap-2"
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--color-border-subtle)',
                        background: 'var(--color-bg-secondary)',
                        textDecoration: 'none',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)' }}
                    >
                      <GitBranch style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.875rem', color: 'var(--color-text)', flex: 1 }}>
                        {dep.dependsOnTitle ?? dep.dependsOnTaskId}
                      </span>
                      {dep.dependsOnStatus && <StatusPill status={dep.dependsOnStatus} />}
                    </Link>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic', margin: 0 }}>
                  No dependencies.
                </p>
              )}
            </div>
          </div>

          {/* Time entries */}
          <div
            className="bg-[var(--color-bg)] rounded-xl"
            style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
          >
            <div
              className="flex items-center justify-between"
              style={{
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid var(--color-row-border)',
              }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Clock size={14} style={{ color: 'var(--color-text-subtle)' }} />
                Time Logged
                {totalHours > 0 && (
                  <span
                    className="text-xs font-normal rounded-full"
                    style={{
                      padding: '0.0625rem 0.4375rem',
                      background: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-subtle)',
                    }}
                  >
                    {totalHours.toFixed(1)}h
                  </span>
                )}
              </h2>
            </div>
            <div style={{ padding: '1.25rem' }}>
              {timeLoading ? (
                <div className="flex items-center gap-2" style={{ padding: '0.5rem 0' }}>
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>Loading...</span>
                </div>
              ) : timeEntries.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {timeEntries.map(entry => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between"
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--color-border-subtle)',
                        background: 'var(--color-bg-secondary)',
                      }}
                    >
                      <div>
                        <p style={{ fontSize: '0.875rem', color: 'var(--color-text)', margin: 0 }}>
                          {entry.description ?? 'Time entry'}
                        </p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', margin: '0.125rem 0 0' }}>
                          {entry.teamMemberName ?? 'Team member'} - {formatDateTime(entry.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>
                          {entry.hours.toFixed(1)}h
                        </span>
                        {entry.billable && (
                          <span
                            className="rounded-full text-xs"
                            style={{ padding: '0.0625rem 0.375rem', background: 'var(--color-brand-50)', color: 'var(--color-brand-dark)' }}
                          >
                            Billable
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Clock style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }} />
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
                    No time entries yet.
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Activity / Comments */}
          <div
            className="bg-[var(--color-bg)] rounded-xl"
            style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
          >
            <div
              style={{
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid var(--color-row-border)',
              }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Activity
              </h2>
            </div>
            <div style={{ padding: '1.25rem' }}>
              <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Add a comment or note... Use @name to mention someone."
                rows={3}
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  fontSize: '0.875rem',
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
                @mentions coming soon.
              </p>
            </div>
          </div>
        </div>

        {/* Right column: Metadata sidebar */}
        <div className="flex flex-col gap-4">
          {/* Status actions (admin only) */}
          {isAdmin && (
            <SidebarCard title="Status">
              <div className="flex flex-col" style={{ gap: '0.375rem' }}>
                {STATUS_OPTIONS.filter(s => s.value !== task.status).map(s => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => handleStatusChange(s.value)}
                    disabled={statusUpdating}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      color: 'var(--color-text)',
                      background: 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-button)',
                      cursor: statusUpdating ? 'not-allowed' : 'pointer',
                      opacity: statusUpdating ? 0.5 : 1,
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (!statusUpdating) {
                        e.currentTarget.style.borderColor = 'var(--color-brand)'
                        e.currentTarget.style.background = 'var(--color-brand-50)'
                        e.currentTarget.style.color = 'var(--color-brand-dark)'
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.background = 'var(--color-bg)'
                      e.currentTarget.style.color = 'var(--color-text)'
                    }}
                  >
                    {statusUpdating ? (
                      <Loader2 size={13} className="animate-spin" style={{ flexShrink: 0 }} />
                    ) : (
                      <span
                        style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: (TASK_STATUS_CONFIG[s.value] ?? TASK_STATUS_CONFIG.todo).dot, flexShrink: 0,
                        }}
                      />
                    )}
                    Move to {s.label}
                  </button>
                ))}
              </div>
            </SidebarCard>
          )}

          {/* Details card */}
          <SidebarCard title="Details">
            <div className="flex flex-col" style={{ gap: '0.875rem' }}>
              <DetailRow label="Type">
                <TypeBadge type={task.type} />
              </DetailRow>

              {/* Priority (editable for admin) */}
              <DetailRow label="Priority">
                {isAdmin ? (
                  <div style={{ width: '100%', maxWidth: '10rem' }}>
                    <SearchableSelect
                      options={PRIORITY_OPTIONS}
                      value={task.priority}
                      onChange={handlePriorityChange}
                      placeholder="Select priority"
                      size="sm"
                    />
                  </div>
                ) : (
                  <PriorityBadge priority={task.priority} />
                )}
              </DetailRow>

              {/* Assignee (editable for admin) */}
              <DetailRow label="Assignee">
                {isAdmin ? (
                  <div style={{ width: '100%', maxWidth: '10rem' }}>
                    <SearchableSelect
                      options={teamMemberOptions}
                      value={task.assigneeId ?? ''}
                      onChange={handleAssigneeChange}
                      placeholder="Select assignee"
                      size="sm"
                    />
                  </div>
                ) : (
                  <span>{task.assigneeName ?? 'Unassigned'}</span>
                )}
              </DetailRow>

              {/* Due date (editable) */}
              <DetailRow label="Due Date">
                {isAdmin && editingDueDate ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={dueDateInput}
                      onChange={e => setDueDateInput(e.target.value)}
                      autoFocus
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.8125rem',
                        border: '1px solid var(--color-brand)',
                        borderRadius: '0.375rem',
                        background: 'var(--color-bg)',
                        color: 'var(--color-text)',
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={handleDueDateSave}
                      style={{
                        padding: '0.25rem',
                        borderRadius: '0.25rem',
                        border: 'none',
                        background: 'var(--color-brand)',
                        color: 'white',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Save size={12} />
                    </button>
                    <button
                      onClick={() => setEditingDueDate(false)}
                      style={{
                        padding: '0.25rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg)',
                        color: 'var(--color-text-subtle)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <span
                    className="flex items-center gap-1"
                    style={{ cursor: isAdmin ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (isAdmin) {
                        setDueDateInput(task.dueDate ?? '')
                        setEditingDueDate(true)
                      }
                    }}
                    onMouseEnter={e => { if (isAdmin) e.currentTarget.style.color = 'var(--color-brand)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text)' }}
                  >
                    <Calendar size={13} style={{ color: 'var(--color-text-subtle)' }} />
                    {formatDate(task.dueDate)}
                    {isAdmin && <Pencil size={10} className="opacity-50" style={{ marginLeft: '0.25rem' }} />}
                  </span>
                )}
              </DetailRow>

              {/* Client */}
              {task.orgName && (
                <DetailRow label="Client">
                  <span>{task.orgName}</span>
                </DetailRow>
              )}

              {/* Linked request */}
              {task.requestId && (
                <DetailRow label="Linked Request">
                  <Link
                    href={`/requests/${task.requestId}`}
                    className="inline-flex items-center gap-1"
                    style={{ fontSize: '0.8125rem', color: 'var(--color-brand)', textDecoration: 'none' }}
                    onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                    onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
                  >
                    <Link2 style={{ width: '0.75rem', height: '0.75rem' }} />
                    View Request
                  </Link>
                </DetailRow>
              )}

              {/* Created */}
              <DetailRow label="Created">
                <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                  {formatDateTime(task.createdAt)}
                </span>
              </DetailRow>

              {/* Updated */}
              <DetailRow label="Updated">
                <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                  {formatDateTime(task.updatedAt)}
                </span>
              </DetailRow>
            </div>
          </SidebarCard>

          {/* Delete button */}
          {isAdmin && (
            <div>
              {showDeleteConfirm ? (
                <div
                  className="bg-[var(--color-bg)] rounded-xl"
                  style={{ padding: '1rem', border: '1px solid var(--color-danger)', boxShadow: 'var(--shadow-xs)' }}
                >
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)', marginBottom: '0.5rem' }}>
                    Are you sure you want to delete this task?
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                    This action cannot be undone. All subtasks and dependencies will also be removed.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="flex items-center gap-1.5 font-semibold text-white"
                      style={{
                        padding: '0.375rem 0.75rem',
                        fontSize: '0.8125rem',
                        background: 'var(--color-danger)',
                        borderRadius: 'var(--radius-button)',
                        border: 'none',
                        cursor: deleting ? 'not-allowed' : 'pointer',
                        opacity: deleting ? 0.5 : 1,
                      }}
                    >
                      {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={deleting}
                      className="font-medium"
                      style={{
                        padding: '0.375rem 0.75rem',
                        fontSize: '0.8125rem',
                        background: 'var(--color-bg)',
                        color: 'var(--color-text-muted)',
                        borderRadius: 'var(--radius-button)',
                        border: '1px solid var(--color-border)',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 w-full justify-center font-medium"
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.8125rem',
                    color: 'var(--color-danger)',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '0.5rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'var(--color-danger-bg)'
                    e.currentTarget.style.borderColor = 'var(--color-danger)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'var(--color-bg)'
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                  }}
                >
                  <Trash2 size={13} />
                  Delete Task
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

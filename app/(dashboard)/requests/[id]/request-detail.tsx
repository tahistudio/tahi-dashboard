'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiPath } from '@/lib/api'
import {
  ArrowLeft, Clock, AlertTriangle, RefreshCw,
  User, ChevronDown, CheckCircle2, Loader2,
  FileText, Image as ImageIcon, Download, Paperclip,
  Calendar, Edit2,
} from 'lucide-react'
import Link from 'next/link'
import { RequestThread } from '@/components/tahi/request-thread'
import { TiptapEditor } from '@/components/tahi/tiptap-editor'
import { StatusBadge } from '@/components/tahi/status-badge'
import { cn } from '@/lib/utils'

const STATUS_FLOW = [
  'submitted',
  'in_review',
  'in_progress',
  'client_review',
  'delivered',
] as const

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  in_review: 'In Review',
  in_progress: 'In Progress',
  client_review: 'Client Review',
  delivered: 'Delivered',
  archived: 'Archived',
  draft: 'Draft',
}

interface Request {
  id: string
  orgId: string
  orgName: string | null
  type: string
  category: string | null
  title: string
  description: string | null
  status: string
  priority: string
  assigneeId: string | null
  assigneeName: string | null
  estimatedHours: number | null
  startDate: string | null
  dueDate: string | null
  revisionCount: number
  maxRevisions: number
  scopeFlagged: boolean
  isInternal: boolean
  tags: string
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
}

interface Message {
  id: string
  authorId: string
  authorType: 'team_member' | 'contact'
  body: string
  isInternal: boolean
  editedAt: string | null
  createdAt: string
  teamMemberName?: string | null
  teamMemberAvatar?: string | null
}

interface RequestFile {
  id: string
  filename: string
  storageKey: string
  mimeType: string | null
  sizeBytes: number | null
  uploadedByType: string
  createdAt: string
  uploaderName?: string | null
}

interface TeamMemberOption {
  id: string
  name: string
}

interface RequestDetailProps {
  requestId: string
  isAdmin: boolean
  currentUserId?: string
}

export function RequestDetail({ requestId, isAdmin, currentUserId }: RequestDetailProps) {
  const [request, setRequest] = useState<Request | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [files, setFiles] = useState<RequestFile[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [isInternal, setIsInternal] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [editingPriority, setEditingPriority] = useState(false)
  const [editingAssignee, setEditingAssignee] = useState(false)
  const [editingDueDate, setEditingDueDate] = useState(false)
  const [dueDateInput, setDueDateInput] = useState('')
  const threadBottomRef = useRef<HTMLDivElement>(null)

  const apiBase = isAdmin ? apiPath('/api/admin') : apiPath('/api/portal')

  const loadFiles = useCallback(async () => {
    if (!isAdmin) return // portal doesn't have files endpoint yet
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/files`))
      if (res.ok) {
        const data = await res.json() as { items: RequestFile[] }
        setFiles(data.items ?? [])
      }
    } catch {
      // non-fatal: files panel will stay empty
    }
  }, [requestId, isAdmin])

  const loadRequest = useCallback(async () => {
    try {
      const [reqRes, msgRes] = await Promise.all([
        fetch(`${apiBase}/requests/${requestId}`),
        fetch(isAdmin
          ? apiPath(`/api/admin/requests/${requestId}/messages`)
          : `${apiBase}/requests/${requestId}`
        ),
      ])
      if (reqRes.ok) {
        const data = await reqRes.json() as { request: Request }
        setRequest(data.request)
      }
      if (msgRes.ok) {
        if (isAdmin) {
          const data = await msgRes.json() as { items: Message[] }
          setMessages(data.items ?? [])
        } else {
          const data = await msgRes.json() as { request: Request; messages: Message[] }
          setRequest(data.request)
          setMessages(data.messages ?? [])
        }
      }
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [requestId, apiBase, isAdmin])

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
    loadRequest()
    loadFiles()
    loadTeamMembers()
  }, [loadRequest, loadFiles, loadTeamMembers])

  // Scroll thread to bottom on new messages
  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSendMessage(html: string) {
    const url = isAdmin
      ? apiPath(`/api/admin/requests/${requestId}/messages`)
      : apiPath(`/api/portal/requests/${requestId}/messages`)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: html, isInternal }),
    })
    if (res.ok) {
      await Promise.all([loadRequest(), loadFiles()])
    }
  }

  async function handleStatusChange(newStatus: string) {
    setStatusUpdating(true)
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    await loadRequest()
    setStatusUpdating(false)
  }

  async function handleScopeFlagToggle() {
    if (!request) return
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scopeFlagged: !request.scopeFlagged }),
    })
    await loadRequest()
  }

  async function handlePriorityChange(priority: string) {
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    })
    setEditingPriority(false)
    await loadRequest()
  }

  async function handleAssigneeChange(assigneeId: string | null) {
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeId }),
    })
    setEditingAssignee(false)
    await loadRequest()
  }

  async function handleDueDateChange(dueDate: string | null) {
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate }),
    })
    setEditingDueDate(false)
    await loadRequest()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-[var(--color-brand)]" size={28} />
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="text-center py-16" style={{ color: 'var(--color-danger)' }}>
        Failed to load request. Please refresh the page.
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-16 text-gray-500">
        Request not found.
      </div>
    )
  }

  const currentStatusIdx = STATUS_FLOW.indexOf(request.status as typeof STATUS_FLOW[number])

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back nav */}
      <div className="mb-6">
        <Link
          href="/requests"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to requests
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
        {/* ── Main content ────────────────────────────────────────────── */}
        <div className="flex flex-col gap-6">
          {/* Header card */}
          <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <StatusBadge status={request.status} />
                  {request.priority === 'high' && (
                    <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                      High Priority
                    </span>
                  )}
                  {request.scopeFlagged && (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium flex items-center gap-1">
                      <AlertTriangle size={10} />
                      Scope flagged
                    </span>
                  )}
                  {request.revisionCount > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full flex items-center gap-1">
                      <RefreshCw size={10} />
                      Revision {request.revisionCount}/{request.maxRevisions}
                    </span>
                  )}
                </div>
                <h1 className="text-xl font-semibold text-gray-900">{request.title}</h1>
                {request.orgName && (
                  <p className="text-sm text-gray-500 mt-1">{request.orgName}</p>
                )}
              </div>
            </div>

            {/* Status stepper */}
            <div className="flex items-center gap-0 mt-6 overflow-x-auto pb-1">
              {STATUS_FLOW.map((s, i) => {
                const isDone = currentStatusIdx > i
                const isCurrent = currentStatusIdx === i
                const isLast = i === STATUS_FLOW.length - 1
                return (
                  <div key={s} className="flex items-center min-w-0 flex-shrink-0">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-colors',
                        isDone
                          ? 'bg-[var(--color-brand)] border-[var(--color-brand)] text-white'
                          : isCurrent
                            ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-white'
                            : 'border-gray-300 text-gray-400 bg-white',
                      )}>
                        {isDone ? <CheckCircle2 size={14} /> : i + 1}
                      </div>
                      <span className={cn(
                        'text-[10px] mt-1 whitespace-nowrap',
                        isCurrent ? 'text-[var(--color-brand)] font-semibold' : 'text-gray-400',
                      )}>
                        {STATUS_LABELS[s]}
                      </span>
                    </div>
                    {!isLast && (
                      <div className={cn(
                        'h-0.5 w-8 mx-1 flex-shrink-0',
                        isDone ? 'bg-[var(--color-brand)]' : 'bg-gray-200',
                      )} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Description */}
          {request.description && (
            <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-6">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Description</h2>
              <div
                className="prose prose-sm max-w-none text-gray-700"
                dangerouslySetInnerHTML={{ __html: request.description }}
              />
            </div>
          )}

          {/* Thread */}
          <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-6 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Thread
              {messages.length > 0 && (
                <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-normal">
                  {messages.length}
                </span>
              )}
            </h2>

            <RequestThread messages={messages} currentUserId={currentUserId} />
            <div ref={threadBottomRef} />

            {/* Compose */}
            <TiptapEditor
              onSubmit={handleSendMessage}
              isInternal={isInternal}
              onInternalToggle={isAdmin ? setIsInternal : undefined}
              placeholder={isAdmin ? 'Reply to client or add an internal note…' : 'Add a comment or question…'}
              isAdmin={isAdmin}
              requestId={requestId}
              orgId={request?.orgId}
            />
          </div>

          {/* Files */}
          {(files.length > 0 || isAdmin) && (
            <FilesPanel files={files} onRefresh={loadFiles} />
          )}
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {/* Status actions (admin only) */}
          {isAdmin && (
            <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Status</h3>
              <div className="flex flex-col gap-1.5">
                {STATUS_FLOW.filter(s => s !== request.status).map(s => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    disabled={statusUpdating}
                    className={cn(
                      'w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors',
                      'border-gray-200 hover:border-[var(--color-brand)] hover:bg-green-50/50',
                      'disabled:opacity-50 disabled:cursor-not-allowed',
                    )}
                  >
                    {statusUpdating ? (
                      <Loader2 size={12} className="animate-spin inline mr-2" />
                    ) : (
                      <ChevronDown size={12} className="inline mr-2 text-gray-400" />
                    )}
                    Move to {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Details card */}
          <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Details</h3>
            <dl className="flex flex-col gap-3 text-sm">
              <Row label="Type" value={request.type.replace(/_/g, ' ')} />
              {request.category && <Row label="Category" value={request.category} />}

              {/* Priority (editable for admin) */}
              <div className="flex justify-between items-start gap-2">
                <dt className="text-gray-400 flex-shrink-0">Priority</dt>
                <dd className="text-gray-700 text-right">
                  {isAdmin && editingPriority ? (
                    <select
                      value={request.priority}
                      onChange={e => handlePriorityChange(e.target.value)}
                      onBlur={() => setEditingPriority(false)}
                      autoFocus
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-[var(--color-brand)]"
                      style={{ minWidth: 100 }}
                    >
                      <option value="standard">Standard</option>
                      <option value="high">High</option>
                    </select>
                  ) : (
                    <span
                      className={cn(
                        'capitalize flex items-center gap-1',
                        isAdmin && 'cursor-pointer hover:text-[var(--color-brand)]',
                      )}
                      onClick={() => isAdmin && setEditingPriority(true)}
                    >
                      {request.priority}
                      {isAdmin && <Edit2 size={10} className="text-gray-400" />}
                    </span>
                  )}
                </dd>
              </div>

              {/* Assignee (editable for admin) */}
              <div className="flex justify-between items-start gap-2">
                <dt className="text-gray-400 flex-shrink-0">Assignee</dt>
                <dd className="text-gray-700 text-right">
                  {isAdmin && editingAssignee ? (
                    <select
                      value={request.assigneeId ?? ''}
                      onChange={e => handleAssigneeChange(e.target.value || null)}
                      onBlur={() => setEditingAssignee(false)}
                      autoFocus
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-[var(--color-brand)]"
                      style={{ minWidth: 120 }}
                    >
                      <option value="">Unassigned</option>
                      {teamMembers.map(tm => (
                        <option key={tm.id} value={tm.id}>{tm.name}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={cn(
                        'flex items-center gap-1.5',
                        isAdmin && 'cursor-pointer hover:text-[var(--color-brand)]',
                      )}
                      onClick={() => isAdmin && setEditingAssignee(true)}
                    >
                      <User size={12} />
                      {request.assigneeName ?? 'Unassigned'}
                      {isAdmin && <Edit2 size={10} className="text-gray-400" />}
                    </span>
                  )}
                </dd>
              </div>

              {/* Due date (editable for admin) */}
              <div className="flex justify-between items-start gap-2">
                <dt className="text-gray-400 flex-shrink-0">Due date</dt>
                <dd className="text-gray-700 text-right">
                  {isAdmin && editingDueDate ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="date"
                        value={dueDateInput}
                        onChange={e => setDueDateInput(e.target.value)}
                        autoFocus
                        className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-[var(--color-brand)]"
                      />
                      <button
                        onClick={() => handleDueDateChange(dueDateInput || null)}
                        className="text-xs px-2 py-1 bg-[var(--color-brand)] text-white rounded hover:opacity-90"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingDueDate(false)}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <span
                      className={cn(
                        'flex items-center gap-1',
                        isAdmin && 'cursor-pointer hover:text-[var(--color-brand)]',
                      )}
                      onClick={() => {
                        if (isAdmin) {
                          setDueDateInput(request.dueDate ?? '')
                          setEditingDueDate(true)
                        }
                      }}
                    >
                      <Calendar size={12} />
                      {request.dueDate ? formatDate(request.dueDate) : 'Not set'}
                      {isAdmin && <Edit2 size={10} className="text-gray-400" />}
                    </span>
                  )}
                </dd>
              </div>

              {request.estimatedHours != null && (
                <Row
                  label="Estimated"
                  value={
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {request.estimatedHours}h
                    </span>
                  }
                />
              )}
              <Row label="Created" value={formatDate(request.createdAt)} />
              {request.deliveredAt && <Row label="Delivered" value={formatDate(request.deliveredAt)} />}
            </dl>
          </div>

          {/* Admin actions */}
          {isAdmin && (
            <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Admin</h3>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleScopeFlagToggle}
                  className={cn(
                    'w-full text-left text-sm px-3 py-2 rounded-lg border transition-colors flex items-center gap-2',
                    request.scopeFlagged
                      ? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                      : 'border-gray-200 text-gray-600 hover:border-orange-300 hover:bg-orange-50',
                  )}
                >
                  <AlertTriangle size={13} />
                  {request.scopeFlagged ? 'Remove scope flag' : 'Flag as scope creep'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FilesPanel ────────────────────────────────────────────────────────────────

function FilesPanel({ files, onRefresh }: { files: RequestFile[]; onRefresh: () => void }) {
  function fileIcon(mimeType: string | null) {
    if (!mimeType) return <FileText size={14} className="text-gray-400" />
    if (mimeType.startsWith('image/')) return <ImageIcon size={14} className="text-purple-400" />
    if (mimeType === 'application/pdf') return <FileText size={14} className="text-red-400" />
    return <FileText size={14} className="text-gray-400" />
  }

  function formatBytes(n: number | null) {
    if (!n) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="bg-white rounded-[var(--radius-card)] border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
          <Paperclip size={14} />
          Files
          {files.length > 0 && (
            <span className="ml-1 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-normal">
              {files.length}
            </span>
          )}
        </h2>
        <button
          onClick={onRefresh}
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {files.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">No files attached yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-100">
          {files.map(f => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              <div className="flex-shrink-0">{fileIcon(f.mimeType)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{f.filename}</p>
                <p className="text-xs text-gray-400">
                  {f.uploaderName ?? f.uploadedByType}
                  {f.sizeBytes ? ` · ${formatBytes(f.sizeBytes)}` : ''}
                  {' · '}{formatDate(f.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {f.mimeType?.startsWith('image/') && (
                  <a
                    href={`/api/uploads/serve?key=${encodeURIComponent(f.storageKey)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    title="View"
                  >
                    <ImageIcon size={14} />
                  </a>
                )}
                <a
                  href={`/api/uploads/serve?key=${encodeURIComponent(f.storageKey)}&download=1`}
                  className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  title="Download"
                >
                  <Download size={14} />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2">
      <dt className="text-gray-400 flex-shrink-0">{label}</dt>
      <dd className="text-gray-700 text-right capitalize">{value}</dd>
    </div>
  )
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

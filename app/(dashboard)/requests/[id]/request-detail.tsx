'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { apiPath } from '@/lib/api'
import {
  Clock, AlertTriangle, RefreshCw,
  User, CheckCircle2, Loader2, Activity,
  FileText, Image as ImageIcon, Download, Paperclip,
  Calendar, Upload, Plus, Trash2, ListChecks, DownloadCloud, Eye, EyeOff,
} from 'lucide-react'
import Link from 'next/link'
import { RequestThread } from '@/components/tahi/request-thread'
import dynamic from 'next/dynamic'
const TiptapEditor = dynamic(() => import('@/components/tahi/tiptap-editor').then(m => ({ default: m.TiptapEditor })), { ssr: false })
import { StatusBadge } from '@/components/tahi/status-badge'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { useToast } from '@/components/tahi/toast'

// ---- Constants ---------------------------------------------------------------

const BRAND = '#5A824E'

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

const PRIORITY_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
]

// ---- Types -------------------------------------------------------------------

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
  requestNumber: number | null
  checklists: string
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

interface ChecklistItem {
  label: string
  done: boolean
}

interface Checklist {
  title: string
  items: ChecklistItem[]
}

interface RequestDetailProps {
  requestId: string
  isAdmin: boolean
  currentUserId?: string
}

// ---- Main Component ----------------------------------------------------------

export function RequestDetail({ requestId, isAdmin, currentUserId }: RequestDetailProps) {
  const [request, setRequest] = useState<Request | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [files, setFiles] = useState<RequestFile[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [isInternal, setIsInternal] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [editingDueDate, setEditingDueDate] = useState(false)
  const [dueDateInput, setDueDateInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const threadBottomRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  // Load following state from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(`tahi-following-${requestId}`)
      setIsFollowing(stored === 'true')
    }
  }, [requestId])

  function toggleFollowing() {
    const next = !isFollowing
    setIsFollowing(next)
    if (typeof window !== 'undefined') {
      if (next) {
        localStorage.setItem(`tahi-following-${requestId}`, 'true')
      } else {
        localStorage.removeItem(`tahi-following-${requestId}`)
      }
    }
  }

  const apiBase = isAdmin ? apiPath('/api/admin') : apiPath('/api/portal')

  const loadFiles = useCallback(async () => {
    try {
      const url = isAdmin
        ? apiPath(`/api/admin/requests/${requestId}/files`)
        : apiPath(`/api/portal/requests/${requestId}/files`)
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json() as { items: RequestFile[] }
        setFiles(data.items ?? [])
      }
    } catch {
      // non-fatal
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
        try {
          setChecklists(JSON.parse(data.request.checklists || '[]') as Checklist[])
        } catch {
          setChecklists([])
        }
      }
      if (msgRes.ok) {
        if (isAdmin) {
          const data = await msgRes.json() as { items: Message[] }
          setMessages(data.items ?? [])
        } else {
          const data = await msgRes.json() as { request: Request; messages: Message[] }
          setRequest(data.request)
          try {
            setChecklists(JSON.parse(data.request.checklists || '[]') as Checklist[])
          } catch {
            setChecklists([])
          }
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

  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSendMessage(html: string) {
    // Create a request_thread conversation on first message if none exists
    let convId = conversationId
    if (!convId && isAdmin && request) {
      try {
        const convRes = await fetch(apiPath('/api/admin/conversations'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'request_thread',
            name: request.title,
            orgId: request.orgId,
            requestId,
            visibility: isInternal ? 'internal' : 'external',
            participantIds: [],
          }),
        })
        if (convRes.ok) {
          const convData = await convRes.json() as { id: string }
          convId = convData.id
          setConversationId(convId)
        }
      } catch {
        // Continue sending even if conversation creation fails
      }
    }

    const url = isAdmin
      ? apiPath(`/api/admin/requests/${requestId}/messages`)
      : apiPath(`/api/portal/requests/${requestId}/messages`)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: html,
        isInternal,
        conversationId: convId ?? undefined,
      }),
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
    showToast(`Status updated to ${STATUS_LABELS[newStatus] ?? newStatus}`)
  }

  async function saveChecklists(updated: Checklist[]) {
    setChecklists(updated)
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checklists: JSON.stringify(updated) }),
    })
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

  async function handlePriorityChange(priority: string | null) {
    if (!priority) return
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    })
    await loadRequest()
  }

  async function handleAssigneeChange(assigneeId: string | null) {
    await fetch(apiPath(`/api/admin/requests/${requestId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigneeId }),
    })
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

  // ---- Loading / Error / Not Found ------------------------------------------

  if (loading) {
    return (
      <div className="flex flex-col" style={{ gap: '2rem', maxWidth: '68.75rem' }}>
        {/* Back link skeleton */}
        <div className="animate-pulse rounded" style={{ height: 16, width: 120, background: 'var(--color-bg-tertiary)' }} />
        {/* Header skeleton */}
        <div
          className="bg-[var(--color-bg)] rounded-xl"
          style={{ padding: '1.5rem', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
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

  if (fetchError) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '4rem 1.5rem', gap: '0.75rem' }}>
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 48, height: 48, background: 'var(--color-danger-bg)' }}
        >
          <AlertTriangle size={22} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Failed to load request</p>
        <p className="text-xs" style={{ color: 'var(--color-text-subtle)', maxWidth: 280 }}>
          Please check your connection and refresh the page.
        </p>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ padding: '4rem 1.5rem', gap: '0.75rem' }}>
        <div
          className="flex items-center justify-center rounded-xl"
          style={{ width: 48, height: 48, background: 'var(--color-bg-secondary)' }}
        >
          <FileText size={22} style={{ color: 'var(--color-text-subtle)' }} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Request not found</p>
        <Link
          href="/requests"
          className="text-xs font-medium hover:underline"
          style={{ color: BRAND, marginTop: '0.25rem' }}
        >
          Back to requests
        </Link>
      </div>
    )
  }

  const currentStatusIdx = STATUS_FLOW.indexOf(request.status as typeof STATUS_FLOW[number])

  const teamMemberOptions = [
    { value: '', label: 'Unassigned', subtitle: 'No one assigned' },
    ...teamMembers.map(tm => ({ value: tm.id, label: tm.name })),
  ]

  return (
    <div className="flex flex-col" style={{ gap: '1.5rem', maxWidth: '68.75rem' }}>
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Requests', href: '/requests' },
          { label: request.requestNumber != null
            ? `#${String(request.requestNumber).padStart(3, '0')} ${request.title}`
            : request.title
          },
        ]}
      />

      {/* Header card */}
      <div
        className="bg-[var(--color-bg)] rounded-xl"
        style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
      >
        <div style={{ padding: '1.5rem' }}>
          {/* Badges row */}
          <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: '0.75rem' }}>
            <StatusBadge status={request.status} />
            {request.priority === 'high' && (
              <span
                className="inline-flex items-center text-xs font-medium rounded-full"
                style={{
                  padding: '0.125rem 0.5rem',
                  background: 'var(--status-in-review-bg)',
                  color: 'var(--status-in-review-text)',
                  border: '1px solid var(--status-in-review-border)',
                }}
              >
                High Priority
              </span>
            )}
            {request.scopeFlagged && (
              <span
                className="inline-flex items-center gap-1 text-xs font-medium rounded-full"
                style={{
                  padding: '0.125rem 0.5rem',
                  background: 'var(--color-danger-bg)',
                  color: 'var(--color-danger)',
                }}
              >
                <AlertTriangle size={10} />
                Scope flagged
              </span>
            )}
            {request.revisionCount > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs rounded-full"
                style={{
                  padding: '0.125rem 0.5rem',
                  background: 'var(--status-submitted-bg)',
                  color: 'var(--status-submitted-text)',
                  border: '1px solid var(--status-submitted-border)',
                }}
              >
                <RefreshCw size={10} />
                Revision {request.revisionCount}/{request.maxRevisions}
              </span>
            )}
          </div>

          {/* Title + Follow */}
          <div className="flex items-start gap-3">
            <h1
              className="text-2xl font-bold tracking-tight flex-1"
              style={{ color: 'var(--color-text)', margin: 0, lineHeight: 1.3 }}
            >
              {isFollowing && (
                <Eye
                  size={16}
                  className="inline-block align-text-top"
                  style={{ color: 'var(--color-brand)', marginRight: '0.375rem' }}
                  aria-label="Following this request"
                />
              )}
              {request.requestNumber != null && (
                <span className="font-mono" style={{ color: 'var(--color-text-subtle)', marginRight: '0.375rem' }}>
                  #{String(request.requestNumber).padStart(3, '0')}
                </span>
              )}
              {request.title}
            </h1>
            <button
              onClick={toggleFollowing}
              className="flex items-center gap-1.5 text-xs font-medium transition-colors flex-shrink-0"
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: 'var(--radius-button)',
                border: '1px solid var(--color-border)',
                background: isFollowing ? 'var(--color-brand-50)' : 'var(--color-bg)',
                color: isFollowing ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                minHeight: '2rem',
              }}
              aria-label={isFollowing ? 'Unfollow this request' : 'Follow this request'}
            >
              {isFollowing ? (
                <>
                  <EyeOff size={13} aria-hidden="true" />
                  Unfollow
                </>
              ) : (
                <>
                  <Eye size={13} aria-hidden="true" />
                  Follow
                </>
              )}
            </button>
          </div>

          {/* Client name + avatar */}
          {request.orgName && (
            <div className="flex items-center gap-2" style={{ marginTop: '0.5rem' }}>
              <div
                className="flex items-center justify-center rounded-full flex-shrink-0"
                style={{ width: 24, height: 24, background: 'var(--color-bg-tertiary)', color: 'var(--color-text-subtle)' }}
              >
                <User size={12} />
              </div>
              <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                {request.orgName}
              </span>
            </div>
          )}
        </div>

        {/* Status stepper */}
        <div
          style={{
            padding: '0 1.5rem 1.25rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0,
            overflowX: 'auto',
          }}
        >
          {STATUS_FLOW.map((s, i) => {
            const isDone = currentStatusIdx > i
            const isCurrent = currentStatusIdx === i
            const isLast = i === STATUS_FLOW.length - 1
            return (
              <div key={s} className="flex items-center flex-shrink-0">
                <div className="flex flex-col items-center" style={{ minWidth: '3.5rem' }}>
                  <div
                    className="flex items-center justify-center rounded-full"
                    style={{
                      width: 28,
                      height: 28,
                      border: `2px solid ${isDone || isCurrent ? BRAND : 'var(--color-border)'}`,
                      background: isDone ? BRAND : 'var(--color-bg)',
                      color: isDone ? '#ffffff' : isCurrent ? BRAND : 'var(--color-text-subtle)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      transition: 'all 0.2s',
                    }}
                  >
                    {isDone ? <CheckCircle2 size={14} /> : i + 1}
                  </div>
                  <span
                    style={{
                      fontSize: '0.625rem',
                      marginTop: '0.3125rem',
                      whiteSpace: 'nowrap',
                      color: isCurrent ? BRAND : 'var(--color-text-subtle)',
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                  >
                    {STATUS_LABELS[s]}
                  </span>
                </div>
                {!isLast && (
                  <div
                    style={{
                      width: '2rem',
                      height: 2,
                      background: isDone ? BRAND : 'var(--color-border)',
                      marginTop: '-0.875rem',
                      flexShrink: 0,
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] lg:grid-cols-[1fr_20rem] gap-6">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Description */}
          {request.description && (
            <div
              className="bg-[var(--color-bg)] rounded-xl"
              style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
            >
              <div
                style={{
                  padding: '0.875rem 1.25rem',
                  borderBottom: '1px solid var(--color-row-border)',
                }}
              >
                <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Description
                </h2>
              </div>
              <div
                className="prose prose-sm max-w-none"
                style={{ padding: '1.25rem', color: 'var(--color-text)', fontSize: '0.875rem', lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: request.description }}
              />
            </div>
          )}

          {/* Thread */}
          <div
            className="bg-[var(--color-bg)] rounded-xl"
            style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
          >
            <div
              className="flex items-center justify-between"
              style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-row-border)' }}
            >
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                Thread
                {messages.length > 0 && (
                  <span
                    className="text-xs font-normal rounded-full"
                    style={{
                      padding: '0.0625rem 0.4375rem',
                      background: 'var(--color-bg-tertiary)',
                      color: 'var(--color-text-subtle)',
                    }}
                  >
                    {messages.length}
                  </span>
                )}
              </h2>
            </div>

            <div style={{ padding: '1.25rem' }}>
              <RequestThread messages={messages} currentUserId={currentUserId} />
              <div ref={threadBottomRef} />
            </div>

            {/* Composer */}
            <div
              style={{
                padding: '1rem 1.25rem',
                borderTop: '1px solid var(--color-row-border)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <TiptapEditor
                onSubmit={handleSendMessage}
                isInternal={isInternal}
                onInternalToggle={isAdmin ? setIsInternal : undefined}
                placeholder={isAdmin ? 'Reply to client or add an internal note...' : 'Add a comment or question...'}
                isAdmin={isAdmin}
                requestId={requestId}
                orgId={request?.orgId}
              />
            </div>
          </div>

          {/* Activity Log */}
          <ActivityLog request={request} messages={messages} files={files} />

          {/* Checklists */}
          <ChecklistsPanel
            checklists={checklists}
            onSave={saveChecklists}
            isAdmin={isAdmin}
          />

          {/* Files */}
          <FilesPanel
            files={files}
            onRefresh={loadFiles}
            requestId={requestId}
            orgId={request.orgId}
            isAdmin={isAdmin}
          />
        </div>

        {/* Right column: Metadata sidebar */}
        <div className="flex flex-col gap-4">
          {/* Status actions (admin only) */}
          {isAdmin && (
            <SidebarCard title="Status">
              <div className="flex flex-col" style={{ gap: '0.375rem' }}>
                {STATUS_FLOW.filter(s => s !== request.status).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleStatusChange(s)}
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
                        e.currentTarget.style.borderColor = BRAND
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
                          background: BRAND, flexShrink: 0,
                        }}
                      />
                    )}
                    Move to {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </SidebarCard>
          )}

          {/* Details card */}
          <SidebarCard title="Details">
            <div className="flex flex-col" style={{ gap: '0.875rem' }}>
              <DetailRow label="Type">
                <span className="capitalize">{request.type.replace(/_/g, ' ')}</span>
              </DetailRow>

              {request.category && (
                <DetailRow label="Category">
                  <span className="capitalize">{request.category}</span>
                </DetailRow>
              )}

              {/* Priority (editable for admin via searchable-select) */}
              <DetailRow label="Priority">
                {isAdmin ? (
                  <div style={{ width: '100%', maxWidth: '10rem' }}>
                    <SearchableSelect
                      options={PRIORITY_OPTIONS}
                      value={request.priority}
                      onChange={handlePriorityChange}
                      placeholder="Select priority"
                      size="sm"
                    />
                  </div>
                ) : (
                  <span className="capitalize">{request.priority}</span>
                )}
              </DetailRow>

              {/* Assignee (editable for admin via searchable-select) */}
              <DetailRow label="Assignee">
                {isAdmin ? (
                  <div style={{ width: '100%', maxWidth: '10rem' }}>
                    <SearchableSelect
                      options={teamMemberOptions}
                      value={request.assigneeId ?? ''}
                      onChange={v => handleAssigneeChange(v || null)}
                      placeholder="Unassigned"
                      searchPlaceholder="Search team..."
                      allowClear
                      size="sm"
                    />
                  </div>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <User size={12} style={{ color: 'var(--color-text-subtle)' }} />
                    {request.assigneeName ?? 'Unassigned'}
                  </span>
                )}
              </DetailRow>

              {/* Due date */}
              <DetailRow label="Due date">
                {isAdmin && editingDueDate ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="date"
                      value={dueDateInput}
                      onChange={e => setDueDateInput(e.target.value)}
                      autoFocus
                      style={{
                        fontSize: '0.8125rem',
                        padding: '0.25rem 0.5rem',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-button)',
                        color: 'var(--color-text)',
                        background: 'var(--color-bg)',
                        outline: 'none',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = BRAND }}
                      onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
                    />
                    <button
                      type="button"
                      onClick={() => handleDueDateChange(dueDateInput || null)}
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        padding: '0.25rem 0.5rem',
                        background: BRAND,
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: 'var(--radius-button)',
                        cursor: 'pointer',
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingDueDate(false)}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.5rem',
                        color: 'var(--color-text-muted)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <span
                    className="flex items-center gap-1.5"
                    style={{
                      cursor: isAdmin ? 'pointer' : 'default',
                      color: 'var(--color-text)',
                    }}
                    onClick={() => {
                      if (isAdmin) {
                        setDueDateInput(request.dueDate ?? '')
                        setEditingDueDate(true)
                      }
                    }}
                    onMouseEnter={e => { if (isAdmin) e.currentTarget.style.color = BRAND }}
                    onMouseLeave={e => { if (isAdmin) e.currentTarget.style.color = 'var(--color-text)' }}
                  >
                    <Calendar size={12} style={{ color: 'var(--color-text-subtle)' }} />
                    {request.dueDate ? formatDate(request.dueDate) : 'Not set'}
                  </span>
                )}
              </DetailRow>

              {request.estimatedHours != null && (
                <DetailRow label="Estimated">
                  <span className="flex items-center gap-1.5">
                    <Clock size={12} style={{ color: 'var(--color-text-subtle)' }} />
                    {request.estimatedHours}h
                  </span>
                </DetailRow>
              )}

              <DetailRow label="Created">
                {formatDate(request.createdAt)}
              </DetailRow>

              {request.deliveredAt && (
                <DetailRow label="Delivered">
                  {formatDate(request.deliveredAt)}
                </DetailRow>
              )}
            </div>
          </SidebarCard>

          {/* Admin actions */}
          {isAdmin && (
            <SidebarCard title="Admin">
              <button
                type="button"
                onClick={handleScopeFlagToggle}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderRadius: 'var(--radius-button)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  border: request.scopeFlagged
                    ? '1px solid var(--color-danger)'
                    : '1px solid var(--color-border)',
                  background: request.scopeFlagged
                    ? 'var(--color-danger-bg)'
                    : 'var(--color-bg)',
                  color: request.scopeFlagged
                    ? 'var(--color-danger)'
                    : 'var(--color-text)',
                }}
                onMouseEnter={e => {
                  if (!request.scopeFlagged) {
                    e.currentTarget.style.borderColor = 'var(--color-warning)'
                    e.currentTarget.style.background = '#fff7ed'
                    e.currentTarget.style.color = 'var(--color-warning)'
                  }
                }}
                onMouseLeave={e => {
                  if (!request.scopeFlagged) {
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                    e.currentTarget.style.background = 'var(--color-bg)'
                    e.currentTarget.style.color = 'var(--color-text)'
                  }
                }}
              >
                <AlertTriangle size={13} />
                {request.scopeFlagged ? 'Remove scope flag' : 'Flag as scope creep'}
              </button>
            </SidebarCard>
          )}

          {/* Time entry logging (admin only) */}
          {isAdmin && (
            <TimeEntryPanel requestId={requestId} />
          )}
        </div>
      </div>

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

// ---- Activity Log ------------------------------------------------------------

interface ActivityEvent {
  id: string
  type: 'created' | 'status_change' | 'message' | 'file_upload'
  description: string
  author: string | null
  timestamp: string
}

function ActivityLog({
  request,
  messages,
  files,
}: {
  request: Request
  messages: Message[]
  files: RequestFile[]
}) {
  const [expanded, setExpanded] = useState(false)

  // Build activity events from available data
  const events: ActivityEvent[] = []

  // Request created
  events.push({
    id: 'created',
    type: 'created',
    description: 'Request was created',
    author: null,
    timestamp: request.createdAt,
  })

  // Status changes inferred: if updatedAt differs from createdAt, the request was updated
  if (request.updatedAt !== request.createdAt) {
    events.push({
      id: 'status-update',
      type: 'status_change',
      description: `Status changed to ${STATUS_LABELS[request.status] ?? request.status}`,
      author: request.assigneeName,
      timestamp: request.updatedAt,
    })
  }

  // Delivered event
  if (request.deliveredAt) {
    events.push({
      id: 'delivered',
      type: 'status_change',
      description: 'Request was delivered',
      author: request.assigneeName,
      timestamp: request.deliveredAt,
    })
  }

  // Messages posted
  for (const msg of messages) {
    events.push({
      id: `msg-${msg.id}`,
      type: 'message',
      description: msg.isInternal ? 'Posted an internal note' : 'Posted a comment',
      author: msg.teamMemberName ?? (msg.authorType === 'contact' ? 'Client' : null),
      timestamp: msg.createdAt,
    })
  }

  // Files uploaded
  for (const file of files) {
    events.push({
      id: `file-${file.id}`,
      type: 'file_upload',
      description: `Uploaded ${file.filename}`,
      author: file.uploaderName ?? null,
      timestamp: file.createdAt,
    })
  }

  // Sort chronologically (newest first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  const displayed = expanded ? events : events.slice(0, 5)

  const iconMap: Record<ActivityEvent['type'], React.ReactNode> = {
    created: <Plus size={10} />,
    status_change: <RefreshCw size={10} />,
    message: <FileText size={10} />,
    file_upload: <Upload size={10} />,
  }

  return (
    <div
      className="bg-[var(--color-bg)] rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-row-border)' }}
      >
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Activity size={14} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
          Activity
          {events.length > 0 && (
            <span
              className="text-xs font-normal rounded-full"
              style={{
                padding: '0.0625rem 0.4375rem',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-subtle)',
              }}
            >
              {events.length}
            </span>
          )}
        </h2>
      </div>

      <div style={{ padding: '0.75rem 1.25rem' }}>
        {events.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-text-subtle)', padding: '0.5rem 0' }}>
            No activity yet.
          </p>
        ) : (
          <div className="flex flex-col" style={{ gap: '0.5rem' }}>
            {displayed.map(event => (
              <div key={event.id} className="flex items-start gap-2.5" style={{ padding: '0.25rem 0' }}>
                <div
                  className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{
                    width: '1.25rem',
                    height: '1.25rem',
                    marginTop: '0.0625rem',
                    background: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-subtle)',
                  }}
                >
                  {iconMap[event.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                    {event.author ? (
                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                        {event.author}
                      </span>
                    ) : null}
                    {event.author ? ' ' : ''}
                    {event.description}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}>
                    {formatActivityDate(event.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {events.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium transition-colors"
            style={{
              color: BRAND,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.375rem 0 0',
              display: 'block',
            }}
          >
            {expanded ? 'Show less' : `Show all ${events.length} events`}
          </button>
        )}
      </div>
    </div>
  )
}

function formatActivityDate(iso: string) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHrs = Math.floor(diffMin / 60)
    if (diffHrs < 24) return `${diffHrs}h ago`
    const diffDays = Math.floor(diffHrs / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

// ---- Sidebar Card ------------------------------------------------------------

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="bg-[var(--color-bg)] rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
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

// ---- Detail Row --------------------------------------------------------------

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

// ---- Checklists Panel --------------------------------------------------------

interface ChecklistsPanelProps {
  checklists: Checklist[]
  onSave: (updated: Checklist[]) => void
  isAdmin: boolean
}

function ChecklistsPanel({ checklists, onSave, isAdmin }: ChecklistsPanelProps) {
  const [newChecklistTitle, setNewChecklistTitle] = useState('')
  const [addingChecklist, setAddingChecklist] = useState(false)
  const [newItemLabels, setNewItemLabels] = useState<Record<number, string>>({})

  function addChecklist() {
    if (!newChecklistTitle.trim()) return
    const updated = [...checklists, { title: newChecklistTitle.trim(), items: [] }]
    onSave(updated)
    setNewChecklistTitle('')
    setAddingChecklist(false)
  }

  function removeChecklist(idx: number) {
    const updated = checklists.filter((_, i) => i !== idx)
    onSave(updated)
  }

  function toggleItem(checklistIdx: number, itemIdx: number) {
    const updated = checklists.map((cl, ci) => {
      if (ci !== checklistIdx) return cl
      return {
        ...cl,
        items: cl.items.map((item, ii) =>
          ii === itemIdx ? { ...item, done: !item.done } : item
        ),
      }
    })
    onSave(updated)
  }

  function addItem(checklistIdx: number) {
    const label = (newItemLabels[checklistIdx] ?? '').trim()
    if (!label) return
    const updated = checklists.map((cl, ci) => {
      if (ci !== checklistIdx) return cl
      return { ...cl, items: [...cl.items, { label, done: false }] }
    })
    onSave(updated)
    setNewItemLabels(prev => ({ ...prev, [checklistIdx]: '' }))
  }

  function removeItem(checklistIdx: number, itemIdx: number) {
    const updated = checklists.map((cl, ci) => {
      if (ci !== checklistIdx) return cl
      return { ...cl, items: cl.items.filter((_, ii) => ii !== itemIdx) }
    })
    onSave(updated)
  }

  return (
    <div
      className="bg-[var(--color-bg)] rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-row-border)' }}
      >
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <ListChecks size={14} style={{ color: 'var(--color-text-subtle)' }} />
          Checklists
          {checklists.length > 0 && (
            <span
              className="text-xs font-normal rounded-full"
              style={{
                padding: '0.0625rem 0.4375rem',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-subtle)',
              }}
            >
              {checklists.length}
            </span>
          )}
        </h2>
        {isAdmin && !addingChecklist && (
          <button
            type="button"
            onClick={() => setAddingChecklist(true)}
            className="flex items-center gap-1 text-xs font-medium transition-colors"
            style={{
              padding: '0.375rem 0.75rem',
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-brand)',
              color: BRAND,
              background: 'var(--color-bg)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-50)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
          >
            <Plus size={12} />
            Add Checklist
          </button>
        )}
      </div>

      {/* Add new checklist form */}
      {addingChecklist && (
        <div className="flex items-center gap-2" style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--color-row-border)' }}>
          <input
            type="text"
            value={newChecklistTitle}
            onChange={e => setNewChecklistTitle(e.target.value)}
            placeholder="Checklist title..."
            autoFocus
            className="flex-1 focus:outline-none"
            style={{
              padding: '0.375rem 0.5rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--color-border)',
              borderRadius: '0.25rem',
              color: 'var(--color-text)',
              background: 'var(--color-bg)',
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addChecklist() }
              if (e.key === 'Escape') setAddingChecklist(false)
            }}
          />
          <button
            type="button"
            onClick={addChecklist}
            className="text-xs font-semibold"
            style={{
              padding: '0.375rem 0.75rem',
              background: BRAND,
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
            }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAddingChecklist(false); setNewChecklistTitle('') }}
            className="text-xs"
            style={{
              padding: '0.375rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-subtle)',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {checklists.length === 0 && !addingChecklist ? (
        <div className="flex flex-col items-center justify-center text-center" style={{ padding: '2.5rem 1.5rem', gap: '0.375rem' }}>
          <ListChecks size={18} style={{ color: 'var(--color-text-subtle)', marginBottom: '0.25rem' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-subtle)' }}>No checklists yet.</p>
        </div>
      ) : (
        <div>
          {checklists.map((cl, ci) => {
            const doneCount = cl.items.filter(i => i.done).length
            const totalCount = cl.items.length
            const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

            return (
              <div
                key={ci}
                style={{ borderBottom: ci < checklists.length - 1 ? '1px solid var(--color-row-border)' : 'none' }}
              >
                {/* Checklist header */}
                <div className="flex items-center justify-between" style={{ padding: '0.75rem 1.25rem' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{cl.title}</span>
                    {totalCount > 0 && (
                      <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                        {doneCount}/{totalCount}
                      </span>
                    )}
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => removeChecklist(ci)}
                      className="transition-colors"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--color-text-subtle)' }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                      aria-label="Remove checklist"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                {totalCount > 0 && (
                  <div style={{ padding: '0 1.25rem 0.5rem' }}>
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--color-bg-tertiary)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${progress}%`,
                          background: progress === 100 ? 'var(--color-success)' : BRAND,
                          borderRadius: 2,
                          transition: 'width 0.2s',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Items */}
                <div style={{ padding: '0 1.25rem 0.5rem' }}>
                  {cl.items.map((item, ii) => (
                    <div
                      key={ii}
                      className="flex items-center gap-2"
                      style={{ padding: '0.25rem 0' }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleItem(ci, ii)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          color: item.done ? BRAND : 'var(--color-text-subtle)',
                          flexShrink: 0,
                        }}
                        aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
                      >
                        <CheckCircle2 size={16} style={{ opacity: item.done ? 1 : 0.4 }} />
                      </button>
                      <span
                        className="text-sm flex-1"
                        style={{
                          color: item.done ? 'var(--color-text-subtle)' : 'var(--color-text)',
                          textDecoration: item.done ? 'line-through' : 'none',
                        }}
                      >
                        {item.label}
                      </span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => removeItem(ci, ii)}
                          className="transition-colors"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.125rem', color: 'var(--color-text-subtle)', opacity: 0.5 }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-danger)' }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                          aria-label="Remove item"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add item */}
                {isAdmin && (
                  <div className="flex items-center gap-2" style={{ padding: '0.25rem 1.25rem 0.75rem' }}>
                    <input
                      type="text"
                      value={newItemLabels[ci] ?? ''}
                      onChange={e => setNewItemLabels(prev => ({ ...prev, [ci]: e.target.value }))}
                      placeholder="Add item..."
                      className="flex-1 focus:outline-none"
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.8125rem',
                        border: '1px solid var(--color-border-subtle)',
                        borderRadius: '0.25rem',
                        color: 'var(--color-text)',
                        background: 'var(--color-bg)',
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); addItem(ci) }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => addItem(ci)}
                      className="flex items-center gap-1 text-xs transition-colors"
                      style={{
                        padding: '0.25rem 0.5rem',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: BRAND,
                        fontWeight: 500,
                      }}
                    >
                      <Plus size={12} />
                      Add
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Files Panel -------------------------------------------------------------

interface FilesPanelProps {
  files: RequestFile[]
  onRefresh: () => void
  requestId: string
  orgId: string
  isAdmin: boolean
}

function FilesPanel({ files, onRefresh, requestId, orgId, isAdmin }: FilesPanelProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function fileIcon(mimeType: string | null) {
    if (!mimeType) return <FileText size={14} style={{ color: 'var(--color-text-subtle)' }} />
    if (mimeType.startsWith('image/')) return <ImageIcon size={14} style={{ color: '#7c3aed' }} />
    if (mimeType === 'application/pdf') return <FileText size={14} style={{ color: 'var(--color-danger)' }} />
    return <FileText size={14} style={{ color: 'var(--color-text-subtle)' }} />
  }

  function formatBytes(n: number | null) {
    if (!n) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadError(null)

    try {
      const presignRes = await fetch(apiPath('/api/uploads/presign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, requestId }),
      })
      if (!presignRes.ok) {
        const errBody = await presignRes.json().catch(() => null) as { error?: string } | null
        throw new Error(`Upload failed: ${errBody?.error ?? presignRes.statusText}`)
      }
      const presignData = await presignRes.json() as {
        uploadUrl: string
        storageKey: string
        fileId: string
      }

      const uploadRes = await fetch(apiPath(presignData.uploadUrl), {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!uploadRes.ok) {
        const errBody = await uploadRes.json().catch(() => null) as { error?: string } | null
        throw new Error(`File upload failed: ${errBody?.error ?? uploadRes.statusText}`)
      }

      const confirmRes = await fetch(apiPath('/api/uploads/confirm'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: presignData.fileId,
          storageKey: presignData.storageKey,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          requestId,
          orgId,
        }),
      })
      if (!confirmRes.ok) {
        const errBody = await confirmRes.json().catch(() => null) as { error?: string } | null
        throw new Error(`Confirm failed: ${errBody?.error ?? confirmRes.statusText}`)
      }

      onRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      setUploadError(message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div
      className="bg-[var(--color-bg)] rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
    >
      <div
        className="flex items-center justify-between"
        style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-row-border)' }}
      >
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Paperclip size={14} style={{ color: 'var(--color-text-subtle)' }} />
          Files
          {files.length > 0 && (
            <span
              className="text-xs font-normal rounded-full"
              style={{
                padding: '0.0625rem 0.4375rem',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-subtle)',
              }}
            >
              {files.length}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
                aria-label="Upload file"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                style={{
                  padding: '0.375rem 0.75rem',
                  borderRadius: 'var(--radius-button)',
                  border: `1px solid ${BRAND}`,
                  color: BRAND,
                  background: 'var(--color-bg)',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  opacity: uploading ? 0.5 : 1,
                }}
                onMouseEnter={e => {
                  if (!uploading) {
                    e.currentTarget.style.background = 'var(--color-brand-50)'
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'var(--color-bg)'
                }}
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </>
          )}
          {files.length > 1 && (
            <button
              type="button"
              onClick={() => {
                files.forEach(f => {
                  window.open(apiPath(`/api/uploads/serve?key=${encodeURIComponent(f.storageKey)}&download=1`), '_blank')
                })
              }}
              className="flex items-center gap-1 text-xs font-medium transition-colors"
              style={{
                padding: '0.375rem 0.75rem',
                borderRadius: 'var(--radius-button)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-brand)'; e.currentTarget.style.color = 'var(--color-text)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)' }}
            >
              <DownloadCloud size={12} />
              Download All
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1 text-xs transition-colors"
            style={{ color: 'var(--color-text-subtle)', background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {uploadError && (
        <div
          style={{
            margin: '0.75rem 1.25rem 0',
            fontSize: '0.8125rem',
            color: 'var(--color-danger)',
            background: 'var(--color-danger-bg)',
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-button)',
            padding: '0.5rem 0.75rem',
          }}
        >
          {uploadError}
        </div>
      )}

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center" style={{ padding: '2.5rem 1.5rem', gap: '0.375rem' }}>
          <Paperclip size={18} style={{ color: 'var(--color-text-subtle)', marginBottom: '0.25rem' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-subtle)' }}>No files attached yet.</p>
        </div>
      ) : (
        <div>
          {files.map((f, i) => (
            <div
              key={f.id}
              className="flex items-center gap-3 transition-colors"
              style={{
                padding: '0.75rem 1.25rem',
                borderBottom: i < files.length - 1 ? '1px solid var(--color-row-border)' : 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-row-hover)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <div className="flex-shrink-0">{fileIcon(f.mimeType)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{f.filename}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}>
                  {f.uploaderName ?? f.uploadedByType}
                  {f.sizeBytes ? ` / ${formatBytes(f.sizeBytes)}` : ''}
                  {' / '}{formatDate(f.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {f.mimeType?.startsWith('image/') && (
                  <a
                    href={apiPath(`/api/uploads/serve?key=${encodeURIComponent(f.storageKey)}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center transition-colors"
                    style={{
                      width: 28, height: 28, borderRadius: 'var(--radius-button)',
                      color: 'var(--color-text-subtle)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                    aria-label={`View ${f.filename}`}
                  >
                    <ImageIcon size={14} />
                  </a>
                )}
                <a
                  href={apiPath(`/api/uploads/serve?key=${encodeURIComponent(f.storageKey)}&download=1`)}
                  className="flex items-center justify-center transition-colors"
                  style={{
                    width: 28, height: 28, borderRadius: 'var(--radius-button)',
                    color: 'var(--color-text-subtle)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                  aria-label={`Download ${f.filename}`}
                >
                  <Download size={14} />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Time Entry Panel --------------------------------------------------------

interface TimeEntryItem {
  id: string
  hours: number
  billable: boolean | null
  notes: string | null
  date: string
  teamMemberName: string | null
}

function TimeEntryPanel({ requestId }: { requestId: string }) {
  const [entries, setEntries] = useState<TimeEntryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [billable, setBillable] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/time-entries`))
      if (res.ok) {
        const data = await res.json() as { items: TimeEntryItem[] }
        setEntries(data.items ?? [])
      }
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => { void loadEntries() }, [loadEntries])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const h = parseFloat(hours)
    if (!h || h <= 0) return

    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/time-entries`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: h, description: description.trim() || undefined, billable }),
      })
      if (res.ok) {
        setHours('')
        setDescription('')
        setBillable(true)
        await loadEntries()
      }
    } finally {
      setSaving(false)
    }
  }

  const totalHours = entries.reduce((s, e) => s + e.hours, 0)

  return (
    <SidebarCard title="Time">
      {/* Summary */}
      {!loading && entries.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <span>{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>
            <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{totalHours.toFixed(1)}h total</span>
          </div>
          <div className="flex flex-col gap-1 mt-2">
            {entries.slice(0, 5).map(entry => (
              <div key={entry.id} className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-muted)' }}>
                <span className="truncate" style={{ maxWidth: '8rem' }}>{entry.teamMemberName ?? 'Unknown'}</span>
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{entry.hours.toFixed(1)}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log form */}
      <form onSubmit={handleSubmit} className="flex flex-col" style={{ gap: '0.5rem' }}>
        <div className="flex gap-2">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={hours}
            onChange={e => setHours(e.target.value)}
            placeholder="Hours"
            required
            style={{
              flex: 1,
              padding: '0.375rem 0.5rem',
              fontSize: '0.8125rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-button)',
              color: 'var(--color-text)',
              background: 'var(--color-bg)',
              outline: 'none',
            }}
          />
          <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            <input
              type="checkbox"
              checked={billable}
              onChange={e => setBillable(e.target.checked)}
              style={{ accentColor: 'var(--color-brand)' }}
            />
            Billable
          </label>
        </div>
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Description (optional)"
          style={{
            padding: '0.375rem 0.5rem',
            fontSize: '0.8125rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-button)',
            color: 'var(--color-text)',
            background: 'var(--color-bg)',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={saving || !hours}
          style={{
            padding: '0.375rem 0.75rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            border: 'none',
            borderRadius: 'var(--radius-button)',
            background: saving ? 'var(--color-text-subtle)' : 'var(--color-brand)',
            color: 'white',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : 'Log Time'}
        </button>
      </form>
    </SidebarCard>
  )
}

// ---- Helpers -----------------------------------------------------------------

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

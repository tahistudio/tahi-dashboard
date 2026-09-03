'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { apiPath } from '@/lib/api'
import {
  Clock, AlertTriangle, RefreshCw,
  User, CheckCircle2, Loader2, Activity,
  FileText, Image as ImageIcon, Download, Paperclip,
  Calendar, Upload, Plus, Trash2, ListChecks, DownloadCloud, ChevronDown, Eye,
  Sparkles, Wand2, X, Check, Lock, Archive, MessageSquare, PauseCircle, Ban,
} from 'lucide-react'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import Link from 'next/link'
import { RequestThread } from '@/components/tahi/request-thread'
import dynamic from 'next/dynamic'
const MessageComposer = dynamic(() => import('@/components/tahi/message-composer').then(m => ({ default: m.MessageComposer })), { ssr: false })
const AiTaskWizard = dynamic(() => import('@/components/tahi/ai-task-wizard').then(m => ({ default: m.AiTaskWizard })), { ssr: false })
// The brief is stored HTML, so it is rendered through the allowlist rather
// than injected raw: not every writer that can reach requests.description
// sanitises on the way in. Loaded on demand for the same reason the composer
// is, since the module it lives in carries the editor with it.
const RichBriefProse = dynamic(() => import('@/components/tahi/rich-brief').then(m => ({ default: m.RichBriefProse })), { ssr: false })
import { StatusBadge } from '@/components/tahi/status-badge'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import { useToast } from '@/components/tahi/toast'
import { Card } from '@/components/tahi/card'
import { Badge, statusTone } from '@/components/tahi/badge'
import { Popover } from '@/components/tahi/popover'
import { SubRequestsPanel, type SubRequestRow } from '@/components/tahi/sub-requests-panel'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { PeoplePanel, type Participant } from '@/components/tahi/people-panel'
import { TimeCard } from '@/components/tahi/time-card'
import { DiscoveryCallsCard } from '@/components/tahi/discovery-calls'
import { fetchSchedulePhaseOptions } from '@/lib/schedule-phases'
import { usePermissions } from '@/components/tahi/permissions-context'
import { CATEGORY_CONFIG, REQUEST_STATUS_CONFIG, REQUEST_STATUSES } from '@/lib/status-config'
import { StatusChipSelect } from '@/components/tahi/status-chip-select'
import { DeliverySpine, isPipelineStatus } from '@/components/tahi/requests/delivery-spine'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import {
  buildActivityEvents, filterActivityEvents, stripHtmlToText,
  type ActivityEventType, type ActivityFilter,
} from '@/components/tahi/requests/activity-feed'
import { RequestActionsMenu } from '@/components/tahi/requests/request-actions-menu'
import { ClientReviewBar } from '@/components/tahi/requests/client-review-bar'
import {
  InlineDateField, InlineMenuField, InlineNone, InlineNumberField,
} from '@/components/tahi/requests/inline-field'
import type { ReviewDecision } from '@/lib/request-review'

// ---- Constants ---------------------------------------------------------------

// Brand color - use var(--color-brand) in styles instead of hardcoded hex

const STATUS_FLOW = [
  'submitted',
  'in_review',
  'in_progress',
  'client_review',
  'delivered',
] as const

/**
 * The label a status reads as. Driven off the one REQUEST_STATUS_CONFIG map
 * rather than a local list, so a status this page can now be moved into from
 * the board or the bulk bar (on hold, cancelled) never prints as a raw slug.
 */
function statusLabel(status: string): string {
  return REQUEST_STATUS_CONFIG[status]?.label ?? status
}

const PRIORITY_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
]

// The line the ported detail shows in place of the delivery spine when the
// request is not on one of the five pipeline steps. One sentence per status,
// worded for both audiences: a client sees the same note the studio does.
const OFF_PIPELINE_NOTES: Record<string, string> = {
  draft: 'This request is a draft, not yet submitted.',
  archived: 'This request is archived.',
  on_hold: 'This request is on hold, off the delivery pipeline for now.',
  cancelled: 'This request was cancelled.',
}

/** The glyph beside an off-pipeline note. Decorative: the note carries it. */
function OffPipelineIcon({ status }: { status: string }) {
  const style = { flexShrink: 0, color: 'var(--color-text-subtle)' }
  if (status === 'draft') return <FileText size={16} aria-hidden="true" style={style} />
  if (status === 'archived') return <Archive size={16} aria-hidden="true" style={style} />
  if (status === 'cancelled') return <Ban size={16} aria-hidden="true" style={style} />
  return <PauseCircle size={16} aria-hidden="true" style={style} />
}

// Category vocabulary for the ported Details rail. Driven off the one
// CATEGORY_CONFIG map so the chip colours and the picker can never diverge.
const CATEGORY_OPTIONS = Object.keys(CATEGORY_CONFIG)

function categoryLabel(value: string): string {
  if (!value) return 'None'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** The category chip used in the Details rail and its picker. */
function CategoryChip({ value }: { value: string | null }) {
  if (!value) return <InlineNone>None</InlineNone>
  const style = CATEGORY_CONFIG[value]
  return (
    <span
      className="inline-flex items-center rounded-full"
      style={{
        padding: '0.125rem 0.5rem',
        fontSize: '0.6875rem',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        background: style?.bg ?? 'var(--color-bg-tertiary)',
        color: style?.color ?? 'var(--color-text-muted)',
      }}
    >
      {categoryLabel(value)}
    </span>
  )
}

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
  // V3 additions
  size: 'small' | 'large' | null
  parentRequestId: string | null
  subPosition: number | null
  scopeFlagReason: string | null
  scheduleRowId: string | null
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
}

interface ParentRequestRef {
  id: string
  title: string
  requestNumber: number | null
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
  // Portal thread only: resolved contact-author label ("Sam (Acme)") and a
  // server-computed own-message flag (portal stores authorId = contact.id).
  authorName?: string | null
  isOwn?: boolean
  /** Files stamped with this message id. The admin thread route returns them
   *  per message; the portal thread has none yet, so the bubble only shows
   *  the row when they are there. */
  files?: Array<{
    id: string
    filename: string
    storageKey: string
    mimeType: string | null
    sizeBytes: number | null
  }>
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

// AI triage suggestion shape returned by POST /api/admin/requests/[id]/triage.
// These are SUGGESTIONS only - nothing applies until the admin clicks Apply.
interface TriageSuggestion {
  suggestedAssigneeId: string | null
  suggestedAssigneeName: string | null
  suggestedPriority: 'standard' | 'high'
  suggestedTrack: 'small' | 'large'
  oneLineReason: string
}

// Convert a plain-text AI draft into the minimal HTML the thread renders.
// Escapes first, then maps blank lines to paragraphs and single newlines
// to <br>. Keeps the posted message consistent with composer output.
function draftTextToHtml(text: string): string {
  const escape = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// A single triage suggestion rendered as a chip with an inline Apply
// button. Apply calls back into the existing PATCH-backed handlers - the
// chip itself never mutates anything directly.
function SuggestionApplyChip({
  label,
  value,
  onApply,
}: {
  label: string
  value: string
  onApply: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <span
      className="inline-flex items-center rounded-full"
      style={{
        gap: '0.375rem',
        padding: '0.1875rem 0.1875rem 0.1875rem 0.5rem',
        fontSize: '0.6875rem',
        fontWeight: 500,
        background: 'var(--color-bg)',
        color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border)',
      }}
    >
      <span>
        {label}: <strong style={{ color: 'var(--color-text)' }}>{value}</strong>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy) return
          setBusy(true)
          try { await onApply() } finally { setBusy(false) }
        }}
        className="inline-flex items-center transition-colors"
        style={{
          gap: '0.1875rem',
          padding: '0.125rem 0.4375rem',
          fontSize: '0.6875rem',
          fontWeight: 600,
          borderRadius: '9999px',
          border: 'none',
          background: busy ? 'var(--color-bg-tertiary)' : 'var(--color-brand)',
          color: busy ? 'var(--color-text-subtle)' : '#ffffff',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy
          ? <Loader2 size={10} className="animate-spin" aria-hidden="true" />
          : <Check size={10} aria-hidden="true" />}
        Apply
      </button>
    </span>
  )
}

// ---- Main Component ----------------------------------------------------------

export function RequestDetail({ requestId, isAdmin: isAdminProp, currentUserId }: RequestDetailProps) {
  const { isImpersonatingClient, isImpersonatingTeamMember, impersonatedAccessRules } = useImpersonation()
  // Only switch to client view when impersonating a client, not a team member
  const isAdmin = isAdminProp && !isImpersonatingClient
  // A super admin standing in a viewer's shoes reads the studio's page. The
  // PATCH and DELETE calls behind these controls land as the real super admin
  // and would genuinely mutate the row, so the lens has to hold on the client
  // as well. Derived exactly as request-list.tsx derives it.
  const isViewerImpersonation = isImpersonatingTeamMember &&
    impersonatedAccessRules.length > 0 &&
    impersonatedAccessRules.every(r => r.role === 'viewer')
  /** Studio audience with a real write. Everything that mutates the request
   *  hangs off this rather than off `isAdmin`. */
  const canWrite = isAdmin && !isViewerImpersonation
  // Slice 6 of the Requests port ships the rebuilt detail behind the same
  // super-admin gate the list uses. Everyone else keeps today's detail
  // untouched, so a regression here can only reach Liam and Staci.
  const { isSuperAdmin } = usePermissions()
  const newUi = isSuperAdmin
  const [request, setRequest] = useState<Request | null>(null)
  const [subRequests, setSubRequests] = useState<SubRequestRow[]>([])
  const [parentRequest, setParentRequest] = useState<ParentRequestRef | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  // Visibility is now owned by <MessageComposer> and passed back through handleSendMessage.
  const [statusUpdating, setStatusUpdating] = useState(false)
  // Mirrors statusUpdating for the Internal switch, so a double tap cannot
  // fire two PATCHes whose order decides who can see the request.
  const [internalUpdating, setInternalUpdating] = useState(false)
  const [editingDueDate, setEditingDueDate] = useState(false)
  const [dueDateInput, setDueDateInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [newSubOpen, setNewSubOpen] = useState(false)
  const [unlinkingParent, setUnlinkingParent] = useState(false)
  const [participants, setParticipants] = useState<Participant[]>([])
  const threadBottomRef = useRef<HTMLDivElement>(null)
  // Client Approve / Request-a-change (only meaningful while status is
  // client_review and the viewer is a client).
  const [approving, setApproving] = useState(false)
  const composerWrapRef = useRef<HTMLDivElement>(null)
  // "Request changes" seeds the composer rather than posting straight away,
  // so the client says what needs adjusting in their own words. Bumping the
  // nonce re-seeds; the composer ignores a nonce it has already applied.
  const [composerSeed, setComposerSeed] = useState<{ text: string; nonce: number } | null>(null)
  // When the client clicks "Request a change" we tag the very next message they
  // send as a change request. A ref (not state) so handleSendMessage always
  // reads the current value without re-subscribing the composer.
  const changeRequestPendingRef = useRef(false)
  const { showToast } = useToast()

  // ---- AI weaves (admin, human-in-the-loop) --------------------------------
  // 1) Task breakdown: opens the existing AI task wizard, seeded from this
  //    request. 2) Triage: dismissible suggestion banner, each field applied
  //    explicitly. 3) Reply draft: a PENDING draft the admin edits then posts
  //    through the normal thread flow. The AI never mutates or posts anything.
  const [wizardOpen, setWizardOpen] = useState(false)
  const [triage, setTriage] = useState<TriageSuggestion | null>(null)
  const [triageLoading, setTriageLoading] = useState(false)
  const [triageError, setTriageError] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState<string | null>(null)
  const [replyLoading, setReplyLoading] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [postingDraft, setPostingDraft] = useState(false)

  // Following is now handled via the People panel's Followers slot -
  // the user adds themselves as a follower if they want notifications.
  // The old localStorage-based per-device "Follow" button was removed
  // (duplicated the Followers participants list + wasn't server-backed).

  const apiBase = isAdmin ? apiPath('/api/admin') : apiPath('/api/portal')

  // Request + messages via a single SWR entry. The inline fetcher mirrors the
  // old dual-fetch (request endpoint + messages endpoint) and returns a merged
  // object. Network failure throws -> SWR error -> "Failed to load" screen. A
  // non-ok response leaves request null -> "Request not found", matching the
  // previous behaviour. mutateRequest() replaces every loadRequest() refresh.
  const {
    data: requestData,
    isLoading: loading,
    error: requestError,
    mutate: mutateRequest,
  } = useSWR(
    `request-detail:${isAdmin ? 'admin' : 'portal'}:${requestId}`,
    async () => {
      const [reqRes, msgRes] = await Promise.all([
        fetch(`${apiBase}/requests/${requestId}`),
        fetch(isAdmin
          ? apiPath(`/api/admin/requests/${requestId}/messages`)
          : `${apiBase}/requests/${requestId}`
        ),
      ])
      let req: Request | null = null
      let subs: SubRequestRow[] = []
      let parent: ParentRequestRef | null = null
      let unread = 0
      let people: Participant[] = []
      let msgs: Message[] = []
      if (reqRes.ok) {
        const data = await reqRes.json() as {
          request: Request
          subRequests?: SubRequestRow[]
          parent?: ParentRequestRef | null
          unreadCount?: number
          participants?: Participant[]
        }
        req = data.request
        subs = data.subRequests ?? []
        parent = data.parent ?? null
        unread = data.unreadCount ?? 0
        people = data.participants ?? []
      }
      if (msgRes.ok) {
        if (isAdmin) {
          const data = await msgRes.json() as { items: Message[] }
          msgs = data.items ?? []
        } else {
          const data = await msgRes.json() as { request: Request; messages: Message[] }
          req = data.request
          msgs = data.messages ?? []
        }
      }
      return { request: req, subRequests: subs, parent, unreadCount: unread, participants: people, messages: msgs }
    },
  )
  const fetchError = !!requestError

  // The Requests list caches one entry per endpoint + query string, and this
  // page cannot know which tab the user came from, so the write refreshes
  // every cached list rather than naming one. Nothing refetches when no list
  // is in the cache, which is the common case for a deep link.
  const { mutate: mutateGlobal } = useSWRConfig()
  const mutateRequestLists = useCallback(() => {
    void mutateGlobal(
      key => typeof key === 'string'
        && (key.startsWith('/api/admin/requests?') || key.startsWith('/api/portal/requests?')),
    )
  }, [mutateGlobal])

  // Mirror fetched data into local state. Local state is the source of truth for
  // optimistic edits (patchRequest, checklists, participants, unlink), so each
  // refresh (mutateRequest) re-syncs everything exactly as loadRequest used to.
  useEffect(() => {
    if (!requestData) return
    setRequest(requestData.request)
    setSubRequests(requestData.subRequests)
    setParentRequest(requestData.parent)
    setUnreadCount(requestData.unreadCount)
    setParticipants(requestData.participants)
    setMessages(requestData.messages)
    try {
      setChecklists(JSON.parse(requestData.request?.checklists || '[]') as Checklist[])
    } catch {
      setChecklists([])
    }
  }, [requestData])

  // Files via SWR (standard path key + global fetcher). mutateFiles() replaces
  // the old loadFiles() refresh.
  const filesKey = isAdmin
    ? `/api/admin/requests/${requestId}/files`
    : `/api/portal/requests/${requestId}/files`
  const { data: filesData, mutate: mutateFiles } = useSWR<{ items: RequestFile[] }>(filesKey)
  const files = filesData?.items ?? []

  // Team members (admin only) for the assignee picker.
  const { data: teamMembersData } = useSWR<{ items: TeamMemberOption[] }>(
    isAdmin ? '/api/admin/team-members' : null,
  )
  const teamMembers = teamMembersData?.items ?? []

  // Delivery-phase options for the spine selector. Conditional key skips the
  // fetch for clients or before the org is known; non-fatal on failure.
  const requestOrgId = request?.orgId ?? null
  const { data: phaseOptionsData } = useSWR(
    isAdmin && requestOrgId ? `schedule-phases:${requestOrgId}` : null,
    () => fetchSchedulePhaseOptions(requestOrgId as string),
  )
  const phaseOptions = phaseOptionsData ?? []

  useEffect(() => {
    threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Mark the request as read 2s after load. A quick glance shouldn't count -
  // if the user leaves sooner, we preserve the unread badge for next time.
  useEffect(() => {
    if (!isAdmin || loading || !request) return
    const t = setTimeout(() => {
      fetch(apiPath(`/api/admin/requests/${requestId}/reads`), { method: 'POST' })
        .then(() => setUnreadCount(0))
        .catch(() => { /* non-fatal */ })
    }, 2000)
    return () => clearTimeout(t)
  }, [isAdmin, loading, request, requestId])

  async function handleSendMessage(
    html: string,
    _json: unknown,
    uploadedFiles: Array<{ fileId: string; filename: string }>,
    visibility: 'public' | 'internal' = 'public',
  ) {
    const messageIsInternal = visibility === 'internal'

    // Client "Request a change" tags the next message with a light prefix so
    // the studio can spot it in the thread. No new schema: it is just marked-up
    // body text. Consumed once, then reset.
    // Ported client bar: an armed change request goes to the review endpoint
    // instead, which moves the request back to in_progress AND posts the note
    // as one message. The note travels as plain text; the server escapes it.
    if (newUi && !isAdmin && changeRequestPendingRef.current) {
      changeRequestPendingRef.current = false
      await submitClientReview('changes', stripHtmlToText(html))
      setComposerSeed(null)
      showToast('Change request sent')
      await Promise.all([mutateRequest(), mutateFiles()])
      return
    }

    let outgoingHtml = html
    if (!isAdmin && changeRequestPendingRef.current) {
      outgoingHtml = `<p><strong>Change request</strong></p>${html}`
      changeRequestPendingRef.current = false
    }

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
            visibility: messageIsInternal ? 'internal' : 'external',
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
    // The composer has already confirmed each upload against the request, so
    // the ids are handed over for the route to stamp message_id on. Without
    // them a file attached to a specific reply only ever shows in the Files
    // panel, detached from the sentence that explains it. Admin only: the
    // portal route takes no attachment ids yet.
    const attachmentFileIds = uploadedFiles.map(f => f.fileId)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: outgoingHtml,
        isInternal: messageIsInternal,
        conversationId: convId ?? undefined,
        ...(isAdmin && attachmentFileIds.length > 0 ? { attachmentFileIds } : {}),
      }),
    })
    if (!res.ok) {
      // Surface the failure to the caller (composer or AI-draft card) so a
      // failed post is never silently swallowed and the user can retry.
      const j = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(j.error ?? 'Failed to send message')
    }
    // Uploaded files have already been attached to the request via the
    // /api/uploads/confirm step inside the composer. We just need to
    // re-fetch the files panel + messages to show the new state.
    await Promise.all([mutateRequest(), mutateFiles()])
  }

  // Optimistic patch helper - updates local state immediately, PATCHes the
  // server in the background, rolls back + toasts on failure. Every field-
  // level mutation below goes through this so the UI never blinks.
  const patchRequest = useCallback(async (
    patch: Partial<Request>,
    successMsg?: string,
  ) => {
    if (!request) return
    // One gate for every field write on this page. A viewer's lens is not a
    // suggestion: the request is theirs to read, not to move.
    if (!canWrite) {
      showToast('Read-only while you are viewing as this team member')
      return
    }
    const previous = request
    // Apply optimistically
    setRequest({ ...previous, ...patch })
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        setRequest(previous)
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Update failed - please retry')
        return
      }
      if (successMsg) showToast(successMsg)
      // The optimistic paint above covers what the user typed; the revalidate
      // fills in what only the server knows. A status move to delivered stamps
      // deliveredAt and bumps updatedAt, and without this the Details card's
      // Delivered row and the activity feed's "Request was delivered" event
      // never appear until a hard reload. The list cache is refreshed too, so
      // the board and the rail agree with the page that just wrote.
      void mutateRequest()
      void mutateRequestLists()
    } catch {
      setRequest(previous)
      showToast('Network error - try again')
    }
  }, [request, requestId, showToast, canWrite, mutateRequest, mutateRequestLists])

  async function handleStatusChange(newStatus: string) {
    if (!request || request.status === newStatus) return
    setStatusUpdating(true)
    await patchRequest({ status: newStatus }, `Moved to ${statusLabel(newStatus)}`)
    setStatusUpdating(false)
  }

  // Client approval: the sole client-writable transition (client_review ->
  // delivered), served by the dedicated portal PATCH. Optimistic, with a
  // server revalidate to reflect deliveredAt.
  async function handleClientApprove() {
    if (!request || approving || request.status !== 'client_review') return
    setApproving(true)
    const previous = request
    setRequest({ ...previous, status: 'delivered' })
    try {
      const res = await fetch(apiPath(`/api/portal/requests/${requestId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'delivered' }),
      })
      if (!res.ok) {
        setRequest(previous)
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Could not approve - please retry')
        return
      }
      showToast('Approved. Thanks for confirming.')
      await mutateRequest()
    } catch {
      setRequest(previous)
      showToast('Network error - try again')
    } finally {
      setApproving(false)
    }
  }

  // "Request a change": arm the next-message tag and drop the client into the
  // composer so they can describe the change straight away.
  function handleRequestChange() {
    changeRequestPendingRef.current = true
    // The ported bar seeds a starter line so the client is not staring at an
    // empty box; the legacy bar just focuses what is there.
    if (newUi) setComposerSeed({ text: 'Changes requested: ', nonce: Date.now() })
    const wrap = composerWrapRef.current
    if (wrap) {
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const editable = wrap.querySelector<HTMLElement>('[contenteditable="true"]')
      editable?.focus()
    }
  }

  // Client review verdict through the dedicated portal endpoint, which moves
  // the status AND posts the client's note to the thread in one call. Used by
  // the ported <ClientReviewBar>; the legacy bar keeps its own PATCH.
  const submitClientReview = useCallback(async (
    decision: ReviewDecision,
    note?: string,
  ) => {
    const res = await fetch(apiPath(`/api/portal/requests/${requestId}/review`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, note }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(j.error ?? 'Could not submit your review')
    }
    return await res.json() as { status: string }
  }, [requestId])

  async function handleReviewApprove() {
    if (!request || approving || request.status !== 'client_review') return
    setApproving(true)
    const previous = request
    setRequest({ ...previous, status: 'delivered' })
    try {
      await submitClientReview('approve')
      showToast('Approved. Thanks for confirming.')
      await Promise.all([mutateRequest(), mutateFiles()])
    } catch (err) {
      setRequest(previous)
      showToast(err instanceof Error ? err.message : 'Network error - try again')
    } finally {
      setApproving(false)
    }
  }

  async function handleCategoryChange(category: string) {
    await patchRequest({ category }, `Category set to ${categoryLabel(category)}`)
  }

  async function saveChecklists(updated: Checklist[]) {
    const previous = checklists
    setChecklists(updated)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklists: JSON.stringify(updated) }),
      })
      if (!res.ok) {
        setChecklists(previous)
        showToast('Checklist update failed')
      }
    } catch {
      setChecklists(previous)
      showToast('Network error - try again')
    }
  }

  // Internal requests never appear in the portal list or the portal detail
  // (both filter on requests.isInternal), so this switch is the studio's
  // single control over whether the client can see this page at all.
  async function handleInternalToggle() {
    if (!request || internalUpdating) return
    const next = !request.isInternal
    const who = request.orgName ?? 'The client'
    setInternalUpdating(true)
    try {
      await patchRequest(
        { isInternal: next },
        next
          ? `${who} can no longer see this request`
          : `${who} can see this request again`,
      )
    } finally {
      setInternalUpdating(false)
    }
  }

  async function handleScopeFlagToggle() {
    if (!request) return
    await patchRequest(
      { scopeFlagged: !request.scopeFlagged },
      request.scopeFlagged ? 'Scope flag removed' : 'Scope flagged',
    )
  }

  // Un-link this sub-request from its parent - promotes it to a top-level
  // request. Uses the same /nest endpoint that drag-to-nest does. Optimistic.
  async function handleUnlinkFromParent() {
    if (!request?.parentRequestId || unlinkingParent) return
    const previous = { request, parent: parentRequest }
    setUnlinkingParent(true)
    // Apply optimistically
    setRequest({ ...request, parentRequestId: null })
    setParentRequest(null)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/nest`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentRequestId: null }),
      })
      if (!res.ok) {
        setRequest(previous.request)
        setParentRequest(previous.parent)
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Failed to unlink from parent')
        return
      }
      showToast('Promoted to top-level')
    } catch {
      setRequest(previous.request)
      setParentRequest(previous.parent)
      showToast('Network error - try again')
    } finally {
      setUnlinkingParent(false)
    }
  }

  async function handlePriorityChange(priority: string | null) {
    if (!priority) return
    await patchRequest({ priority }, 'Priority updated')
  }

  /**
   * The Assignee field in Details and the Assignees slot in People are one
   * fact told twice: Details writes requests.assigneeId (what Workload, the
   * "Assigned to me" view and the unassigned filter all read), People writes
   * a request_participants row (what the avatars read). Changing one used to
   * leave the other saying something different on the same screen, so each
   * one now carries the other with it.
   */
  async function handleAssigneeChange(assigneeId: string | null) {
    const name = assigneeId ? teamMembers.find(tm => tm.id === assigneeId)?.name ?? null : null
    const previousAssigneeId = request?.assigneeId ?? null
    await patchRequest(
      { assigneeId, assigneeName: name },
      assigneeId ? `Assigned to ${name ?? 'team member'}` : 'Unassigned',
    )
    if (!canWrite || assigneeId === previousAssigneeId) return
    await syncAssigneeParticipant(previousAssigneeId, assigneeId, name)
  }

  /**
   * Make the participants list agree with the assignee field. Adds the new
   * assignee's row (the POST de-dupes, so a repeat is free) and retires the
   * person who was carrying it. Failures are non-fatal: the request field is
   * already written, and the panel reloads from the server on the next visit.
   */
  const syncAssigneeParticipant = useCallback(async (
    previousAssigneeId: string | null,
    nextAssigneeId: string | null,
    nextName: string | null,
  ) => {
    const stale = participants.filter(p =>
      p.role === 'assignee'
      && p.participantType === 'team_member'
      && p.participantId === previousAssigneeId
      && !p.id.startsWith('temp-'))
    for (const row of stale) {
      try {
        const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants/${row.id}`), {
          method: 'DELETE',
        })
        if (res.ok) setParticipants(prev => prev.filter(p => p.id !== row.id))
      } catch { /* the panel re-reads on the next load */ }
    }
    if (!nextAssigneeId) return
    if (participants.some(p => p.role === 'assignee' && p.participantId === nextAssigneeId)) return
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/participants`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: nextAssigneeId, participantType: 'team_member', role: 'assignee' }),
      })
      if (!res.ok) return
      const data = await res.json() as { participant: { id: string; addedAt: string } }
      setParticipants(prev => prev.some(p => p.id === data.participant.id)
        ? prev
        : [...prev, {
            id: data.participant.id,
            participantId: nextAssigneeId,
            participantType: 'team_member',
            role: 'assignee',
            name: nextName,
            avatar: null,
            email: null,
            addedAt: data.participant.addedAt,
          }])
    } catch { /* the panel re-reads on the next load */ }
  }, [participants, requestId])

  /**
   * The other direction: People added or removed an assignee, so the request
   * row follows. Writes the field only, which is what keeps this out of a
   * loop with the sync above.
   */
  const mirrorAssigneeFromPeople = useCallback((assigneeId: string | null, name: string | null) => {
    void patchRequest({ assigneeId, assigneeName: name })
  }, [patchRequest])

  async function handleDueDateChange(dueDate: string | null) {
    setEditingDueDate(false)
    await patchRequest({ dueDate }, dueDate ? 'Due date set' : 'Due date cleared')
  }

  async function handleScheduleRowChange(scheduleRowId: string | null) {
    const label = scheduleRowId ? phaseOptions.find(o => o.value === scheduleRowId)?.label : null
    await patchRequest(
      { scheduleRowId },
      scheduleRowId ? `Linked to ${label ?? 'schedule phase'}` : 'Unlinked from schedule',
    )
  }

  // Run AI triage - returns SUGGESTIONS only. Never mutates the request.
  async function runTriage() {
    if (triageLoading) return
    setTriageLoading(true)
    setTriageError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/triage`), { method: 'POST' })
      const json = await res.json().catch(() => ({})) as { suggestion?: TriageSuggestion; error?: string }
      if (!res.ok || !json.suggestion) {
        setTriageError(json.error ?? 'Triage failed')
        return
      }
      setTriage(json.suggestion)
    } catch {
      setTriageError('Network error - try again')
    } finally {
      setTriageLoading(false)
    }
  }

  // Apply the suggested assignee via the existing PATCH flow (patchRequest).
  async function applyTriageAssignee() {
    if (!triage) return
    await handleAssigneeChange(triage.suggestedAssigneeId)
    setTriage(prev => (prev ? { ...prev, suggestedAssigneeId: null, suggestedAssigneeName: null } : prev))
  }

  // Apply the suggested priority via the existing PATCH flow (patchRequest).
  async function applyTriagePriority() {
    if (!triage) return
    await handlePriorityChange(triage.suggestedPriority)
  }

  // Generate a PENDING reply draft. Does not post - lands in the review card.
  async function runDraftReply() {
    if (replyLoading) return
    setReplyLoading(true)
    setReplyError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/draft-reply`), { method: 'POST' })
      const json = await res.json().catch(() => ({})) as { body?: string; error?: string }
      if (!res.ok || !json.body) {
        setReplyError(json.error ?? 'Draft failed')
        return
      }
      setReplyDraft(json.body)
    } catch {
      setReplyError('Network error - try again')
    } finally {
      setReplyLoading(false)
    }
  }

  // Post the (human-edited) draft through the EXISTING message flow. This is
  // the sole approval gate for the reply draft - the admin clicks Post.
  async function postDraftReply() {
    if (!replyDraft?.trim() || postingDraft) return
    setPostingDraft(true)
    try {
      await handleSendMessage(draftTextToHtml(replyDraft), null, [], 'public')
      setReplyDraft(null)
      showToast('Reply posted to thread')
    } catch {
      setReplyError('Failed to post - try again')
    } finally {
      setPostingDraft(false)
    }
  }

  // Build the wizard seed from this request (title / category / client /
  // description). The wizard opens with this text pre-filled; the admin
  // reviews and sends it themselves.
  const taskWizardSeed = request
    ? [
        'Break this request into actionable tasks.',
        '',
        `Title: ${request.title}`,
        request.category ? `Category: ${request.category}` : null,
        request.orgName ? `Client: ${request.orgName}` : null,
        request.description ? `\nDetails:\n${stripHtmlToText(request.description)}` : null,
      ].filter(Boolean).join('\n')
    : ''

  // ---- Loading / Error / Not Found ------------------------------------------

  // Show the skeleton while SWR is loading, and also during the single frame
  // after data arrives but before the mirror effect has synced it into local
  // state (when the fetched request is non-null) so we never flash "not found".
  const showSkeleton = loading || (!request && !fetchError && !(requestData && !requestData.request))

  if (showSkeleton) {
    return (
      <div className="flex flex-col" style={{ gap: '2rem', maxWidth: '68.75rem' }}>
        {/* Back link skeleton */}
        <div className="animate-pulse rounded" style={{ height: 16, width: 120, background: 'var(--color-bg-tertiary)' }} />
        {/* Header skeleton */}
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
          style={{ color: 'var(--color-brand)', marginTop: '0.25rem' }}
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

  // The Details card. The ported rail lifts it above People and Checklists
  // (reference first, then the people, then the steps); the legacy rail
  // keeps it last. The ported rows edit in place, the legacy rows keep
  // their searchable selects and click-to-edit due date.
  const detailsCard = newUi ? (
    <SidebarCard title="Details">
      <div className="flex flex-col" style={{ gap: '0.875rem' }}>
        <DetailRow label="Type">
          <span className="capitalize">{request.type.replace(/_/g, ' ')}</span>
        </DetailRow>

        <DetailRow label="Category">
          <InlineMenuField
            ariaLabel="Change category"
            readOnly={!canWrite}
            value={request.category ?? ''}
            options={CATEGORY_OPTIONS.map(c => ({
              value: c,
              label: categoryLabel(c),
              node: <CategoryChip value={c} />,
            }))}
            renderValue={v => <CategoryChip value={v || null} />}
            onChange={handleCategoryChange}
          />
        </DetailRow>

        <DetailRow label="Priority">
          <InlineMenuField
            ariaLabel="Change priority"
            readOnly={!canWrite}
            value={request.priority}
            options={PRIORITY_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
            renderValue={v => (
              v === 'high'
                ? (
                  <span
                    className="inline-flex items-center rounded-full"
                    style={{
                      padding: '0.125rem 0.5rem',
                      fontSize: '0.6875rem',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      background: 'var(--priority-high-bg)',
                      color: 'var(--priority-high-text)',
                      border: '1px solid var(--priority-high-border)',
                    }}
                  >
                    High
                  </span>
                )
                : <span className="capitalize">{v || 'Standard'}</span>
            )}
            onChange={v => { void handlePriorityChange(v) }}
          />
        </DetailRow>

        {isAdmin && (
          <DetailRow label="Assignee">
            <InlineMenuField
              ariaLabel="Change assignee"
              readOnly={!canWrite}
              searchable
              searchPlaceholder="Search team…"
              emptyMessage="No team members"
              value={request.assigneeId ?? ''}
              options={[
                ...teamMembers.map(tm => ({ value: tm.id, label: tm.name, keywords: tm.name })),
                { value: '', label: 'Unassigned' },
              ]}
              renderValue={v => {
                const name = teamMembers.find(tm => tm.id === v)?.name ?? request.assigneeName
                return v && name
                  ? <span>{name}</span>
                  : <InlineNone>Unassigned</InlineNone>
              }}
              onChange={v => { void handleAssigneeChange(v || null) }}
            />
          </DetailRow>
        )}

        {isAdmin && (phaseOptions.length > 0 || request.scheduleRowId) && (
          <DetailRow label="Delivery phase">
            <InlineMenuField
              ariaLabel="Link to a delivery phase"
              readOnly={!canWrite}
              searchable
              searchPlaceholder="Search phases…"
              emptyMessage="No schedule phases"
              value={request.scheduleRowId ?? ''}
              options={[
                ...phaseOptions.map(o => ({ value: o.value, label: o.label, keywords: o.label })),
                { value: '', label: 'Not linked' },
              ]}
              renderValue={v => {
                const label = phaseOptions.find(o => o.value === v)?.label
                return v && label
                  ? <span>{label}</span>
                  : <InlineNone>Not linked</InlineNone>
              }}
              onChange={v => { void handleScheduleRowChange(v || null) }}
            />
          </DetailRow>
        )}

        <DetailRow label="Due date">
          <InlineDateField
            ariaLabel="Change due date"
            readOnly={!canWrite}
            value={request.dueDate}
            render={v => v
              ? <span>{formatDate(v)}</span>
              : <InlineNone>Not set</InlineNone>}
            onChange={v => { void handleDueDateChange(v) }}
          />
        </DetailRow>

        {isAdmin && (
          <DetailRow label="Estimated">
            <InlineNumberField
              ariaLabel="Change the estimate"
              readOnly={!canWrite}
              suffix="h"
              value={request.estimatedHours}
              render={v => v != null
                ? <span>{v}h</span>
                : <InlineNone>Not set</InlineNone>}
              onChange={v => { void patchRequest(
                { estimatedHours: v },
                v != null ? `Estimate set to ${v}h` : 'Estimate cleared',
              ) }}
            />
          </DetailRow>
        )}

        {request.deliveredAt && (
          <DetailRow label="Delivered">
            {formatDate(request.deliveredAt)}
          </DetailRow>
        )}
      </div>
    </SidebarCard>
    ) : (
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

        {/* Delivery phase - links this request to a schedule gantt row
            so the schedule shows live delivery status (spine #148).
            Admin-only; hidden when the org has no schedule phases. */}
        {isAdmin && (phaseOptions.length > 0 || request.scheduleRowId) && (
          <DetailRow label="Delivery phase">
            <div style={{ width: '100%', maxWidth: '10rem' }}>
              <SearchableSelect
                options={phaseOptions}
                value={request.scheduleRowId ?? ''}
                onChange={v => handleScheduleRowChange(v || null)}
                placeholder="Not linked"
                searchPlaceholder="Search phases..."
                emptyMessage="No schedule phases"
                allowClear
                size="sm"
              />
            </div>
          </DetailRow>
        )}

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
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              />
              <button
                type="button"
                onClick={() => handleDueDateChange(dueDateInput || null)}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '0.25rem 0.5rem',
                  background: 'var(--color-brand)',
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
              onMouseEnter={e => { if (isAdmin) e.currentTarget.style.color = 'var(--color-brand)' }}
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

        {request.deliveredAt && (
          <DetailRow label="Delivered">
            {formatDate(request.deliveredAt)}
          </DetailRow>
        )}
      </div>
    </SidebarCard>
  )

  // The brief. The ported detail leads with it, so a reader knows what was
  // asked before they read the replies to it; the legacy order keeps it under
  // the thread. Built once here and mounted in whichever slot applies.
  const briefCard = request.description ? (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <Card.Header bordered style={{ margin: 0, padding: '0.875rem 1.25rem' }}>
        <Card.Title as="h2">{newUi ? 'Brief' : 'Description'}</Card.Title>
      </Card.Header>
      {/* Not every writer that can reach requests.description sanitises on
          the way in (the bulk create and the sub-request create both store
          what they are handed), so the allowlist runs here on the way out.
          RichBriefProse also carries the list, link and emphasis styles the
          editor writes for, which the bare prose classes had flattened. */}
      <div data-private>
        <RichBriefProse
          html={request.description}
          style={{ padding: '1.25rem', color: 'var(--color-text)', fontSize: '0.875rem', lineHeight: 1.6 }}
        />
      </div>
    </Card>
  ) : null

  // Every status that is not one of the five pipeline steps gets the note
  // instead of the spine. The spine has no way to show how far an off-pipeline
  // request got (there is no stored high-water mark, so it would draw five
  // grey nodes and no current step, which reads as broken), and the studio can
  // still move any of them from the status control in the Actions card.
  const isOffPipelineNote = !isPipelineStatus(request.status)

  return (
    <div className="flex flex-col" style={{ gap: '1.5rem', maxWidth: '68.75rem' }}>
      {/* Breadcrumb - includes parent when this request is a sub-request */}
      <Breadcrumb
        items={[
          { label: 'Requests', href: '/requests' },
          ...(parentRequest ? [{
            label: parentRequest.requestNumber != null
              ? `#${String(parentRequest.requestNumber).padStart(3, '0')} ${parentRequest.title}`
              : parentRequest.title,
            href: `/requests/${parentRequest.id}`,
          }] : []),
          { label: request.requestNumber != null
            ? `#${String(request.requestNumber).padStart(3, '0')} ${request.title}`
            : request.title
          },
        ]}
      />

      {/* Header card - minimal, modern dashboard style. Meta row up top
          (request number + status badge + small indicator pills), then the
          title owns the full width, then a compact progress bar below
          instead of a chunky stepper. */}
      <div
        className="bg-[var(--color-bg)] rounded-xl"
        style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
      >
        <div style={{ padding: '1.5rem 1.5rem 1.25rem' }}>
          {/* Meta row */}
          <div
            className="flex items-center flex-wrap"
            style={{ gap: '0.5rem', marginBottom: '0.625rem', fontSize: '0.75rem' }}
          >
            {request.requestNumber != null && (
              <span
                data-private
                className="font-mono"
                style={{ color: 'var(--color-text-subtle)', fontWeight: 500 }}
              >
                #{String(request.requestNumber).padStart(3, '0')}
              </span>
            )}
            {request.requestNumber != null && (
              <span style={{ color: 'var(--color-border)' }} aria-hidden="true">·</span>
            )}
            <StatusBadge status={request.status} />
            {request.priority === 'high' && (
              <span
                className="inline-flex items-center rounded-full"
                style={{
                  padding: '0.125rem 0.5rem',
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  background: 'var(--priority-high-bg)',
                  color: 'var(--priority-high-text)',
                  border: '1px solid var(--priority-high-border)',
                }}
              >
                High priority
              </span>
            )}
            {/* Internal request: the one chip that says a client cannot see
                this page at all. Studio audiences only, because the portal
                payload never carries an internal request in the first place. */}
            {isAdmin && request.isInternal && (
              <span
                className="inline-flex items-center gap-1 rounded-full"
                style={{
                  padding: '0.125rem 0.5rem',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  background: 'var(--status-in-review-bg)',
                  color: 'var(--status-in-review-text)',
                  border: '1px solid var(--status-in-review-border)',
                }}
              >
                <Lock size={10} aria-hidden="true" />
                Internal
              </span>
            )}
            {/* Scope flagging is an internal studio signal: never surface it to
                the client, whose payload no longer carries scopeFlagged anyway. */}
            {isAdmin && request.scopeFlagged && (
              <span
                className="inline-flex items-center gap-1 rounded-full"
                style={{
                  padding: '0.125rem 0.5rem',
                  fontSize: '0.6875rem',
                  fontWeight: 500,
                  background: 'var(--color-danger-bg)',
                  color: 'var(--color-danger)',
                }}
              >
                <AlertTriangle size={10} aria-hidden="true" />
                Scope flagged
              </span>
            )}
            {request.revisionCount > 0 && (
              newUi && isAdmin ? (
                <RevisionChip
                  revisionCount={request.revisionCount}
                  maxRevisions={request.maxRevisions}
                />
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-full"
                  style={{
                    padding: '0.125rem 0.5rem',
                    fontSize: '0.6875rem',
                    background: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  <RefreshCw size={10} aria-hidden="true" />
                  Rev {request.revisionCount}/{request.maxRevisions}
                </span>
              )
            )}

            {/* Header actions. Studio audiences on the ported detail only. */}
            {newUi && canWrite && (
              <RequestActionsMenu
                requestId={request.id}
                orgId={request.orgId}
                hasParent={!!request.parentRequestId}
                onChanged={() => { mutateRequest() }}
              />
            )}
          </div>

          {/* Title row - title on the left, compact people stack on the
              right so the header is balanced and you can tell at a glance
              who's on this request. */}
          <div className="flex items-start" style={{ gap: '1rem' }}>
            <h1
              data-private
              className="font-bold tracking-tight flex-1"
              style={{
                color: 'var(--color-text)',
                margin: 0,
                fontSize: '1.5rem',
                lineHeight: 1.25,
                minWidth: 0,
              }}
            >
              {request.title}
            </h1>
            <PeopleStack participants={participants} />
          </div>

          {/* Client + created */}
          <div
            className="flex items-center flex-wrap"
            style={{ gap: '0.875rem', marginTop: '0.625rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}
          >
            {request.orgName && (
              <span data-private className="flex items-center" style={{ gap: '0.375rem' }}>
                <User size={12} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
                {request.orgName}
              </span>
            )}
            <span className="flex items-center" style={{ gap: '0.375rem' }}>
              <Calendar size={12} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
              Created {formatDate(request.createdAt)}
            </span>
            {request.dueDate && (
              <span className="flex items-center" style={{ gap: '0.375rem' }}>
                <Clock size={12} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
                Due {formatDate(request.dueDate)}
              </span>
            )}
            {/* Who is carrying this. The rail and the header stack both know,
                but neither says it in words, so the sub-meta does. */}
            {newUi && isAdmin && request.assigneeName && (
              <span data-private className="flex items-center" style={{ gap: '0.375rem' }}>
                <User size={12} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
                Led by{' '}
                <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                  {request.assigneeName}
                </strong>
              </span>
            )}
          </div>
        </div>

        {/* Ported detail: the strip leaves the header card entirely and
            becomes the delivery spine below it. The legacy header keeps its
            inline progress bar. */}
        {!newUi && (
        /* Minimal progress bar - replaces the chunky stepper. A single
            horizontal line with breakpoints; current step highlighted.
            Less visual weight than the numbered stepper and reads cleaner. */
        <div
          style={{
            padding: '0.75rem 1.5rem 1rem',
            borderTop: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg-secondary)',
            borderBottomLeftRadius: '0.75rem',
            borderBottomRightRadius: '0.75rem',
          }}
        >
          <div
            className="flex items-center"
            style={{ gap: '0.375rem', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}
          >
            {STATUS_FLOW.map((s, i) => {
              const isDone = currentStatusIdx > i
              const isCurrent = currentStatusIdx === i
              return (
                <span
                  key={s}
                  className="flex-1 flex flex-col"
                  style={{ gap: '0.25rem', minWidth: 0 }}
                >
                  <span
                    style={{
                      height: 3,
                      borderRadius: 2,
                      background: isDone || isCurrent
                        ? 'var(--color-brand)'
                        : 'var(--color-border)',
                      transition: 'background 200ms ease',
                    }}
                  />
                  <span
                    className="truncate"
                    style={{
                      color: isCurrent ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                  >
                    {statusLabel(s)}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
        )}
      </div>

      {/* Scope warning. The header chip is the at-a-glance signal; this card
          carries the reason, so whoever picks the request up next reads why
          before they start burning more hours on it. Studio only. */}
      {newUi && isAdmin && request.scopeFlagged && (
        <div
          role="region"
          aria-label="Scope warning"
          style={{
            border: '1px solid var(--color-danger)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-xs)',
            padding: '0.875rem 1.125rem',
          }}
        >
          <div className="flex items-start" style={{ gap: '0.6875rem' }}>
            <AlertTriangle
              size={18}
              aria-hidden="true"
              style={{ flexShrink: 0, marginTop: '0.0625rem', color: 'var(--color-danger)' }}
            />
            <div style={{ minWidth: 0 }}>
              <p className="text-sm font-bold" style={{ color: 'var(--color-text)', margin: 0 }}>
                Scope flagged, check before continuing
              </p>
              <p
                className="text-xs"
                style={{ color: 'var(--color-text-muted)', margin: '0.1875rem 0 0', lineHeight: 1.5 }}
              >
                {request.scopeFlagReason || 'Someone on the team flagged this for a scope check.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Delivery spine: its own card between the header and the grid.
          Off-pipeline statuses (draft, on hold, cancelled, archived) get a
          one-line note instead of five steps with no current one, which reads
          as broken rather than deliberate. */}
      {newUi && (
        isOffPipelineNote ? (
          <div
            className="flex items-center"
            style={{
              gap: '0.5625rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-bg)',
              boxShadow: 'var(--shadow-xs)',
              padding: '0.875rem 1.125rem',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--color-text-muted)',
            }}
          >
            <OffPipelineIcon status={request.status} />
            {OFF_PIPELINE_NOTES[request.status] ?? 'This request is off the delivery pipeline.'}
          </div>
        ) : (
          <DeliverySpine
            status={request.status}
            interactive={canWrite}
            busy={statusUpdating}
            eta={request.dueDate ? `Due ${formatDate(request.dueDate)}` : null}
            onPick={handleStatusChange}
          />
        )
      )}

      {/* Client review actions - client only. Sits directly under the pipeline
          bar so approving a delivery is the obvious next step. Approve routes
          through the whitelisted portal PATCH (client_review -> delivered);
          "Request a change" arms the change tag and focuses the composer. */}
      {newUi && !isAdmin && request.status === 'client_review' && (
        <ClientReviewBar
          busy={approving}
          disabled={isImpersonatingClient}
          onApprove={handleReviewApprove}
          onRequestChanges={handleRequestChange}
        />
      )}

      {!newUi && !isAdmin && request.status === 'client_review' && (
        <div
          role="region"
          aria-label="Review this delivery"
          style={{
            border: '1px solid var(--color-brand)',
            background: 'var(--color-brand-50)',
            borderRadius: 'var(--radius-leaf, 0 16px 0 16px)',
            padding: '1rem 1.125rem',
          }}
        >
          <div className="flex items-start flex-wrap" style={{ gap: '0.75rem' }}>
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: '1.75rem', height: '1.75rem',
                borderRadius: '0 0.5rem 0 0.5rem',
                background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
              }}
            >
              <CheckCircle2 size={14} style={{ color: '#ffffff' }} aria-hidden="true" />
            </div>
            <div className="flex-1" style={{ minWidth: '12rem' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-brand-dark)', margin: 0 }}>
                Ready for your review
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', margin: '0.1875rem 0 0' }}>
                Approve to close this request, or request a change and tell us what needs adjusting.
              </p>
            </div>
            <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
              <button
                type="button"
                onClick={handleClientApprove}
                disabled={approving}
                className="inline-flex items-center transition-colors"
                style={{
                  gap: '0.375rem',
                  padding: '0.4375rem 0.875rem',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-button)',
                  border: 'none',
                  background: approving ? 'var(--color-bg-tertiary)' : 'var(--color-brand)',
                  color: approving ? 'var(--color-text-subtle)' : '#ffffff',
                  cursor: approving ? 'not-allowed' : 'pointer',
                  minHeight: '2.25rem',
                }}
                onMouseEnter={e => { if (!approving) e.currentTarget.style.background = 'var(--color-brand-dark)' }}
                onMouseLeave={e => { if (!approving) e.currentTarget.style.background = 'var(--color-brand)' }}
              >
                {approving
                  ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  : <Check size={14} aria-hidden="true" />}
                {approving ? 'Approving…' : 'Approve & close'}
              </button>
              <button
                type="button"
                onClick={handleRequestChange}
                disabled={approving}
                className="inline-flex items-center transition-colors"
                style={{
                  gap: '0.375rem',
                  padding: '0.4375rem 0.875rem',
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  borderRadius: 'var(--radius-button)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  cursor: approving ? 'not-allowed' : 'pointer',
                  minHeight: '2.25rem',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-brand)'
                  e.currentTarget.style.color = 'var(--color-brand-dark)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Request a change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI triage suggestion banner - admin only. Suggestions never apply
          themselves; each field has an explicit Apply button that routes
          through the same PATCH the manual controls use. Dismissible. */}
      {isAdmin && triage && (
        <div
          role="region"
          aria-label="AI triage suggestions"
          style={{
            border: '1px solid var(--color-brand)',
            background: 'var(--color-brand-50)',
            borderRadius: 'var(--radius-leaf, 0 16px 0 16px)',
            padding: '1rem 1.125rem',
          }}
        >
          <div className="flex items-start" style={{ gap: '0.75rem' }}>
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: '1.75rem', height: '1.75rem',
                borderRadius: '0 0.5rem 0 0.5rem',
                background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
              }}
            >
              <Sparkles size={14} style={{ color: '#ffffff' }} aria-hidden="true" />
            </div>
            <div className="flex-1" style={{ minWidth: 0 }}>
              <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-brand-dark)', margin: 0 }}>
                  AI triage suggestion
                </p>
                <button
                  type="button"
                  onClick={() => setTriage(null)}
                  aria-label="Dismiss triage suggestions"
                  className="flex items-center justify-center transition-colors"
                  style={{
                    width: '1.5rem', height: '1.5rem', flexShrink: 0,
                    border: 'none', background: 'transparent',
                    color: 'var(--color-text-subtle)', cursor: 'pointer',
                    borderRadius: '0.375rem',
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)', margin: '0.25rem 0 0', lineHeight: 1.5 }}>
                {triage.oneLineReason}
              </p>

              <div className="flex flex-wrap items-center" style={{ gap: '0.5rem', marginTop: '0.75rem' }}>
                {/* Assignee suggestion + Apply (uses existing assign flow) */}
                {triage.suggestedAssigneeId && triage.suggestedAssigneeName && request.assigneeId !== triage.suggestedAssigneeId && (
                  <SuggestionApplyChip
                    label="Assign"
                    value={triage.suggestedAssigneeName}
                    onApply={applyTriageAssignee}
                  />
                )}
                {/* Priority suggestion + Apply (uses existing priority flow) */}
                {request.priority !== triage.suggestedPriority && (
                  <SuggestionApplyChip
                    label="Priority"
                    value={triage.suggestedPriority === 'high' ? 'High' : 'Standard'}
                    onApply={applyTriagePriority}
                  />
                )}
                {/* Track is shown as context. There is no request-level track
                    endpoint to route an Apply through, so we surface it as a
                    read-only hint rather than a misleading button. */}
                <span
                  className="inline-flex items-center rounded-full"
                  style={{
                    gap: '0.25rem', padding: '0.1875rem 0.5rem',
                    fontSize: '0.6875rem', fontWeight: 500,
                    background: 'var(--color-bg)', color: 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  Suggested track: {triage.suggestedTrack === 'large' ? 'Large' : 'Small'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-request creation dialog - opened from the <SubRequestsPanel>
          "New sub-request" button. Client is locked to parent's org. */}
      {canWrite && !request.parentRequestId && (
        <NewRequestDialog
          open={newSubOpen}
          onClose={() => setNewSubOpen(false)}
          isAdmin
          parentRequestId={request.id}
          forceOrgId={request.orgId}
          onCreated={() => {
            // Refresh sub-requests list without a full page load
            mutateRequest()
            showToast('Sub-request created')
          }}
        />
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_16rem] lg:grid-cols-[1fr_20rem] gap-6">
        {/* Left column - thread-first, description / sub-requests / files below,
            activity collapsed at the bottom */}
        <div className="flex flex-col gap-6">
          {/* Ported order: brief, then the conversation about it. */}
          {newUi && briefCard}

          {/* Thread */}
          <Card padding="none" style={{ overflow: 'hidden' }}>
            <Card.Header
              bordered
              style={{ margin: 0, padding: '0.875rem 1.25rem' }}
            >
              <Card.Title as="h2" className="flex items-center gap-2">
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
                {unreadCount > 0 && (
                  <span
                    className="text-xs font-semibold rounded-full"
                    style={{
                      padding: '0.0625rem 0.5rem',
                      background: 'var(--color-brand)',
                      color: '#ffffff',
                    }}
                    aria-label={`${unreadCount} unread`}
                  >
                    {unreadCount} new
                  </span>
                )}
              </Card.Title>
            </Card.Header>

            <div style={{ padding: '1.25rem' }}>
              <RequestThread messages={messages} currentUserId={currentUserId} />
              <div ref={threadBottomRef} />
            </div>

            {/* Composer */}
            <div
              ref={composerWrapRef}
              style={{
                padding: '1rem 1.25rem',
                borderTop: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              {/* AI reply draft - admin only. Generates a PENDING draft the
                  admin edits in place and then explicitly posts through the
                  normal thread flow below. The AI never posts. */}
              {isAdmin && (
                <div style={{ marginBottom: '0.75rem' }}>
                  {!replyDraft ? (
                    <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={runDraftReply}
                        disabled={replyLoading}
                        className="inline-flex items-center transition-colors"
                        style={{
                          gap: '0.375rem',
                          padding: '0.375rem 0.75rem',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          borderRadius: 'var(--radius-button)',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-bg)',
                          color: 'var(--color-brand)',
                          cursor: replyLoading ? 'not-allowed' : 'pointer',
                          opacity: replyLoading ? 0.6 : 1,
                          minHeight: '2rem',
                        }}
                      >
                        {replyLoading
                          ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                          : <Sparkles size={13} aria-hidden="true" />}
                        {replyLoading ? 'Drafting…' : 'AI: draft reply'}
                      </button>
                      {replyError && (
                        <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
                          {replyError}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div
                      style={{
                        border: '1px solid var(--color-brand)',
                        background: 'var(--color-brand-50)',
                        borderRadius: 'var(--radius-lg)',
                        padding: '0.75rem 0.875rem',
                      }}
                    >
                      <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem', gap: '0.5rem' }}>
                        <span className="inline-flex items-center text-xs font-semibold" style={{ gap: '0.375rem', color: 'var(--color-brand-dark)' }}>
                          <Sparkles size={13} aria-hidden="true" />
                          AI draft - review before posting
                        </span>
                        <span
                          className="inline-flex items-center rounded-full"
                          style={{
                            padding: '0.125rem 0.5rem', fontSize: '0.625rem', fontWeight: 600,
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                            background: 'var(--color-warning-bg)', color: 'var(--color-warning)',
                          }}
                        >
                          Pending
                        </span>
                      </div>
                      <textarea
                        className="tahi-focus-ring"
                        value={replyDraft}
                        onChange={e => setReplyDraft(e.target.value)}
                        rows={7}
                        aria-label="AI reply draft - edit before posting"
                        style={{
                          width: '100%',
                          padding: '0.625rem 0.75rem',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-bg)',
                          color: 'var(--color-text)',
                          fontSize: '0.8125rem',
                          fontFamily: 'inherit',
                          lineHeight: 1.6,
                          resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                      />
                      {replyError && (
                        <p className="text-xs" style={{ color: 'var(--color-danger)', margin: '0.375rem 0 0' }}>
                          {replyError}
                        </p>
                      )}
                      <div className="flex items-center flex-wrap" style={{ gap: '0.5rem', marginTop: '0.625rem' }}>
                        <button
                          type="button"
                          onClick={postDraftReply}
                          disabled={postingDraft || !replyDraft.trim()}
                          className="inline-flex items-center transition-colors"
                          style={{
                            gap: '0.375rem',
                            padding: '0.375rem 0.75rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-button)',
                            border: 'none',
                            background: postingDraft || !replyDraft.trim() ? 'var(--color-bg-tertiary)' : 'var(--color-brand)',
                            color: postingDraft || !replyDraft.trim() ? 'var(--color-text-subtle)' : '#ffffff',
                            cursor: postingDraft || !replyDraft.trim() ? 'not-allowed' : 'pointer',
                            minHeight: '2rem',
                          }}
                        >
                          {postingDraft
                            ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                            : <Check size={13} aria-hidden="true" />}
                          {postingDraft ? 'Posting…' : 'Post to thread'}
                        </button>
                        <button
                          type="button"
                          onClick={runDraftReply}
                          disabled={replyLoading || postingDraft}
                          className="inline-flex items-center transition-colors"
                          style={{
                            gap: '0.375rem',
                            padding: '0.375rem 0.75rem',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            borderRadius: 'var(--radius-button)',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-bg)',
                            color: 'var(--color-text-muted)',
                            cursor: replyLoading || postingDraft ? 'not-allowed' : 'pointer',
                            opacity: replyLoading || postingDraft ? 0.6 : 1,
                            minHeight: '2rem',
                          }}
                        >
                          {replyLoading
                            ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                            : <RefreshCw size={13} aria-hidden="true" />}
                          Regenerate
                        </button>
                        <button
                          type="button"
                          onClick={() => { setReplyDraft(null); setReplyError(null) }}
                          disabled={postingDraft}
                          className="inline-flex items-center transition-colors"
                          style={{
                            gap: '0.375rem',
                            padding: '0.375rem 0.75rem',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            borderRadius: 'var(--radius-button)',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text-muted)',
                            cursor: postingDraft ? 'not-allowed' : 'pointer',
                            minHeight: '2rem',
                          }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Client view is a lens, not a login: every portal write
                  answers 403, so the composer says so rather than letting
                  someone type a reply the server will refuse. */}
              {isImpersonatingClient ? (
                <p
                  className="text-xs"
                  style={{ color: 'var(--color-text-subtle)', margin: 0, lineHeight: 1.5 }}
                >
                  {`You are reading this as ${request.orgName ?? 'the client'}. Replies are read-only in client view.`}
                </p>
              ) : (
                <MessageComposer
                  onSubmit={handleSendMessage}
                  placeholder={isAdmin ? 'Reply to client or add an internal note…' : 'Add a comment or question…'}
                  canBeInternal={isAdmin}
                  clientName={request?.orgName ?? undefined}
                  requestId={requestId}
                  orgId={request?.orgId}
                  seed={composerSeed}
                />
              )}
            </div>
          </Card>

          {/* Legacy order keeps the brief under the thread. */}
          {!newUi && briefCard}

          {/* Sub-requests - only for top-level requests (V1 disallows grandchildren) */}
          {!request.parentRequestId && (
            <SubRequestsPanel
              parentRequestId={request.id}
              subRequests={subRequests}
              alwaysShow={isAdmin}
              canCreate={canWrite}
              onCreated={() => { mutateRequest() }}
              onRequestNew={() => setNewSubOpen(true)}
              emptyMessage={newUi ? 'No sub-requests yet.' : undefined}
            />
          )}

          {/* Tasks spawned from this request (admin only). Mirrors the
              sub-requests panel; the AI task wizard now links tasks back here. */}
          {isAdmin && <RequestTasksPanel requestId={requestId} />}

          {/* Files */}
          <FilesPanel
            files={files}
            onRefresh={() => { mutateFiles() }}
            requestId={requestId}
            orgId={request.orgId}
            emptyHint={newUi ? 'No files yet. Drop one here or upload.' : undefined}
          />

          {/* Activity log - collapsed by default at the bottom */}
          <ActivityLog
            request={request}
            messages={messages}
            files={files}
            newUi={newUi}
          />
        </div>

        {/* Right column: Metadata sidebar - primary-use blocks first.
            Ported order: Time, Actions, Discovery calls, Details, People,
            Checklists. Legacy order keeps Details last.

            From md up the rail sticks to the top of the scrollport (the
            <main> element in the dashboard layout), so Time, Actions and the
            status control stay reachable on a long thread. `self-start` is
            what makes that work: a stretched grid item is as tall as the row
            and has nowhere to travel. Below md the grid is one column and the
            rail scrolls with the page.

            A pinned box stops translating, so a rail taller than the viewport
            would put Details, People and Checklists permanently out of reach:
            the max-height plus its own overflow is what keeps the bottom of a
            studio rail scrollable once it pins. The shell is `h-screen`, so
            the budget is 100vh less the 3.5rem top bar, less the top offset,
            less a little breathing room at the bottom: 6rem at md, 7rem at lg.
            Deliberately conservative, because an optional banner above the top
            bar can only ever make the scrollport shorter, and a rail that ends
            early reads as spacing while one that ends late is unreachable. The
            top offset itself is what keeps the first card off the top bar.
            Menus in here render through the shared portalled <Popover>, so
            they still escape this scroll container. */}
        <div className="flex flex-col gap-4 md:self-start md:sticky md:top-4 lg:top-6 md:max-h-[calc(100vh_-_6rem)] lg:max-h-[calc(100vh_-_7rem)] md:overflow-y-auto md:overscroll-contain">
          {/* Time (admin only): live timer + manual log + recent entries */}
          {isAdmin && <TimeCard requestId={requestId} />}

          {/* Calls: kickoff, scope review, mid-build check-ins. The ported
              rail puts Actions directly under Time, so a phone-width column
              leads with the two blocks the studio touches most. */}
          {isAdmin && !newUi && <DiscoveryCallsCard parentType="request" parentId={requestId} />}

          {/* Actions: status dropdown, scope flag toggle, make top-level */}
          {isAdmin && (
            <SidebarCard title="Actions">
              <div className="flex flex-col" style={{ gap: '0.5rem' }}>
                {/* Status: editable chip matching the requests list status chip */}
                <div className="flex items-center" style={{ gap: '0.5rem' }}>
                  <span
                    className="text-xs font-medium"
                    style={{
                      color: 'var(--color-text-subtle)',
                      width: '4.5rem', flexShrink: 0,
                    }}
                  >
                    Status
                  </span>
                  <div style={{ flex: 1 }}>
                    {/* The shared chip, driven off REQUEST_STATUSES. The old
                        local copy carried its own six-status list, so a
                        request the board had put on hold printed the raw
                        slug here and could not be moved back or cancelled
                        from the page that manages it. */}
                    <StatusChipSelect
                      value={request.status}
                      options={REQUEST_STATUSES}
                      busy={statusUpdating}
                      disabled={!canWrite}
                      onChange={handleStatusChange}
                    />
                  </div>
                </div>

                {/* Scope flag toggle */}
                <button
                  type="button"
                  onClick={handleScopeFlagToggle}
                  disabled={!canWrite}
                  className="tahi-focus-ring flex items-center transition-colors min-h-11 md:min-h-8"
                  style={{
                    gap: '0.375rem',
                    padding: '0.3125rem 0.625rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    borderRadius: 'var(--radius-button)',
                    border: request.scopeFlagged
                      ? '1px solid var(--color-danger)'
                      : '1px solid var(--color-border)',
                    background: request.scopeFlagged
                      ? 'var(--color-danger-bg)'
                      : 'var(--color-bg)',
                    color: request.scopeFlagged
                      ? 'var(--color-danger)'
                      : 'var(--color-text-muted)',
                    cursor: canWrite ? 'pointer' : 'not-allowed',
                    opacity: canWrite ? 1 : 0.6,
                    justifyContent: 'flex-start',
                  }}
                  onMouseEnter={e => {
                    if (canWrite && !request.scopeFlagged) {
                      e.currentTarget.style.borderColor = 'var(--color-warning)'
                      e.currentTarget.style.background = 'var(--color-warning-bg)'
                      e.currentTarget.style.color = 'var(--color-warning)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!request.scopeFlagged) {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.background = 'var(--color-bg)'
                      e.currentTarget.style.color = 'var(--color-text-muted)'
                    }
                  }}
                  aria-pressed={request.scopeFlagged}
                >
                  <AlertTriangle size={12} aria-hidden="true" />
                  {request.scopeFlagged ? 'Scope flagged' : 'Flag scope creep'}
                </button>

                {/* Internal request. The only control on this page that
                    changes who can see it, so the note underneath spells the
                    consequence out in the client's own name rather than
                    leaving it to the switch label. Both the portal list and
                    the portal detail already refuse internal rows, so the
                    switch closes the boundary rather than opening one. */}
                {newUi && (
                  <>
                    <InternalSwitch
                      checked={request.isInternal}
                      busy={internalUpdating}
                      disabled={!canWrite}
                      describedById={INTERNAL_NOTE_ID}
                      onToggle={handleInternalToggle}
                    />
                    <p
                      id={INTERNAL_NOTE_ID}
                      className="text-xs"
                      style={{ color: 'var(--color-text-subtle)', margin: 0, lineHeight: 1.45 }}
                    >
                      {request.isInternal
                        ? 'Hidden from the client portal.'
                        : `Visible to ${request.orgName ?? 'the client'} in their portal.`}
                    </p>
                  </>
                )}

                {/* Make top-level - only for sub-requests */}
                {request.parentRequestId && (
                  <button
                    type="button"
                    onClick={handleUnlinkFromParent}
                    disabled={unlinkingParent || !canWrite}
                    className="tahi-focus-ring flex items-center transition-colors min-h-11 md:min-h-8"
                    style={{
                      gap: '0.375rem',
                      padding: '0.3125rem 0.625rem',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      borderRadius: 'var(--radius-button)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text-muted)',
                      cursor: unlinkingParent || !canWrite ? 'not-allowed' : 'pointer',
                      opacity: unlinkingParent || !canWrite ? 0.6 : 1,
                      justifyContent: 'flex-start',
                    }}
                    onMouseEnter={e => {
                      if (!unlinkingParent && canWrite) {
                        e.currentTarget.style.borderColor = 'var(--color-brand)'
                        e.currentTarget.style.background = 'var(--color-brand-50)'
                        e.currentTarget.style.color = 'var(--color-brand-dark)'
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--color-border)'
                      e.currentTarget.style.background = 'var(--color-bg)'
                      e.currentTarget.style.color = 'var(--color-text-muted)'
                    }}
                  >
                    {unlinkingParent
                      ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      : <RefreshCw size={12} aria-hidden="true" />}
                    Make top-level
                  </button>
                )}

                {/* AI assist - human-in-the-loop. "Break into tasks" opens the
                    existing task wizard seeded from this request; "Suggest
                    triage" fetches routing suggestions into the banner above.
                    Neither changes anything without an explicit follow-up. */}
                <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '0.25rem 0' }} aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  disabled={!canWrite}
                  className="tahi-focus-ring flex items-center transition-colors min-h-11 md:min-h-8"
                  style={{
                    gap: '0.375rem',
                    padding: '0.3125rem 0.625rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    borderRadius: 'var(--radius-button)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-brand)',
                    cursor: canWrite ? 'pointer' : 'not-allowed',
                    opacity: canWrite ? 1 : 0.6,
                    justifyContent: 'flex-start',
                  }}
                  onMouseEnter={e => { if (canWrite) e.currentTarget.style.background = 'var(--color-brand-50)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
                >
                  <Wand2 size={12} aria-hidden="true" />
                  AI: break into tasks
                </button>
                <button
                  type="button"
                  onClick={runTriage}
                  disabled={triageLoading || !canWrite}
                  className="tahi-focus-ring flex items-center transition-colors min-h-11 md:min-h-8"
                  style={{
                    gap: '0.375rem',
                    padding: '0.3125rem 0.625rem',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    borderRadius: 'var(--radius-button)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-brand)',
                    cursor: triageLoading || !canWrite ? 'not-allowed' : 'pointer',
                    opacity: triageLoading || !canWrite ? 0.6 : 1,
                    justifyContent: 'flex-start',
                  }}
                  onMouseEnter={e => { if (!triageLoading && canWrite) e.currentTarget.style.background = 'var(--color-brand-50)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
                >
                  {triageLoading
                    ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                    : <Sparkles size={12} aria-hidden="true" />}
                  {triageLoading ? 'Analysing…' : 'AI: suggest triage'}
                </button>
                {triageError && (
                  <span className="text-xs" style={{ color: 'var(--color-danger)' }}>
                    {triageError}
                  </span>
                )}
              </div>
            </SidebarCard>
          )}

          {isAdmin && newUi && <DiscoveryCallsCard parentType="request" parentId={requestId} />}

          {/* Details, then People, then Checklists on the ported rail;
              the legacy rail keeps Details last. */}
          {newUi && detailsCard}

          {/* People - PM / Assignees / Followers */}
          <PeoplePanel
            requestId={requestId}
            orgId={request.orgId}
            participants={participants}
            setParticipants={setParticipants}
            isAdmin={canWrite}
            lockPm={newUi}
            dedupeAcrossRoles={newUi}
            onAssigneeMirror={mirrorAssigneeFromPeople}
          />

          {/* Checklists */}
          <ChecklistsPanel
            checklists={checklists}
            onSave={saveChecklists}
            isAdmin={canWrite}
          />

          {!newUi && detailsCard}
        </div>
      </div>

      {/* AI task wizard - seeded from this request. Opens with a pre-filled
          prompt the admin reviews and sends; tasks are reviewed + created
          inside the wizard exactly as on the tasks page. */}
      {canWrite && (
        <AiTaskWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          context={{ orgId: request.orgId, trackType: request.size ?? undefined, requestId }}
          seed={taskWizardSeed}
          onTasksCreated={() => {
            mutateRequest()
            showToast('Tasks created')
          }}
        />
      )}

      {/* Mobile bottom nav spacer */}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  )
}

// ---- Activity Log ------------------------------------------------------------

const ACTIVITY_FILTER_OPTIONS = [
  { value: 'all' as const, label: 'All' },
  { value: 'comments' as const, label: 'Comments' },
]

function ActivityLog({
  request,
  messages,
  files,
  newUi = false,
}: {
  request: Request
  messages: Message[]
  files: RequestFile[]
  /**
   * The ported detail. Moves the filter into the header so which half of the
   * feed you are reading shows without expanding, starts the card expanded
   * when the log is short enough to read at a glance (five events or fewer),
   * and swaps "Posted a comment" for the comment's own first line. Everyone
   * still on the legacy detail keeps today's card exactly as it was, which is
   * the same gate the rest of this page honours.
   */
  newUi?: boolean
}) {
  // `open` toggles the whole card; `expanded` toggles Show more inside it.
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  // `filter` switches between all events and comments-only, persisted so the
  // preference sticks across requests and sessions.
  const [filter, setFilter] = useState<ActivityFilter>('all')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('tahi-activity-filter')
      if (saved === 'comments' || saved === 'all') setFilter(saved)
    } catch { /* localStorage unavailable */ }
  }, [])

  const applyFilter = useCallback((next: ActivityFilter) => {
    setFilter(next)
    // The ported card's filter is clickable while the body is collapsed, so
    // choosing a half of the feed has to reveal it. Otherwise the control
    // reads as dead: the selection moves and nothing appears.
    setOpen(true)
    try { localStorage.setItem('tahi-activity-filter', next) } catch { /* ignore */ }
  }, [])

  // Thread messages are merged in as comment events carrying a one-line
  // excerpt, so Comments filters to something worth reading rather than a
  // stack of rows that all say "Posted a comment".
  //
  // Memoised because messageExcerpt walks the full Tiptap HTML of every
  // message: without this every parent re-render (status patch, participant
  // edit, SWR revalidation) re-parses the whole thread to build a list the
  // collapsed card then throws away.
  const events = useMemo(() => {
    const merged = buildActivityEvents(
      {
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        deliveredAt: request.deliveredAt,
        statusLabel: statusLabel(request.status),
        assigneeName: request.assigneeName,
      },
      messages.map(m => ({
        id: m.id,
        body: m.body,
        isInternal: m.isInternal,
        createdAt: m.createdAt,
        authorName: m.teamMemberName
          ?? m.authorName
          ?? (m.authorType === 'contact' ? 'Client' : null),
      })),
      files.map(f => ({
        id: f.id,
        filename: f.filename,
        createdAt: f.createdAt,
        uploaderName: f.uploaderName ?? null,
      })),
    )
    if (newUi) return merged
    // Legacy detail keeps the wording it has today. Same chronology, same
    // filter, no excerpts, so the surface every non-super-admin uses is
    // untouched by this slice.
    return merged.map(e => e.type === 'comment'
      ? { ...e, description: e.internal ? 'Posted an internal note' : 'Posted a comment' }
      : e)
  }, [
    request.createdAt, request.updatedAt, request.deliveredAt,
    request.status, request.assigneeName, messages, files, newUi,
  ])

  // Ported detail: a short log opens itself once per request, so five events
  // or fewer are readable without a click. The ref means a later click to
  // collapse it sticks instead of being re-opened on the next render.
  const eventCount = events.length
  const autoOpenedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!newUi) return
    if (autoOpenedFor.current === request.id) return
    autoOpenedFor.current = request.id
    setOpen(eventCount > 0 && eventCount <= 5)
  }, [newUi, request.id, eventCount])

  const filteredEvents = filterActivityEvents(events, filter)
  const displayed = expanded ? filteredEvents : filteredEvents.slice(0, 5)

  const iconMap: Record<ActivityEventType, React.ReactNode> = {
    created: <Plus size={10} />,
    status_change: <RefreshCw size={10} />,
    comment: newUi ? <MessageSquare size={10} /> : <FileText size={10} />,
    file_upload: <Upload size={10} />,
  }

  // The disclosure's own contents, shared by both headers. `min-w-0` on the
  // label and `truncate` on the word are what make the row degrade by
  // ellipsis: the Card clips its overflow, so a header that cannot shrink
  // loses the chevron silently at 375px instead of wrapping.
  const disclosureInner = (
    <>
      <span
        className="text-sm font-semibold flex items-center gap-2 min-w-0"
        style={{ color: 'var(--color-text)' }}
      >
        <Activity size={14} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} aria-hidden="true" />
        <span className="truncate">Activity</span>
        {events.length > 0 && (
          <span
            className="text-xs font-normal rounded-full flex-shrink-0"
            style={{
              padding: '0.0625rem 0.4375rem',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-subtle)',
            }}
          >
            {events.length}
          </span>
        )}
      </span>
      <ChevronDown
        size={14}
        aria-hidden="true"
        style={{
          flexShrink: 0,
          color: 'var(--color-text-subtle)',
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}
      />
    </>
  )

  const filterControl = (className: string) => events.length > 0 ? (
    <SegmentedControl
      role="tablist"
      size="sm"
      ariaLabel="Activity filter"
      value={filter}
      onChange={applyFilter}
      options={ACTIVITY_FILTER_OPTIONS}
      className={className}
    />
  ) : null

  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      {/* Ported header row. The filter sits out here beside the disclosure
          rather than inside the body, so which half of the feed you are
          looking at reads without expanding the card first. It cannot live
          inside the disclosure button either: a control inside a button is
          not a control. The legacy header below keeps the filter in the body,
          where every non-super-admin has it today. */}
      {newUi ? (
        <div
          className="flex items-center"
          style={{
            gap: '0.5rem',
            padding: '0.5rem 0.75rem 0.5rem 1.25rem',
            borderBottom: open ? '1px solid var(--color-row-border)' : 'none',
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-controls="activity-log-body"
            className="tahi-focus-ring flex items-center flex-1 transition-colors min-h-11 md:min-h-8"
            style={{
              gap: '0.5rem',
              minWidth: 0,
              padding: '0.375rem 0.5rem',
              marginLeft: '-0.5rem',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            {disclosureInner}
          </button>
          {filterControl('shrink-0')}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-controls="activity-log-body"
          className="tahi-focus-ring flex items-center justify-between w-full transition-colors"
          style={{
            padding: '0.875rem 1.25rem',
            background: 'transparent',
            // `border` first, then `borderBottom`: inline styles apply in key
            // order, so the shorthand would wipe the divider if it came last.
            border: 'none',
            borderBottom: open ? '1px solid var(--color-row-border)' : 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {disclosureInner}
        </button>
      )}

      {open && (
      <div id="activity-log-body" style={{ padding: '0.75rem 1.25rem' }}>
        {!newUi && filterControl('mb-3')}
        {filteredEvents.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-text-subtle)', padding: '0.5rem 0' }}>
            {filter === 'comments' ? 'No comments yet.' : 'No activity yet.'}
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
                    background: newUi && event.internal
                      ? 'var(--status-in-review-bg)'
                      : 'var(--color-bg-tertiary)',
                    color: newUi && event.internal
                      ? 'var(--status-in-review-text)'
                      : 'var(--color-text-subtle)',
                  }}
                >
                  {iconMap[event.type]}
                </div>
                <div className="flex-1 min-w-0">
                  {newUi && event.type === 'comment' ? (
                    <>
                      <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                        <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {event.author ?? 'Someone'}
                        </span>
                        {event.internal ? ' added an internal note' : ' commented'}
                      </p>
                      {event.description && (
                        <p
                          data-private
                          className="text-xs truncate"
                          style={{ color: 'var(--color-text-muted)', marginTop: '0.0625rem' }}
                          title={event.description}
                        >
                          {event.description}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                      {event.author ? (
                        <span className="font-medium" style={{ color: 'var(--color-text)' }}>
                          {event.author}
                        </span>
                      ) : null}
                      {event.author ? ' ' : ''}
                      {event.description}
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}>
                    {formatActivityDate(event.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredEvents.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="tahi-focus-ring text-xs font-medium transition-colors"
            style={{
              color: 'var(--color-brand)',
              background: 'none',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              padding: '0.375rem 0 0',
              display: 'block',
            }}
          >
            {expanded ? 'Show less' : `Show all ${filteredEvents.length} events`}
          </button>
        )}
      </div>
      )}
    </Card>
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

// ---- People Stack (header) ---------------------------------------------------

/**
 * Compact overlapping avatar stack shown in the request detail header.
 * PM first, then assignees, then followers if we still have room. Extra
 * people collapse into a "+N" chip. Purely visual - the full list of
 * people is managed in the sidebar People panel.
 */
function PeopleStack({ participants }: { participants: Participant[] }) {
  const pm = participants.find(p => p.role === 'pm') ?? null
  const assignees = participants.filter(p => p.role === 'assignee')
  const followers = participants.filter(p => p.role === 'follower')

  // Visual order: PM on the left, then assignees, then followers.
  const ordered: Array<{ p: Participant; accent: 'pm' | 'normal' }> = []
  if (pm) ordered.push({ p: pm, accent: 'pm' })
  for (const a of assignees) ordered.push({ p: a, accent: 'normal' })
  for (const f of followers) ordered.push({ p: f, accent: 'normal' })

  if (ordered.length === 0) {
    return (
      <span
        className="flex items-center flex-shrink-0"
        style={{
          fontSize: '0.6875rem',
          color: 'var(--color-text-subtle)',
          gap: '0.25rem',
          padding: '0.125rem 0.5rem',
          background: 'var(--color-bg-secondary)',
          border: '1px dashed var(--color-border)',
          borderRadius: '9999px',
        }}
        title="No people assigned yet"
      >
        <User size={11} aria-hidden="true" />
        Unassigned
      </span>
    )
  }

  const VISIBLE = 4
  const visible = ordered.slice(0, VISIBLE)
  const overflow = ordered.length - visible.length

  return (
    <div
      className="flex items-center flex-shrink-0"
      style={{ marginLeft: 'auto' }}
      aria-label={`${ordered.length} ${ordered.length === 1 ? 'person' : 'people'}`}
    >
      <div
        className="flex items-center"
        style={{ paddingRight: overflow > 0 ? '0.25rem' : 0 }}
      >
        {visible.map(({ p, accent }, i) => (
          <span
            key={p.id}
            title={`${p.name ?? 'Unknown'}${p.role === 'pm' ? ' - PM' : p.role === 'assignee' ? ' - Assignee' : ' - Follower'}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '1.75rem',
              height: '1.75rem',
              borderRadius: '9999px',
              background: accent === 'pm' ? 'var(--color-brand-100)' : 'var(--color-bg-tertiary)',
              color: accent === 'pm' ? 'var(--color-brand-dark)' : 'var(--color-text)',
              fontSize: '0.625rem',
              fontWeight: 600,
              border: `2px solid var(--color-bg)`,
              marginLeft: i === 0 ? 0 : '-0.4375rem',
              position: 'relative',
              zIndex: visible.length - i,
              boxShadow: accent === 'pm' ? '0 0 0 1px var(--color-brand)' : undefined,
            }}
          >
            {(p.name ?? '?')
              .split(' ')
              .map(s => s[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
        ))}
      </div>
      {overflow > 0 && (
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'var(--color-text-muted)',
            padding: '0.125rem 0.4375rem',
            background: 'var(--color-bg-tertiary)',
            borderRadius: '9999px',
          }}
          title={`${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

// ---- Revision chip -----------------------------------------------------------

/**
 * The Rev n/m chip, made clickable on the ported detail. There is no
 * per-request revision-history table in the schema (only revisionCount and
 * maxRevisions on the request row), so the popover reports the allowance
 * rather than inventing a timeline of rounds.
 */
function RevisionChip({
  revisionCount,
  maxRevisions,
}: {
  revisionCount: number
  maxRevisions: number
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const left = Math.max(0, (maxRevisions ?? 0) - revisionCount)

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Revision allowance"
        title="Revision allowance"
        onClick={() => setOpen(o => !o)}
        className="tahi-focus-ring inline-flex items-center gap-1 rounded-full"
        style={{
          padding: '0.125rem 0.5rem',
          fontSize: '0.6875rem',
          border: 'none',
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-muted)',
          cursor: 'pointer',
          transition: 'background-color 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-border-subtle)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
      >
        <RefreshCw size={10} aria-hidden="true" />
        Rev {revisionCount}/{maxRevisions}
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} align="start" width="15.5rem">
        <div style={{ padding: '0.75rem 0.875rem' }}>
          <p
            className="uppercase"
            style={{
              margin: 0,
              fontSize: '0.625rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              color: 'var(--color-text-subtle)',
            }}
          >
            Revisions
          </p>
          <p className="text-sm" style={{ margin: '0.375rem 0 0', color: 'var(--color-text)', fontWeight: 600 }}>
            {revisionCount} of {maxRevisions} used
          </p>
          <p className="text-xs" style={{ margin: '0.25rem 0 0', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {left === 0
              ? `All ${maxRevisions} included revisions are used on this request.`
              : `${left} ${left === 1 ? 'revision' : 'revisions'} left on this plan.`}
          </p>
          <p className="text-xs" style={{ margin: '0.5rem 0 0', color: 'var(--color-text-subtle)', lineHeight: 1.5 }}>
            Round-by-round history is not recorded yet. The thread below is the
            record of what was asked for.
          </p>
        </div>
      </Popover>
    </>
  )
}

// ---- Sidebar Card ------------------------------------------------------------

// Each request-detail sidebar block renders as its own standalone card
// (kept separate rather than the deal-detail "one card, many sections"
// pattern). Composed from the shared <Card> primitive with bordered header.
function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--color-border-subtle)',
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
    </Card>
  )
}

// ---- Internal switch ---------------------------------------------------------

/**
 * The id of the consequence line under the Internal switch. The switch points
 * at it with aria-describedby, so a screen reader hears which way round the
 * request currently is, not just "Internal request, switch". One detail page
 * is mounted at a time, so a fixed id is safe (as with activity-log-body).
 */
const INTERNAL_NOTE_ID = 'request-internal-note'

/**
 * The Actions card's Internal request switch. A real `role="switch"` rather
 * than a second pill button, because this is a state the studio reads at a
 * glance and the track shows it without the label having to change. The
 * consequence line lives beside it in the Actions card, not in here, so the
 * client's name can be named; `describedById` is what ties the two together.
 *
 * `busy` disables it while the PATCH is in flight: two taps in a row would
 * otherwise send two writes computed from the optimistic state, and the one
 * that lands last decides whether the client can see the request.
 */
function InternalSwitch({
  checked,
  busy = false,
  disabled = false,
  describedById,
  onToggle,
}: {
  checked: boolean
  busy?: boolean
  /** Hard lock, e.g. a super admin standing in a viewer's shoes. */
  disabled?: boolean
  describedById?: string
  onToggle: () => void | Promise<void>
}) {
  const locked = busy || disabled
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={describedById}
      disabled={locked}
      onClick={() => { if (!locked) void onToggle() }}
      className="tahi-focus-ring flex items-center min-h-11 md:min-h-8"
      style={{
        gap: '0.625rem',
        width: '100%',
        padding: '0.1875rem 0',
        border: 'none',
        background: 'transparent',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.75rem',
        fontWeight: 500,
        color: 'var(--color-text)',
        textAlign: 'left',
        cursor: locked ? 'not-allowed' : 'pointer',
        opacity: locked ? 0.6 : 1,
        transition: 'opacity 130ms ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'relative',
          flexShrink: 0,
          width: '2.125rem',
          height: '1.25rem',
          borderRadius: '0.6875rem',
          border: `1px solid ${checked ? 'transparent' : 'var(--color-border)'}`,
          background: checked ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
          transition: 'background-color 160ms ease, border-color 160ms ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: '0.125rem',
            left: checked ? '1rem' : '0.125rem',
            width: '0.875rem',
            height: '0.875rem',
            borderRadius: '50%',
            background: 'var(--color-bg)',
            boxShadow: 'var(--shadow-xs)',
            transition: 'left 160ms ease',
          }}
        />
      </span>
      <span style={{ minWidth: 0 }}>Internal request</span>
    </button>
  )
}

// ---- Detail Row --------------------------------------------------------------

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
      <dt className="text-xs font-medium flex-shrink-0" style={{ color: 'var(--color-text-subtle)', paddingTop: '0.1875rem' }}>
        {label}
      </dt>
      {/* The value cell grows into the row instead of shrink-wrapping the
          trigger's margin box, so an inline editor gets the whole width the
          rail can spare before its label starts to ellipsis. */}
      <dd
        className="text-sm text-right"
        style={{
          color: 'var(--color-text)',
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
        }}
      >
        {children}
      </dd>
    </div>
  )
}

// ---- Tasks Panel -------------------------------------------------------------

interface RequestTaskRow {
  id: string
  title: string
  status: string
  priority: string | null
}

// Lists the tasks spawned from this request (admin only). Fetches the existing
// tasks filter (?requestId=) and mirrors the sub-requests panel layout. Read
// from the tasks API only - this surface never mutates tasks.
function RequestTasksPanel({ requestId }: { requestId: string }) {
  const { data, isLoading } = useSWR<{ tasks: RequestTaskRow[] }>(
    `/api/admin/tasks?requestId=${requestId}`,
  )
  const tasks = data?.tasks ?? []

  return (
    <Card padding="none">
      <div
        style={{
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: tasks.length > 0 ? '1px solid var(--color-border-subtle)' : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
        }}
      >
        <h3
          className="flex items-center gap-2"
          style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}
        >
          <ListChecks size={14} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
          Tasks
          {tasks.length > 0 && (
            <span
              className="text-xs font-normal rounded-full"
              style={{ padding: '0.0625rem 0.4375rem', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-subtle)' }}
            >
              {tasks.length}
            </span>
          )}
        </h3>
      </div>

      {isLoading ? (
        <div style={{ padding: 'var(--space-3) var(--space-5)' }}>
          {[0, 1].map(i => (
            <div key={i} className="flex items-center gap-3 animate-pulse" style={{ padding: 'var(--space-2) 0' }}>
              <div className="rounded-full" style={{ width: '4.5rem', height: '1.25rem', background: 'var(--color-bg-tertiary)' }} />
              <div className="rounded" style={{ flex: 1, height: '0.875rem', background: 'var(--color-bg-tertiary)' }} />
            </div>
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center" style={{ padding: '2rem 1.5rem', gap: '0.375rem' }}>
          <ListChecks size={18} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
          <p className="text-sm" style={{ color: 'var(--color-text-subtle)', margin: 0 }}>No tasks yet.</p>
          <p className="text-xs" style={{ color: 'var(--color-text-subtle)', margin: 0 }}>
            Use &ldquo;AI: break into tasks&rdquo; to generate some.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {tasks.map((t, i) => (
            <li
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: i < tasks.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
              }}
            >
              <Badge tone={statusTone(t.status)} size="sm" variant="soft" dot>
                {t.status.replace(/_/g, ' ')}
              </Badge>
              <span
                data-private
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t.title}
              </span>
              {t.priority && t.priority !== 'standard' && (
                <Badge tone="neutral" size="sm">
                  {t.priority}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
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

  // Clients get checklists as read-only progress. With nothing to show, omit
  // the card entirely rather than render an empty shell with no affordances.
  if (!isAdmin && checklists.length === 0) return null

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
      style={{ border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xs)' }}
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
              color: 'var(--color-brand)',
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
              background: 'var(--color-brand)',
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
                          background: progress === 100 ? 'var(--color-success)' : 'var(--color-brand)',
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
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => toggleItem(ci, ii)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 0,
                            color: item.done ? 'var(--color-brand)' : 'var(--color-text-subtle)',
                            flexShrink: 0,
                          }}
                          aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
                        >
                          <CheckCircle2 size={16} style={{ opacity: item.done ? 1 : 0.4 }} />
                        </button>
                      ) : (
                        // Read-only for clients: progress, not a control.
                        <span
                          role="img"
                          aria-label={item.done ? 'Completed' : 'Not completed'}
                          style={{
                            display: 'inline-flex',
                            color: item.done ? 'var(--color-brand)' : 'var(--color-text-subtle)',
                            flexShrink: 0,
                          }}
                        >
                          <CheckCircle2 size={16} style={{ opacity: item.done ? 1 : 0.4 }} />
                        </span>
                      )}
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
                        color: 'var(--color-brand)',
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
  /** Ported detail's empty-state line. Falls back to the original copy. */
  emptyHint?: string
}

// Files are attachable by both studio and client: uploads authorise non-admins
// server-side, so there is no admin gate on this panel.
function FilesPanel({ files, onRefresh, requestId, orgId, emptyHint }: FilesPanelProps) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // File icons are visual differentiators, not status indicators.
  // Keep them all muted so red/amber can stay reserved for danger/warning.
  function fileIcon(mimeType: string | null) {
    if (!mimeType) return <FileText size={14} style={{ color: 'var(--color-text-subtle)' }} />
    if (mimeType.startsWith('image/')) return <ImageIcon size={14} style={{ color: 'var(--color-text-muted)' }} />
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

      // uploadUrl is already absolute (origin + basePath + path) - wrapping
      // it in apiPath() double-prepends /dashboard and produces 404s.
      const uploadRes = await fetch(presignData.uploadUrl, {
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
    <Card padding="none" style={{ overflow: 'hidden' }}>
      <div
        className="flex items-center justify-between"
        style={{ padding: '0.875rem 1.25rem', borderBottom: '1px solid var(--color-border-subtle)' }}
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
          {/* Upload is available to clients too: the presign + confirm routes
              authorise non-admins and land the file under their own D1 org. The
              submit form promises clients can attach files, so honour that here. */}
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
                  border: '1px solid var(--color-brand)',
                  color: 'var(--color-brand)',
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
          <p className="text-sm" style={{ color: 'var(--color-text-subtle)', margin: 0 }}>
            {emptyHint ?? 'No files yet.'}
          </p>
          {!emptyHint && (
            <p className="text-xs" style={{ color: 'var(--color-text-subtle)', margin: 0 }}>
              Use Upload to attach files to this request.
            </p>
          )}
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
              <FileActions
                file={f}
                onDeleted={onRefresh}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * <FileActions> - view / download / delete action group on each file row.
 *
 * View opens inline in a new tab when the MIME is renderable (image, PDF,
 * video, audio). Download forces attachment Content-Disposition. Delete
 * confirms via a Tahi dialog and hits DELETE /api/uploads/[fileId] which
 * removes from R2 + the files row.
 */
function FileActions({ file, onDeleted }: {
  file: { id: string; filename: string; storageKey: string; mimeType: string | null }
  onDeleted: () => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inlineSafe = (file.mimeType ?? '').match(/^(image|video|audio)\//) || file.mimeType === 'application/pdf'

  async function doDelete() {
    setBusy(true)
    try {
      const res = await fetch(apiPath(`/api/uploads/${file.id}`), { method: 'DELETE' })
      if (res.ok) onDeleted()
    } catch { /* silent */ }
    finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  const iconBtn: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 'var(--radius-button)',
    color: 'var(--color-text-subtle)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
  }

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {inlineSafe && (
        <a
          href={apiPath(`/api/uploads/serve?key=${encodeURIComponent(file.storageKey)}`)}
          target="_blank"
          rel="noopener noreferrer"
          style={iconBtn}
          aria-label={`Open ${file.filename}`}
          title="Open in browser"
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
        >
          <Eye size={14} />
        </a>
      )}
      <a
        href={apiPath(`/api/uploads/serve?key=${encodeURIComponent(file.storageKey)}&download=1`)}
        style={iconBtn}
        aria-label={`Download ${file.filename}`}
        title="Download"
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
      >
        <Download size={14} />
      </a>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
        style={iconBtn}
        aria-label={`Delete ${file.filename}`}
        title="Delete"
        onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#dc2626' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
      >
        <Trash2 size={14} />
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete file?"
        description={`Permanently removes "${file.filename}" from this request. The file is gone from R2 storage and any messages referencing it will lose the link. Cannot be undone.`}
        confirmLabel="Delete file"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
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

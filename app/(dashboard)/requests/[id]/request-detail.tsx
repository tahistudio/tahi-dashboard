'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { apiPath } from '@/lib/api'
import {
  Clock, AlertTriangle, RefreshCw,
  User, CheckCircle2, Loader2, Activity,
  FileText, Image as ImageIcon, Download, Paperclip,
  Calendar, Upload, Plus, Trash2, ListChecks, DownloadCloud, ChevronDown, Eye,
  Sparkles, Wand2, X, Check, Lock, Archive, MessageSquare, PauseCircle, Ban, Tag,
  Inbox,
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
import { PortalStatusBadge } from '@/components/tahi/portal/portal-status-badge'
import { portalStatusGloss } from '@/lib/portal-status'
import { PortalStudioTeamCard } from '@/components/tahi/portal/portal-studio-team-card'
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
import {
  buildRequestThreadConversationPayload,
  formatClientSeenBy,
  latestClientReadAt,
  type ThreadReadReceipt,
} from '@/lib/request-thread'
import { NOTIFICATIONS_CHANGED_EVENT } from '@/lib/notification-events'
import {
  CATEGORY_CONFIG,
  EDITABLE_STATUSES,
  REQUEST_STATUS_CONFIG,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_TONE,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONE,
} from '@/lib/status-config'
import { isBlockerOpen, parseSubjectKey, subjectKey, type BlockerCandidate, type BlockerRow } from '@/lib/blockers'
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
  InlineDateField, InlineMenuField, InlineNone, InlineNumberField, type InlineMenuOption,
} from '@/components/tahi/inline-field'
import {
  SidebarCard,
  RAIL_ACTION_CLASS,
  RAIL_ACTION_STYLE,
} from '@/components/tahi/rail/sidebar-card'
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
 * Header meta and rail card chrome, as one scoped sheet.
 *
 * The meta row's affordance is on the link's CHILDREN (the icon and the bold
 * value tint with it), and a rail card head's icon tile is a hover-free
 * descendant of a head that may or may not be interactive, so neither can be
 * expressed as an inline style on a single element. Scoped here the way
 * <CapacityStrip> keeps CAPACITY_CSS, rather than in globals.css, because
 * nothing outside this page uses them.
 *
 * Every link keeps `.tahi-focus-ring` for the keyboard ring; these rules only
 * ever set colour and background, so they never fight it.
 */
const DETAIL_CSS = `
.tahi-meta-link{
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin: -0.125rem -0.3125rem;
  padding: 0.125rem 0.3125rem;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  text-decoration: none;
  transition:
    color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tahi-meta-link b{ color: var(--color-text); font-weight: 600; }
.tahi-meta-ic{ display: inline-flex; flex-shrink: 0; color: var(--color-text-subtle); transition: color var(--motion-quick) var(--ease-out); }
.tahi-meta-link:hover,
.tahi-meta-link:focus-visible{ color: var(--color-link); background: var(--color-bg-secondary); }
.tahi-meta-link:hover b,
.tahi-meta-link:focus-visible b,
.tahi-meta-link:hover .tahi-meta-ic,
.tahi-meta-link:focus-visible .tahi-meta-ic{ color: var(--color-link); }
.tahi-chip-link{
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-full);
  color: inherit;
  text-decoration: none;
  transition: opacity var(--motion-quick) var(--ease-out);
}
.tahi-chip-link:hover{ opacity: 0.82; }
.tahi-avatar-link{
  display: inline-flex;
  border-radius: var(--radius-full);
  text-decoration: none;
  transition: transform var(--motion-quick) var(--ease-out);
}
.tahi-avatar-link:hover{ transform: translateY(-0.0625rem); }

/* The header people stack. Overlapping is a desktop affordance: every bubble
   but the first has its left edge under the neighbour above it in the
   z-stack, which is fine to read and impossible to aim a thumb at. Below md
   the seats unstack and each linked one grows to a full 2.75rem target. */
.tahi-people-stack{ display: flex; align-items: center; }
.tahi-people-seat{ display: inline-flex; position: relative; margin-left: -0.4375rem; }
.tahi-people-seat:first-child{ margin-left: 0; }
@media (max-width: 47.9375rem){
  .tahi-people-stack{ gap: 0.125rem; }
  .tahi-people-seat{ margin-left: 0; }
  a.tahi-people-seat{
    min-width: 2.75rem;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
  }
}

/* Rail: the quiet head action (add, remove) shared by every card. */
.tahi-rail-head-action{
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-subtle);
  cursor: pointer;
  transition:
    color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tahi-rail-head-action:hover,
.tahi-rail-head-action:focus-visible{ color: var(--color-text); background: var(--color-bg-secondary); }
.tahi-rail-head-action:disabled{ opacity: 0.4; cursor: not-allowed; }
.tahi-rail-head-action:disabled:hover{ color: var(--color-text-subtle); background: none; }
.tahi-rail-x{
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-subtle);
  cursor: pointer;
  transition:
    color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tahi-rail-x:hover,
.tahi-rail-x:focus-visible{ color: var(--color-danger); background: var(--color-danger-bg); }

/* Rail: the one inline text input. Quiet at rest, because the add-a-step row
   is always on screen and a permanent brand outline reads as an error. On
   focus it takes the same brand halo as the Details editors, so the page has
   a single "you are editing" signal. */
.tahi-rail-input{
  min-width: 0;
  height: 2.75rem;
  padding: 0 0.5625rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text);
  outline: none;
  transition:
    border-color var(--motion-quick) var(--ease-out),
    box-shadow var(--motion-quick) var(--ease-out);
}
@media (min-width: 48rem){ .tahi-rail-input{ height: 2rem; } }
.tahi-rail-input::placeholder{ color: var(--color-text-subtle); }
.tahi-rail-input:focus{
  border-color: var(--color-brand);
  box-shadow: 0 0 0 0.1875rem color-mix(in srgb, var(--color-brand) 14%, transparent);
}

/* Rail: one empty state, so no two cards word their nothing differently. */
.tahi-rail-empty{
  margin: 0;
  padding: 1.125rem 0.75rem;
  text-align: center;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.55;
  color: var(--color-text-subtle);
}

/* Checklist rows, ported from .req-check / .req-check-box / .req-check-label. */
.tahi-check{
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 0;
  padding: 0.4375rem 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
/* The read-only drawing: same row, no pointer, no hover promise. */
.tahi-check.is-static{ cursor: default; }
.tahi-check-box{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: var(--radius-sm);
  border: 0.09375rem solid var(--color-border);
  background: var(--color-bg);
  color: transparent;
  transition:
    background-color var(--motion-quick) var(--ease-out),
    border-color var(--motion-quick) var(--ease-out),
    color var(--motion-quick) var(--ease-out);
}
.tahi-check.is-done .tahi-check-box{
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--color-text-on-dark);
}
.tahi-check:not(.is-static):hover .tahi-check-box,
.tahi-check:focus-visible .tahi-check-box{ border-color: var(--color-brand); }
.tahi-check-label{
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--color-text);
  transition: color var(--motion-quick) var(--ease-out);
}
.tahi-check.is-done .tahi-check-label{
  color: var(--color-text-subtle);
  text-decoration: line-through;
}
@media (prefers-reduced-motion: reduce){
  .tahi-meta-link,
  .tahi-meta-ic,
  .tahi-chip-link,
  .tahi-avatar-link,
  .tahi-rail-head-action,
  .tahi-rail-x,
  .tahi-check-box,
  .tahi-check-label{ transition: none; }
  .tahi-avatar-link:hover{ transform: none; }
}
`

/** Where a hero link sends you, so every one of them is built the same way. */
const REQUESTS_LIST = '/requests'
function requestsListHref(params: Record<string, string>): string {
  return `${REQUESTS_LIST}?${new URLSearchParams(params).toString()}`
}

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
  /** Files stamped with this message id. Both threads return them per message
   *  now, so the client sees the attachment under the sentence that explains
   *  it, not only in the Files panel. */
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
  // The rebuilt detail is on for every audience since 2026-09-03; the
  // legacy branches below are dead and queued for deletion.
  const newUi = true
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
      // The portal serves the request AND its thread from one endpoint, so the
      // client audience makes one call rather than the same call twice.
      const [reqRes, msgRes] = await Promise.all([
        fetch(`${apiBase}/requests/${requestId}`),
        isAdmin
          ? fetch(apiPath(`/api/admin/requests/${requestId}/messages`))
          : null,
      ])
      let req: Request | null = null
      let subs: SubRequestRow[] = []
      let parent: ParentRequestRef | null = null
      let unread = 0
      let people: Participant[] = []
      let msgs: Message[] = []
      let convId: string | null = null
      if (reqRes.ok) {
        const data = await reqRes.json() as {
          request: Request
          subRequests?: SubRequestRow[]
          parent?: ParentRequestRef | null
          unreadCount?: number
          participants?: Participant[]
          messages?: Message[]
        }
        req = data.request
        subs = data.subRequests ?? []
        parent = data.parent ?? null
        unread = data.unreadCount ?? 0
        people = data.participants ?? []
        if (!isAdmin) msgs = data.messages ?? []
      }
      if (msgRes?.ok) {
        const data = await msgRes.json() as { items: Message[]; conversationId?: string | null }
        msgs = data.items ?? []
        convId = data.conversationId ?? null
      }
      return {
        request: req,
        subRequests: subs,
        parent,
        unreadCount: unread,
        participants: people,
        messages: msgs,
        conversationId: convId,
      }
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

  /**
   * How many writes this page has open.
   *
   * Every edit here paints local state first and confirms with the server
   * after, and the request fetcher fans out to four endpoints, so a revalidate
   * that was already in flight when a write landed answers with the PRE-write
   * row. The mirror effect below would then paint that stale answer over the
   * fresh one: the People card reverted to the old assignee, and an unrelated
   * field patch could wipe an optimistic checklist. Holding the mirror while
   * the page is still writing closes that window, and the write that takes the
   * count back to zero asks for one fresh read, so nothing is lost.
   */
  const pendingWrites = useRef(0)
  const beginWrite = useCallback(() => {
    pendingWrites.current += 1
  }, [])
  const endWrite = useCallback((revalidate: boolean) => {
    pendingWrites.current = Math.max(0, pendingWrites.current - 1)
    if (pendingWrites.current === 0 && revalidate) {
      void mutateRequest()
      void mutateRequestLists()
    }
  }, [mutateRequest, mutateRequestLists])

  // A dynamic route keeps this component mounted when the id changes, so the
  // thread's conversation has to be forgotten explicitly. Declared BEFORE the
  // mirror below so the hydrate that follows starts from null rather than
  // carrying the previous request's conversation onto this one.
  useEffect(() => {
    setConversationId(null)
  }, [requestId])

  // Mirror fetched data into local state. Local state is the source of truth for
  // optimistic edits (patchRequest, checklists, participants, unlink), so each
  // refresh (mutateRequest) re-syncs everything exactly as loadRequest used to.
  useEffect(() => {
    if (!requestData) return
    // A read that raced a write is stale by the time it arrives. endWrite()
    // fires a fresh one the moment the last write settles.
    if (pendingWrites.current > 0) return
    setRequest(requestData.request)
    setSubRequests(requestData.subRequests)
    setParentRequest(requestData.parent)
    setUnreadCount(requestData.unreadCount)
    setParticipants(requestData.participants)
    setMessages(requestData.messages)
    // Hydrate the thread's conversation from the server. This state used to
    // start at null and stay there, so the first message after EVERY page load
    // minted another request_thread row. Never downgrade an id this page just
    // created to the null a racing read would carry.
    setConversationId(prev => requestData.conversationId ?? prev)
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

  // Open blockers, for the spine's amber chip. Same key the Blocked by card
  // reads, so SWR serves both from one request and the chip and the card can
  // never disagree. Null for a client, and there is no portal route to call
  // anyway (Decision 13).
  const { data: blockersData } = useSWR<RequestBlockersPayload>(
    isAdmin ? requestBlockersKey(requestId) : null,
  )
  const openBlockerCount = countOpenBlockers(blockersData?.blockedBy)

  // Team members (admin only) for the assignee picker.
  const { data: teamMembersData } = useSWR<{ items: TeamMemberOption[] }>(
    isAdmin ? '/api/admin/team-members' : null,
  )
  const teamMembers = teamMembersData?.items ?? []

  // Read receipts (admin only). The studio's question is "did the client
  // actually open this", so the sentence only ever names contacts; the
  // helper drops the studio's own receipts before it says anything.
  //
  // Polled, because the global SWR config turns revalidateOnFocus off and this
  // is the one number on the page that changes while nobody touches it: the
  // client opening the request is exactly the event the studio is waiting for.
  const { data: readsData } = useSWR<{ items: ThreadReadReceipt[] }>(
    isAdmin ? `/api/admin/requests/${requestId}/reads` : null,
    { refreshInterval: 60_000 },
  )
  const clientReadAt = useMemo(
    () => latestClientReadAt(readsData?.items ?? []),
    [readsData],
  )
  // The sentence is relative ("about 2 hours ago"), so it needs its own clock:
  // SWR hands back the SAME data reference when a refetch changes nothing, so
  // polling alone would leave the phrasing frozen on a tab left open. One tick
  // a minute, and only while there is a receipt to age.
  const [receiptNow, setReceiptNow] = useState(() => Date.now())
  useEffect(() => {
    if (!clientReadAt) return
    const t = setInterval(() => setReceiptNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [clientReadAt])
  const seenBy = useMemo(
    () => formatClientSeenBy(readsData?.items ?? [], new Date(receiptNow)),
    [readsData, receiptNow],
  )

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
  // Both audiences write a receipt now (the portal route stamps userType
  // 'contact'), so the studio can see that the client opened the thread. A
  // super admin looking through the client lens writes nothing: the receipt
  // would be a lie in the client's name.
  const hasRequest = !!request
  useEffect(() => {
    if (loading || !hasRequest || isImpersonatingClient) return
    const url = isAdmin
      ? apiPath(`/api/admin/requests/${requestId}/reads`)
      : apiPath(`/api/portal/requests/${requestId}/reads`)
    const t = setTimeout(() => {
      fetch(url, { method: 'POST' })
        .then(() => setUnreadCount(0))
        .catch(() => { /* non-fatal */ })
    }, 2000)
    return () => clearTimeout(t)
  }, [isAdmin, loading, hasRequest, isImpersonatingClient, requestId])

  // Opening the request clears its bell rows for whoever is looking. Clicking
  // the row inside the popover used to be the ONLY way a notification about a
  // request went away, so arriving from the list, a link or a deep link left
  // the badge counting work already dealt with. Once per request per visit,
  // and never through the client lens: looking at somebody else's portal is
  // not the same as reading your own notification.
  const bellClearedFor = useRef<string | null>(null)
  useEffect(() => {
    if (loading || !hasRequest || isImpersonatingClient) return
    if (bellClearedFor.current === requestId) return
    // Claim the id before the call so a re-render mid-flight cannot fire a
    // second PATCH, and release it again on anything but a success: a dropped
    // connection on a mobile portal session used to leave the badge counting a
    // request the reader had already dealt with, for the rest of the mount.
    bellClearedFor.current = requestId
    const release = () => {
      if (bellClearedFor.current === requestId) bellClearedFor.current = null
    }
    fetch(apiPath('/api/notifications'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'request', entityId: requestId }),
    })
      .then(res => {
        // The bell owns its own state and only refetches on open, so tell it.
        if (res.ok) window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))
        else release()
      })
      .catch(release)
  }, [loading, hasRequest, isImpersonatingClient, requestId])

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

    // Create a request_thread conversation on first message if none exists.
    // conversationId is hydrated from the thread payload above, so this runs
    // once per request rather than once per page load, and the row it writes
    // is external whether or not this first message is an internal note (what
    // hides a note from a client is the message's own isInternal flag).
    let convId = conversationId
    if (!convId && isAdmin && request) {
      try {
        const convRes = await fetch(apiPath('/api/admin/conversations'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildRequestThreadConversationPayload({
            requestId,
            orgId: request.orgId,
            title: request.title,
          })),
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

  /**
   * Optimistic patch helper: updates local state immediately, PATCHes the
   * server in the background, rolls back and toasts on failure. Every
   * field-level mutation below goes through this so the UI never blinks.
   *
   * Resolves TRUE only when the server took the write, so a caller that
   * mirrors the change somewhere else (the assignee / participants pair) can
   * tell a 403 or a dropped connection from a save and stay out of the
   * divergence it exists to prevent.
   *
   * Pass `revalidate: false` when the caller has more writes to make; it owns
   * the beginWrite/endWrite pair around the whole sequence and the refresh
   * fires once at the end.
   */
  const patchRequest = useCallback(async (
    patch: Partial<Request>,
    successMsg?: string,
    options?: { revalidate?: boolean },
  ): Promise<boolean> => {
    if (!request) return false
    // One gate for every field write on this page. A viewer's lens is not a
    // suggestion: the request is theirs to read, not to move.
    if (!canWrite) {
      showToast('Read-only while you are viewing as this team member')
      return false
    }
    const previous = request
    // Apply optimistically
    setRequest({ ...previous, ...patch })
    let ok = false
    beginWrite()
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
      } else {
        ok = true
        if (successMsg) showToast(successMsg)
      }
    } catch {
      setRequest(previous)
      showToast('Network error - try again')
    } finally {
      // The optimistic paint above covers what the user typed; the revalidate
      // fills in what only the server knows. A status move to delivered stamps
      // deliveredAt and bumps updatedAt, and without this the Details card's
      // Delivered row and the activity feed's "Request was delivered" event
      // never appear until a hard reload. The list cache is refreshed too, so
      // the board and the rail agree with the page that just wrote.
      endWrite(ok && options?.revalidate !== false)
    }
    return ok
  }, [request, requestId, showToast, canWrite, beginWrite, endWrite])

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
    // Counted like every other write: the mirror effect reads checklists back
    // out of requests.checklists, so a revalidate landing mid-save used to be
    // able to paint the pre-tick list over the box the user just ticked.
    beginWrite()
    let saved = false
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklists: JSON.stringify(updated) }),
      })
      if (!res.ok) {
        setChecklists(previous)
        showToast('Checklist update failed')
      } else {
        saved = true
      }
    } catch {
      setChecklists(previous)
      showToast('Network error - try again')
    } finally {
      endWrite(saved)
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
    // Both writes sit inside one begin/end pair, so the participant DELETE and
    // POST land before the page asks the server for a fresh read. Without it
    // the read could answer with the pre-write participants and the People
    // card would snap back to the person who no longer holds this.
    beginWrite()
    let saved = false
    try {
      // A rejected PATCH (a 403 from access scoping, a 500, an offline tab)
      // leaves requests.assigneeId exactly as it was. Mirroring it into
      // request_participants anyway would create the divergence this pair
      // exists to remove, so the mirror only follows a save the server took.
      saved = await patchRequest(
        { assigneeId, assigneeName: name },
        assigneeId ? `Assigned to ${name ?? 'team member'}` : 'Unassigned',
        { revalidate: false },
      )
      if (saved && canWrite && assigneeId !== previousAssigneeId) {
        await syncAssigneeParticipant(previousAssigneeId, assigneeId, name)
      }
    } finally {
      endWrite(saved)
    }
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
    <SidebarCard title="Details" icon={<Tag size={14} />} bodyPadding="0.25rem 0.875rem">
      <dl style={{ margin: 0 }}>
        <DetailRow label="Type">
          <span className="capitalize">{request.type.replace(/_/g, ' ')}</span>
        </DetailRow>

        <DetailRow label="Category" divided>
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

        <DetailRow label="Priority" divided>
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
          <DetailRow label="Assignee" divided>
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
          <DetailRow label="Delivery phase" divided>
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

        <DetailRow label="Due date" divided>
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
          <DetailRow label="Estimated" divided>
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
          <DetailRow label="Delivered" divided>
            {formatDate(request.deliveredAt)}
          </DetailRow>
        )}
      </dl>
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
      <style>{DETAIL_CSS}</style>
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
            {/* Every header chip is a way into the list filtered by what it
                says. Both audiences get these two: status and priority are
                filter dimensions on the portal list as well as the studio
                one, so neither link is a door a client cannot open. */}
            <Link
              href={requestsListHref({ status: request.status })}
              title={`See all ${statusLabel(request.status).toLowerCase()} requests`}
              className="tahi-chip-link tahi-focus-ring min-h-11 md:min-h-0"
            >
              {isAdmin ? (
                <StatusBadge status={request.status} />
              ) : (
                // titled={false}: the Link above already carries a title saying
                // where it goes, and the inner one would win on hover and hide
                // it. The badge keeps its aria-label, and the gloss is rendered
                // as visible text beside it, which is where it actually reaches
                // a client on a phone.
                <PortalStatusBadge status={request.status} titled={false} />
              )}
            </Link>
            {/* The plain-English half of the client vocabulary, said out loud.
                It lived only in a title attribute, which is hover-only for a
                pointer and simply absent on touch, so most clients never saw
                the half that does the explaining. */}
            {!isAdmin && portalStatusGloss(request.status) && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                {portalStatusGloss(request.status)}
              </span>
            )}
            {request.priority === 'high' && (
              <Link
                href={requestsListHref({ priority: 'high' })}
                title="See all high priority requests"
                className="tahi-chip-link tahi-focus-ring min-h-11 md:min-h-0"
              >
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
              </Link>
            )}
            {/* Category is not a chip on this row, but it is a dimension, so
                it earns the same door when the request carries one. */}
            {request.category && (
              <Link
                href={requestsListHref({ category: request.category })}
                title={`See all ${categoryLabel(request.category).toLowerCase()} requests`}
                className="tahi-chip-link tahi-focus-ring min-h-11 md:min-h-0"
              >
                <CategoryChip value={request.category} />
              </Link>
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
            {/* Same honesty rule as the People card below: the portal detail
                route returns no participants, so for a client this printed an
                "Unassigned" pill on every request, including the ones whose
                avatars they had just seen on the list. Silence beats a wrong
                claim. */}
            {(isAdmin || participants.length > 0) && (
              <PeopleStack participants={participants} linkPeople={isAdmin} />
            )}
          </div>

          {/* Client + created */}
          <div
            className="flex items-center flex-wrap"
            style={{ gap: '0.875rem', marginTop: '0.625rem', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}
          >
            {/* The client. A studio audience gets the door to their record;
                a client is already inside their own account and has no
                /clients route to follow, so for them the name stays text. */}
            {request.orgName && (
              isAdmin ? (
                <Link
                  href={`/clients/${request.orgId}`}
                  data-private
                  title={`Open ${request.orgName}`}
                  className="tahi-meta-link tahi-focus-ring min-h-11 md:min-h-0"
                >
                  <OrgAvatar name={request.orgName} />
                  <b>{request.orgName}</b>
                </Link>
              ) : (
                <span data-private className="flex items-center" style={{ gap: '0.375rem' }}>
                  <OrgAvatar name={request.orgName} />
                  {request.orgName}
                </span>
              )
            )}
            <Link
              href={requestsListHref({ sort: 'created', dir: 'desc' })}
              title="See every request, newest first"
              className="tahi-meta-link tahi-focus-ring min-h-11 md:min-h-0"
            >
              <Calendar size={12} className="tahi-meta-ic" aria-hidden="true" />
              Created <b>{formatDate(request.createdAt)}</b>
            </Link>
            {request.dueDate && (
              <Link
                href={requestsListHref({ view: 'timeline' })}
                title="See this on the requests timeline"
                className="tahi-meta-link tahi-focus-ring min-h-11 md:min-h-0"
              >
                <Clock size={12} className="tahi-meta-ic" aria-hidden="true" />
                Due <b>{formatDate(request.dueDate)}</b>
              </Link>
            )}
            {/* Who is carrying this. The rail and the header stack both know,
                but neither says it in words, so the sub-meta does. There is no
                per-teammate page in this app, so the door is the list narrowed
                to their work. */}
            {newUi && isAdmin && request.assigneeName && (
              request.assigneeId ? (
                <Link
                  href={requestsListHref({ assignee: request.assigneeId })}
                  data-private
                  title={`See everything ${request.assigneeName} is on`}
                  className="tahi-meta-link tahi-focus-ring min-h-11 md:min-h-0"
                >
                  <User size={12} className="tahi-meta-ic" aria-hidden="true" />
                  Led by <b>{request.assigneeName}</b>
                </Link>
              ) : (
                <span data-private className="flex items-center" style={{ gap: '0.375rem' }}>
                  <User size={12} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
                  Led by{' '}
                  <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>
                    {request.assigneeName}
                  </strong>
                </span>
              )
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
            blockedByCount={openBlockerCount}
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
              style={{ margin: 0, padding: '0.875rem 1.25rem', flexWrap: 'wrap' }}
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

              {/* Did the client actually open this? The receipt is written by
                  the portal detail page, so an empty line here means nobody at
                  the client has opened the request since read state shipped.
                  The sentence is relative; the title carries the exact time so
                  it stays recoverable however long the tab has been open. */}
              {isAdmin && seenBy && (
                <span
                  className="inline-flex items-center gap-1 text-xs"
                  style={{ color: 'var(--color-text-subtle)' }}
                  title={clientReadAt ? formatDateTime(clientReadAt) : undefined}
                >
                  <Eye size={12} aria-hidden="true" />
                  <span data-private>{seenBy}</span>
                </span>
              )}
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
            /* Not canWrite: a client legitimately attaches files to their own
               request, and canWrite is studio-only. What has to hold is the
               viewer's lens, because the upload and the delete behind it land
               as the real super admin and genuinely mutate the row. */
            canMutate={!isViewerImpersonation}
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
          {isAdmin && <TimeCard target={{ kind: 'request', id: requestId }} />}

          {/* Blocked by (admin only, Decision 13). A blocker is a reason the
              work is not moving, so it sits beside the time and the status
              rather than below the checklists. */}
          {isAdmin && <RequestBlockersCard requestId={requestId} canWrite={canWrite} />}

          {/* Calls: kickoff, scope review, mid-build check-ins. The ported
              rail puts Actions directly under Time, so a phone-width column
              leads with the two blocks the studio touches most. */}
          {isAdmin && !newUi && <DiscoveryCallsCard parentType="request" parentId={requestId} />}

          {/* Actions: status dropdown, scope flag toggle, make top-level */}
          {isAdmin && (
            <SidebarCard title="Actions" icon={<Sparkles size={14} />}>
              <div className="flex flex-col" style={{ gap: '0.6875rem' }}>
                {/* Status: editable chip matching the requests list status chip.
                    Same key column as a Details row, so the two cards line up
                    down the rail rather than each inventing a gutter. */}
                <div className="flex items-center" style={{ gap: '0.625rem' }}>
                  <span
                    className="flex-shrink-0"
                    style={{
                      width: '4.875rem',
                      fontSize: '0.78125rem',
                      fontWeight: 500,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    Status
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* The shared chip, driven off the same EDITABLE_STATUSES
                        the list column uses. The old local copy carried its
                        own six-status list, so a request the board had put on
                        hold printed the raw slug here and could not be moved
                        back or cancelled from the page that manages it.
                        Archived is the one status left out: it is destructive,
                        so it belongs behind the bulk bar's Danger confirm
                        rather than one unguarded click away here. */}
                    <StatusChipSelect
                      value={request.status}
                      options={EDITABLE_STATUSES}
                      busy={statusUpdating}
                      disabled={!canWrite}
                      onChange={handleStatusChange}
                      // The prototype's `.req-timer-btn` shape, which every
                      // other command in this card already wears. The list
                      // column keeps the 2.75rem default.
                      density="compact"
                    />
                  </div>
                </div>

                {/* Scope flag toggle */}
                <button
                  type="button"
                  onClick={handleScopeFlagToggle}
                  disabled={!canWrite}
                  className={RAIL_ACTION_CLASS}
                  style={{
                    ...RAIL_ACTION_STYLE,
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
                  <AlertTriangle size={13} aria-hidden="true" />
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
                      style={{
                        margin: 0,
                        fontSize: '0.71875rem',
                        fontWeight: 500,
                        lineHeight: 1.45,
                        color: 'var(--color-text-subtle)',
                      }}
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
                    className={RAIL_ACTION_CLASS}
                    style={{
                      ...RAIL_ACTION_STYLE,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-text-muted)',
                      cursor: unlinkingParent || !canWrite ? 'not-allowed' : 'pointer',
                      opacity: unlinkingParent || !canWrite ? 0.6 : 1,
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
                      ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                      : <RefreshCw size={13} aria-hidden="true" />}
                    Make top-level
                  </button>
                )}

                {/* AI assist - human-in-the-loop. "Break into tasks" opens the
                    existing task wizard seeded from this request; "Suggest
                    triage" fetches routing suggestions into the banner above.
                    Neither changes anything without an explicit follow-up. */}
                <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: '0.25rem 0' }} aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  disabled={!canWrite}
                  className={RAIL_ACTION_CLASS}
                  style={{
                    ...RAIL_ACTION_STYLE,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-brand)',
                    cursor: canWrite ? 'pointer' : 'not-allowed',
                    opacity: canWrite ? 1 : 0.6,
                  }}
                  onMouseEnter={e => { if (canWrite) e.currentTarget.style.background = 'var(--color-brand-50)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
                >
                  <Wand2 size={13} aria-hidden="true" />
                  AI: break into tasks
                </button>
                <button
                  type="button"
                  onClick={runTriage}
                  disabled={triageLoading || !canWrite}
                  className={RAIL_ACTION_CLASS}
                  style={{
                    ...RAIL_ACTION_STYLE,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-brand)',
                    cursor: triageLoading || !canWrite ? 'not-allowed' : 'pointer',
                    opacity: triageLoading || !canWrite ? 0.6 : 1,
                  }}
                  onMouseEnter={e => { if (!triageLoading && canWrite) e.currentTarget.style.background = 'var(--color-brand-50)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
                >
                  {triageLoading
                    ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                    : <Sparkles size={13} aria-hidden="true" />}
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

          {isAdmin && newUi && (
            <DiscoveryCallsCard
              title="Discovery calls"
              variant="rail"
              parentType="request"
              parentId={requestId}
            />
          )}

          {/* Details, then People, then Checklists on the ported rail;
              the legacy rail keeps Details last. */}
          {newUi && detailsCard}

          {/* People - PM / Assignees / Followers.
              GET /api/portal/requests/[id] returns { request, messages } and no
              participants, so for a client this panel had nothing to render and
              printed "No PM assigned", "No assignees yet" and "No followers
              yet" on a request that demonstrably has a PM, one click after the
              list showed them those very avatars. That is a lie, not an empty
              state, so a client only sees the card when the API actually
              answered with people. Until the route carries participants they
              get the studio team on their account instead, from a read that
              exists (/api/portal/team). */}
          {isAdmin || participants.length > 0 ? (
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
          ) : (
            <PortalStudioTeamCard />
          )}

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
          // The panel below reads its own key, so without this the drafts the
          // wizard has just written sit in D1 while the card still says
          // "No tasks yet" until a manual refresh.
          mutateKeys={[requestTasksKey(requestId)]}
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

// ---- Header avatars ----------------------------------------------------------

/** Initials from a person or company name, capped at two letters. */
function initialsOf(name: string): string {
  return name
    .split(' ')
    .map(s => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * The client's bubble in the header sub-meta. Organisations carry no logo on
 * the detail payload, so this is initials rather than an image with a
 * fallback: there is nothing to fall back FROM.
 */
function OrgAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{
        width: '1.125rem',
        height: '1.125rem',
        borderRadius: 'var(--radius-full)',
        background: 'var(--color-brand-100)',
        color: 'var(--color-brand-dark)',
        fontSize: '0.5rem',
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {initialsOf(name)}
    </span>
  )
}

// ---- People Stack (header) ---------------------------------------------------

/**
 * Compact overlapping avatar stack shown in the request detail header.
 * PM first, then assignees, then followers if we still have room. Extra
 * people collapse into a "+N" chip. Purely visual - the full list of
 * people is managed in the sidebar People panel.
 */
function PeopleStack({
  participants,
  linkPeople = false,
}: {
  participants: Participant[]
  /**
   * Turn each teammate's bubble into a door to their work. The list's
   * `?assignee=` narrowing matches everyone ON a request, pm and follower
   * included, so a PM bubble lands on a list that still contains the request
   * it was clicked from. Studio audiences only: the dimension is a studio
   * one, and there is no per-teammate page in this app to send anyone else
   * to. Contacts are never linked, in either audience, because nothing
   * narrows the list by contact.
   */
  linkPeople?: boolean
}) {
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
        className="tahi-people-stack"
        style={{ paddingRight: overflow > 0 ? '0.25rem' : 0 }}
      >
        {visible.map(({ p, accent }, i) => {
          const roleLabel = p.role === 'pm' ? 'PM' : p.role === 'assignee' ? 'Assignee' : 'Follower'
          const name = p.name ?? 'Unknown'
          const bubble = (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '1.75rem',
                height: '1.75rem',
                borderRadius: 'var(--radius-full)',
                background: accent === 'pm' ? 'var(--color-brand-100)' : 'var(--color-bg-tertiary)',
                color: accent === 'pm' ? 'var(--color-brand-dark)' : 'var(--color-text)',
                fontSize: '0.625rem',
                fontWeight: 600,
                border: '2px solid var(--color-bg)',
                boxShadow: accent === 'pm' ? '0 0 0 1px var(--color-brand)' : undefined,
              }}
            >
              {initialsOf(name) || '?'}
            </span>
          )
          // Only the z-order is inline. The overlap itself lives in
          // .tahi-people-seat, so it can come off below md where the bubbles
          // become touch targets.
          const stackStyle: React.CSSProperties = { zIndex: visible.length - i }
          if (linkPeople && p.participantType === 'team_member') {
            return (
              <Link
                key={p.id}
                data-private
                href={requestsListHref({ assignee: p.participantId })}
                title={`${name} - ${roleLabel}. See everything they are on.`}
                className="tahi-people-seat tahi-avatar-link tahi-focus-ring"
                style={stackStyle}
              >
                {bubble}
              </Link>
            )
          }
          return (
            <span
              key={p.id}
              data-private
              title={`${name} - ${roleLabel}`}
              className="tahi-people-seat"
              style={stackStyle}
            >
              {bubble}
            </span>
          )
        })}
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
        fontSize: '0.78125rem',
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

/**
 * One Details row, at the prototype's rhythm (`.req-detail-row`): a fixed
 * 4.875rem key column, the value hard right at 12.5px/600, and a hairline
 * between rows. `divided` rather than a `+` selector, so the separator is a
 * property of the list the caller builds and this stays inline-styled.
 */
function DetailRow({
  label,
  divided = false,
  children,
}: {
  label: string
  /** Draw the hairline above this row. False on the first row of a card. */
  divided?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.4375rem 0',
        borderTop: divided ? '1px solid var(--color-border-subtle)' : undefined,
      }}
    >
      <dt
        className="flex-shrink-0"
        style={{
          width: '4.875rem',
          fontSize: '0.78125rem',
          fontWeight: 500,
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </dt>
      {/* The value cell grows into the row instead of shrink-wrapping the
          trigger's margin box, so an inline editor gets the whole width the
          rail can spare before its label starts to ellipsis. */}
      <dd
        className="text-right"
        style={{
          margin: 0,
          fontSize: '0.78125rem',
          fontWeight: 600,
          color: 'var(--color-text)',
          flex: '1 1 auto',
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '0.4375rem',
        }}
      >
        {children}
      </dd>
    </div>
  )
}

// ---- Blocked by --------------------------------------------------------------

/** One expression for the key, so the card's fetch and the spine's count are
 *  the same request rather than two that can disagree. */
function requestBlockersKey(requestId: string): string {
  return `/api/admin/requests/${requestId}/blockers`
}

interface RequestBlockersPayload {
  blockedBy?: BlockerRow[]
  blocks?: BlockerRow[]
}

/**
 * Open ones only, which is what the list route counts and therefore what the
 * glyph, the board warning and the Blocked saved view all read. The rows
 * themselves still show a satisfied blocker so it can be unlinked; counting it
 * would make this card disagree with the row it sits next to.
 */
function countOpenBlockers(rows: readonly BlockerRow[] | undefined): number {
  return (rows ?? []).filter(r => isBlockerOpen(r.otherType, r.otherStatus)).length
}

/**
 * The Blocked by card.
 *
 * Admin only, and gated twice on purpose (Decision 13): this render is behind
 * `isAdmin`, AND the portal detail route returns no blocker data and there is
 * no portal blockers route at all. A count on its own still leaks ("your
 * request is stuck on three internal things"), so neither gate is decoration.
 *
 * Its own SWR key rather than a field on the detail payload: the card
 * revalidates on its own writes and that payload is already large.
 */
function RequestBlockersCard({ requestId, canWrite }: { requestId: string; canWrite: boolean }) {
  const { showToast } = useToast()
  const { data, isLoading, mutate } = useSWR<RequestBlockersPayload>(requestBlockersKey(requestId))
  const blockers = useMemo(() => data?.blockedBy ?? [], [data])
  const openCount = countOpenBlockers(blockers)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<readonly BlockerCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const searchSeq = useRef(0)

  // Debounced, and sequenced so a slow early response cannot land on top of a
  // fast later one and repopulate the list with results for text nobody is
  // looking at any more.
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      searchSeq.current += 1
      setResults([])
      setSearching(false)
      return
    }

    const seq = ++searchSeq.current
    setSearching(true)
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed, excludeType: 'request', excludeId: requestId })
      void fetch(apiPath(`/api/admin/blockers/search?${params.toString()}`))
        .then(res => (res.ok ? res.json() as Promise<{ candidates?: BlockerCandidate[] }> : { candidates: [] }))
        .then(json => { if (seq === searchSeq.current) setResults(json.candidates ?? []) })
        .catch(() => { if (seq === searchSeq.current) setResults([]) })
        .finally(() => { if (seq === searchSeq.current) setSearching(false) })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [query, requestId])

  const linkedKeys = useMemo(
    () => new Set(blockers.map(b => subjectKey(b.otherType, b.otherId))),
    [blockers],
  )

  const options: InlineMenuOption[] = results
    .filter(c => !(c.type === 'request' && c.id === requestId) && !linkedKeys.has(subjectKey(c.type, c.id)))
    .map(c => ({
      value: subjectKey(c.type, c.id),
      keywords: [c.label, c.ref, c.orgName].filter(Boolean).join(' '),
      node: (
        <span className="inline-flex items-center" style={{ gap: '0.375rem', minWidth: 0 }}>
          {c.type === 'request'
            ? <Inbox size={11} aria-hidden style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }} />
            : <ListChecks size={11} aria-hidden style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }} />}
          {c.ref && (
            <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-subtle)' }}>
              {c.ref}
            </span>
          )}
          <span className="truncate" style={{ minWidth: 0 }}>{c.label}</span>
          {c.orgName && (
            <span className="truncate" style={{ minWidth: 0, color: 'var(--color-text-subtle)' }}>{c.orgName}</span>
          )}
        </span>
      ),
    }))

  const emptyMessage = query.trim() === ''
    ? 'Type to search tasks and requests'
    : searching
      ? 'Searching...'
      : 'Nothing open matches that'

  async function addBlocker(optionValue: string) {
    const parsed = parseSubjectKey(optionValue)
    if (!parsed) return
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/blockers`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockerType: parsed.type, blockerId: parsed.id }),
      })
      if (!res.ok) {
        // The route returns the exact sentence a human should read.
        const body = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error ?? 'Could not add that blocker')
      }
      await mutate()
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : 'Could not add that blocker', 'error')
    }
  }

  async function removeBlocker(linkId: string, title: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/blockers/${linkId}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('failed')
      await mutate()
    } catch {
      showToast(`Could not stop waiting on ${title}`, 'error')
    }
  }

  // Nothing to show and nothing to do: an empty read-only card is noise on a
  // rail that already runs past the fold.
  if (!canWrite && blockers.length === 0) return null

  return (
    <SidebarCard
      title="Blocked by"
      icon={<AlertTriangle size={14} />}
      count={openCount > 0 ? openCount : undefined}
    >
      {isLoading && blockers.length === 0 ? (
        <div className="flex flex-col animate-pulse" style={{ gap: '0.375rem' }}>
          {[0, 1].map(i => (
            <div
              key={i}
              className="rounded"
              style={{ height: '1rem', background: 'var(--color-bg-tertiary)' }}
            />
          ))}
        </div>
      ) : blockers.length === 0 ? (
        <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
          Nothing is holding this up.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          {blockers.map(b => (
            <div
              key={b.linkId}
              className="flex items-center"
              style={{ gap: '0.5rem', padding: '0.25rem 0', fontSize: '0.78125rem' }}
            >
              <Badge
                tone={b.otherType === 'request'
                  ? (REQUEST_STATUS_TONE[b.otherStatus] ?? 'neutral')
                  : (TASK_STATUS_TONE[b.otherStatus] ?? 'neutral')}
                variant="soft"
                size="sm"
                leader="dot"
              >
                {b.otherType === 'request'
                  ? (REQUEST_STATUS_LABELS[b.otherStatus] ?? b.otherStatus.replace(/_/g, ' '))
                  : (TASK_STATUS_LABELS[b.otherStatus] ?? b.otherStatus.replace(/_/g, ' '))}
              </Badge>
              {b.otherType === 'request'
                ? <Inbox size={11} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }} />
                : <ListChecks size={11} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-text-subtle)' }} />}
              {b.otherRef && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: '0.71875rem',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: 'var(--color-text-subtle)',
                  }}
                >
                  {b.otherRef}
                </span>
              )}
              {/* Satisfied blockers read quieter, because the header count is
                  open blockers only and a row list that outnumbers it has to
                  explain itself. */}
              <span
                className="truncate"
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: 600,
                  color: isBlockerOpen(b.otherType, b.otherStatus)
                    ? 'var(--color-text)'
                    : 'var(--color-text-subtle)',
                }}
                title={b.otherOrgName ? `${b.otherTitle} (${b.otherOrgName})` : b.otherTitle}
              >
                {b.otherTitle}
              </span>
              {/* A task blocker opens the tasks slide-over through the same
                  deep link the notifications use; a request blocker opens the
                  request. */}
              <Link
                href={b.otherType === 'request' ? `/requests/${b.otherId}` : `/tasks?task=${b.otherId}`}
                className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 min-h-11 md:min-h-6"
                style={{
                  padding: '0 0.4375rem',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg)',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: 'var(--color-text-muted)',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
                }}
                aria-label={`Open ${b.otherTitle}`}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = 'var(--color-brand)'
                  e.currentTarget.style.color = 'var(--color-link)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                  e.currentTarget.style.color = 'var(--color-text-muted)'
                }}
              >
                Open
              </Link>
              {canWrite && (
                <button
                  type="button"
                  className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-6 md:w-6"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--color-text-subtle)',
                    cursor: 'pointer',
                    transition: 'color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
                  }}
                  aria-label={`Stop waiting on ${b.otherTitle}`}
                  title="Remove blocker"
                  onMouseEnter={e => {
                    e.currentTarget.style.color = 'var(--color-danger)'
                    e.currentTarget.style.background = 'var(--color-hover-tint)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'var(--color-text-subtle)'
                    e.currentTarget.style.background = 'transparent'
                  }}
                  onClick={() => { void removeBlocker(b.linkId, b.otherTitle) }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canWrite && (
        <div className="flex items-center" style={{ marginTop: blockers.length > 0 ? '0.375rem' : '0.5rem' }}>
          <InlineMenuField
            value="none"
            options={options}
            onChange={next => { void addBlocker(next) }}
            renderValue={() => (
              <span
                className="inline-flex items-center"
                style={{ gap: '0.375rem', color: 'var(--color-text-muted)', fontWeight: 600 }}
              >
                <Plus size={13} aria-hidden="true" />
                Add blocker
              </span>
            )}
            ariaLabel="Add a blocker"
            searchable
            serverFiltered
            onQueryChange={setQuery}
            searchPlaceholder="Search tasks and requests"
            emptyMessage={emptyMessage}
            width="18rem"
          />
        </div>
      )}
    </SidebarCard>
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
/** One expression for this panel's SWR key, so the wizard's revalidation and
 *  the panel's own fetch cannot drift apart by a query string. */
function requestTasksKey(requestId: string): string {
  return `/api/admin/tasks?requestId=${requestId}`
}

function RequestTasksPanel({ requestId }: { requestId: string }) {
  const { data, isLoading } = useSWR<{ tasks: RequestTaskRow[] }>(
    requestTasksKey(requestId),
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
                borderBottom: i < tasks.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
              }}
            >
              {/* The row is a door, not a label: the panel used to be the one
                  place a task could be seen and not opened. /tasks?task=<id>
                  is the same address the deep link and every notification
                  use, so the slide-over is what answers. */}
              <Link
                href={`/tasks?task=${t.id}`}
                className="tahi-focus-ring"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  minHeight: '2.75rem',
                  padding: 'var(--space-3) var(--space-5)',
                  textDecoration: 'none',
                  transition: 'background-color var(--motion-quick) var(--ease-out)',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-hover-tint)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
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
              </Link>
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

  const total = checklists.length

  return (
    <SidebarCard
      title="Checklists"
      icon={<ListChecks size={14} />}
      count={total}
      action={isAdmin && !addingChecklist ? (
        <button
          type="button"
          onClick={() => setAddingChecklist(true)}
          aria-label="Add a checklist"
          title="Add a checklist"
          className="tahi-rail-head-action tahi-focus-ring inline-flex items-center justify-center h-11 w-11 md:h-6 md:w-6"
        >
          <Plus size={15} aria-hidden="true" />
        </button>
      ) : undefined}
    >
      {/* Add a checklist. The input owns the brand ring the way every other
          inline editor in the rail does, so there is one edit affordance on
          this page rather than two. */}
      {addingChecklist && (
        <div className="flex items-center" style={{ gap: '0.375rem', marginBottom: total > 0 ? '0.625rem' : 0 }}>
          <input
            type="text"
            value={newChecklistTitle}
            onChange={e => setNewChecklistTitle(e.target.value)}
            placeholder="Name the checklist…"
            aria-label="New checklist title"
            autoFocus
            className="tahi-rail-input flex-1"
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addChecklist() }
              if (e.key === 'Escape') { setAddingChecklist(false); setNewChecklistTitle('') }
            }}
          />
          <button
            type="button"
            onClick={addChecklist}
            className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 md:h-8"
            style={{
              padding: '0 0.625rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              border: '1px solid var(--color-brand)',
              background: 'var(--color-brand)',
              color: 'var(--color-text-on-dark)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAddingChecklist(false); setNewChecklistTitle('') }}
            className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 md:h-8"
            style={{
              padding: '0 0.5rem',
              fontSize: '0.75rem',
              fontWeight: 500,
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {total === 0 && !addingChecklist && (
        <p className="tahi-rail-empty">
          {isAdmin ? 'No checklists yet. Add one to break this down.' : 'No checklists yet.'}
        </p>
      )}

      {checklists.map((cl, ci) => {
        const doneCount = cl.items.filter(i => i.done).length
        const totalCount = cl.items.length
        const progress = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

        return (
          <div
            key={ci}
            style={{
              paddingTop: ci === 0 ? 0 : '0.75rem',
              marginTop: ci === 0 ? 0 : '0.75rem',
              borderTop: ci === 0 ? undefined : '1px solid var(--color-border-subtle)',
            }}
          >
            <div className="flex items-center" style={{ gap: '0.5rem', marginBottom: '0.375rem' }}>
              <span
                className="truncate"
                style={{ fontSize: '0.78125rem', fontWeight: 600, color: 'var(--color-text)', minWidth: 0 }}
              >
                {cl.title}
              </span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => removeChecklist(ci)}
                  aria-label={`Remove the ${cl.title} checklist`}
                  title="Remove checklist"
                  className="tahi-rail-x tahi-focus-ring inline-flex items-center justify-center h-11 w-11 md:h-6 md:w-6"
                  style={{ marginLeft: 'auto' }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Progress. Ported from `.req-check-progress`: a 0.375rem track
                with the fraction beside it, not under it. */}
            {totalCount > 0 && (
              <div className="flex items-center" style={{ gap: '0.5625rem', marginBottom: '0.375rem' }}>
                <div
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${cl.title} progress`}
                  style={{
                    flex: 1,
                    height: '0.375rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-bg-secondary)',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'block',
                      height: '100%',
                      width: `${progress}%`,
                      borderRadius: 'var(--radius-sm)',
                      background: progress === 100 ? 'var(--color-success)' : 'var(--color-brand)',
                      transition: 'width var(--motion-medium) var(--ease-out)',
                    }}
                  />
                </div>
                <span
                  className="tabular-nums flex-shrink-0"
                  style={{ fontSize: '0.71875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}
                >
                  {doneCount}/{totalCount}
                </span>
              </div>
            )}

            {/* Items. The whole box-and-label is one control, so the label is
                a target too, with the remove button as its sibling rather
                than nested inside it.

                Checklists are client-visible, and a client cannot tick one.
                They get the same drawing as a reading, not a control they are
                barred from: an element named after the STATE it reports, out
                of the tab order because there is nothing to operate. Only a
                viewer who can toggle gets the button and its aria-pressed. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
              {cl.items.map((item, ii) => (
                <div key={ii} className="flex items-center" style={{ gap: '0.375rem' }}>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => toggleItem(ci, ii)}
                      aria-pressed={item.done}
                      aria-label={item.done ? `Mark ${item.label} incomplete` : `Mark ${item.label} complete`}
                      className={`tahi-check tahi-focus-ring min-h-11 md:min-h-0${item.done ? ' is-done' : ''}`}
                    >
                      <span aria-hidden="true" className="tahi-check-box">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      <span className="tahi-check-label">{item.label}</span>
                    </button>
                  ) : (
                    <span
                      role="img"
                      aria-label={`${item.label}: ${item.done ? 'completed' : 'not completed'}`}
                      className={`tahi-check is-static${item.done ? ' is-done' : ''}`}
                    >
                      <span aria-hidden="true" className="tahi-check-box">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      <span className="tahi-check-label">{item.label}</span>
                    </span>
                  )}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => removeItem(ci, ii)}
                      aria-label={`Remove ${item.label}`}
                      title="Remove item"
                      className="tahi-rail-x tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-6 md:w-6"
                      style={{ marginLeft: 'auto' }}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add an item. One quiet full-width row, the way the prototype's
                `.rqd-add` sits under its list. */}
            {isAdmin && (
              <div className="flex items-center" style={{ gap: '0.375rem', marginTop: '0.25rem' }}>
                <input
                  type="text"
                  value={newItemLabels[ci] ?? ''}
                  onChange={e => setNewItemLabels(prev => ({ ...prev, [ci]: e.target.value }))}
                  placeholder="Name the step…"
                  aria-label={`Add a step to ${cl.title}`}
                  className="tahi-rail-input flex-1"
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addItem(ci) }
                  }}
                />
                <button
                  type="button"
                  onClick={() => addItem(ci)}
                  aria-label={`Add the step to ${cl.title}`}
                  title="Add step"
                  className="tahi-rail-head-action tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-8 md:w-8"
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )
      })}
    </SidebarCard>
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
  /** False under a viewer's lens: view and download stay open, attaching and
   *  deleting do not. Defaults to true so any other caller is unaffected. */
  canMutate?: boolean
}

// Files are attachable by both studio and client: uploads authorise non-admins
// server-side, so there is no ADMIN gate on this panel. There is a write gate,
// because a super admin standing in a viewer's shoes must not be able to
// attach or destroy a file from a page they are only reading.
function FilesPanel({ files, onRefresh, requestId, orgId, emptyHint, canMutate = true }: FilesPanelProps) {
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
          {canMutate && (
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
                canDelete={canMutate}
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
 *
 * Delete is the only one of the three that writes, so it is the only one the
 * viewer's lens takes away. Reading a file is what a viewer is for.
 */
function FileActions({ file, onDeleted, canDelete = true }: {
  file: { id: string; filename: string; storageKey: string; mimeType: string | null }
  onDeleted: () => void
  canDelete?: boolean
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
      {canDelete && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          style={iconBtn}
          aria-label={`Delete ${file.filename}`}
          title="Delete"
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-danger-bg)'; e.currentTarget.style.color = 'var(--color-danger)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
        >
          <Trash2 size={14} />
        </button>
      )}
      <ConfirmDialog
        open={canDelete && confirmOpen}
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

/** Date AND time, for the title behind a relative phrase that goes stale. */
function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-NZ', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

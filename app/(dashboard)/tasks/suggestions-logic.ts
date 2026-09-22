/**
 * The pure half of the Suggestions view: grouping, labels, the keyboard
 * map and the two directions a create_task proposal travels through
 * NewTaskDialog's initialDraft prop. Nothing here talks to fetch, React or
 * the DOM, so it runs in the repo's node-only Vitest environment the same
 * way lib/tasks-views.ts does.
 */

import type { TaskFields } from '@/lib/task-wizard-drafts'
import type { RequestInitialDraft } from '@/components/tahi/new-request-dialog'
import { handoffReasonShortLabel, isHandoffReason } from '@/lib/request-handoff-copy'
import type {
  CreateRequestProposal,
  CreateTaskProposal,
  DecoratedSuggestion,
  HandOffRequestProposal,
  SimilarMatch,
  SnoozePreset,
  TaskSuggestionKind,
} from './suggestions-types'

// ── Grouping ────────────────────────────────────────────────────────────────

export interface SuggestionCallGroup {
  /** transcriptId, falling back to callId then the first row's id: whatever
   *  ties every suggestion in the group to the same call. */
  key: string
  callTitle: string
  orgName: string | null
  callScheduledAt: string | null
  items: DecoratedSuggestion[]
}

function groupKey(item: DecoratedSuggestion): string {
  return item.transcriptId ?? item.callId ?? item.id
}

/** Rows grouped by call, most recent call first, oldest suggestion first
 *  within a call (the order the transcript said them in, which createdAt
 *  approximates since a cron run inserts them in one pass). A suggestion with
 *  neither a transcript nor a call groups alone under its own id, which reads
 *  as "unlinked notes" rather than being silently dropped. */
export function groupSuggestionsByCall(items: readonly DecoratedSuggestion[]): SuggestionCallGroup[] {
  const map = new Map<string, SuggestionCallGroup>()
  for (const item of items) {
    const key = groupKey(item)
    const existing = map.get(key)
    if (existing) {
      existing.items.push(item)
      continue
    }
    map.set(key, {
      key,
      callTitle: item.callTitle ?? 'Unlinked notes',
      orgName: item.orgName,
      callScheduledAt: item.callScheduledAt,
      items: [item],
    })
  }
  const groups = [...map.values()]
  for (const group of groups) {
    group.items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  groups.sort((a, b) => (b.callScheduledAt ?? '').localeCompare(a.callScheduledAt ?? ''))
  return groups
}

// ── Kind chip and proposal summary ───────────────────────────────────────────

export const SUGGESTION_KIND_LABELS: Record<TaskSuggestionKind, string> = {
  create_task: 'New task',
  update_task: 'Update',
  complete_task: 'Complete',
  add_subtasks: 'Subtasks',
  note: 'Note',
  create_request: 'New request',
  update_request: 'Update request',
  request_note: 'Request note',
  hand_off_request: 'Hand off',
}

export function suggestionKindLabel(kind: TaskSuggestionKind): string {
  return SUGGESTION_KIND_LABELS[kind] ?? kind
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

const UPDATE_FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  dueDate: 'due date',
  assigneeId: 'assignee',
  estimatedHours: 'estimate',
}

const UPDATE_REQUEST_FIELD_LABELS: Record<string, string> = {
  status: 'status',
  priority: 'priority',
  dueDate: 'due date',
  startDate: 'start date',
  estimatedHours: 'estimate',
  category: 'category',
  scopeFlagged: 'scope flag',
}

/** One plain-text line describing a proposal, whatever kind it is. Never
 *  throws on a malformed shape: an unreadable proposal reads as a generic
 *  line rather than crashing the row it is inside. */
export function summariseProposal(kind: TaskSuggestionKind, proposal: unknown): string {
  const p = asRecord(proposal)
  switch (kind) {
    case 'create_task': {
      const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : 'Untitled task'
      const description = typeof p.description === 'string' ? p.description.trim() : ''
      return description ? `${title} - ${description}` : title
    }
    case 'update_task': {
      const fields = asRecord(p.fields)
      const keys = Object.keys(fields)
      if (keys.length === 0) return 'No fields changed'
      const labels = keys.map(k => UPDATE_FIELD_LABELS[k] ?? k)
      return `Changes ${labels.join(', ')}`
    }
    case 'complete_task': {
      const note = typeof p.note === 'string' ? p.note.trim() : ''
      return note ? `Marks the task done. ${note}` : 'Marks the task done'
    }
    case 'add_subtasks': {
      const subtasks = Array.isArray(p.subtasks)
        ? p.subtasks.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : []
      return subtasks.length > 0 ? subtasks.join(', ') : 'No subtasks listed'
    }
    case 'note': {
      const body = typeof p.body === 'string' ? p.body.trim() : ''
      return body || 'No note text'
    }
    case 'create_request': {
      const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : 'Untitled request'
      const category = typeof p.category === 'string' ? p.category.trim() : ''
      return category ? `${title} - ${category}` : title
    }
    case 'update_request': {
      const fields = asRecord(p.fields)
      const keys = Object.keys(fields)
      if (keys.length === 0) return 'No fields changed'
      const labels = keys.map(k => UPDATE_REQUEST_FIELD_LABELS[k] ?? k)
      return `Changes ${labels.join(', ')}`
    }
    case 'request_note': {
      const body = typeof p.body === 'string' ? p.body.trim() : ''
      return body || 'No note text'
    }
    case 'hand_off_request': {
      const name = typeof p.contactName === 'string' && p.contactName.trim() ? p.contactName.trim() : 'someone'
      const reason = isHandoffReason(p.reason) ? handoffReasonShortLabel(p.reason) : 'something'
      return `Waiting on ${name}: ${reason}`
    }
    default:
      return 'Unrecognised suggestion'
  }
}

/** "#<number> <title>" for a row with a target request, or null when there is
 *  none: a create_request has no target yet, and every kind reads this the
 *  same way once one exists (contract section 5). */
export function targetRequestLine(suggestion: Pick<DecoratedSuggestion, 'targetRequestNumber' | 'targetRequestTitle'>): string | null {
  if (suggestion.targetRequestNumber == null || !suggestion.targetRequestTitle) return null
  return `#${suggestion.targetRequestNumber} ${suggestion.targetRequestTitle}`
}

/** A hand-off suggestion cannot be approved until a contact is picked, on
 *  the row or on Tweak: the sweep suggests it anyway when it could not
 *  resolve the name, and the human fills in who. */
export function handOffNeedsContact(proposal: Pick<HandOffRequestProposal, 'contactId'>): boolean {
  return !proposal.contactId
}

/** Shown only under 0.7 per the contract; a confident suggestion carries no
 *  percentage at all rather than a reassuring one nobody asked for. */
export function confidenceLabel(confidence: number | null): string | null {
  if (confidence == null || confidence >= 0.7) return null
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return `${pct}% confidence`
}

// ── Duplicate guard (CN.1d contract sections 2 and 5) ───────────────────────

/** Mirrors lib/text-similarity.ts SIMILAR_BLOCK. Slice D1 owns the real
 *  export; this literal is swapped for it at merge if the two drift. */
export const SIMILAR_BLOCK = 0.8

function similarMatchRef(match: Pick<SimilarMatch, 'number' | 'title'>): string {
  return match.number != null ? `#${match.number} ${match.title}` : match.title
}

/** "Looks like #226 Design directions (open, 71%)" for the best match under
 *  a create row, or null when there is nothing to show. */
export function similarMatchLine(similar: readonly SimilarMatch[]): string | null {
  const best = similar[0]
  if (!best) return null
  const pct = Math.round(Math.max(0, Math.min(1, best.score)) * 100)
  return `Looks like ${similarMatchRef(best)} (${best.status}, ${pct}%)`
}

/** "and 2 more" for whatever is behind the best match, or null when there is
 *  nothing left over. */
export function similarOverflowLabel(similar: readonly SimilarMatch[]): string | null {
  const extra = similar.length - 1
  return extra > 0 ? `and ${extra} more` : null
}

/** The best match can be attached to only when it is an existing request or
 *  task: a match against another pending suggestion has nothing to attach
 *  to yet. */
export function canAttachBestMatch(similar: readonly SimilarMatch[]): boolean {
  const best = similar[0]
  return !!best && (best.kind === 'request' || best.kind === 'task')
}

/** "Use #226 instead", or a quoted-title fallback when the best match has no
 *  number to show. Null when the best match cannot be attached to. */
export function attachButtonLabel(similar: readonly SimilarMatch[]): string | null {
  if (!canAttachBestMatch(similar)) return null
  const best = similar[0]
  if (!best) return null
  return best.number != null ? `Use #${best.number} instead` : `Use "${best.title}" instead`
}

/** Approve reads "Approve anyway" and needs an inline confirm once the best
 *  match is at or above SIMILAR_BLOCK (contract section 5); below that the
 *  line is informational only and Approve behaves as it does with no
 *  matches at all. */
export function needsApproveConfirm(similar: readonly SimilarMatch[]): boolean {
  const best = similar[0]
  return !!best && best.score >= SIMILAR_BLOCK
}

/** The target an "attach" decision carries: the best match's kind and id.
 *  Callers should only call this once canAttachBestMatch is true. */
export function bestMatchTarget(similar: readonly SimilarMatch[]): { kind: 'request' | 'task'; id: string } | null {
  const best = similar[0]
  if (!best || (best.kind !== 'request' && best.kind !== 'task')) return null
  return { kind: best.kind, id: best.id }
}

// ── Keyboard ──────────────────────────────────────────────────────────────

export type SuggestionKeyAction = 'approve' | 'reject' | 'focus_next' | 'focus_prev' | null

/** y approves, n rejects, j/k move focus. Anything else is not this view's
 *  shortcut, so the caller lets the keystroke fall through. */
export function suggestionKeyAction(key: string): SuggestionKeyAction {
  switch (key) {
    case 'y': return 'approve'
    case 'n': return 'reject'
    case 'j': return 'focus_next'
    case 'k': return 'focus_prev'
    default: return null
  }
}

// ── Decide request bodies ────────────────────────────────────────────────

export interface DecideRequestBody {
  action: 'approve' | 'reject' | 'snooze' | 'attach'
  proposal?: unknown
  snooze?: SnoozePreset | { until: string }
  /** Sent only on approve, only once the confirm line under an
   *  "Approve anyway" button has itself been confirmed (contract section
   *  5). Omitted entirely otherwise, never sent as false. */
  force?: boolean
  target?: { kind: 'request' | 'task'; id: string }
}

/** Plain approve, or Tweak's approve-with-a-proposal-override: the contract
 *  reads a Tweak-and-save as "approve is a proposal override", not a
 *  separate action. `force` is only ever true, sent after the row's own
 *  confirm line; never sent as false. */
export function buildApproveRequest(proposalOverride?: unknown, force?: boolean): DecideRequestBody {
  const body: DecideRequestBody = proposalOverride === undefined
    ? { action: 'approve' }
    : { action: 'approve', proposal: proposalOverride }
  if (force) body.force = true
  return body
}

export function buildRejectRequest(): DecideRequestBody {
  return { action: 'reject' }
}

export function buildSnoozeRequest(preset: SnoozePreset): DecideRequestBody {
  return { action: 'snooze', snooze: preset }
}

/** "Use #226 instead": converts the pending create row into a note on the
 *  existing request or task the human picked (contract section 3). */
export function buildAttachRequest(target: { kind: 'request' | 'task'; id: string }): DecideRequestBody {
  return { action: 'attach', target }
}

// ── create_task proposal <-> TaskFields (NewTaskDialog's initialDraft) ──────

/** A create_task suggestion, read as the shape NewTaskDialog's initialDraft
 *  prop takes. Status always opens on todo: a suggestion never proposes a
 *  starting status, and the operator reviewing it owns that choice the same
 *  way they would from a blank dialog. */
export function createProposalToTaskFields(proposal: CreateTaskProposal): TaskFields {
  return {
    title: proposal.title,
    type: proposal.type,
    orgId: proposal.orgId,
    requestId: proposal.requestId ?? null,
    description: proposal.description ?? null,
    status: 'todo',
    priority: proposal.priority ?? 'standard',
    assigneeId: proposal.suggestedAssigneeId ?? null,
    dueDate: proposal.dueDate ?? null,
    estimatedHours: proposal.estimatedHours ?? null,
    subtasks: proposal.subtasks ?? [],
  }
}

/** The reverse: what Tweak's save sends back as the proposal override.
 *  suggestedAssigneeName and assigneeReason are dropped deliberately, they
 *  were the suggester's guess at a name and the human has now either
 *  confirmed an id or cleared it. */
export function taskFieldsToCreateProposal(fields: TaskFields): CreateTaskProposal {
  return {
    title: fields.title,
    description: fields.description,
    type: fields.type,
    orgId: fields.orgId,
    requestId: fields.requestId,
    suggestedAssigneeId: fields.assigneeId,
    dueDate: fields.dueDate,
    estimatedHours: fields.estimatedHours,
    priority: fields.priority,
    subtasks: fields.subtasks,
  }
}

// ── Assignee suggestions (CN.2 contract section 5) ─────────────────────────

/** The three kinds whose proposal may carry an owner suggestion. */
const ASSIGNEE_SUGGESTION_KINDS: readonly TaskSuggestionKind[] = ['create_task', 'create_request', 'update_request']

export interface AssigneeSuggestion {
  name: string | null
  id: string | null
  reason: string | null
}

/** The owner the suggester proposed, read off whichever of the three kinds
 *  the proposal is, or null when the kind carries no such suggestion at
 *  all. Null is also what a kind that carries the fields but named nobody
 *  returns, so a row never renders an empty "Suggested:" line. */
export function proposalAssigneeSuggestion(kind: TaskSuggestionKind, proposal: unknown): AssigneeSuggestion | null {
  if (!ASSIGNEE_SUGGESTION_KINDS.includes(kind)) return null
  const p = asRecord(proposal)
  const name = typeof p.suggestedAssigneeName === 'string' && p.suggestedAssigneeName.trim() ? p.suggestedAssigneeName.trim() : null
  if (!name) return null
  const id = typeof p.suggestedAssigneeId === 'string' && p.suggestedAssigneeId ? p.suggestedAssigneeId : null
  const reason = typeof p.assigneeReason === 'string' && p.assigneeReason.trim() ? p.assigneeReason.trim() : null
  return { name, id, reason }
}

/** "Suggested: Staci, said she would send the headers" for the row, or
 *  "Suggested: Staci" when there is a name but no reason. Null when the
 *  suggester named nobody. */
export function assigneeSuggestionLine(suggestion: AssigneeSuggestion | null): string | null {
  if (!suggestion || !suggestion.name) return null
  return suggestion.reason ? `Suggested: ${suggestion.name}, ${suggestion.reason}` : `Suggested: ${suggestion.name}`
}

/** The proposal Approve sends once the row's picker has moved the owner
 *  away from what the suggester wrote: the original proposal, spread, with
 *  the three assignee keys replaced. `assigneeReason` is dropped alongside
 *  a human pick the same way Tweak drops it for create_task, it was the
 *  suggester's reasoning for a name that is no longer the one on the row. */
export function withAssigneeOverride<P extends { suggestedAssigneeId?: string | null; suggestedAssigneeName?: string | null; assigneeReason?: string | null }>(
  proposal: P,
  picked: { id: string | null; name: string | null },
): P {
  return {
    ...proposal,
    suggestedAssigneeId: picked.id,
    suggestedAssigneeName: picked.name,
    assigneeReason: null,
  }
}

// ── create_request proposal <-> RequestInitialDraft (NewRequestDialog) ──────

/** A create_request suggestion, read as the shape NewRequestDialog's
 *  initialDraft prop takes. The org comes from the suggestion row, not the
 *  proposal: create_request never carries one of its own (contract section
 *  2), it is always the org the call suggestion belongs to. */
export function createRequestProposalToInitialDraft(
  proposal: CreateRequestProposal,
  orgId: string | null,
): RequestInitialDraft {
  return {
    orgId,
    title: proposal.title,
    description: proposal.description ?? null,
    category: proposal.category,
    type: proposal.type === 'large_task' ? 'large_task' : 'small_task',
    priority: proposal.priority,
    dueDate: proposal.dueDate ?? null,
  }
}

/** The reverse: what Tweak's save sends back as the proposal override.
 *  requesterName and requesterContactId carry over unedited from the
 *  original proposal, a Tweak never touches who asked for it, only what the
 *  request will say. */
export function initialDraftToCreateRequestProposal(
  draft: RequestInitialDraft,
  original: CreateRequestProposal,
): CreateRequestProposal {
  return {
    ...original,
    title: draft.title,
    description: draft.description,
    category: draft.category,
    type: draft.type,
    priority: draft.priority === 'high' ? 'high' : 'standard',
    dueDate: draft.dueDate,
  }
}

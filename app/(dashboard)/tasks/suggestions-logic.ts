/**
 * The pure half of the Suggestions view: grouping, the keyboard map, the
 * decide request bodies and the two directions a create_task proposal travels
 * through NewTaskDialog's initialDraft prop. Nothing here talks to fetch,
 * React or the DOM, so it runs in the repo's node-only Vitest environment the
 * same way lib/tasks-views.ts does.
 *
 * The words a suggestion is described in (the kind chip, the proposal
 * summary, the target request line, the confidence label, the suggested
 * assignee line and the duplicate warning) moved to lib/suggestion-summary.ts
 * when the Slack DM started showing the same row (CN.2 contract section 3),
 * and are re-exported from here so no call site in the view had to move.
 */

import type { TaskFields } from '@/lib/task-wizard-drafts'
import type { RequestInitialDraft } from '@/components/tahi/new-request-dialog'
import { asRecord } from '@/lib/suggestion-summary'
import type {
  CreateRequestProposal,
  CreateTaskProposal,
  DecoratedSuggestion,
  HandOffRequestProposal,
  SimilarMatch,
  SnoozePreset,
  TaskSuggestionKind,
} from './suggestions-types'

// The shared summariser (lib/suggestion-summary.ts). Re-exported rather than
// re-implemented: Slack and the inbox describe a row in one set of words.
export {
  SUGGESTION_KIND_LABELS,
  attachButtonLabel,
  bestMatchTarget,
  canAttachBestMatch,
  confidenceLabel,
  similarMatchLine,
  suggestedAssigneeLine,
  suggestionKindLabel,
  summariseProposal,
  targetRequestLine,
} from '@/lib/suggestion-summary'

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

/** A hand-off suggestion cannot be approved until a contact is picked, on
 *  the row or on Tweak: the sweep suggests it anyway when it could not
 *  resolve the name, and the human fills in who. */
export function handOffNeedsContact(proposal: Pick<HandOffRequestProposal, 'contactId'>): boolean {
  return !proposal.contactId
}

// ── Duplicate guard (CN.1d contract sections 2 and 5) ───────────────────────

/** Mirrors lib/text-similarity.ts SIMILAR_BLOCK. Slice D1 owns the real
 *  export; this literal is swapped for it at merge if the two drift. */
export const SIMILAR_BLOCK = 0.8

/** "and 2 more" for whatever is behind the best match, or null when there is
 *  nothing left over. */
export function similarOverflowLabel(similar: readonly SimilarMatch[]): string | null {
  const extra = similar.length - 1
  return extra > 0 ? `and ${extra} more` : null
}

/** Approve reads "Approve anyway" and needs an inline confirm once the best
 *  match is at or above SIMILAR_BLOCK (contract section 5); below that the
 *  line is informational only and Approve behaves as it does with no
 *  matches at all. */
export function needsApproveConfirm(similar: readonly SimilarMatch[]): boolean {
  const best = similar[0]
  return !!best && best.score >= SIMILAR_BLOCK
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

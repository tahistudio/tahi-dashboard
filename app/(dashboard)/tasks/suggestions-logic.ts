/**
 * The pure half of the Suggestions view: grouping, labels, the keyboard
 * map and the two directions a create_task proposal travels through
 * NewTaskDialog's initialDraft prop. Nothing here talks to fetch, React or
 * the DOM, so it runs in the repo's node-only Vitest environment the same
 * way lib/tasks-views.ts does.
 */

import type { TaskFields } from '@/lib/task-wizard-drafts'
import type {
  CreateTaskProposal,
  DecoratedSuggestion,
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
}

export function suggestionKindLabel(kind: TaskSuggestionKind): string {
  return SUGGESTION_KIND_LABELS[kind] ?? kind
}

function asRecord(value: unknown): Record<string, unknown> {
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
    default:
      return 'Unrecognised suggestion'
  }
}

/** Shown only under 0.7 per the contract; a confident suggestion carries no
 *  percentage at all rather than a reassuring one nobody asked for. */
export function confidenceLabel(confidence: number | null): string | null {
  if (confidence == null || confidence >= 0.7) return null
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return `${pct}% confidence`
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
  action: 'approve' | 'reject' | 'snooze'
  proposal?: unknown
  snooze?: SnoozePreset | { until: string }
}

/** Plain approve, or Tweak's approve-with-a-proposal-override: the contract
 *  reads a Tweak-and-save as "approve is a proposal override", not a
 *  separate action. */
export function buildApproveRequest(proposalOverride?: unknown): DecideRequestBody {
  return proposalOverride === undefined
    ? { action: 'approve' }
    : { action: 'approve', proposal: proposalOverride }
}

export function buildRejectRequest(): DecideRequestBody {
  return { action: 'reject' }
}

export function buildSnoozeRequest(preset: SnoozePreset): DecideRequestBody {
  return { action: 'snooze', snooze: preset }
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
    assigneeId: proposal.assigneeId ?? null,
    dueDate: proposal.dueDate ?? null,
    estimatedHours: proposal.estimatedHours ?? null,
    subtasks: proposal.subtasks ?? [],
  }
}

/** The reverse: what Tweak's save sends back as the proposal override.
 *  assigneeName is dropped deliberately, it was the suggester's guess at a
 *  name and the human has now either confirmed an id or cleared it. */
export function taskFieldsToCreateProposal(fields: TaskFields): CreateTaskProposal {
  return {
    title: fields.title,
    description: fields.description,
    type: fields.type,
    orgId: fields.orgId,
    requestId: fields.requestId,
    assigneeId: fields.assigneeId,
    dueDate: fields.dueDate,
    estimatedHours: fields.estimatedHours,
    priority: fields.priority,
    subtasks: fields.subtasks,
  }
}

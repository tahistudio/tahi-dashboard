/**
 * lib/suggestion-summary.ts
 *
 * One reading of a suggestion, shared by every surface that shows one.
 *
 * This is the pure half of what was app/(dashboard)/tasks/suggestions-logic.ts:
 * the kind chip, the one-line summary of a proposal, the target request line,
 * the confidence label, the suggested assignee line and the duplicate warning.
 * The CN.2 contract (section 3) moves it here because the Slack DM and the
 * dashboard inbox have to describe the same row in the same words. A founder
 * who approves in Slack and then opens /tasks should read one sentence, not
 * two that drifted.
 *
 * Nothing here touches the database, fetch, React or the DOM, so it runs in
 * the node-only Vitest environment and is safe to import from a client
 * component and from a Worker route alike.
 *
 * The page keeps importing these from suggestions-logic, which re-exports
 * them: no call site moved, only the definition.
 */

import { handoffReasonShortLabel, isHandoffReason } from '@/lib/request-handoff-copy'

/** Every kind a suggestion can be, task family then request family. */
export type SuggestionSummaryKind =
  | 'create_task'
  | 'update_task'
  | 'complete_task'
  | 'add_subtasks'
  | 'note'
  | 'create_request'
  | 'update_request'
  | 'request_note'
  | 'hand_off_request'

export const SUGGESTION_KIND_LABELS: Record<SuggestionSummaryKind, string> = {
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

/** The chip words. Takes a plain string because a stored row's kind column is
 *  one, and an unrecognised kind reads as itself rather than as a blank. */
export function suggestionKindLabel(kind: string): string {
  return SUGGESTION_KIND_LABELS[kind as SuggestionSummaryKind] ?? kind
}

/**
 * A proposal as a bag of fields, whether it arrived parsed or as the JSON
 * string the column holds. Exported because every surface that reads one
 * field off a proposal (the inbox row, the Slack card) needs exactly this and
 * a second copy would be a second set of edge cases.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
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
 *  line rather than crashing the row or the Slack block it is inside. The
 *  proposal may arrive parsed or as the stored JSON string. */
export function summariseProposal(kind: string, proposal: unknown): string {
  const p = asRecord(proposal)
  switch (kind) {
    case 'create_task': {
      const title = trimmedString(p.title) || 'Untitled task'
      const description = trimmedString(p.description)
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
      const note = trimmedString(p.note)
      return note ? `Marks the task done. ${note}` : 'Marks the task done'
    }
    case 'add_subtasks': {
      const subtasks = Array.isArray(p.subtasks)
        ? p.subtasks.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : []
      return subtasks.length > 0 ? subtasks.join(', ') : 'No subtasks listed'
    }
    case 'note': {
      return trimmedString(p.body) || 'No note text'
    }
    case 'create_request': {
      const title = trimmedString(p.title) || 'Untitled request'
      const category = trimmedString(p.category)
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
      return trimmedString(p.body) || 'No note text'
    }
    case 'hand_off_request': {
      const name = trimmedString(p.contactName) || 'someone'
      const reason = isHandoffReason(p.reason) ? handoffReasonShortLabel(p.reason) : 'something'
      return `Waiting on ${name}: ${reason}`
    }
    default:
      return 'Unrecognised suggestion'
  }
}

/** "#<number> <title>" for a row with a target request, or null when there is
 *  none: a create_request has no target yet, and every kind reads this the
 *  same way once one exists (CN.1b contract section 5). */
export function targetRequestLine(
  suggestion: { targetRequestNumber: number | null; targetRequestTitle: string | null },
): string | null {
  if (suggestion.targetRequestNumber == null || !suggestion.targetRequestTitle) return null
  return `#${suggestion.targetRequestNumber} ${suggestion.targetRequestTitle}`
}

/** Shown only under 0.7 per the contract; a confident suggestion carries no
 *  percentage at all rather than a reassuring one nobody asked for. */
export function confidenceLabel(confidence: number | null): string | null {
  if (confidence == null || confidence >= 0.7) return null
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return `${pct}% confidence`
}

/**
 * "Suggested: Staci, said she would send the headers", or just
 * "Suggested: Staci" when the proposal carries no reason.
 *
 * Reads both spellings on purpose. CN.1 already writes `assigneeName` on a
 * create_task; the CN.2 contract section 5 adds `suggestedAssigneeName` and
 * `assigneeReason` across create_task, create_request and update_request, and
 * slice A1 owns that write. Until A1 lands, a create_task's existing name
 * still renders a line rather than nothing, and a proposal with no name at
 * all renders no line rather than "Suggested: nobody".
 */
export function suggestedAssigneeLine(proposal: unknown): string | null {
  const p = asRecord(proposal)
  const name = trimmedString(p.suggestedAssigneeName) || trimmedString(p.assigneeName)
  if (!name) return null
  const reason = trimmedString(p.assigneeReason)
  return reason ? `Suggested: ${name}, ${reason}` : `Suggested: ${name}`
}

/**
 * Something that already exists and looks like what a create row proposes
 * (CN.1d section 2). Structural on purpose: both the server's SimilarMatch
 * (lib/task-suggestions.ts) and the page's mirror satisfy it.
 */
export interface SummarySimilarMatch {
  kind: 'request' | 'task' | 'suggestion'
  id: string
  number: number | null
  title: string
  status: string
  score: number
}

function similarMatchRef(match: Pick<SummarySimilarMatch, 'number' | 'title'>): string {
  return match.number != null ? `#${match.number} ${match.title}` : match.title
}

/** "Looks like #226 Design directions (open, 71%)" for the best match under
 *  a create row, or null when there is nothing to show. */
export function similarMatchLine(similar: readonly SummarySimilarMatch[]): string | null {
  const best = similar[0]
  if (!best) return null
  const pct = Math.round(Math.max(0, Math.min(1, best.score)) * 100)
  return `Looks like ${similarMatchRef(best)} (${best.status}, ${pct}%)`
}

/** The best match can be attached to only when it is an existing request or
 *  task: a match against another pending suggestion has nothing to attach
 *  to yet. */
export function canAttachBestMatch(similar: readonly SummarySimilarMatch[]): boolean {
  const best = similar[0]
  return !!best && (best.kind === 'request' || best.kind === 'task')
}

/** "Use #226 instead", or a quoted-title fallback when the best match has no
 *  number to show. Null when the best match cannot be attached to. */
export function attachButtonLabel(similar: readonly SummarySimilarMatch[]): string | null {
  if (!canAttachBestMatch(similar)) return null
  const best = similar[0]
  if (!best) return null
  return best.number != null ? `Use #${best.number} instead` : `Use "${best.title}" instead`
}

/** The target an "attach" decision carries: the best match's kind and id.
 *  Callers should only call this once canAttachBestMatch is true. */
export function bestMatchTarget(similar: readonly SummarySimilarMatch[]): { kind: 'request' | 'task'; id: string } | null {
  const best = similar[0]
  if (!best || (best.kind !== 'request' && best.kind !== 'task')) return null
  return { kind: best.kind, id: best.id }
}

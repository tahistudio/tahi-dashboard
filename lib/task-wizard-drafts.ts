/**
 * lib/task-wizard-drafts.ts
 *
 * The pure half of AI task creation: the priority alias table, the two name
 * resolvers, and the two body builders (one for the create form, one for the
 * API).
 *
 * It lives in lib/ rather than being exported from the component the way the
 * request wizard's helpers are, so the tests never import a 'use client'
 * module. Structural typing means the dialog's NewTaskDraft satisfies
 * TaskFields without either file importing the other.
 */

import { TASK_PRIORITIES } from '@/lib/task-priorities'
import type { TaskLevel } from '@/lib/tasks-views'

export interface TaskWizardDraft {
  id: string
  title: string
  description: string
  /** Free text from the model. There is no category column on tasks, so this
   *  survives as a line in the note or not at all. */
  category: string | null
  priority: string
  estimatedHours: number | null
  dueDate: string | null
  /** Names, not ids. The model never sees an id, so it can never invent one
   *  that happens to exist. */
  clientName: string | null
  assigneeName: string | null
  requestRef: string | null
  checklist: string[]
}

/** The wizard's old four value scale, and every synonym a model reaches for,
 *  mapped onto the repo's three. */
const PRIORITY_ALIASES: Record<string, string> = {
  none: 'standard', low: 'standard', medium: 'standard', normal: 'standard',
  standard: 'standard', high: 'high', urgent: 'urgent', critical: 'urgent',
}

export function normaliseWizardPriority(raw: unknown): string {
  const key = typeof raw === 'string' ? raw.toLowerCase().trim() : ''
  const mapped = PRIORITY_ALIASES[key]
  if (mapped) return mapped
  return (TASK_PRIORITIES as readonly string[]).includes(key) ? key : 'standard'
}

export interface NamedOption { id: string; name: string }

/** Case-insensitive exact match, then a unique prefix. An ambiguous prefix
 *  returns null on purpose: filing against the wrong client silently is worse
 *  than making the human pick. */
export function resolveByName(name: string | null, options: readonly NamedOption[]): string | null {
  if (!name) return null
  const needle = name.trim().toLowerCase()
  if (!needle) return null
  const exact = options.filter(o => o.name.trim().toLowerCase() === needle)
  if (exact.length === 1) return exact[0].id
  const prefix = options.filter(o => o.name.trim().toLowerCase().startsWith(needle))
  return prefix.length === 1 ? prefix[0].id : null
}

export const resolveDraftClient = resolveByName
export const resolveDraftAssignee = resolveByName

export interface DraftContext {
  clients: readonly NamedOption[]
  people: readonly NamedOption[]
  requests: readonly { id: string; requestNumber: number | null }[]
  /** Set when the wizard was opened from a place that already knows. */
  orgId?: string | null
  requestId?: string | null
  /** Set only when the operator chose one. Otherwise the level is derived. */
  level?: TaskLevel | null
}

export interface TaskFields {
  title: string
  type: TaskLevel
  orgId: string | null
  requestId: string | null
  description: string | null
  status: string
  priority: string
  assigneeId: string | null
  dueDate: string | null
  estimatedHours: number | null
  subtasks: string[]
}

/**
 * A draft plus what the page knows, resolved into the exact shape the create
 * form takes.
 *
 * The level rule is the one the detail panel already applies: a task that
 * gains a client becomes Internal, not Client. An AI-drafted chaser is
 * normally studio work about a client, not something the client will read.
 */
export function draftToTaskFields(draft: TaskWizardDraft, ctx: DraftContext): TaskFields | null {
  const title = draft.title.trim()
  if (!title) return null

  const orgId = ctx.orgId ?? resolveDraftClient(draft.clientName, ctx.clients)
  const requestId = ctx.requestId ?? resolveRequestRef(draft.requestRef, ctx.requests)
  const level: TaskLevel = ctx.level ?? (orgId ? 'internal_client_task' : 'tahi_internal')

  const noteLines: string[] = []
  if (draft.description.trim()) noteLines.push(draft.description.trim())
  if (draft.category) noteLines.push(`Category: ${draft.category}`)

  return {
    title,
    type: level,
    orgId,
    requestId,
    description: noteLines.length > 0 ? noteLines.join('\n\n') : null,
    status: 'todo',
    priority: normaliseWizardPriority(draft.priority),
    assigneeId: resolveDraftAssignee(draft.assigneeName, ctx.people),
    dueDate: draft.dueDate,
    estimatedHours: draft.estimatedHours,
    subtasks: draft.checklist.filter(c => c.trim().length > 0),
  }
}

/** '#042' or '42' onto a request id. */
export function resolveRequestRef(
  ref: string | null,
  requests: readonly { id: string; requestNumber: number | null }[],
): string | null {
  if (!ref) return null
  const n = Number.parseInt(ref.replace(/^#/, ''), 10)
  if (!Number.isFinite(n)) return null
  const match = requests.filter(r => r.requestNumber === n)
  return match.length === 1 ? match[0].id : null
}

/** The POST body. Identical fields to the create form, because the create
 *  route already accepts every one of them; the old wizard simply never sent
 *  them and stringified two of them into the description instead. */
export function buildCreateTaskBody(
  draft: TaskWizardDraft,
  ctx: DraftContext,
): Record<string, unknown> | null {
  const fields = draftToTaskFields(draft, ctx)
  if (!fields) return null
  return {
    title: fields.title,
    type: fields.type,
    orgId: fields.orgId,
    requestId: fields.requestId,
    description: fields.description,
    status: fields.status,
    priority: fields.priority,
    assigneeId: fields.assigneeId,
    dueDate: fields.dueDate,
    estimatedHours: fields.estimatedHours,
    subtasks: fields.subtasks,
  }
}

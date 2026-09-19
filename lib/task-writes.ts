/**
 * lib/task-writes.ts
 *
 * The one code path that creates a task and the one that updates it.
 *
 * Both bodies used to live inline in their route handlers (POST
 * /api/admin/tasks and PATCH /api/admin/tasks/[id]), which meant the only way
 * for anything other than a browser to write a task exactly the way the
 * dashboard does was to call the HTTP route from inside the worker. Applying
 * an approved call suggestion (lib/task-suggestions.ts) needs those same
 * rules with no request, no session and no NextResponse, so the rules moved
 * here and the routes became thin.
 *
 * What the routes keep: reading the body, `isTahiAdmin`, and for PATCH
 * `guardTask` on the task as it stands today. What moved: the validation, the
 * link invariants, the client access check on the client a task is being
 * filed under or moved to, the insert or update, the subtasks, and the
 * task_assigned notification.
 *
 * What is NEW here, and therefore new to both routes: an audit_log entry.
 * Nothing in the tasks API wrote one before; applying a suggestion has to be
 * traceable, and a trail that only records the automation would be a trail
 * that says the studio never touches its own tasks.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router routes
 * may only export HTTP methods and config.
 */

import { eq } from 'drizzle-orm'
import type { NextResponse } from 'next/server'
import { schema, type DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { requireAccessToOrg } from '@/lib/require-access'
import { isTaskPriority, TASK_PRIORITIES } from '@/lib/task-priorities'
import { TASK_STATUSES } from '@/lib/status-config'
import { isTaskLevel, type TaskLevel } from '@/lib/tasks-views'
import { coerceTaskLinks, setTaskLevel } from '@/lib/task-consistency'
import { loadTaskLinks, requestOrgId, resolveAssigneeType } from '@/lib/task-access'
import { resolveTeamMember } from '@/lib/team-identity'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Who is writing.
 *
 * 'team_member' is a signed-in human: `actorId` is their Clerk user id, and
 * the client access rule (Rule 11) is applied against it.
 *
 * 'system' is an automation applying something a human already approved
 * elsewhere: the approval surface did the scoping, there is no session to
 * scope against here, and the audit entry says system rather than naming the
 * founder who clicked. `actorId` still carries whoever that was, so the trail
 * can answer "who approved this" without claiming they typed it.
 */
export interface TaskWriteActor {
  actorType: 'team_member' | 'system'
  actorId: string | null
}

export interface TaskCreateInput {
  title?: string
  type?: string
  orgId?: string | null
  description?: string | null
  status?: string
  priority?: string
  assigneeId?: string | null
  assigneeType?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  trackId?: string | null
  position?: number | null
  requestId?: string | null
  scheduleRowId?: string | null
  subtasks?: string[]
  /**
   * The team member the caller IS, when it cannot be read from the session.
   * A worker MCP call authenticates as the service user, which by design is
   * nobody's team member, so "create a task for me" through create_task used
   * to write the asker their own bell row. Only ever suppresses a
   * notification, never sends one anywhere new.
   */
  actorTeamMemberId?: string | null
}

export interface TaskPatchInput {
  title?: string
  description?: string | null
  status?: string
  priority?: string
  assigneeId?: string | null
  assigneeType?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  trackId?: string | null
  position?: number | null
  requestId?: string | null
  orgId?: string | null
  type?: string
  tags?: string
  scheduleRowId?: string | null
}

/** The task as it stands after the write. */
export interface TaskRecord {
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
  estimatedHours: number | null
  completedAt: string | null
  requestId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * A refusal, as a status and a message rather than as a Response, so this
 * module can be called from a cron or an apply function that has no request
 * to answer. The routes turn it back into the exact JSON they always sent.
 */
export interface TaskWriteFailure {
  status: number
  error: string
}

export type TaskWriteResult =
  | { ok: true; task: TaskRecord }
  | { ok: false; failure: TaskWriteFailure }

/** The current timestamp in the shape every other writer in this repo stamps. */
function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * Read a `requireAccessToOrg` denial back into a failure. The body is the
 * one the routes have always returned ('Forbidden' or 'Not found'), so
 * turning it back into a response downstream reproduces it exactly.
 */
async function failureFromDenial(denied: NextResponse): Promise<TaskWriteFailure> {
  let error = 'Forbidden'
  try {
    const body = await denied.json() as { error?: string }
    if (typeof body.error === 'string') error = body.error
  } catch {
    error = 'Forbidden'
  }
  return { status: denied.status, error }
}

/**
 * Rule 11 on the client the task is being filed under or moved to, for a
 * human caller only. A system apply is already past its own approval gate.
 */
async function guardTargetOrg(
  drizzle: Drizzle,
  actor: TaskWriteActor,
  targetOrgId: string,
): Promise<TaskWriteFailure | null> {
  if (actor.actorType !== 'team_member') return null
  const denied = await requireAccessToOrg(drizzle, actor.actorId, targetOrgId)
  return denied ? failureFromDenial(denied) : null
}

/** The audit actor type, which is the write actor's own vocabulary. */
function auditActorType(actor: TaskWriteActor): 'team_member' | 'system' {
  return actor.actorType
}

/**
 * Tell the assignee a task was handed to them.
 *
 * Team members only, never a contact. Tasks are not a client surface (the
 * portal has no task page, and lib/notification-links clientHref returns null
 * for 'task'), so a contact addressed here would be handed an internal task
 * TITLE in their bell on a row that cannot be clicked. The task still holds
 * the contact and still stores the kind; nobody outside the studio is told.
 *
 * And never the caller: taking a task on yourself is not news.
 */
async function notifyAssignee(
  drizzle: Drizzle,
  params: { taskId: string; title: string; assigneeId: string; actorTeamMemberId: string | null },
): Promise<void> {
  if (params.actorTeamMemberId === params.assigneeId) return
  await createNotification(drizzle, {
    recipient: { teamMemberId: params.assigneeId },
    type: 'task_assigned',
    title: `Task assigned to you: "${params.title}"`,
    body: null,
    entityType: 'task',
    entityId: params.taskId,
  })
}

/**
 * Create a task. Everything POST /api/admin/tasks does once it knows the
 * caller is an admin, in the order it did it.
 */
export async function createTaskRecord(
  drizzle: Drizzle,
  input: TaskCreateInput,
  actor: TaskWriteActor,
): Promise<TaskWriteResult> {
  const title = input.title?.trim()
  if (!title) return { ok: false, failure: { status: 400, error: 'Title is required' } }

  const requestedLevel = isTaskLevel(input.type) ? input.type : null

  // Normalise before validating: a form with nothing selected posts
  // `priority: null`, which the insert below already reads as standard, so
  // 400ing on it answered "Invalid priority" for a field left blank.
  const priority = input.priority ?? 'standard'
  if (!isTaskPriority(priority)) {
    return { ok: false, failure: { status: 400, error: 'Invalid priority' } }
  }

  const status = input.status ?? 'todo'
  if (!TASK_STATUSES.some(s => s.value === status)) {
    return { ok: false, failure: { status: 400, error: 'Invalid status' } }
  }

  // A caller that names a request but no client is naming the client too:
  // linking adopts the request's client (setTaskRequest). An explicit
  // tahi_internal still means "no links", so it never reaches the lookup.
  let clientOrgId = input.orgId ?? null
  if (!clientOrgId && input.requestId && requestedLevel !== 'tahi_internal') {
    clientOrgId = await requestOrgId(drizzle, input.requestId)
    if (!clientOrgId) return { ok: false, failure: { status: 404, error: 'Request not found' } }
  }

  const level: TaskLevel = requestedLevel ?? (clientOrgId ? 'client_task' : 'tahi_internal')

  if (level !== 'tahi_internal' && !clientOrgId) {
    return { ok: false, failure: { status: 400, error: 'Client is required for a client task' } }
  }

  // setTaskLevel runs first because an explicit tahi_internal MEANS "drop the
  // links", which coerceTaskLinks on its own would read the other way round.
  const links = coerceTaskLinks(setTaskLevel(
    { level: 'client_task', orgId: clientOrgId, requestId: input.requestId ?? null },
    level,
  ))

  if (links.orgId) {
    const denied = await guardTargetOrg(drizzle, actor, links.orgId)
    if (denied) return { ok: false, failure: denied }
  }

  // Who the assignee IS, settled once, BEFORE the write: reading it after
  // meant a D1 failure answered 500 for a request whose task row already
  // existed, so the operator re-submitted and got a duplicate.
  const assigneeId = input.assigneeId ?? null
  const statedType = input.assigneeType === 'contact' || input.assigneeType === 'team_member'
    ? input.assigneeType
    : null
  const assigneeType = assigneeId
    ? statedType ?? await resolveAssigneeType(drizzle, assigneeId)
    : null
  const statedActor = typeof input.actorTeamMemberId === 'string' && input.actorTeamMemberId.trim()
    ? input.actorTeamMemberId.trim()
    : null
  const me = assigneeType === 'team_member' && !statedActor && actor.actorType === 'team_member'
    ? await resolveTeamMember(drizzle, actor.actorId)
    : null
  const actorTeamMemberId = statedActor ?? me?.id ?? null

  const id = crypto.randomUUID()
  const stamp = now()

  const row: TaskRecord = {
    id,
    type: links.level,
    orgId: links.orgId,
    title,
    description: input.description ?? null,
    status,
    priority,
    assigneeId,
    assigneeType,
    dueDate: input.dueDate ?? null,
    estimatedHours: input.estimatedHours ?? null,
    completedAt: status === 'done' ? stamp : null,
    requestId: links.requestId,
    createdAt: stamp,
    updatedAt: stamp,
  }

  await drizzle.insert(schema.tasks).values({
    ...row,
    createdById: actor.actorId,
    tags: '[]',
    trackId: input.trackId ?? null,
    position: input.position ?? null,
    scheduleRowId: input.scheduleRowId || null,
  })

  const subtaskTitles = Array.isArray(input.subtasks)
    ? input.subtasks.map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : []

  for (const subtaskTitle of subtaskTitles) {
    await drizzle.insert(schema.taskSubtasks).values({
      id: crypto.randomUUID(),
      taskId: id,
      title: subtaskTitle,
      completed: false,
      createdAt: stamp,
    })
  }

  if (assigneeId && assigneeType === 'team_member') {
    await notifyAssignee(drizzle, { taskId: id, title, assigneeId, actorTeamMemberId })
  }

  await logAudit(drizzle as unknown as DB, {
    action: 'task.created',
    userId: actor.actorId,
    userType: auditActorType(actor),
    entityType: 'task',
    entityId: id,
    metadata: { title, level: links.level, orgId: links.orgId, requestId: links.requestId },
  })

  return { ok: true, task: row }
}

/**
 * Update a task. Everything PATCH /api/admin/tasks/[id] does once the caller
 * is an admin and `guardTask` has allowed them at the task as it stands.
 */
export async function updateTaskRecord(
  drizzle: Drizzle,
  taskId: string,
  patch: TaskPatchInput,
  actor: TaskWriteActor,
): Promise<TaskWriteResult> {
  const stamp = now()
  const updates: Record<string, unknown> = { updatedAt: stamp }

  if (patch.title !== undefined) {
    if (!patch.title.trim()) {
      return { ok: false, failure: { status: 400, error: 'Title cannot be empty' } }
    }
    updates.title = patch.title.trim()
  }
  if (patch.description !== undefined) updates.description = patch.description
  if (patch.status !== undefined) {
    if (!TASK_STATUSES.some(s => s.value === patch.status)) {
      return { ok: false, failure: { status: 400, error: 'Invalid status' } }
    }
    updates.status = patch.status
    // Reopening a task must take its completion stamp with it, or the list
    // keeps printing "Done 3 days ago" beside an open row.
    updates.completedAt = patch.status === 'done' ? stamp : null
  }
  if (patch.priority !== undefined) {
    if (!(TASK_PRIORITIES as readonly string[]).includes(patch.priority)) {
      return { ok: false, failure: { status: 400, error: 'Invalid priority' } }
    }
    updates.priority = patch.priority
  }
  if (patch.assigneeId !== undefined) {
    updates.assigneeId = patch.assigneeId
    if (patch.assigneeType !== undefined) {
      updates.assigneeType = patch.assigneeType
    } else if (!patch.assigneeId) {
      // Clearing the assignee clears the type with it, or a stale type sits
      // behind a null id and misroutes the next assignment notification.
      updates.assigneeType = null
    } else {
      const kind = await resolveAssigneeType(drizzle, patch.assigneeId)
      if (!kind) return { ok: false, failure: { status: 400, error: 'Unknown assignee' } }
      updates.assigneeType = kind
    }
  }
  if (patch.dueDate !== undefined) updates.dueDate = patch.dueDate
  if (patch.estimatedHours !== undefined) {
    const hours = patch.estimatedHours
    if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0)) {
      return { ok: false, failure: { status: 400, error: 'Invalid estimate' } }
    }
    updates.estimatedHours = hours
  }
  if (patch.trackId !== undefined) updates.trackId = patch.trackId
  if (patch.position !== undefined) updates.position = patch.position
  if (patch.tags !== undefined) updates.tags = patch.tags
  // '' and null both mean unlink (the MCP tool cannot send null).
  if (patch.scheduleRowId !== undefined) updates.scheduleRowId = patch.scheduleRowId || null

  if (patch.type !== undefined && !isTaskLevel(patch.type)) {
    return { ok: false, failure: { status: 400, error: 'Invalid level' } }
  }

  // The level, the client and the request are one state, not three fields.
  // Any patch that touches one of the three resolves all three through the
  // same invariants the create door uses, and writes all three.
  const touchesLinks = patch.type !== undefined
    || patch.orgId !== undefined
    || patch.requestId !== undefined

  if (touchesLinks) {
    const current = await loadTaskLinks(drizzle, taskId)
    if (!current) return { ok: false, failure: { status: 404, error: 'Task not found' } }

    const currentLevel: TaskLevel = isTaskLevel(current.type)
      ? current.type
      : (current.orgId ? 'client_task' : 'tahi_internal')
    const requestedLevel = isTaskLevel(patch.type) ? patch.type : null

    let nextOrgId = patch.orgId !== undefined ? patch.orgId : current.orgId
    let nextRequestId = patch.requestId !== undefined ? patch.requestId : current.requestId

    // Clearing the client clears the request with it, because a request the
    // task no longer shares a client with is not a link. A request named in
    // the same call is the caller restating the pair, and wins.
    if (patch.orgId !== undefined && !patch.orgId && patch.requestId === undefined) {
      nextRequestId = null
    }

    if (nextRequestId && requestedLevel !== 'tahi_internal'
      && (nextRequestId !== current.requestId || nextOrgId !== current.orgId)) {
      const linkedOrgId = await requestOrgId(drizzle, nextRequestId)
      if (!linkedOrgId) return { ok: false, failure: { status: 404, error: 'Request not found' } }
      if (patch.orgId !== undefined && nextOrgId && nextOrgId !== linkedOrgId) {
        nextRequestId = null
      } else {
        nextOrgId = linkedOrgId
      }
    }

    // A level the caller stated and could not have meant is an error rather
    // than something to repair behind their back.
    if (requestedLevel && requestedLevel !== 'tahi_internal' && !nextOrgId) {
      return { ok: false, failure: { status: 400, error: 'Client is required for a client task' } }
    }

    const links = coerceTaskLinks(setTaskLevel(
      { level: currentLevel, orgId: nextOrgId, requestId: nextRequestId },
      requestedLevel ?? currentLevel,
    ))

    // Rule 11 on the NEW client. The caller's guard only checked the client
    // the task sits in today, so without this a member scoped to one client
    // could move a task into a client they cannot see.
    if (links.orgId && links.orgId !== current.orgId) {
      const denied = await guardTargetOrg(drizzle, actor, links.orgId)
      if (denied) return { ok: false, failure: denied }
    }

    updates.type = links.level
    updates.orgId = links.orgId
    updates.requestId = links.requestId
  }

  await drizzle.update(schema.tasks).set(updates).where(eq(schema.tasks.id, taskId))

  const task = await readTask(drizzle, taskId)
  if (!task) return { ok: false, failure: { status: 404, error: 'Task not found' } }

  // Notify the assignee when a task is handed to them. Two doors, one rule:
  // the create door answers exactly the same way.
  if (patch.assigneeId && updates.assigneeType !== 'contact') {
    const me = actor.actorType === 'team_member' ? await resolveTeamMember(drizzle, actor.actorId) : null
    await notifyAssignee(drizzle, {
      taskId,
      title: task.title ?? 'Untitled',
      assigneeId: patch.assigneeId,
      actorTeamMemberId: me?.id ?? null,
    })
  }

  await logAudit(drizzle as unknown as DB, {
    action: 'task.updated',
    userId: actor.actorId,
    userType: auditActorType(actor),
    entityType: 'task',
    entityId: taskId,
    metadata: { fields: Object.keys(updates).filter(key => key !== 'updatedAt') },
  })

  return { ok: true, task }
}

/** The task row, in the shape both writers return. */
async function readTask(drizzle: Drizzle, taskId: string): Promise<TaskRecord | null> {
  const [task] = await drizzle
    .select({
      id: schema.tasks.id,
      type: schema.tasks.type,
      orgId: schema.tasks.orgId,
      title: schema.tasks.title,
      description: schema.tasks.description,
      status: schema.tasks.status,
      priority: schema.tasks.priority,
      assigneeId: schema.tasks.assigneeId,
      assigneeType: schema.tasks.assigneeType,
      dueDate: schema.tasks.dueDate,
      estimatedHours: schema.tasks.estimatedHours,
      completedAt: schema.tasks.completedAt,
      requestId: schema.tasks.requestId,
      createdAt: schema.tasks.createdAt,
      updatedAt: schema.tasks.updatedAt,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1)

  return task ?? null
}

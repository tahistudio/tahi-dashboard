import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { createNotification } from '@/lib/notifications'
import { TASK_PRIORITIES } from '@/lib/task-priorities'
import { TASK_STATUSES } from '@/lib/status-config'
import { guardTask, loadTaskLinks, requestOrgId, resolveAssigneeType } from '@/lib/task-access'
import { resolveTeamMember } from '@/lib/team-identity'
import { requireAccessToOrg } from '@/lib/require-access'
import { isTaskLevel, type TaskLevel } from '@/lib/tasks-views'
import { coerceTaskLinks, setTaskLevel } from '@/lib/task-consistency'
import { sweepBlockers } from '@/lib/blockers-server'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/tasks/[id] ─────────────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardTask(drizzle, userId, id)
  if (denied) return denied

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
      completedAt: schema.tasks.completedAt,
      createdById: schema.tasks.createdById,
      tags: schema.tasks.tags,
      trackId: schema.tasks.trackId,
      position: schema.tasks.position,
      requestId: schema.tasks.requestId,
      scheduleRowId: schema.tasks.scheduleRowId,
      estimatedHours: schema.tasks.estimatedHours,
      createdAt: schema.tasks.createdAt,
      updatedAt: schema.tasks.updatedAt,
      orgName: schema.organisations.name,
    })
    .from(schema.tasks)
    .leftJoin(schema.organisations, eq(schema.tasks.orgId, schema.organisations.id))
    .where(eq(schema.tasks.id, id))
    .limit(1)

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json({ task })
}

// ── PATCH /api/admin/tasks/[id] ───────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await req.json() as {
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

  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardTask(drizzle, userId, id)
  if (denied) return denied

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.title !== undefined) {
    if (!body.title.trim()) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    }
    updates.title = body.title.trim()
  }
  if (body.description !== undefined) updates.description = body.description
  if (body.status !== undefined) {
    if (!TASK_STATUSES.some(s => s.value === body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
    // Reopening a task must take its completion stamp with it, or the list
    // keeps printing "Done 3 days ago" beside an open row.
    updates.completedAt = body.status === 'done' ? now : null
  }
  if (body.priority !== undefined) {
    if (!(TASK_PRIORITIES as readonly string[]).includes(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
    updates.priority = body.priority
  }
  if (body.assigneeId !== undefined) {
    updates.assigneeId = body.assigneeId
    if (body.assigneeType !== undefined) {
      updates.assigneeType = body.assigneeType
    } else if (!body.assigneeId) {
      // Clearing the assignee clears the type with it, or a stale type sits
      // behind a null id and misroutes the next assignment notification.
      updates.assigneeType = null
    } else {
      // The panel sends the id alone; the server settles which table it
      // names so the notification below reaches the right person.
      const kind = await resolveAssigneeType(drizzle, body.assigneeId)
      if (!kind) return NextResponse.json({ error: 'Unknown assignee' }, { status: 400 })
      updates.assigneeType = kind
    }
  }
  if (body.dueDate !== undefined) updates.dueDate = body.dueDate
  if (body.estimatedHours !== undefined) {
    const hours = body.estimatedHours
    if (hours !== null && (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0)) {
      return NextResponse.json({ error: 'Invalid estimate' }, { status: 400 })
    }
    updates.estimatedHours = hours
  }
  if (body.trackId !== undefined) updates.trackId = body.trackId
  if (body.position !== undefined) updates.position = body.position
  if (body.tags !== undefined) updates.tags = body.tags
  // '' and null both mean unlink (the MCP tool cannot send null).
  if (body.scheduleRowId !== undefined) updates.scheduleRowId = body.scheduleRowId || null

  if (body.type !== undefined && !isTaskLevel(body.type)) {
    return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
  }

  // The level, the client and the request are one state, not three fields.
  // Writing them independently is how an impossible task gets stored: the
  // detail panel's Client row answers { level: 'internal_client_task', orgId }
  // for a Tahi task, and a route that wrote only the orgId kept the old level
  // beside the new client, which renders as a Tahi chip next to a client name.
  // So any PATCH that touches one of the three resolves all three through the
  // same invariants POST uses, and writes all three.
  const touchesLinks = body.type !== undefined
    || body.orgId !== undefined
    || body.requestId !== undefined

  if (touchesLinks) {
    const current = await loadTaskLinks(drizzle, id)
    if (!current) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const currentLevel: TaskLevel = isTaskLevel(current.type)
      ? current.type
      : (current.orgId ? 'client_task' : 'tahi_internal')
    const requestedLevel = isTaskLevel(body.type) ? body.type : null

    let nextOrgId = body.orgId !== undefined ? body.orgId : current.orgId
    let nextRequestId = body.requestId !== undefined ? body.requestId : current.requestId

    // Clearing the client clears the request with it, because a request the
    // task no longer shares a client with is not a link (setTaskClient again).
    // A request named in the same call is the caller restating the pair, and
    // wins.
    if (body.orgId !== undefined && !body.orgId && body.requestId === undefined) {
      nextRequestId = null
    }

    // The linked request's own client settles the pair. Linking adopts that
    // client (setTaskRequest); a client stated in the same call wins over it
    // instead, and a request belonging to somebody else cannot survive that
    // move (setTaskClient). Only looked up when the pair actually moved: a
    // stored pair was already consistent. An explicit tahi_internal drops
    // both links below, so it never reaches the lookup.
    if (nextRequestId && requestedLevel !== 'tahi_internal'
      && (nextRequestId !== current.requestId || nextOrgId !== current.orgId)) {
      const linkedOrgId = await requestOrgId(drizzle, nextRequestId)
      if (!linkedOrgId) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 })
      }
      if (body.orgId !== undefined && nextOrgId && nextOrgId !== linkedOrgId) {
        nextRequestId = null
      } else {
        nextOrgId = linkedOrgId
      }
    }

    // A level the caller stated and could not have meant is an error rather
    // than something to repair behind their back, which is the same answer
    // POST gives. A level the caller did not state is still coerced below.
    if (requestedLevel && requestedLevel !== 'tahi_internal' && !nextOrgId) {
      return NextResponse.json({ error: 'Client is required for a client task' }, { status: 400 })
    }

    const links = coerceTaskLinks(setTaskLevel(
      { level: currentLevel, orgId: nextOrgId, requestId: nextRequestId },
      requestedLevel ?? currentLevel,
    ))

    // Rule 11 on the NEW client. guardTask above only checked the client the
    // task sits in today, so without this a member scoped to one client could
    // move a task into a client they cannot see.
    if (links.orgId && links.orgId !== current.orgId) {
      const deniedTarget = await requireAccessToOrg(drizzle, userId, links.orgId)
      if (deniedTarget) return deniedTarget
    }

    updates.type = links.level
    updates.orgId = links.orgId
    updates.requestId = links.requestId
  }

  await drizzle
    .update(schema.tasks)
    .set(updates)
    .where(eq(schema.tasks.id, id))

  // Notify the assignee when a task is handed to them. Two doors, one rule:
  // POST /api/admin/tasks answers exactly the same way.
  //
  // Team members only, never a contact. Tasks are not a client surface (the
  // portal has no task page, and lib/notification-links clientHref returns
  // null for 'task'), so a contact addressed here would be handed a
  // Tahi-internal task TITLE in their bell on a row that cannot be clicked.
  // The task still holds the contact and still stores the kind; nobody
  // outside the studio is told about it.
  //
  // And never the caller: taking a task on yourself is not news. `me` is read
  // only when it can change the answer, and only for a team assignee.
  if (body.assigneeId && updates.assigneeType !== 'contact') {
    const me = await resolveTeamMember(drizzle, userId)
    if (me?.id !== body.assigneeId) {
      const [task] = await drizzle
        .select({ title: schema.tasks.title })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, id))
        .limit(1)

      // assigneeId is a teamMembers.id; the typed recipient resolves it to the
      // Clerk user id the bell queries.
      await createNotification(drizzle, {
        recipient: { teamMemberId: body.assigneeId },
        type: 'task_assigned',
        title: `Task assigned to you: "${task?.title ?? 'Untitled'}"`,
        body: null,
        entityType: 'task',
        entityId: id,
      })
    }
  }

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/tasks/[id] ──────────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardTask(drizzle, userId, id)
  if (denied) return denied

  // No foreign keys on a polymorphic edge, so nothing cascades. This is the
  // only hard delete in the codebase; requests archive instead, and archived is
  // already a closed status. Both directions, or the far end keeps a count
  // nothing on the page can explain.
  await sweepBlockers(drizzle, { type: 'task', id })

  // Checklist items still cascade via their FK onDelete rule. Blocker links no
  // longer do, which is what the sweep above is for.
  await drizzle.delete(schema.tasks).where(eq(schema.tasks.id, id))

  return NextResponse.json({ success: true })
}

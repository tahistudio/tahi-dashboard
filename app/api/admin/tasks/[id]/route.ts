import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { createNotification } from '@/lib/notifications'
import { requireAccessToOrg } from '@/lib/require-access'
import { TASK_PRIORITIES } from '@/lib/task-priorities'
import { TASK_STATUSES } from '@/lib/status-config'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * A task with a client is guarded by that client. A task with no client is
 * the studio's own housekeeping, and every team member on this surface is in
 * the studio, so it is allowed. The list route applies exactly the same rule
 * (see the isNull clause in ../route.ts); before the port the two disagreed
 * about how they hid the same rows, one by filtering and one by 403ing.
 *
 * Returns a NextResponse to short circuit on denial, or null to proceed.
 */
async function guardTaskAccess(
  drizzle: Drizzle,
  userId: string | null,
  taskOrgId: string | null,
): Promise<NextResponse | null> {
  if (!taskOrgId) return null
  return requireAccessToOrg(drizzle, userId, taskOrgId)
}

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

  const denied = await guardTaskAccess(drizzle, userId, task.orgId)
  if (denied) return denied

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
    tags?: string
    scheduleRowId?: string | null
  }

  const database = await db()
  const drizzle = database as Drizzle

  // Verify task exists + scope check
  const [existing] = await drizzle
    .select({ id: schema.tasks.id, orgId: schema.tasks.orgId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const denied = await guardTaskAccess(drizzle, userId, existing.orgId)
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
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId
  if (body.assigneeType !== undefined) updates.assigneeType = body.assigneeType
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
  if (body.requestId !== undefined) updates.requestId = body.requestId
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.tags !== undefined) updates.tags = body.tags
  // '' and null both mean unlink (the MCP tool cannot send null).
  if (body.scheduleRowId !== undefined) updates.scheduleRowId = body.scheduleRowId || null

  await drizzle
    .update(schema.tasks)
    .set(updates)
    .where(eq(schema.tasks.id, id))

  // Notify assignee when a task is assigned to them
  if (body.assigneeId !== undefined && body.assigneeId) {
    const [task] = await drizzle
      .select({ title: schema.tasks.title })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id))
      .limit(1)

    // assigneeId is a teamMembers.id or contacts.id; the typed recipient
    // resolves it to the Clerk user id the bell queries.
    await createNotification(drizzle, {
      recipient: body.assigneeType === 'contact'
        ? { contactId: body.assigneeId }
        : { teamMemberId: body.assigneeId },
      type: 'task_assigned',
      title: `Task assigned to you: "${task?.title ?? 'Untitled'}"`,
      body: null,
      entityType: 'task',
      entityId: id,
    })
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

  const [existing] = await drizzle
    .select({ id: schema.tasks.id, orgId: schema.tasks.orgId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const denied = await guardTaskAccess(drizzle, userId, existing.orgId)
  if (denied) return denied

  // Subtasks and dependency rows cascade via their FK onDelete rules.
  await drizzle.delete(schema.tasks).where(eq(schema.tasks.id, id))

  return NextResponse.json({ success: true })
}

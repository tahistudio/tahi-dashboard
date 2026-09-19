import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { guardTask } from '@/lib/task-access'
import { sweepBlockers } from '@/lib/blockers-server'
import { updateTaskRecord, type TaskPatchInput } from '@/lib/task-writes'

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
//
// `guardTask` first, on the task as it stands: that is this route's own job,
// because it is the only caller who has a signed-in human to scope. The write
// itself lives in lib/task-writes.ts#updateTaskRecord, which applying an
// approved call suggestion calls too, so a change made from the detail panel
// and a change made from a call go through one set of rules.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await req.json() as TaskPatchInput

  const database = await db()
  const drizzle = database as Drizzle

  const denied = await guardTask(drizzle, userId, id)
  if (denied) return denied

  const result = await updateTaskRecord(drizzle, id, body, { actorType: 'team_member', actorId: userId })
  if (!result.ok) {
    return NextResponse.json({ error: result.failure.error }, { status: result.failure.status })
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

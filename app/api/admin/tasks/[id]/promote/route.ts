import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'
import { guardTask } from '@/lib/task-access'
import { emitRequestCreated } from '@/lib/request-status-effects'

/**
 * POST /api/admin/tasks/[id]/promote
 *
 * Turn a task into client-facing work. The new request carries the task's
 * title, note, priority, assignee and due date; the task keeps living where
 * it is, now linked, so the studio's own follow-ups stay off the client's
 * thread.
 *
 * Category and size come from the caller rather than being guessed. The
 * prototype hardcoded design / small, which would have been wrong for most
 * of the work that actually gets promoted.
 *
 * The insert mirrors POST /api/admin/requests exactly, and for the same
 * reasons: the request number is assigned atomically inside the INSERT
 * (scoped per org, so each client sees a private 1, 2, 3 and never learns the
 * studio's total volume), both `type` and `size` are written because `type` is
 * the legacy column the row still carries and `size` is the one the list and
 * the board filter on, and emitRequestCreated fires so automations and
 * outgoing webhooks see a promoted request the same as any other. A raw
 * drizzle .insert() here would silently skip all four.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { category?: string; size?: string }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const denied = await guardTask(drizzle, userId, id)
  if (denied) return denied

  const [task] = await drizzle.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1)
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  if (!task.orgId) {
    return NextResponse.json({ error: 'A task with no client cannot become a request' }, { status: 400 })
  }
  if (task.requestId) {
    return NextResponse.json({ error: 'This task is already linked to a request' }, { status: 409 })
  }

  const category = body.category ?? 'design'
  // `size` is the modern column ('small' | 'large'); `type` is the legacy one
  // the row still carries ('small_task' | 'large_task'). Both get written.
  const size = body.size === 'large_task' || body.size === 'large' ? 'large' : 'small'
  const legacyType = size === 'large' ? 'large_task' : 'small_task'
  // A request's priority vocabulary is standard | high. A task may be urgent,
  // which has no request peer, so it lands as high rather than writing a value
  // the requests surface cannot render or PATCH.
  const priority = task.priority === 'standard' ? 'standard' : 'high'

  const requestId = crypto.randomUUID()
  const now = new Date().toISOString()

  await drizzle.run(sql`
    INSERT INTO requests (
      id, org_id, title, type, size, category, description, status, priority,
      assignee_id, due_date, submitted_by_id, submitted_by_type, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${requestId},
      ${task.orgId},
      ${task.title},
      ${legacyType},
      ${size},
      ${category},
      ${task.description ?? null},
      'submitted',
      ${priority},
      ${task.assigneeId ?? null},
      ${task.dueDate ?? null},
      ${userId ?? null},
      'team_member',
      0,
      0,
      3,
      COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ${task.orgId}), 0) + 1,
      ${now},
      ${now}
    )
  `)

  // The task becomes Client level: it now has a client-facing peer, which is
  // exactly what that level means.
  await drizzle
    .update(schema.tasks)
    .set({ requestId, type: 'client_task', updatedAt: now })
    .where(eq(schema.tasks.id, id))

  await emitRequestCreated(drizzle, {
    id: requestId,
    orgId: task.orgId,
    title: task.title,
    type: legacyType,
    category,
    priority,
    status: 'submitted',
    isInternal: false,
    source: 'admin',
  })

  return NextResponse.json({ requestId }, { status: 201 })
}

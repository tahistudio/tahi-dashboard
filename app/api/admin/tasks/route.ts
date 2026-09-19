import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray, isNull, or, sql, asc } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { openBlockerCounts } from '@/lib/blockers-server'
import { createTaskRecord, type TaskCreateInput } from '@/lib/task-writes'

// ── GET /api/admin/tasks ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const type = url.searchParams.get('type')
  const clientId = url.searchParams.get('orgId')
  const trackId = url.searchParams.get('trackId')
  const requestId = url.searchParams.get('requestId')
  const assignee = url.searchParams.get('assignee') // 'me' | a team member id
  const sortBy = url.searchParams.get('sortBy') // 'position' | 'updatedAt' (default)

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Resolve assignee=me to the signed-in team member (teamMembers.clerkUserId).
  // A pure admin with no team_members row has no assigned tasks -> honest empty.
  let assigneeId: string | null = null
  if (assignee) {
    if (assignee === 'me') {
      const [me] = await drizzle
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.clerkUserId, userId ?? ''))
        .limit(1)
      if (!me) return NextResponse.json({ tasks: [] })
      assigneeId = me.id
    } else {
      assigneeId = assignee
    }
  }

  // Apply team member access scoping
  const scopedOrgIds = await resolveAccessScoping(drizzle, userId)

  const conditions = []

  if (assigneeId) {
    conditions.push(eq(schema.tasks.assigneeId, assigneeId))
  }

  // If scoping returned a specific set of org IDs, filter to those. Tasks
  // with no client are the STUDIO'S OWN list, so a scoped member sees them
  // too: SQL `IN` never matches NULL, and without the explicit isNull the
  // whole Tahi-internal half of this surface silently vanished for anyone
  // who is not a super admin.
  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      conditions.push(isNull(schema.tasks.orgId))
    } else {
      conditions.push(or(inArray(schema.tasks.orgId, scopedOrgIds), isNull(schema.tasks.orgId))!)
    }
  }

  if (status && status !== 'all') {
    conditions.push(eq(schema.tasks.status, status))
  }
  if (type && type !== 'all') {
    conditions.push(eq(schema.tasks.type, type))
  }
  if (clientId) {
    conditions.push(eq(schema.tasks.orgId, clientId))
  }
  if (trackId) {
    conditions.push(eq(schema.tasks.trackId, trackId))
  }
  if (requestId) {
    conditions.push(eq(schema.tasks.requestId, requestId))
  }

  const orderClause = sortBy === 'position'
    ? asc(schema.tasks.position)
    : desc(schema.tasks.updatedAt)

  const tasks = await drizzle
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
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderClause)

  // Gather task IDs to batch-load subtask progress and blockers
  const taskIds = tasks.map(t => t.id)

  const subtaskCounts: Record<string, number> = {}
  const subtaskDoneCounts: Record<string, number> = {}
  let blockedByCounts: Record<string, number> = {}

  if (taskIds.length > 0) {
    // Subtask progress: total count AND completed count in one grouped pass, so
    // rows can render "2/5" instead of a permanently-0 progress bar.
    //
    // Chunked, because the query above carries no limit: one id is one bound
    // parameter and D1 caps a statement at 100, so a hundred-and-first task
    // used to 500 the whole page. Same chunk size openBlockerCounts uses below.
    const SUBTASK_ID_CHUNK = 90
    for (let i = 0; i < taskIds.length; i += SUBTASK_ID_CHUNK) {
      const subtaskRows = await drizzle
        .select({
          taskId: schema.taskSubtasks.taskId,
          count: sql<number>`count(*)`.as('count'),
          done: sql<number>`sum(case when ${schema.taskSubtasks.completed} = 1 then 1 else 0 end)`.as('done'),
        })
        .from(schema.taskSubtasks)
        .where(inArray(schema.taskSubtasks.taskId, taskIds.slice(i, i + SUBTASK_ID_CHUNK)))
        .groupBy(schema.taskSubtasks.taskId)

      for (const row of subtaskRows) {
        subtaskCounts[row.taskId] = Number(row.count) || 0
        subtaskDoneCounts[row.taskId] = Number(row.done) || 0
      }
    }

    // Open blockers, which since 0088 can be a task OR a request. The closed
    // vocabulary differs per type ('done' against 'delivered' / 'cancelled' /
    // 'archived'), so neither list goes into SQL: openBlockerCounts answers
    // both from lib/blockers.ts, which is the same answer the detail card and
    // the requests list get. The old inline `dependsOnStatus !== 'done'`
    // literal here is exactly what had drifted.
    blockedByCounts = await openBlockerCounts(drizzle, 'task', taskIds)
  }

  const enrichedTasks = tasks.map(t => ({
    ...t,
    subtaskCount: subtaskCounts[t.id] ?? 0,
    subtaskDone: subtaskDoneCounts[t.id] ?? 0,
    blockedByCount: blockedByCounts[t.id] ?? 0,
  }))

  return NextResponse.json({ tasks: enrichedTasks })
}

// ── POST /api/admin/tasks ──────────────────────────────────────────────────
//
// The rules themselves live in lib/task-writes.ts#createTaskRecord: the
// validation, the link invariants, Rule 11 on the client the task is filed
// under, the insert, the subtasks, the task_assigned notification and the
// audit entry. Applying an approved call suggestion calls the same function,
// so the dashboard and the automation write a task the same way rather than
// nearly the same way.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as TaskCreateInput

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const result = await createTaskRecord(drizzle, body, { actorType: 'team_member', actorId: userId })
  if (!result.ok) {
    return NextResponse.json({ error: result.failure.error }, { status: result.failure.status })
  }

  return NextResponse.json({ id: result.task.id }, { status: 201 })
}

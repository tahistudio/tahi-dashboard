import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray, isNull, or, sql, asc } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { isTaskPriority } from '@/lib/task-priorities'
import { TASK_STATUSES } from '@/lib/status-config'
import { isTaskLevel, type TaskLevel } from '@/lib/tasks-views'
import { coerceTaskLinks, setTaskLevel } from '@/lib/task-consistency'
import { requestOrgId, resolveAssigneeType } from '@/lib/task-access'
import { requireAccessToOrg } from '@/lib/require-access'
import { openBlockerCounts } from '@/lib/blockers-server'
import { createNotification } from '@/lib/notifications'
import { resolveTeamMember } from '@/lib/team-identity'

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
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
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
  }

  const title = body.title?.trim()
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  // The three-level model is live again. Decision #046 collapsed the UI to a
  // binary; the Tasks port brings back Client / Internal / Tahi as the chips
  // the studio actually thinks in, so the route stops flattening the middle
  // value. `orgId` presence is still what decides when the caller says
  // nothing.
  const requestedLevel = isTaskLevel(body.type) ? body.type : null

  // Normalise before validating: a form with nothing selected posts
  // `priority: null`, which the insert below already reads as standard, so
  // 400ing on it answered "Invalid priority" for a field left blank.
  const priority = body.priority ?? 'standard'
  if (!isTaskPriority(priority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  }

  const status = body.status ?? 'todo'
  if (!TASK_STATUSES.some(s => s.value === status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // A caller that names a request but no client is naming the client too:
  // linking adopts the request's client (setTaskRequest). Without this the
  // level derived to tahi_internal and coerceTaskLinks then dropped the very
  // request the caller asked for, silently, with a 201. An explicit
  // tahi_internal still means "no links", so it never reaches the lookup.
  let clientOrgId = body.orgId ?? null
  if (!clientOrgId && body.requestId && requestedLevel !== 'tahi_internal') {
    clientOrgId = await requestOrgId(drizzle, body.requestId)
    if (!clientOrgId) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
  }

  const level: TaskLevel = requestedLevel ?? (clientOrgId ? 'client_task' : 'tahi_internal')

  if (level !== 'tahi_internal' && !clientOrgId) {
    return NextResponse.json({ error: 'Client is required for a client task' }, { status: 400 })
  }

  // The one place a task is built from parts rather than edited, so the link
  // invariants are enforced here rather than trusted from the caller.
  //
  // setTaskLevel runs first because an explicit tahi_internal MEANS "drop the
  // links", which coerceTaskLinks on its own would read the other way round
  // (as a level to repair upwards). Starting from client_task makes the call a
  // no-op whenever that is the level asked for.
  const links = coerceTaskLinks(setTaskLevel(
    { level: 'client_task', orgId: clientOrgId, requestId: body.requestId ?? null },
    level,
  ))

  // Rule 11 on the client the task is being filed under, which the caller
  // chose. from-template guards its own orgId the same way; without this the
  // create door was the one that did not.
  if (links.orgId) {
    const denied = await requireAccessToOrg(drizzle, userId, links.orgId)
    if (denied) return denied
  }

  // Who the assignee IS, settled once, before the write.
  //
  // Before the write for two reasons. The column: PATCH persists what it
  // resolves, this door stored `body.assigneeType ?? null` and the dialog
  // never sends the type, so every task created assigned carried an id with
  // no kind and /api/admin/overview/me had to OR isNull into its filter.
  // And the answer: reading it after the insert meant a D1 failure here
  // answered 500 for a request whose task row already existed, so the
  // operator re-submitted the dialog and got a duplicate. Failing here costs
  // a 500 on a request that wrote nothing, which is safe to retry.
  //
  // `me` is the team member the caller IS, read before the write for the same
  // reason and only when it can change the answer: the assignee id names a
  // teamMembers row while the caller is a Clerk user, so the self-check below
  // compares through it.
  const assigneeId = body.assigneeId ?? null
  const statedType = body.assigneeType === 'contact' || body.assigneeType === 'team_member'
    ? body.assigneeType
    : null
  const assigneeType = assigneeId
    ? statedType ?? await resolveAssigneeType(drizzle, assigneeId)
    : null
  const me = assigneeType === 'team_member' ? await resolveTeamMember(drizzle, userId) : null

  const id = crypto.randomUUID()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  await drizzle.insert(schema.tasks).values({
    id,
    type: links.level,
    orgId: links.orgId,
    title,
    description: body.description ?? null,
    status,
    priority,
    assigneeId,
    assigneeType,
    dueDate: body.dueDate ?? null,
    estimatedHours: body.estimatedHours ?? null,
    completedAt: status === 'done' ? now : null,
    createdById: userId,
    tags: '[]',
    trackId: body.trackId ?? null,
    position: body.position ?? null,
    requestId: links.requestId,
    scheduleRowId: body.scheduleRowId || null,
    createdAt: now,
    updatedAt: now,
  })

  // The new-task dialog and the template picker both hand over titles here.
  // Before the port this key was accepted on the wire and dropped on the
  // floor, so a checklist typed at creation vanished without a word.
  const subtaskTitles = Array.isArray(body.subtasks)
    ? body.subtasks.map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean)
    : []

  for (const subtaskTitle of subtaskTitles) {
    await drizzle.insert(schema.taskSubtasks).values({
      id: crypto.randomUUID(),
      taskId: id,
      title: subtaskTitle,
      completed: false,
      createdAt: now,
    })
  }

  // A task created already assigned IS an assignment, and PATCH has always
  // told the person carrying it. This door never did, so the quickest way to
  // hand somebody work (the new-task dialog, the dashboard template picker
  // which prefills that dialog, the AI wizard, the MCP create_task tool) was
  // also the only way they were never told: the task simply appeared on the
  // board and waited to be noticed.
  //
  // Not every create door, though: POST /api/admin/tasks/from-template writes
  // its own row and is reachable on its own through the MCP
  // create_task_from_template tool, so that one still assigns in silence.
  //
  // Team members only, never a contact. Tasks are not a client surface
  // (DECISIONS.md, and lib/notification-links clientHref returns null for
  // 'task'), so a contact addressed here would be handed a Tahi-internal task
  // TITLE in their bell, on a row that cannot be clicked because there is no
  // client page to open. The tasks board assigns team members, but the MCP
  // create_task tool forwards `assigneeId` unvalidated, so an id lifted from
  // a contacts list would otherwise put internal work in a client's bell.
  // A contact assignee therefore still stores its type and still holds the
  // task; nobody outside the studio is told about it.
  //
  // Assigning yourself something is not news, so the creator is never
  // notified. KNOWN GAP, accepted rather than half-closed: a worker MCP call
  // authenticates as the service user, which by design IS nobody's team
  // member (lib/team-identity SERVICE_USER_ID), so `me` is null and "create
  // a task for me" through create_task still writes the asker a row. Closing
  // it needs the MCP to forward the acting team member id, which is a change
  // in workers/mcp-server, not here.
  if (assigneeId && assigneeType === 'team_member' && me?.id !== assigneeId) {
    await createNotification(drizzle, {
      recipient: { teamMemberId: assigneeId },
      type: 'task_assigned',
      title: `Task assigned to you: "${title}"`,
      body: null,
      entityType: 'task',
      entityId: id,
    })
  }

  return NextResponse.json({ id }, { status: 201 })
}

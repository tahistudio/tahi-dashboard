import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray, sql, asc } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'

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
  const sortBy = url.searchParams.get('sortBy') // 'position' | 'updatedAt' (default)

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Apply team member access scoping
  const scopedOrgIds = await resolveAccessScoping(drizzle, userId)

  const conditions = []

  // If scoping returned a specific set of org IDs, filter to those
  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      return NextResponse.json({ tasks: [] })
    }
    conditions.push(inArray(schema.tasks.orgId, scopedOrgIds))
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
      createdAt: schema.tasks.createdAt,
      updatedAt: schema.tasks.updatedAt,
      orgName: schema.organisations.name,
    })
    .from(schema.tasks)
    .leftJoin(schema.organisations, eq(schema.tasks.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(orderClause)

  // Gather task IDs to batch-load subtask counts and dependencies
  const taskIds = tasks.map(t => t.id)

  const subtaskCounts: Record<string, number> = {}
  const dependenciesByTask: Record<string, Array<{ id: string; dependsOnTaskId: string }>> = {}

  if (taskIds.length > 0) {
    // Subtask counts
    const subtaskRows = await drizzle
      .select({
        taskId: schema.taskSubtasks.taskId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.taskSubtasks)
      .where(inArray(schema.taskSubtasks.taskId, taskIds))
      .groupBy(schema.taskSubtasks.taskId)

    for (const row of subtaskRows) {
      subtaskCounts[row.taskId] = row.count
    }

    // Dependencies
    const depRows = await drizzle
      .select({
        id: schema.taskDependencies.id,
        taskId: schema.taskDependencies.taskId,
        dependsOnTaskId: schema.taskDependencies.dependsOnTaskId,
      })
      .from(schema.taskDependencies)
      .where(inArray(schema.taskDependencies.taskId, taskIds))

    for (const dep of depRows) {
      if (!dependenciesByTask[dep.taskId]) {
        dependenciesByTask[dep.taskId] = []
      }
      dependenciesByTask[dep.taskId].push({
        id: dep.id,
        dependsOnTaskId: dep.dependsOnTaskId,
      })
    }
  }

  const enrichedTasks = tasks.map(t => ({
    ...t,
    subtaskCount: subtaskCounts[t.id] ?? 0,
    dependencies: dependenciesByTask[t.id] ?? [],
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
    trackId?: string | null
    position?: number | null
    requestId?: string | null
  }

  const { title, description, priority, assigneeId, assigneeType, dueDate } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  // Decision #046: tasks are always Tahi-internal; the only distinction
  // is whether the work is for a client. Source of truth is `orgId` presence.
  // Legacy `type` is still accepted from callers (MCP, old clients) but
  // auto-derived when omitted. Both legacy client-flavoured types collapse
  // to the single `client_task` value now.
  const resolvedType: string = body.orgId
    ? 'client_task'
    : (body.type === 'client_task' || body.type === 'internal_client_task' ? 'client_task' : 'tahi_internal')

  // If the caller chose a client-flavoured type but didn't supply orgId,
  // that's still an error \u2014 we need to know which client.
  if (resolvedType === 'client_task' && !body.orgId) {
    return NextResponse.json({ error: 'Client is required for a client task' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const id = crypto.randomUUID()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  await drizzle.insert(schema.tasks).values({
    id,
    type: resolvedType,
    orgId: resolvedType === 'tahi_internal' ? null : (body.orgId ?? null),
    title: title.trim(),
    description: description ?? null,
    status: 'todo',
    priority: priority ?? 'standard',
    assigneeId: assigneeId ?? null,
    assigneeType: assigneeType ?? null,
    dueDate: dueDate ?? null,
    createdById: userId,
    tags: '[]',
    trackId: body.trackId ?? null,
    position: body.position ?? null,
    requestId: body.requestId ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

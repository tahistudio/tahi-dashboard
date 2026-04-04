import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

// ── GET /api/admin/tasks/[id]/dependencies ─────────────────────────────────
// Returns both "blocks" (tasks this task blocks) and "blockedBy" (tasks blocking this one)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify task exists
  const [task] = await drizzle
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1)

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  // "blockedBy": tasks that this task depends on (this task is blocked by them)
  const blockedByRows = await drizzle
    .select({
      depId: schema.taskDependencies.id,
      taskId: schema.taskDependencies.dependsOnTaskId,
      taskTitle: schema.tasks.title,
      taskStatus: schema.tasks.status,
      createdAt: schema.taskDependencies.createdAt,
    })
    .from(schema.taskDependencies)
    .leftJoin(schema.tasks, eq(schema.taskDependencies.dependsOnTaskId, schema.tasks.id))
    .where(eq(schema.taskDependencies.taskId, taskId))

  // "blocks": tasks that depend on this task (this task blocks them)
  const blocksRows = await drizzle
    .select({
      depId: schema.taskDependencies.id,
      taskId: schema.taskDependencies.taskId,
      taskTitle: schema.tasks.title,
      taskStatus: schema.tasks.status,
      createdAt: schema.taskDependencies.createdAt,
    })
    .from(schema.taskDependencies)
    .leftJoin(schema.tasks, eq(schema.taskDependencies.taskId, schema.tasks.id))
    .where(eq(schema.taskDependencies.dependsOnTaskId, taskId))

  return NextResponse.json({
    blockedBy: blockedByRows,
    blocks: blocksRows,
  })
}

// ── POST /api/admin/tasks/[id]/dependencies ────────────────────────────────
// Add a dependency: this task depends on another task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId } = await params

  const body = await req.json() as { dependsOnTaskId?: string }
  const { dependsOnTaskId } = body

  if (!dependsOnTaskId?.trim()) {
    return NextResponse.json({ error: 'dependsOnTaskId is required' }, { status: 400 })
  }

  if (dependsOnTaskId === taskId) {
    return NextResponse.json({ error: 'A task cannot depend on itself' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Validate both tasks exist
  const [task] = await drizzle
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1)

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  const [dependsOnTask] = await drizzle
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, dependsOnTaskId))
    .limit(1)

  if (!dependsOnTask) {
    return NextResponse.json({ error: 'Dependency task not found' }, { status: 404 })
  }

  // Check for duplicate dependency
  const [existing] = await drizzle
    .select({ id: schema.taskDependencies.id })
    .from(schema.taskDependencies)
    .where(
      and(
        eq(schema.taskDependencies.taskId, taskId),
        eq(schema.taskDependencies.dependsOnTaskId, dependsOnTaskId)
      )
    )
    .limit(1)

  if (existing) {
    return NextResponse.json({ error: 'Dependency already exists' }, { status: 409 })
  }

  // Check for circular dependency: if dependsOnTaskId already depends on taskId
  // (directly or transitively), adding this would create a cycle
  const hasCycle = await detectCycle(drizzle, dependsOnTaskId, taskId)
  if (hasCycle) {
    return NextResponse.json(
      { error: 'Adding this dependency would create a circular dependency' },
      { status: 400 }
    )
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  await drizzle.insert(schema.taskDependencies).values({
    id,
    taskId,
    dependsOnTaskId,
    createdAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

/**
 * Detect if adding a dependency from `fromTaskId` -> (depends on) `toTaskId`
 * would create a cycle. We check if `toTaskId` can already reach `fromTaskId`
 * through existing dependency chains (BFS).
 */
async function detectCycle(
  drizzle: ReturnType<typeof import('drizzle-orm/d1').drizzle>,
  startTaskId: string,
  targetTaskId: string
): Promise<boolean> {
  const visited = new Set<string>()
  const queue = [startTaskId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === targetTaskId) return true
    if (visited.has(current)) continue
    visited.add(current)

    // Find all tasks that `current` depends on
    const deps = await drizzle
      .select({ dependsOnTaskId: schema.taskDependencies.dependsOnTaskId })
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, current))

    for (const dep of deps) {
      if (!visited.has(dep.dependsOnTaskId)) {
        queue.push(dep.dependsOnTaskId)
      }
    }
  }

  return false
}

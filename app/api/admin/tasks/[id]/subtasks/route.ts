import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'
import { guardTask } from '@/lib/task-access'

// ── GET /api/admin/tasks/[id]/subtasks ────────────────────────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId } = await params

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const denied = await guardTask(drizzle, userId, taskId)
  if (denied) return denied

  // Key is `subtasks` (not `items`): every client reader expects
  // `data.subtasks`. Returning `items` silently produced an always-empty list.
  const subtasks = await drizzle
    .select({
      id: schema.taskSubtasks.id,
      taskId: schema.taskSubtasks.taskId,
      title: schema.taskSubtasks.title,
      completed: schema.taskSubtasks.completed,
      createdAt: schema.taskSubtasks.createdAt,
    })
    .from(schema.taskSubtasks)
    .where(eq(schema.taskSubtasks.taskId, taskId))
    .orderBy(asc(schema.taskSubtasks.createdAt))

  return NextResponse.json({ subtasks })
}

// ── POST /api/admin/tasks/[id]/subtasks ───────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId } = await params

  const body = await req.json() as { title?: string }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const denied = await guardTask(drizzle, userId, taskId)
  if (denied) return denied

  const id = crypto.randomUUID()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  await drizzle.insert(schema.taskSubtasks).values({
    id,
    taskId,
    title: body.title.trim(),
    completed: false,
    createdAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// ── PATCH /api/admin/tasks/[id] ───────────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
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
    trackId?: string | null
    position?: number | null
    requestId?: string | null
    orgId?: string | null
    tags?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify task exists
  const [existing] = await drizzle
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

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
    const validStatuses = ['todo', 'in_progress', 'blocked', 'done']
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
    if (body.status === 'done') {
      updates.completedAt = now
    }
  }
  if (body.priority !== undefined) {
    const validPriorities = ['standard', 'high', 'urgent']
    if (!validPriorities.includes(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
    updates.priority = body.priority
  }
  if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId
  if (body.assigneeType !== undefined) updates.assigneeType = body.assigneeType
  if (body.dueDate !== undefined) updates.dueDate = body.dueDate
  if (body.trackId !== undefined) updates.trackId = body.trackId
  if (body.position !== undefined) updates.position = body.position
  if (body.requestId !== undefined) updates.requestId = body.requestId
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.tags !== undefined) updates.tags = body.tags

  await drizzle
    .update(schema.tasks)
    .set(updates)
    .where(eq(schema.tasks.id, id))

  return NextResponse.json({ success: true })
}

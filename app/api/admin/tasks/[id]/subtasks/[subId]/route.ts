import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

// ── PATCH /api/admin/tasks/[id]/subtasks/[subId] ──────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; subId: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: taskId, subId } = await params

  const body = await req.json() as { isCompleted?: boolean }

  if (typeof body.isCompleted !== 'boolean') {
    return NextResponse.json({ error: 'isCompleted (boolean) is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify subtask exists and belongs to this task
  const [existing] = await drizzle
    .select({ id: schema.taskSubtasks.id })
    .from(schema.taskSubtasks)
    .where(
      and(
        eq(schema.taskSubtasks.id, subId),
        eq(schema.taskSubtasks.taskId, taskId)
      )
    )
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Subtask not found' }, { status: 404 })
  }

  await drizzle
    .update(schema.taskSubtasks)
    .set({ completed: body.isCompleted })
    .where(eq(schema.taskSubtasks.id, subId))

  return NextResponse.json({ success: true })
}

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// ── POST /api/admin/schedules/[id]/rows/reorder ────────────────────────
// Bulk-set the position of multiple rows. Body: { order: string[] } where
// each entry is a row id and the array position is the new `position` value.
// Used by drag-and-drop reordering in the editor.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId } = await ctx.params
  const body = await req.json() as { order?: string[] }

  if (!Array.isArray(body.order)) {
    return NextResponse.json({ error: 'order must be an array of row IDs' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // Apply each new position. We scope by scheduleId so a malicious caller
  // can't move rows belonging to a different schedule.
  for (let i = 0; i < body.order.length; i++) {
    const rowId = body.order[i]
    if (typeof rowId !== 'string') continue
    await database
      .update(schema.scheduleRows)
      .set({ position: i, updatedAt: now })
      .where(and(eq(schema.scheduleRows.id, rowId), eq(schema.scheduleRows.scheduleId, scheduleId)))
  }

  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: now })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ success: true })
}

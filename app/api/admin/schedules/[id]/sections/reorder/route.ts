import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// ── POST /api/admin/schedules/[id]/sections/reorder ─────────────────────
// Body: { order: string[] } — section IDs in the new display order. Scoped
// by scheduleId so cross-schedule moves are rejected.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId } = await ctx.params
  const body = await req.json() as { order?: string[] }
  if (!Array.isArray(body.order)) {
    return NextResponse.json({ error: 'order must be an array of section IDs' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  for (let i = 0; i < body.order.length; i++) {
    const sectionId = body.order[i]
    if (typeof sectionId !== 'string') continue
    await database
      .update(schema.scheduleSections)
      .set({ position: i, updatedAt: now })
      .where(and(
        eq(schema.scheduleSections.id, sectionId),
        eq(schema.scheduleSections.scheduleId, scheduleId),
      ))
  }

  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: now })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ success: true })
}

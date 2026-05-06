import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// ── POST /api/admin/schedules/[id]/rows ────────────────────────────────
// Append a new row to the schedule. Defaults to last position + 1.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId } = await ctx.params
  const body = await req.json() as {
    rowType: 'section_header' | 'task' | 'gate' | 'critical_gate'
    label?: string
    owner?: 'tahi' | 'client' | 'joint' | 'tahi_parallel' | null
    startWeek?: number | null
    endWeek?: number | null
    riskFlag?: boolean
    position?: number
  }

  if (!body.rowType) return NextResponse.json({ error: 'rowType is required' }, { status: 400 })
  if (!body.label?.trim()) return NextResponse.json({ error: 'label is required' }, { status: 400 })

  const database = await db() as unknown as D1

  // If no position supplied, append to the end.
  let position = body.position
  if (position == null) {
    const [maxRow] = await database
      .select({ maxPos: sql<number>`COALESCE(MAX(${schema.scheduleRows.position}), -1)` })
      .from(schema.scheduleRows)
      .where(eq(schema.scheduleRows.scheduleId, scheduleId))
    position = (maxRow?.maxPos ?? -1) + 1
  }

  // For gate rows, force endWeek === startWeek (single-week diamond).
  const startWeek = body.startWeek ?? null
  let endWeek = body.endWeek ?? null
  if ((body.rowType === 'gate' || body.rowType === 'critical_gate') && startWeek != null) {
    endWeek = startWeek
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.scheduleRows).values({
    id,
    scheduleId,
    rowType: body.rowType,
    label: body.label.trim(),
    owner: body.owner ?? null,
    startWeek,
    endWeek,
    riskFlag: body.riskFlag ? 1 : 0,
    position,
    createdAt: now,
    updatedAt: now,
  })

  // Bump the parent schedule's updated_at so list views resort correctly.
  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: now })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ id }, { status: 201 })
}

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// Allowed section types. Keep in sync with schema docs + viewer renderer.
const SECTION_TYPES = ['overview', 'gantt', 'risk_register', 'raci_matrix', 'text'] as const
type SectionType = typeof SECTION_TYPES[number]

interface SectionBody {
  type: SectionType
  title?: string | null
  subtitle?: string | null
  startWeek?: number | null
  endWeek?: number | null
  /** JSON-serialisable type-specific payload (see schema.ts docs). */
  data?: unknown
  position?: number
}

// ── POST /api/admin/schedules/[id]/sections ────────────────────────────
// Append a new section. Defaults to last position + 1.
//
// Per type, `data` is expected to be:
//   - overview / text:    { html: string }
//   - gantt:              {} (rows live in /rows, not here)
//   - risk_register:      { rows: [{ risk, owner, impact, mitigation,
//                                    contractualImplication }] }
//   - raci_matrix:        { columns: [{ id, label }], rows: [{ id, label,
//                           group?, cells: { [colId]: 'R'|'A'|'C'|'I' } }] }
//
// We accept any shape — validation happens in the renderer where the
// missing-field cost is "section looks empty" rather than a crash.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: scheduleId } = await ctx.params
  const body = await req.json() as SectionBody

  if (!body.type || !SECTION_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type must be one of ${SECTION_TYPES.join(', ')}` }, { status: 400 })
  }

  const database = await db() as unknown as D1

  let position = body.position
  if (position == null) {
    const [maxRow] = await database
      .select({ maxPos: sql<number>`COALESCE(MAX(${schema.scheduleSections.position}), -1)` })
      .from(schema.scheduleSections)
      .where(eq(schema.scheduleSections.scheduleId, scheduleId))
    position = (maxRow?.maxPos ?? -1) + 1
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.scheduleSections).values({
    id,
    scheduleId,
    type: body.type,
    title: body.title?.trim() ?? null,
    subtitle: body.subtitle?.trim() ?? null,
    startWeek: body.startWeek ?? null,
    endWeek: body.endWeek ?? null,
    data: body.data === undefined ? null : JSON.stringify(body.data),
    position,
    createdAt: now,
    updatedAt: now,
  })

  await database
    .update(schema.projectSchedules)
    .set({ updatedAt: now })
    .where(eq(schema.projectSchedules.id, scheduleId))

  return NextResponse.json({ id }, { status: 201 })
}

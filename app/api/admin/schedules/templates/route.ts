import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/schedules/templates — list reusable schedule blueprints ─
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const database = await db() as unknown as D1
  const items = await database
    .select({
      id: schema.scheduleTemplates.id,
      name: schema.scheduleTemplates.name,
      description: schema.scheduleTemplates.description,
      isDefault: schema.scheduleTemplates.isDefault,
      createdAt: schema.scheduleTemplates.createdAt,
      updatedAt: schema.scheduleTemplates.updatedAt,
    })
    .from(schema.scheduleTemplates)
    .orderBy(desc(schema.scheduleTemplates.updatedAt))
  return NextResponse.json({ items })
}

// ── POST /api/admin/schedules/templates ─────────────────────────────────
//
// Two ways to seed a template:
// 1. fromScheduleId — snapshot the live schedule's sections + rows + meta.
// 2. snapshot — pass a hand-authored snapshot directly (used by tests / MCP).
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name?: string
    description?: string
    fromScheduleId?: string
    snapshot?: unknown
    isDefault?: boolean
  }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const database = await db() as unknown as D1

  let snapshot: unknown
  if (body.fromScheduleId) {
    const [scheduleRow] = await database
      .select({
        title: schema.projectSchedules.title,
        subtitle: schema.projectSchedules.subtitle,
        preparedBy: schema.projectSchedules.preparedBy,
        numberOfWeeks: schema.projectSchedules.numberOfWeeks,
        overviewHtml: schema.projectSchedules.overviewHtml,
      })
      .from(schema.projectSchedules)
      .where(eq(schema.projectSchedules.id, body.fromScheduleId))
      .limit(1)
    if (!scheduleRow) return NextResponse.json({ error: 'Source schedule not found' }, { status: 404 })

    const sections = await database
      .select({
        id: schema.scheduleSections.id,
        type: schema.scheduleSections.type,
        title: schema.scheduleSections.title,
        subtitle: schema.scheduleSections.subtitle,
        startWeek: schema.scheduleSections.startWeek,
        endWeek: schema.scheduleSections.endWeek,
        data: schema.scheduleSections.data,
        position: schema.scheduleSections.position,
      })
      .from(schema.scheduleSections)
      .where(eq(schema.scheduleSections.scheduleId, body.fromScheduleId))
      .orderBy(asc(schema.scheduleSections.position))

    const rows = await database
      .select({
        sectionId: schema.scheduleRows.sectionId,
        rowType: schema.scheduleRows.rowType,
        label: schema.scheduleRows.label,
        owner: schema.scheduleRows.owner,
        startWeek: schema.scheduleRows.startWeek,
        endWeek: schema.scheduleRows.endWeek,
        riskFlag: schema.scheduleRows.riskFlag,
        position: schema.scheduleRows.position,
      })
      .from(schema.scheduleRows)
      .where(eq(schema.scheduleRows.scheduleId, body.fromScheduleId))
      .orderBy(asc(schema.scheduleRows.position))

    // Map per-section IDs to indices so the snapshot is portable. When
    // the template is instantiated we re-create sections and use the
    // index to wire each row to its newly-minted sectionId.
    const sectionIndexById = new Map<string, number>()
    sections.forEach((s, i) => sectionIndexById.set(s.id, i))

    snapshot = {
      scheduleMeta: {
        title: scheduleRow.title,
        subtitle: scheduleRow.subtitle,
        preparedBy: scheduleRow.preparedBy,
        numberOfWeeks: scheduleRow.numberOfWeeks,
        overviewHtml: scheduleRow.overviewHtml,
      },
      sections: sections.map(s => ({
        type: s.type,
        title: s.title,
        subtitle: s.subtitle,
        startWeek: s.startWeek,
        endWeek: s.endWeek,
        data: s.data ? safeParse(s.data) : null,
        position: s.position,
      })),
      rows: rows.map(r => ({
        sectionIndex: r.sectionId != null ? sectionIndexById.get(r.sectionId) ?? null : null,
        rowType: r.rowType,
        label: r.label,
        owner: r.owner,
        startWeek: r.startWeek,
        endWeek: r.endWeek,
        riskFlag: r.riskFlag,
        position: r.position,
      })),
    }
  } else if (body.snapshot) {
    snapshot = body.snapshot
  } else {
    return NextResponse.json({ error: 'fromScheduleId or snapshot required' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.scheduleTemplates).values({
    id,
    name: body.name.trim(),
    description: body.description?.trim() ?? null,
    snapshot: JSON.stringify(snapshot),
    isDefault: body.isDefault ? 1 : 0,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })
  return NextResponse.json({ id }, { status: 201 })
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

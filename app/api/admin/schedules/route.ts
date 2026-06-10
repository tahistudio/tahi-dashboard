import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, asc, inArray } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/schedules ──────────────────────────────────────────
// List project schedules. Filterable by orgId / dealId / status.
// `includeRows=1` additionally returns each schedule's deliverable gantt
// rows (task / gate / critical_gate) for delivery-phase pickers.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const filterDealId = url.searchParams.get('dealId')
  const filterLeadId = url.searchParams.get('leadId')
  const filterProposalId = url.searchParams.get('proposalId')
  const filterStatus = url.searchParams.get('status')
  const includeRows = url.searchParams.get('includeRows') === '1'

  const database = await db() as unknown as D1

  const conditions = []
  if (filterOrgId) conditions.push(eq(schema.projectSchedules.orgId, filterOrgId))
  if (filterDealId) conditions.push(eq(schema.projectSchedules.dealId, filterDealId))
  if (filterLeadId) conditions.push(eq(schema.projectSchedules.leadId, filterLeadId))
  if (filterProposalId) conditions.push(eq(schema.projectSchedules.proposalId, filterProposalId))
  if (filterStatus) conditions.push(eq(schema.projectSchedules.status, filterStatus))

  const items = await database
    .select({
      id: schema.projectSchedules.id,
      orgId: schema.projectSchedules.orgId,
      dealId: schema.projectSchedules.dealId,
      leadId: schema.projectSchedules.leadId,
      proposalId: schema.projectSchedules.proposalId,
      title: schema.projectSchedules.title,
      subtitle: schema.projectSchedules.subtitle,
      preparedFor: schema.projectSchedules.preparedFor,
      preparedBy: schema.projectSchedules.preparedBy,
      effectiveDate: schema.projectSchedules.effectiveDate,
      targetLaunchDate: schema.projectSchedules.targetLaunchDate,
      numberOfWeeks: schema.projectSchedules.numberOfWeeks,
      status: schema.projectSchedules.status,
      publicShareToken: schema.projectSchedules.publicShareToken,
      createdAt: schema.projectSchedules.createdAt,
      updatedAt: schema.projectSchedules.updatedAt,
      orgName: schema.organisations.name,
      dealTitle: schema.deals.title,
      leadName: schema.leads.name,
    })
    .from(schema.projectSchedules)
    .leftJoin(schema.organisations, eq(schema.projectSchedules.orgId, schema.organisations.id))
    .leftJoin(schema.deals, eq(schema.projectSchedules.dealId, schema.deals.id))
    .leftJoin(schema.leads, eq(schema.projectSchedules.leadId, schema.leads.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.projectSchedules.updatedAt))

  if (!includeRows || items.length === 0) {
    return NextResponse.json({ items })
  }

  // Deliverable rows only (section headers are visual). Chunked to stay
  // under D1's 100-bind-variable cap.
  const scheduleIds = items.map(i => i.id)
  const ID_CHUNK = 90
  const rows: Array<{
    id: string
    scheduleId: string
    label: string
    rowType: string
    startWeek: number | null
    endWeek: number | null
    position: number
    sectionTitle: string | null
  }> = []
  for (let i = 0; i < scheduleIds.length; i += ID_CHUNK) {
    const chunk = scheduleIds.slice(i, i + ID_CHUNK)
    const part = await database
      .select({
        id: schema.scheduleRows.id,
        scheduleId: schema.scheduleRows.scheduleId,
        label: schema.scheduleRows.label,
        rowType: schema.scheduleRows.rowType,
        startWeek: schema.scheduleRows.startWeek,
        endWeek: schema.scheduleRows.endWeek,
        position: schema.scheduleRows.position,
        sectionTitle: schema.scheduleSections.title,
      })
      .from(schema.scheduleRows)
      .leftJoin(schema.scheduleSections, eq(schema.scheduleRows.sectionId, schema.scheduleSections.id))
      .where(and(
        inArray(schema.scheduleRows.scheduleId, chunk),
        inArray(schema.scheduleRows.rowType, ['task', 'gate', 'critical_gate']),
      ))
      .orderBy(asc(schema.scheduleRows.position))
    rows.push(...part)
  }

  const rowsBySchedule = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = rowsBySchedule.get(row.scheduleId)
    if (list) list.push(row)
    else rowsBySchedule.set(row.scheduleId, [row])
  }

  return NextResponse.json({
    items: items.map(item => ({ ...item, rows: rowsBySchedule.get(item.id) ?? [] })),
  })
}

// ── Schedule template snapshot shape ────────────────────────────────────
//
// Frozen at template-save time and unpacked at create time. `rows.sectionIndex`
// maps each row back to its parent section by index, so we can re-wire FK
// references when minting fresh UUIDs.
interface SnapshotSection {
  type: string
  title: string | null
  subtitle: string | null
  startWeek: number | null
  endWeek: number | null
  data: unknown
  position: number
}
interface SnapshotRow {
  sectionIndex: number | null
  rowType: 'section_header' | 'task' | 'gate' | 'critical_gate'
  label: string
  owner: 'tahi' | 'client' | 'joint' | 'tahi_parallel' | null
  startWeek: number | null
  endWeek: number | null
  riskFlag: number
  position: number
}
interface ScheduleTemplateSnapshot {
  scheduleMeta?: {
    title?: string | null
    subtitle?: string | null
    preparedBy?: string | null
    numberOfWeeks?: number | null
    overviewHtml?: string | null
  }
  sections?: SnapshotSection[]
  rows?: SnapshotRow[]
}

// ── POST /api/admin/schedules ──────────────────────────────────────────
// Create a new schedule. Three modes:
//   1. Default: create a blank schedule with a single empty 'gantt' section.
//   2. Body has `rows`: legacy template flow — seed rows under the default
//      gantt section.
//   3. Body has `templateId`: instantiate sections + rows from a saved
//      schedule_template snapshot. Schedule meta (title, subtitle, weeks,
//      overview, preparedBy) defaults to the snapshot's values when not
//      explicitly overridden in the body.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    title?: string
    subtitle?: string
    orgId?: string | null
    dealId?: string | null
    leadId?: string | null
    proposalId?: string | null
    preparedFor?: string
    preparedBy?: string
    effectiveDate?: string
    targetLaunchDate?: string
    numberOfWeeks?: number
    overviewHtml?: string
    templateId?: string
    rows?: Array<{
      rowType: 'section_header' | 'task' | 'gate' | 'critical_gate'
      label: string
      owner?: 'tahi' | 'client' | 'joint' | 'tahi_parallel' | null
      startWeek?: number | null
      endWeek?: number | null
      riskFlag?: boolean
    }>
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Resolve template snapshot if requested. We load it before validation
  // so the snapshot can supply a default title.
  let templateSnapshot: ScheduleTemplateSnapshot | null = null
  if (body.templateId) {
    const [tpl] = await database
      .select({ snapshot: schema.scheduleTemplates.snapshot })
      .from(schema.scheduleTemplates)
      .where(eq(schema.scheduleTemplates.id, body.templateId))
      .limit(1)
    if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    try { templateSnapshot = JSON.parse(tpl.snapshot) as ScheduleTemplateSnapshot }
    catch { return NextResponse.json({ error: 'Template snapshot is corrupt' }, { status: 500 }) }
  }

  const meta = templateSnapshot?.scheduleMeta ?? {}
  const resolvedTitle = body.title?.trim() || meta.title?.trim() || ''
  if (!resolvedTitle) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const resolvedNumberOfWeeks = Math.max(1, Math.min(52,
    body.numberOfWeeks ?? meta.numberOfWeeks ?? 12,
  ))

  await database.insert(schema.projectSchedules).values({
    id,
    orgId: body.orgId ?? null,
    dealId: body.dealId ?? null,
    leadId: body.leadId ?? null,
    proposalId: body.proposalId ?? null,
    title: resolvedTitle,
    subtitle: body.subtitle?.trim() ?? meta.subtitle ?? null,
    preparedFor: body.preparedFor?.trim() ?? null,
    preparedBy: body.preparedBy?.trim() ?? meta.preparedBy ?? null,
    effectiveDate: body.effectiveDate ?? null,
    targetLaunchDate: body.targetLaunchDate ?? null,
    numberOfWeeks: resolvedNumberOfWeeks,
    overviewHtml: body.overviewHtml ?? meta.overviewHtml ?? null,
    status: 'draft',
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  // ── Template flow: unpack snapshot into fresh sections + rows ────────
  if (templateSnapshot) {
    const tplSections = (templateSnapshot.sections ?? []).slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

    // If the template has no sections (defensive), seed a single default
    // gantt section so the schedule still renders.
    const sectionsToInsert = tplSections.length > 0 ? tplSections : [{
      type: 'gantt',
      title: 'Project schedule',
      subtitle: 'Whole project, one view.',
      startWeek: null,
      endWeek: null,
      data: null,
      position: 0,
    }]

    const sectionIds: string[] = sectionsToInsert.map(() => crypto.randomUUID())
    const sectionRows = sectionsToInsert.map((s, i) => ({
      id: sectionIds[i],
      scheduleId: id,
      type: s.type,
      title: s.title ?? null,
      subtitle: s.subtitle ?? null,
      startWeek: s.startWeek ?? null,
      endWeek: s.endWeek ?? null,
      data: s.data == null ? null : JSON.stringify(s.data),
      position: s.position ?? i,
      createdAt: now,
      updatedAt: now,
    }))
    // 10 columns per section row → 9 per chunk = 90 vars (under the 100 cap).
    const SEC_CHUNK = 9
    for (let i = 0; i < sectionRows.length; i += SEC_CHUNK) {
      await database.insert(schema.scheduleSections).values(sectionRows.slice(i, i + SEC_CHUNK))
    }

    const tplRows = templateSnapshot.rows ?? []
    if (tplRows.length > 0) {
      const seeded = tplRows.map((r, idx) => {
        const idxLookup = r.sectionIndex
        const targetSectionId = (typeof idxLookup === 'number' && idxLookup >= 0 && idxLookup < sectionIds.length)
          ? sectionIds[idxLookup]
          // Fallback: first gantt section, else first section.
          : sectionIds[Math.max(0, sectionsToInsert.findIndex(s => s.type === 'gantt'))] ?? sectionIds[0]
        return {
          id: crypto.randomUUID(),
          scheduleId: id,
          sectionId: targetSectionId,
          rowType: r.rowType,
          label: (r.label ?? '').trim() || 'Untitled',
          owner: r.owner ?? null,
          startWeek: r.startWeek ?? null,
          endWeek: r.endWeek ?? null,
          riskFlag: r.riskFlag ? 1 : 0,
          position: r.position ?? idx,
          createdAt: now,
          updatedAt: now,
        }
      })
      // 12 placeholders per row → 8 per chunk = 96 vars (safe).
      const ROW_CHUNK = 8
      for (let i = 0; i < seeded.length; i += ROW_CHUNK) {
        await database.insert(schema.scheduleRows).values(seeded.slice(i, i + ROW_CHUNK))
      }
    }

    return NextResponse.json({
      id,
      defaultSectionId: sectionIds[0],
      fromTemplate: true,
    }, { status: 201 })
  }

  // ── No template: every schedule starts with a single empty gantt section.
  const defaultSectionId = crypto.randomUUID()
  await database.insert(schema.scheduleSections).values({
    id: defaultSectionId,
    scheduleId: id,
    type: 'gantt',
    title: 'Project schedule',
    subtitle: 'Whole project, one view.',
    position: 0,
    createdAt: now,
    updatedAt: now,
  })

  // Seed rows if provided (legacy template-as-rows flow). Chunked to stay
  // under D1's per-statement bind-variable cap. Each row takes 12
  // placeholders (added section_id), so 8 rows per chunk = 96 vars (safe).
  if (body.rows?.length) {
    const seeded = body.rows.map((r, idx) => ({
      id: crypto.randomUUID(),
      scheduleId: id,
      sectionId: defaultSectionId,
      rowType: r.rowType,
      label: r.label.trim(),
      owner: r.owner ?? null,
      startWeek: r.startWeek ?? null,
      endWeek: r.endWeek ?? null,
      riskFlag: r.riskFlag ? 1 : 0,
      position: idx,
      createdAt: now,
      updatedAt: now,
    }))
    const CHUNK = 8
    for (let i = 0; i < seeded.length; i += CHUNK) {
      const slice = seeded.slice(i, i + CHUNK)
      await database.insert(schema.scheduleRows).values(slice)
    }
  }

  return NextResponse.json({ id, defaultSectionId }, { status: 201 })
}

import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc, desc, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type PhaseState = 'done' | 'active' | 'upcoming'

interface Phase {
  name: string
  state: PhaseState
  pct: number
  note: string | null
}

// ── GET /api/portal/project ──────────────────────────────────────────────────
// For project-type clients, the real phase breakdown for the ProjectBoard +
// "Your project" card, derived from the org's published project schedule (Gantt
// section headers + week spans). Retainer clients (an active subscription) get
// { isProject: false } so the home renders the TrackBoard instead.
//
// Progress is only asserted when the schedule carries an effective date to
// anchor "current week"; otherwise progressKnown=false and phases render as a
// plain roadmap (no fabricated percentages). Scoped to the caller's org; the
// Tahi admin org is rejected. Read-only, safe under Client-view impersonation.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1

  // Retainer vs project: an active subscription means retainer -> TrackBoard.
  let hasActiveSub = false
  try {
    const [sub] = await drizzle
      .select({ id: schema.subscriptions.id })
      .from(schema.subscriptions)
      .where(and(
        eq(schema.subscriptions.orgId, orgId),
        eq(schema.subscriptions.status, 'active'),
      ))
      .limit(1)
    hasActiveSub = !!sub
  } catch {
    hasActiveSub = false
  }

  if (hasActiveSub) {
    return NextResponse.json({ isProject: false })
  }

  // Project summary from the projects table (name + status + target launch).
  let project: { name: string; status: string; targetLaunchDate: string | null } | null = null
  try {
    const [row] = await drizzle
      .select({
        name: schema.projects.name,
        status: schema.projects.status,
        expectedDelivery: schema.projects.expectedDelivery,
      })
      .from(schema.projects)
      .where(eq(schema.projects.orgId, orgId))
      .orderBy(desc(schema.projects.createdAt))
      .limit(1)
    if (row) {
      project = { name: row.name, status: row.status, targetLaunchDate: row.expectedDelivery ?? null }
    }
  } catch {
    project = null
  }

  // The most recent project schedule for the org anchors the phase roadmap.
  let schedule:
    | { id: string; title: string; effectiveDate: string | null; targetLaunchDate: string | null }
    | null = null
  try {
    const [row] = await drizzle
      .select({
        id: schema.projectSchedules.id,
        title: schema.projectSchedules.title,
        effectiveDate: schema.projectSchedules.effectiveDate,
        targetLaunchDate: schema.projectSchedules.targetLaunchDate,
      })
      .from(schema.projectSchedules)
      .where(eq(schema.projectSchedules.orgId, orgId))
      .orderBy(desc(schema.projectSchedules.createdAt))
      .limit(1)
    schedule = row ?? null
  } catch {
    schedule = null
  }

  let phases: Phase[] = []
  let progressKnown = false
  let nextMilestone: { name: string; dateISO: string | null } | null = null

  if (schedule) {
    let rows: Array<{
      rowType: string
      label: string
      startWeek: number | null
      endWeek: number | null
    }> = []
    try {
      rows = await drizzle
        .select({
          rowType: schema.scheduleRows.rowType,
          label: schema.scheduleRows.label,
          startWeek: schema.scheduleRows.startWeek,
          endWeek: schema.scheduleRows.endWeek,
        })
        .from(schema.scheduleRows)
        .where(eq(schema.scheduleRows.scheduleId, schedule.id))
        .orderBy(asc(schema.scheduleRows.position))
    } catch {
      rows = []
    }

    // Anchor "current week" to the schedule's effective date. Without it we
    // still show the phase names but assert no progress.
    const effMs = schedule.effectiveDate ? new Date(schedule.effectiveDate).getTime() : NaN
    progressKnown = Number.isFinite(effMs)
    const currentWeek = progressKnown
      ? Math.floor((Date.now() - effMs) / WEEK_MS) + 1
      : null

    // Walk rows: each section_header opens a phase; the task/gate rows that
    // follow define its week span and (when active) its current work note.
    interface Building {
      name: string
      spanStart: number | null
      spanEnd: number | null
      taskLabels: Array<{ label: string; start: number | null; end: number | null }>
    }
    const built: Building[] = []
    let cur: Building | null = null
    for (const row of rows) {
      if (row.rowType === 'section_header') {
        if (cur) built.push(cur)
        cur = { name: row.label, spanStart: null, spanEnd: null, taskLabels: [] }
      } else if (cur && (row.rowType === 'task' || row.rowType === 'gate' || row.rowType === 'critical_gate')) {
        const end = row.endWeek ?? row.startWeek
        if (row.startWeek != null) {
          cur.spanStart = cur.spanStart == null ? row.startWeek : Math.min(cur.spanStart, row.startWeek)
        }
        if (end != null) {
          cur.spanEnd = cur.spanEnd == null ? end : Math.max(cur.spanEnd, end)
        }
        if (row.rowType === 'task') {
          cur.taskLabels.push({ label: row.label, start: row.startWeek, end })
        }
      }
    }
    if (cur) built.push(cur)

    phases = built.map((b): Phase => {
      // No week span (or no anchor) -> roadmap entry, no asserted progress.
      if (currentWeek == null || b.spanStart == null || b.spanEnd == null) {
        return { name: b.name, state: 'upcoming', pct: 0, note: null }
      }
      if (currentWeek > b.spanEnd) {
        return { name: b.name, state: 'done', pct: 100, note: null }
      }
      if (currentWeek < b.spanStart) {
        return { name: b.name, state: 'upcoming', pct: 0, note: null }
      }
      // Active phase: proportional progress through its span.
      const total = b.spanEnd - b.spanStart + 1
      const elapsed = currentWeek - b.spanStart + 1
      const pct = Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)))
      const activeTask = b.taskLabels.find(
        (t) => t.start != null && t.end != null && currentWeek >= t.start && currentWeek <= t.end,
      )
      return { name: b.name, state: 'active', pct, note: activeTask?.label ?? null }
    })

    // Next milestone: the earliest gate that has not yet passed.
    if (currentWeek != null) {
      try {
        const gates = await drizzle
          .select({
            label: schema.scheduleRows.label,
            startWeek: schema.scheduleRows.startWeek,
          })
          .from(schema.scheduleRows)
          .where(and(
            eq(schema.scheduleRows.scheduleId, schedule.id),
            inArray(schema.scheduleRows.rowType, ['gate', 'critical_gate']),
          ))
          .orderBy(asc(schema.scheduleRows.startWeek))
        const upcoming = gates.find((g) => g.startWeek != null && g.startWeek >= currentWeek)
        if (upcoming?.startWeek != null) {
          const dateMs = Number.isFinite(effMs)
            ? effMs + (upcoming.startWeek - 1) * WEEK_MS
            : NaN
          nextMilestone = {
            name: upcoming.label,
            dateISO: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null,
          }
        }
      } catch {
        nextMilestone = null
      }
    }
  }

  // Next invoice: the earliest unpaid invoice with a due date (real billing,
  // not a project-schedule assumption).
  let nextInvoice: { dateISO: string } | null = null
  try {
    const [inv] = await drizzle
      .select({ dueDate: schema.invoices.dueDate })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.orgId, orgId),
        inArray(schema.invoices.status, ['sent', 'overdue']),
      ))
      .orderBy(asc(schema.invoices.dueDate))
      .limit(1)
    if (inv?.dueDate) nextInvoice = { dateISO: inv.dueDate }
  } catch {
    nextInvoice = null
  }

  return NextResponse.json({
    isProject: true,
    scheduleTitle: schedule?.title ?? null,
    project,
    phases,
    progressKnown,
    nextMilestone,
    nextInvoice,
    targetLaunchDate: schedule?.targetLaunchDate ?? project?.targetLaunchDate ?? null,
  })
}

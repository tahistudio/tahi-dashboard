import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
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

// A gantt row reduced to what the phase roadmap needs. Live rows and rows out
// of a published snapshot both land in this shape.
interface PhaseRow {
  rowType: string
  label: string
  startWeek: number | null
  endWeek: number | null
}

interface PublishedCover {
  title: string | null
  effectiveDate: string | null
  targetLaunchDate: string | null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// `projectSchedules.publishedSnapshot` is the JSON the publish action writes:
// { schedule: {...}, sections: [...], rows: [...] }. Parsed defensively because
// it is stored as free text. Returns null when there is no usable snapshot, and
// a null `rows` when the snapshot carries no rows array, so callers can fall
// back to the live tables exactly like the public share viewer does.
function parsePublishedSnapshot(
  json: string | null,
): { cover: PublishedCover; rows: PhaseRow[] | null } | null {
  if (!json) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const root = parsed as { schedule?: unknown; rows?: unknown }
  const cover: PublishedCover = { title: null, effectiveDate: null, targetLaunchDate: null }
  if (root.schedule && typeof root.schedule === 'object') {
    const s = root.schedule as Record<string, unknown>
    cover.title = readString(s.title)
    cover.effectiveDate = readString(s.effectiveDate)
    cover.targetLaunchDate = readString(s.targetLaunchDate)
  }

  let rows: PhaseRow[] | null = null
  if (Array.isArray(root.rows)) {
    const ordered: Array<PhaseRow & { position: number }> = []
    for (const entry of root.rows) {
      if (!entry || typeof entry !== 'object') continue
      const r = entry as Record<string, unknown>
      const rowType = readString(r.rowType)
      const label = readString(r.label)
      if (!rowType || !label) continue
      ordered.push({
        rowType,
        label,
        startWeek: readNumber(r.startWeek),
        endWeek: readNumber(r.endWeek),
        position: readNumber(r.position) ?? 0,
      })
    }
    ordered.sort((a, b) => a.position - b.position)
    rows = ordered.map(({ rowType, label, startWeek, endWeek }) => ({ rowType, label, startWeek, endWeek }))
  }

  return { cover, rows }
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
  const { orgId, userId, clerkOrgId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'overview')
  if (featureDenied) return featureDenied

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

  // The org's PUBLISHED project schedule anchors the phase roadmap. `status`
  // flips to 'shared' when an admin shares a schedule and back to 'draft' when
  // they revoke it, so it marks exactly the schedules a client is meant to see:
  // an in-progress draft (even a newer one) never reaches this card. Ordered by
  // publishedAt so the most recently published schedule wins.
  let scheduleRow:
    | {
        id: string
        title: string
        effectiveDate: string | null
        targetLaunchDate: string | null
        publishedSnapshot: string | null
      }
    | null = null
  try {
    const [row] = await drizzle
      .select({
        id: schema.projectSchedules.id,
        title: schema.projectSchedules.title,
        effectiveDate: schema.projectSchedules.effectiveDate,
        targetLaunchDate: schema.projectSchedules.targetLaunchDate,
        publishedSnapshot: schema.projectSchedules.publishedSnapshot,
      })
      .from(schema.projectSchedules)
      .where(and(
        eq(schema.projectSchedules.orgId, orgId),
        eq(schema.projectSchedules.status, 'shared'),
      ))
      .orderBy(
        desc(schema.projectSchedules.publishedAt),
        desc(schema.projectSchedules.createdAt),
      )
      .limit(1)
    scheduleRow = row ?? null
  } catch {
    scheduleRow = null
  }

  // Published values beat the live columns: the snapshot is what the client
  // already reads on the shared link, so unpublished edits to the title or the
  // phase names stay internal. Schedules shared before the snapshot column
  // existed carry none and keep their live values, which is the same fallback
  // the public share viewer makes.
  const published = scheduleRow ? parsePublishedSnapshot(scheduleRow.publishedSnapshot) : null
  const schedule = scheduleRow
    ? {
        id: scheduleRow.id,
        title: published?.cover.title ?? scheduleRow.title,
        effectiveDate: published?.cover.effectiveDate ?? scheduleRow.effectiveDate,
        targetLaunchDate: published?.cover.targetLaunchDate ?? scheduleRow.targetLaunchDate,
      }
    : null

  let phases: Phase[] = []
  let progressKnown = false
  let nextMilestone: { name: string; dateISO: string | null } | null = null

  if (schedule) {
    // Phase names come from the published snapshot. Only a schedule that was
    // shared before the snapshot column existed reads the live rows.
    let rows: PhaseRow[] = published?.rows ?? []
    if (!published?.rows) {
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

    // Next milestone: the earliest gate that has not yet passed. Read off the
    // same rows the phases came from so it cannot describe an unpublished gate.
    if (currentWeek != null) {
      const week = currentWeek
      const gates = rows
        .filter((r) => r.rowType === 'gate' || r.rowType === 'critical_gate')
        .filter((r): r is PhaseRow & { startWeek: number } => r.startWeek != null && r.startWeek >= week)
        .sort((a, b) => a.startWeek - b.startWeek)
      const upcoming = gates[0]
      if (upcoming) {
        const dateMs = Number.isFinite(effMs)
          ? effMs + (upcoming.startWeek - 1) * WEEK_MS
          : NaN
        nextMilestone = {
          name: upcoming.label,
          dateISO: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : null,
        }
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

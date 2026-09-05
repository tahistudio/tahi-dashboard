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
// it is stored as free text. Returns null when the column is empty AND when the
// JSON is unparseable, and a null `rows` when a parsed snapshot carries no rows
// array. In every one of those cases the caller reads the live tables, which is
// exactly what the public share viewer does with the same input, so the card and
// the link the client already holds never disagree.
//
// A parsed snapshot is otherwise authoritative: a field it published as null
// stays null rather than falling through to the live column, because "published
// with no target launch date" is a real state, not a missing snapshot.
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
// "Your project" card, derived from the org's shared project schedule (Gantt
// section headers + week spans), read through its published snapshot wherever
// one exists. Retainer clients (an active subscription) get { isProject: false }
// so the home renders the TrackBoard instead.
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

  // The org's SHARED project schedule anchors the phase roadmap. `status` flips
  // to 'shared' when an admin shares a schedule and back to 'draft' when they
  // revoke it, so it marks exactly the schedules a client is meant to see: an
  // in-progress draft (even a newer one) never reaches this card.
  //
  // Schedules are not exclusive per org (a pre-sale gantt attached to the deal
  // stays 'shared' alongside the delivery plan), so the newest one the admin
  // created wins, which is the plan they are working to now. publishedAt is only
  // a tiebreak: republishing an old schedule must not hijack the card away from
  // the current one.
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
        desc(schema.projectSchedules.createdAt),
        desc(schema.projectSchedules.publishedAt),
      )
      .limit(1)
    scheduleRow = row ?? null
  } catch {
    scheduleRow = null
  }

  // The whole cover comes from one source, chosen per snapshot and not per
  // field. Once a snapshot exists it is what the client reads on the shared
  // link, so its dates are taken verbatim: a date it published as null stays
  // null. Reading each field with `??` would send a schedule published before
  // its dates were filled in straight back to the live column, which is the
  // unpublished value, and would silently anchor progress to it.
  //
  // `title` is the exception. The column is notNull, so a snapshot without one
  // is corruption rather than intent, and the card needs a name to render.
  //
  // A schedule with no usable snapshot (shared but never published, or a
  // snapshot that will not parse) keeps its live values. That is the same
  // fallback /api/public/schedules/[token] makes, so the card shows the client
  // what their own link shows them. See the rows comment below.
  const published = scheduleRow ? parsePublishedSnapshot(scheduleRow.publishedSnapshot) : null
  const schedule = scheduleRow
    ? {
        id: scheduleRow.id,
        title: published ? (published.cover.title ?? scheduleRow.title) : scheduleRow.title,
        effectiveDate: published ? published.cover.effectiveDate : scheduleRow.effectiveDate,
        targetLaunchDate: published ? published.cover.targetLaunchDate : scheduleRow.targetLaunchDate,
      }
    : null

  let phases: Phase[] = []
  let progressKnown = false
  let nextMilestone: { name: string; dateISO: string | null } | null = null

  if (schedule) {
    // Phase names come from the published snapshot whenever there is one, so
    // renaming a phase after publishing stays internal until the next publish.
    //
    // The live read below is NOT a pre-migration relic. Sharing does not write a
    // snapshot (POST /api/admin/schedules/[id]/share only sets status and the
    // token) and the Publish button only appears after a schedule has been
    // shared, so "shared, never published" is an ordinary state and this branch
    // runs for it. Those schedules serve their live rows on the client's own
    // share link too, so reading live here keeps the card and the link in step
    // rather than telling the client their plan is still being set up. Closing
    // this properly means making share write the first snapshot; until then a
    // never-published schedule shows live edits in both places.
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

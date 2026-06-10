/**
 * lib/delivery-aggregate.ts — Delivery spine (#148) cross-schedule aggregation.
 *
 * The pure engine in lib/delivery-status.ts computes status for ONE schedule's
 * rows. A deal or client engagement can span several schedules, so this helper
 * loads the linked work for a set of schedules and rolls them up into a single
 * engagement status. Used by the deal/client engagement-health card (Slice 4)
 * and the overview off-track widget (Slice 5).
 *
 * DB-aware (takes a Drizzle instance) — server-only, import from API routes.
 */

import { schema } from '@/db/d1'
import { inArray, ne } from 'drizzle-orm'
import {
  computeRowStatus,
  computeEngagementStatus,
  type LinkedWorkItem,
  type RowDeliveryStatus,
  type EngagementRollup,
  type DeliveryStatus,
} from '@/lib/delivery-status'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface ScheduleRef {
  id: string
  title: string
  effectiveDate: string | null
}

export interface OffTrackRow {
  rowId: string
  scheduleId: string
  scheduleTitle: string
  label: string
  status: DeliveryStatus
}

export interface AggregateResult {
  engagement: EngagementRollup
  perSchedule: Array<{ scheduleId: string; title: string; engagement: EngagementRollup }>
  offTrackRows: OffTrackRow[]
}

const ID_CHUNK = 90 // D1 caps bind variables at 100 per statement
const OFF_TRACK: DeliveryStatus[] = ['blocked', 'delayed', 'at_risk']

/**
 * Aggregate delivery status across the given schedules. Returns the combined
 * engagement rollup, a per-schedule breakdown, and the flat list of off-track
 * rows (with schedule context for deep-linking).
 */
export async function aggregateDeliveryStatus(
  drizzle: D1,
  schedules: ScheduleRef[],
  nowISO: string,
): Promise<AggregateResult> {
  const empty: AggregateResult = {
    engagement: { status: 'not_started', pctComplete: 0, rowsTotal: 0, rowsDone: 0, offTrackRowIds: [] },
    perSchedule: [],
    offTrackRows: [],
  }
  if (schedules.length === 0) return empty

  const schedById = new Map(schedules.map(s => [s.id, s]))
  const scheduleIds = schedules.map(s => s.id)

  // Batch-load deliverable gantt rows across all schedules.
  type RowRec = {
    id: string
    scheduleId: string
    rowType: string
    startWeek: number | null
    endWeek: number | null
    riskFlag: number | null
    label: string
  }
  const rows: RowRec[] = []
  for (let i = 0; i < scheduleIds.length; i += ID_CHUNK) {
    const chunk = scheduleIds.slice(i, i + ID_CHUNK)
    const part = await drizzle
      .select({
        id: schema.scheduleRows.id,
        scheduleId: schema.scheduleRows.scheduleId,
        rowType: schema.scheduleRows.rowType,
        startWeek: schema.scheduleRows.startWeek,
        endWeek: schema.scheduleRows.endWeek,
        riskFlag: schema.scheduleRows.riskFlag,
        label: schema.scheduleRows.label,
      })
      .from(schema.scheduleRows)
      .where(inArray(schema.scheduleRows.scheduleId, chunk))
    rows.push(...part)
  }

  if (rows.length === 0) return empty

  const rowIds = rows.map(r => r.id)

  // Batch-load requests + tasks linked to any of these rows.
  const byRow = new Map<string, LinkedWorkItem[]>()
  const push = (rowId: string | null, item: LinkedWorkItem) => {
    if (!rowId) return
    const arr = byRow.get(rowId)
    if (arr) arr.push(item)
    else byRow.set(rowId, [item])
  }
  for (let i = 0; i < rowIds.length; i += ID_CHUNK) {
    const chunk = rowIds.slice(i, i + ID_CHUNK)
    const [reqs, tsks] = await Promise.all([
      drizzle
        .select({
          id: schema.requests.id,
          scheduleRowId: schema.requests.scheduleRowId,
          status: schema.requests.status,
          dueDate: schema.requests.dueDate,
          scopeFlagged: schema.requests.scopeFlagged,
        })
        .from(schema.requests)
        .where(inArray(schema.requests.scheduleRowId, chunk)),
      drizzle
        .select({
          id: schema.tasks.id,
          scheduleRowId: schema.tasks.scheduleRowId,
          status: schema.tasks.status,
          dueDate: schema.tasks.dueDate,
        })
        .from(schema.tasks)
        .where(inArray(schema.tasks.scheduleRowId, chunk)),
    ])
    for (const r of reqs) {
      push(r.scheduleRowId, {
        kind: 'request', id: r.id, status: r.status,
        dueDate: r.dueDate, scopeFlagged: !!r.scopeFlagged,
      })
    }
    for (const t of tsks) {
      push(t.scheduleRowId, { kind: 'task', id: t.id, status: t.status, dueDate: t.dueDate })
    }
  }

  // Compute per-row status (each row keyed to its own schedule's effectiveDate).
  const perScheduleRows = new Map<string, RowDeliveryStatus[]>()
  const offTrackRows: OffTrackRow[] = []
  const allRowStatuses: RowDeliveryStatus[] = []

  for (const r of rows) {
    const sched = schedById.get(r.scheduleId)
    const status = computeRowStatus(
      { id: r.id, rowType: r.rowType, startWeek: r.startWeek, endWeek: r.endWeek, riskFlag: r.riskFlag },
      byRow.get(r.id) ?? [],
      nowISO,
      sched?.effectiveDate ?? null,
    )
    allRowStatuses.push(status)
    const list = perScheduleRows.get(r.scheduleId)
    if (list) list.push(status)
    else perScheduleRows.set(r.scheduleId, [status])

    if (status.linkedCount > 0 && OFF_TRACK.includes(status.status)) {
      offTrackRows.push({
        rowId: r.id,
        scheduleId: r.scheduleId,
        scheduleTitle: sched?.title ?? 'Schedule',
        label: r.label,
        status: status.status,
      })
    }
  }

  const perSchedule = schedules
    .map(s => ({
      scheduleId: s.id,
      title: s.title,
      engagement: computeEngagementStatus(perScheduleRows.get(s.id) ?? []),
    }))
    .filter(s => s.engagement.rowsTotal > 0)

  return {
    engagement: computeEngagementStatus(allRowStatuses),
    perSchedule,
    offTrackRows,
  }
}

const SEVERITY: Record<DeliveryStatus, number> = {
  blocked: 5, delayed: 4, at_risk: 3, in_progress: 2, not_started: 1, done: 0,
}
const OFF_TRACK_STATUSES: DeliveryStatus[] = ['blocked', 'delayed', 'at_risk']

export interface OffTrackEngagement {
  orgId: string
  orgName: string
  status: DeliveryStatus
  pctComplete: number
  rowsDone: number
  rowsTotal: number
  offTrackCount: number
  offTrackRows: OffTrackRow[]
}

/**
 * Enumerate client engagements (grouped by org) whose delivery rollup is
 * currently off track, worst first. Org is resolved from schedule.orgId,
 * falling back to the linked deal's orgId. Shared by the overview off-track
 * endpoint (Slice 5) and the delivery-watch cron.
 */
export async function listOffTrackEngagements(
  drizzle: D1,
  nowISO: string,
): Promise<OffTrackEngagement[]> {
  const schedules = await drizzle
    .select({
      id: schema.projectSchedules.id,
      title: schema.projectSchedules.title,
      effectiveDate: schema.projectSchedules.effectiveDate,
      orgId: schema.projectSchedules.orgId,
      dealId: schema.projectSchedules.dealId,
    })
    .from(schema.projectSchedules)
    .where(ne(schema.projectSchedules.status, 'archived'))

  if (schedules.length === 0) return []

  // Resolve org via schedule.orgId, falling back to the linked deal's orgId.
  const needDealIds = [...new Set(schedules.filter(s => !s.orgId && s.dealId).map(s => s.dealId as string))]
  const dealOrg = new Map<string, string | null>()
  for (let i = 0; i < needDealIds.length; i += ID_CHUNK) {
    const chunk = needDealIds.slice(i, i + ID_CHUNK)
    const deals = await drizzle
      .select({ id: schema.deals.id, orgId: schema.deals.orgId })
      .from(schema.deals)
      .where(inArray(schema.deals.id, chunk))
    for (const d of deals) dealOrg.set(d.id, d.orgId)
  }

  const byOrg = new Map<string, ScheduleRef[]>()
  for (const s of schedules) {
    const resolvedOrg = s.orgId ?? (s.dealId ? dealOrg.get(s.dealId) ?? null : null)
    if (!resolvedOrg) continue
    const ref: ScheduleRef = { id: s.id, title: s.title, effectiveDate: s.effectiveDate }
    const list = byOrg.get(resolvedOrg)
    if (list) list.push(ref)
    else byOrg.set(resolvedOrg, [ref])
  }
  if (byOrg.size === 0) return []

  const orgIds = [...byOrg.keys()]
  const orgNames = new Map<string, string>()
  for (let i = 0; i < orgIds.length; i += ID_CHUNK) {
    const chunk = orgIds.slice(i, i + ID_CHUNK)
    const orgs = await drizzle
      .select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations)
      .where(inArray(schema.organisations.id, chunk))
    for (const o of orgs) orgNames.set(o.id, o.name)
  }

  const out: OffTrackEngagement[] = []
  for (const [org, scheds] of byOrg) {
    const agg = await aggregateDeliveryStatus(drizzle, scheds, nowISO)
    if (agg.engagement.rowsTotal > 0 && OFF_TRACK_STATUSES.includes(agg.engagement.status)) {
      out.push({
        orgId: org,
        orgName: orgNames.get(org) ?? 'Client',
        status: agg.engagement.status,
        pctComplete: agg.engagement.pctComplete,
        rowsDone: agg.engagement.rowsDone,
        rowsTotal: agg.engagement.rowsTotal,
        offTrackCount: agg.offTrackRows.length,
        offTrackRows: agg.offTrackRows
          .slice()
          .sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status])
          .slice(0, 5),
      })
    }
  }

  out.sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || b.offTrackCount - a.offTrackCount)
  return out
}

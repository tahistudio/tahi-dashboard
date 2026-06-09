/**
 * lib/delivery-status.ts — Delivery spine (#148) status engine.
 *
 * Pure functions that derive, from a schedule's gantt rows + the requests/tasks
 * linked to them (via scheduleRowId), where delivery actually is versus the plan:
 * per-row status + an engagement rollup. No DB / Cloudflare deps so it is fully
 * unit-testable and runs anywhere.
 *
 * Status precedence (highest wins):
 *   blocked > done > delayed > at_risk > in_progress > not_started
 *
 * `done` outranks `delayed`: a phase whose work is all delivered is "done" even
 * if it finished late — lateness is history, not current status.
 */

export type DeliveryStatus =
  | 'not_started'
  | 'in_progress'
  | 'at_risk'
  | 'delayed'
  | 'blocked'
  | 'done'

/** A request or task linked to a schedule row. Loose status typing because
 *  requests and tasks use different status vocabularies (mapped below). */
export interface LinkedWorkItem {
  kind: 'request' | 'task'
  id: string
  status: string
  dueDate?: string | null
  /** requests only — admin flagged scope creep => treat as blocked */
  scopeFlagged?: boolean | null
}

export interface ScheduleRowInput {
  id: string
  /** section_header | task | gate | critical_gate */
  rowType: string
  startWeek?: number | null
  endWeek?: number | null
  riskFlag?: number | boolean | null
}

export interface RowDeliveryStatus {
  rowId: string
  status: DeliveryStatus
  linkedCount: number
  doneCount: number
  blockedCount: number
  plannedStart: string | null
  plannedEnd: string | null
}

export interface EngagementRollup {
  /** worst row status across task/gate rows that have linked work */
  status: DeliveryStatus
  /** done task-rows / total task-rows with linked work, 0..1 */
  pctComplete: number
  rowsTotal: number
  rowsDone: number
  /** rows currently blocked / delayed / at_risk */
  offTrackRowIds: string[]
}

const AT_RISK_WINDOW_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

// ── work-item classification ────────────────────────────────────────────────

/** Done: request delivered, or task done. */
export function isWorkDone(w: LinkedWorkItem): boolean {
  return w.kind === 'request' ? w.status === 'delivered' : w.status === 'done'
}

/** Blocked: request on_hold or scope-flagged, or task blocked. */
export function isWorkBlocked(w: LinkedWorkItem): boolean {
  if (w.kind === 'request') return w.status === 'on_hold' || !!w.scopeFlagged
  return w.status === 'blocked'
}

/** Excluded from delivery signal entirely (cancelled / archived). */
export function isWorkInactive(w: LinkedWorkItem): boolean {
  return w.status === 'cancelled' || w.status === 'archived'
}

/** Started: past the initial backlog state and not done. */
export function isWorkStarted(w: LinkedWorkItem): boolean {
  if (isWorkDone(w) || isWorkInactive(w)) return false
  if (w.kind === 'request') return w.status !== 'submitted'
  return w.status !== 'todo'
}

// ── planned window ──────────────────────────────────────────────────────────

/** 1-based gantt week -> ISO date (yyyy-mm-dd), relative to the schedule's
 *  effective date. Week 1 starts on the effective date. Returns null if either
 *  input is missing/invalid. */
export function weekToDate(
  effectiveDate: string | null | undefined,
  week: number | null | undefined,
  opts: { endOfWeek?: boolean } = {},
): string | null {
  if (!effectiveDate || week == null || !Number.isFinite(week)) return null
  const base = new Date(effectiveDate)
  if (Number.isNaN(base.getTime())) return null
  // Week 1 day 0 = effectiveDate; week N starts (N-1)*7 days later.
  const startOffset = (week - 1) * 7
  const offsetDays = opts.endOfWeek ? startOffset + 6 : startOffset
  const d = new Date(base.getTime() + offsetDays * DAY_MS)
  return d.toISOString().slice(0, 10)
}

// ── per-row status ──────────────────────────────────────────────────────────

/** Rows that represent actual deliverable work (vs visual headers). */
export function isDeliverableRow(row: ScheduleRowInput): boolean {
  return row.rowType === 'task' || row.rowType === 'gate' || row.rowType === 'critical_gate'
}

export function computeRowStatus(
  row: ScheduleRowInput,
  linked: LinkedWorkItem[],
  nowISO: string,
  effectiveDate: string | null | undefined,
): RowDeliveryStatus {
  const plannedStart = weekToDate(effectiveDate, row.startWeek)
  const plannedEnd = weekToDate(effectiveDate, row.endWeek ?? row.startWeek, { endOfWeek: true })

  const active = linked.filter(w => !isWorkInactive(w))
  const doneCount = active.filter(isWorkDone).length
  const blockedCount = active.filter(isWorkBlocked).length

  const base = {
    rowId: row.id,
    linkedCount: active.length,
    doneCount,
    blockedCount,
    plannedStart,
    plannedEnd,
  }

  // No delivery signal -> nothing to report against the plan.
  if (active.length === 0) return { ...base, status: 'not_started' }

  if (blockedCount > 0) return { ...base, status: 'blocked' }
  if (doneCount === active.length) return { ...base, status: 'done' }

  const now = new Date(nowISO)
  const past = (iso: string | null) => !!iso && now.getTime() > new Date(iso).getTime()
  const within = (iso: string | null | undefined, days: number) =>
    !!iso && new Date(iso).getTime() - now.getTime() <= days * DAY_MS

  // Planned end passed but not all done -> delayed.
  if (past(plannedEnd)) return { ...base, status: 'delayed' }

  // Risk overlay, or a linked due date past / imminent on undone work.
  const undone = active.filter(w => !isWorkDone(w))
  const dueRisk = undone.some(w => within(w.dueDate, AT_RISK_WINDOW_DAYS))
  if (row.riskFlag || dueRisk) return { ...base, status: 'at_risk' }

  if (active.some(isWorkStarted)) return { ...base, status: 'in_progress' }
  return { ...base, status: 'not_started' }
}

// ── engagement rollup ───────────────────────────────────────────────────────

const SEVERITY: Record<DeliveryStatus, number> = {
  blocked: 5,
  delayed: 4,
  at_risk: 3,
  in_progress: 2,
  not_started: 1,
  done: 0,
}

const OFF_TRACK: DeliveryStatus[] = ['blocked', 'delayed', 'at_risk']

/** Roll per-row statuses up to an engagement-level summary. Only rows that have
 *  linked work count toward the rollup (a plan with no linked delivery yet is
 *  not "off track", just unmapped). */
export function computeEngagementStatus(rows: RowDeliveryStatus[]): EngagementRollup {
  const mapped = rows.filter(r => r.linkedCount > 0)
  if (mapped.length === 0) {
    return { status: 'not_started', pctComplete: 0, rowsTotal: 0, rowsDone: 0, offTrackRowIds: [] }
  }
  const rowsDone = mapped.filter(r => r.status === 'done').length
  const worst = mapped.reduce<DeliveryStatus>(
    (acc, r) => (SEVERITY[r.status] > SEVERITY[acc] ? r.status : acc),
    'done',
  )
  return {
    status: worst,
    pctComplete: rowsDone / mapped.length,
    rowsTotal: mapped.length,
    rowsDone,
    offTrackRowIds: mapped.filter(r => OFF_TRACK.includes(r.status)).map(r => r.rowId),
  }
}

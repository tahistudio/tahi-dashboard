/**
 * lib/call-time-backfill.ts
 *
 * Plan (and, once applied, describe) fixing up scheduledAt rows written
 * before every call-time writer normalised to an absolute UTC instant
 * (see lib/call-time.ts for the whole story). A row is either already
 * canonical ("...Z" with milliseconds, exactly what
 * normalizeCallInstant produces), needs re-writing to the equivalent
 * instant, or is unparseable and gets refused by name rather than
 * silently skipped.
 *
 * This is a data repair, not a migration (CLAUDE.md: migrations are for
 * schema, not data), so it is a plan-then-apply pair behind an admin
 * route, same shape as lib/invoice-number-backfill.ts.
 *
 * Pure and D1-free so the decision logic is unit testable without a D1
 * handle.
 */

import { isCanonicalInstant, normalizeCallInstant } from './call-time'

export type CallTimeTable = 'discovery_calls' | 'scheduled_calls'

export interface CallTimeRow {
  id: string
  table: CallTimeTable
  scheduledAt: string
}

/** A row that needs its scheduledAt rewritten to the equivalent instant. */
export interface CallTimeFix {
  id: string
  table: CallTimeTable
  from: string
  to: string
}

/** A row that could not be normalised at all. */
export interface CallTimeRefusal {
  id: string
  table: CallTimeTable
  scheduledAt: string
  reason: 'unparseable'
}

export interface CallTimeBackfillPlan {
  fixes: CallTimeFix[]
  refusals: CallTimeRefusal[]
  /** Rows already in canonical form: nothing to do, reported for the count. */
  alreadyCanonical: number
}

/**
 * Decide what each row needs. Naive (no-offset) values are interpreted
 * as Pacific/Auckland wall-clock time, the same rule every writer now
 * applies at the boundary, so a row written before this fix existed
 * gets the same instant a writer would produce for it today.
 */
export function planCallTimeBackfill(rows: readonly CallTimeRow[]): CallTimeBackfillPlan {
  const fixes: CallTimeFix[] = []
  const refusals: CallTimeRefusal[] = []
  let alreadyCanonical = 0

  for (const row of rows) {
    if (isCanonicalInstant(row.scheduledAt)) {
      alreadyCanonical++
      continue
    }
    const normalized = normalizeCallInstant(row.scheduledAt)
    if (!normalized) {
      refusals.push({ id: row.id, table: row.table, scheduledAt: row.scheduledAt, reason: 'unparseable' })
      continue
    }
    fixes.push({ id: row.id, table: row.table, from: row.scheduledAt, to: normalized })
  }

  return { fixes, refusals, alreadyCanonical }
}

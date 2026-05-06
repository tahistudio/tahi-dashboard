/**
 * deal-activity.ts — helper for logging structured activity entries on
 * deals / orgs / contacts.
 *
 * Decision #041 (2026-04-21): every deal mutation must produce a timeline
 * entry so nothing is invisible. One helper per change type so the call
 * sites stay readable.
 *
 * Metadata: structured before/after values are stored in activities.metadata
 * (JSON text column, added in migration 0017). Written via raw SQL so we
 * don't have to add the column to the Drizzle schema definition before
 * the migration has run on production (Decision #039 lesson #1).
 */

import { sql, type SQLWrapper } from 'drizzle-orm'

// Matches Drizzle's D1 database `run` signature. We intentionally accept
// any return type so callers don't need to care about SQLiteRaw internals.
type AnyDb = {
  run: (q: SQLWrapper | string) => unknown
}

/** Every activity type the timeline understands. */
export type DealActivityType =
  | 'deal_created'
  | 'stage_change'
  | 'value_change'
  | 'currency_change'
  | 'owner_change'
  | 'org_change'
  | 'source_change'
  | 'engagement_change'
  | 'close_date_change'
  | 'notes_change'
  | 'won'
  | 'lost'
  | 'archived'
  | 'unarchived'
  | 'auto_nudges_toggled'
  | 'nudge_sent'
  | 'contact_added'
  | 'contact_removed'
  | 'call'
  | 'meeting'
  | 'email'
  | 'note'
  | 'task'
  | 'status'

export interface LogActivityInput {
  dealId?: string | null
  orgId?: string | null
  contactId?: string | null
  type: DealActivityType
  title: string
  description?: string | null
  /** Structured old/new payload. Stored as JSON in activities.metadata. */
  metadata?: Record<string, unknown> | null
  createdById: string
  scheduledAt?: string | null
  completedAt?: string | null
  durationMinutes?: number | null
  outcome?: string | null
}

/**
 * Insert a row into the activities table. Never throws — if logging fails
 * we swallow the error (telemetry-only data must not break user writes).
 * Uses raw SQL so we can write to `metadata` without declaring it in the
 * Drizzle schema until migration 0017 is applied on every environment.
 */
export async function logActivity(
  database: AnyDb,
  input: LogActivityInput,
): Promise<void> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  try {
    await database.run(sql`
      INSERT INTO activities (
        id, type, title, description,
        deal_id, org_id, contact_id,
        created_by_id,
        scheduled_at, completed_at, duration_minutes, outcome,
        metadata,
        created_at, updated_at
      ) VALUES (
        ${id},
        ${input.type},
        ${input.title},
        ${input.description ?? null},
        ${input.dealId ?? null},
        ${input.orgId ?? null},
        ${input.contactId ?? null},
        ${input.createdById || 'system'},
        ${input.scheduledAt ?? null},
        ${input.completedAt ?? null},
        ${input.durationMinutes ?? null},
        ${input.outcome ?? null},
        ${input.metadata ? JSON.stringify(input.metadata) : null},
        ${now},
        ${now}
      )
    `)
  } catch (err) {
    // Swallow — activity logging must never break a real write.
    // If this fires the most likely cause is migration 0017 hasn't run on
    // this environment yet.
    console.warn('[logActivity] insert failed:', err instanceof Error ? err.message : err)
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * Helpers for formatting value changes.
 * ─────────────────────────────────────────────────────────────────── */

export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

export interface ValueSnapshot {
  value: number | null | undefined
  valueMin: number | null | undefined
  valueMax: number | null | undefined
  currency: string | null | undefined
  /** Split-model fields (added in migration 0023). Optional so legacy
   *  callers without these still type-check. */
  upfrontValue?: number | null | undefined
  monthlyValue?: number | null | undefined
  recurringStartDate?: string | null | undefined
}

function isRange(s: ValueSnapshot): boolean {
  return s.valueMin != null && s.valueMax != null && s.valueMin !== s.valueMax
}

function hasSplit(s: ValueSnapshot): boolean {
  return s.upfrontValue != null || s.monthlyValue != null
}

function describeValue(s: ValueSnapshot): string {
  const cur = s.currency ?? 'NZD'
  // Split-model takes priority when set: "$10k + $2k/mo".
  if (hasSplit(s)) {
    const upfrontLabel = isRange(s)
      ? `${formatMoney(s.valueMin ?? 0, cur)}\u2013${formatMoney(s.valueMax ?? 0, cur)}`
      : (s.upfrontValue ?? 0) > 0
        ? formatMoney(s.upfrontValue ?? 0, cur)
        : null
    const monthlyLabel = (s.monthlyValue ?? 0) > 0
      ? `${formatMoney(s.monthlyValue ?? 0, cur)}/mo`
      : null
    if (upfrontLabel && monthlyLabel) return `${upfrontLabel} + ${monthlyLabel}`
    if (upfrontLabel) return upfrontLabel
    if (monthlyLabel) return monthlyLabel
    return formatMoney(0, cur)
  }
  if (isRange(s)) {
    return `${formatMoney(s.valueMin ?? 0, cur)}\u2013${formatMoney(s.valueMax ?? 0, cur)}`
  }
  return formatMoney(s.value ?? 0, cur)
}

/**
 * Has the monetary position of a deal changed? Any of: value, valueMin,
 * valueMax, currency, upfrontValue, monthlyValue, recurringStartDate.
 */
export function valueChanged(before: ValueSnapshot, after: ValueSnapshot): boolean {
  return (
    before.value !== after.value ||
    before.valueMin !== after.valueMin ||
    before.valueMax !== after.valueMax ||
    before.currency !== after.currency ||
    (before.upfrontValue ?? null) !== (after.upfrontValue ?? null) ||
    (before.monthlyValue ?? null) !== (after.monthlyValue ?? null) ||
    (before.recurringStartDate ?? null) !== (after.recurringStartDate ?? null)
  )
}

export function valueChangeTitle(before: ValueSnapshot, after: ValueSnapshot): string {
  return `Value changed from ${describeValue(before)} to ${describeValue(after)}`
}

export function valueChangeMetadata(
  before: ValueSnapshot,
  after: ValueSnapshot,
  note?: string | null,
): Record<string, unknown> {
  return {
    before: {
      value: before.value ?? null,
      valueMin: before.valueMin ?? null,
      valueMax: before.valueMax ?? null,
      currency: before.currency ?? null,
      upfrontValue: before.upfrontValue ?? null,
      monthlyValue: before.monthlyValue ?? null,
      recurringStartDate: before.recurringStartDate ?? null,
    },
    after: {
      value: after.value ?? null,
      valueMin: after.valueMin ?? null,
      valueMax: after.valueMax ?? null,
      currency: after.currency ?? null,
      upfrontValue: after.upfrontValue ?? null,
      monthlyValue: after.monthlyValue ?? null,
      recurringStartDate: after.recurringStartDate ?? null,
    },
    note: note ?? null,
  }
}

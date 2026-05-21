/**
 * billing-derivation.ts
 *
 * Derives an org's billing model + retainer window from observable signals
 * so the user doesn't have to keep these fields up to date by hand.
 *
 * Signals consulted (all from existing tables):
 *   - `subscriptions`            active row + first start + cancelled date
 *   - `organisations.custom_mrr` legacy retainer indicator
 *   - `time_entries` × requests  billable hours in last 60 days
 *   - `projects`                 active project rows
 *   - `deals` × pipeline_stages  won deals with upfront value
 *   - `invoices`                 last paid invoice (start/end date hint)
 *
 * Manual override:
 *   When a user sets a field explicitly via PATCH /api/admin/clients/[id]
 *   the route flips `<field>_is_manual = 1` on the org row. `applyDerivation`
 *   reads those flags and skips manually-overridden fields, so derivation
 *   never steamrolls a deliberate user choice. Clearing the flag (e.g.
 *   "Re-enable auto" in the UI) makes auto-derivation reclaim the field.
 *
 * This module talks to the DB via raw SQL because three of the columns
 * (`billing_model`, `retainer_start_date`, `retainer_end_date`) and the
 * three `_is_manual` flags live in migration 0016 which has been applied
 * to prod via MCP but is not yet reflected in `db/schema.ts` (Decision
 * #039 lesson: do not put a column in the Drizzle schema until the
 * migration has run cleanly on every environment).
 */

import { sql, type SQLWrapper } from 'drizzle-orm'

// Loose database type to keep this module independent of the Drizzle D1
// generic. The two methods we use are `.all` (read) and `.run` (write).
type AnyDb = {
  all: <T = unknown>(q: SQLWrapper) => Promise<T[]>
  run: (q: SQLWrapper) => Promise<unknown>
}

export type BillingModel = 'retainer' | 'hourly' | 'project' | 'none'

const RECENT_BILLABLE_WINDOW_DAYS = 60

export interface BillingSignals {
  hasActiveSubscription: boolean
  customMrr: number | null
  recentBillableHours: number
  hasActiveProject: boolean
  hasWonDealWithUpfront: boolean
  firstSubscriptionStart: string | null
  lastPaidInvoiceDate: string | null
  cancelledSubscriptionAt: string | null
}

export interface DerivedBilling {
  billingModel: BillingModel
  retainerStartDate: string | null
  retainerEndDate: string | null
  /** Human-readable summary of which signals drove the decision. */
  reasoning: string
}

/**
 * Pull every signal we need to derive billing for one org in a single
 * round-trip batch. Each query is read-only.
 */
export async function gatherBillingSignals(database: AnyDb, orgId: string): Promise<BillingSignals> {
  const windowStart = new Date(Date.now() - RECENT_BILLABLE_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const [subAgg, orgRow, hoursAgg, projCount, dealCount, invRow] = await Promise.all([
    database.all<{
      first_start: string | null
      cancelled_at: string | null
      has_active: number
    }>(sql`
      SELECT
        MIN(current_period_start) AS first_start,
        MAX(cancelled_at) AS cancelled_at,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS has_active
      FROM subscriptions
      WHERE org_id = ${orgId}
    `),
    database.all<{ custom_mrr: number | null }>(sql`
      SELECT custom_mrr FROM organisations WHERE id = ${orgId}
    `),
    database.all<{ total: number | null }>(sql`
      SELECT COALESCE(SUM(t.hours), 0) AS total
      FROM time_entries t
      INNER JOIN requests r ON t.request_id = r.id
      WHERE r.org_id = ${orgId}
        AND t.billable = 1
        AND t.date >= ${windowStart}
    `),
    database.all<{ c: number }>(sql`
      SELECT COUNT(*) AS c FROM projects
      WHERE org_id = ${orgId} AND status NOT IN ('completed', 'cancelled', 'archived')
    `),
    database.all<{ c: number }>(sql`
      SELECT COUNT(*) AS c
      FROM deals d
      INNER JOIN pipeline_stages s ON d.stage_id = s.id
      WHERE d.org_id = ${orgId}
        AND s.is_closed_won = 1
        AND (d.upfront_value IS NOT NULL OR d.upfront_value_nzd IS NOT NULL)
    `),
    database.all<{ last_paid: string | null }>(sql`
      SELECT MAX(paid_at) AS last_paid FROM invoices
      WHERE org_id = ${orgId} AND status = 'paid'
    `),
  ])

  return {
    hasActiveSubscription: (subAgg[0]?.has_active ?? 0) > 0,
    customMrr: orgRow[0]?.custom_mrr ?? null,
    recentBillableHours: Number(hoursAgg[0]?.total ?? 0),
    hasActiveProject: (projCount[0]?.c ?? 0) > 0,
    hasWonDealWithUpfront: (dealCount[0]?.c ?? 0) > 0,
    firstSubscriptionStart: subAgg[0]?.first_start ?? null,
    lastPaidInvoiceDate: invRow[0]?.last_paid ?? null,
    cancelledSubscriptionAt: subAgg[0]?.cancelled_at ?? null,
  }
}

/**
 * Pure function: given a set of signals, decide the billing model and the
 * retainer window. Order of precedence (strongest signal wins):
 *
 *   1. Active Stripe subscription            → retainer
 *   2. customMrr set + > 0                   → retainer
 *   3. Billable hours in last 60 days alone  → hourly
 *   4. Active project or won deal with upfront → project
 *   5. Otherwise                             → none
 *
 * Retainer dates only set when the model is retainer. Start = first
 * subscription start or last paid invoice (best signal of when the
 * relationship financially began). End = cancelled date if subscription
 * was cancelled and no active sub remains, else null (still open).
 */
export function deriveBilling(signals: BillingSignals): DerivedBilling {
  const reasons: string[] = []
  let model: BillingModel = 'none'

  if (signals.hasActiveSubscription) {
    model = 'retainer'
    reasons.push('active Stripe subscription')
  } else if (signals.customMrr && signals.customMrr > 0) {
    model = 'retainer'
    reasons.push(`customMrr ${signals.customMrr}`)
  } else if (signals.recentBillableHours > 0 && !signals.hasActiveProject) {
    model = 'hourly'
    reasons.push(`${signals.recentBillableHours.toFixed(1)} billable hrs (last ${RECENT_BILLABLE_WINDOW_DAYS}d)`)
  } else if (signals.hasActiveProject || signals.hasWonDealWithUpfront) {
    model = 'project'
    reasons.push(signals.hasActiveProject ? 'active project' : 'won deal with upfront value')
  } else {
    reasons.push('no active signals')
  }

  let retainerStartDate: string | null = null
  let retainerEndDate: string | null = null

  if (model === 'retainer') {
    retainerStartDate = signals.firstSubscriptionStart ?? signals.lastPaidInvoiceDate ?? null
    if (!signals.hasActiveSubscription && signals.cancelledSubscriptionAt) {
      retainerEndDate = signals.cancelledSubscriptionAt
    }
  }

  return {
    billingModel: model,
    retainerStartDate,
    retainerEndDate,
    reasoning: reasons.join(' + '),
  }
}

export interface ApplyResult {
  orgId: string
  signals: BillingSignals
  derived: DerivedBilling
  applied: {
    billingModel: boolean
    retainerStartDate: boolean
    retainerEndDate: boolean
  }
  skippedDueToManual: string[]
}

/**
 * Compute the derived billing for one org and write the result to the
 * org row, but only for fields that are NOT flagged as manually overridden.
 * Returns a structured result so callers can show "applied to: …, skipped: …".
 */
export async function applyBillingDerivation(database: AnyDb, orgId: string): Promise<ApplyResult> {
  const signals = await gatherBillingSignals(database, orgId)
  const derived = deriveBilling(signals)

  // Manual override flags live in migration 0016. If those columns don't
  // exist yet on this environment (legacy prod before the migration runs),
  // treat the org as not-manually-overridden and proceed. Without this
  // fallback the entire derivation would 500 on every legacy env.
  let flags = { billing_model_is_manual: 0, retainer_dates_is_manual: 0 }
  try {
    const flagRow = await database.all<{
      billing_model_is_manual: number | null
      retainer_dates_is_manual: number | null
    }>(sql`
      SELECT billing_model_is_manual, retainer_dates_is_manual
      FROM organisations WHERE id = ${orgId}
    `)
    if (flagRow[0]) {
      flags = {
        billing_model_is_manual: flagRow[0].billing_model_is_manual ?? 0,
        retainer_dates_is_manual: flagRow[0].retainer_dates_is_manual ?? 0,
      }
    }
  } catch {
    // Flag columns not present — default to no overrides.
  }

  const skipped: string[] = []
  const applied = { billingModel: false, retainerStartDate: false, retainerEndDate: false }
  const now = new Date().toISOString()

  if (!flags.billing_model_is_manual) {
    try {
      await database.run(sql`
        UPDATE organisations
        SET billing_model = ${derived.billingModel}, updated_at = ${now}
        WHERE id = ${orgId}
      `)
      applied.billingModel = true
    } catch {
      // billing_model column missing — pre-migration env. Skip silently.
    }
  } else {
    skipped.push('billingModel')
  }

  if (!flags.retainer_dates_is_manual) {
    try {
      await database.run(sql`
        UPDATE organisations
        SET retainer_start_date = ${derived.retainerStartDate},
            retainer_end_date = ${derived.retainerEndDate},
            updated_at = ${now}
        WHERE id = ${orgId}
      `)
      applied.retainerStartDate = true
      applied.retainerEndDate = true
    } catch {
      // Date columns missing — pre-migration env. Skip silently.
    }
  } else {
    skipped.push('retainerDates')
  }

  return { orgId, signals, derived, applied, skippedDueToManual: skipped }
}

/**
 * Sweep every non-archived org. Failures on a single org are logged and
 * the loop continues so one bad row never blocks the rest.
 */
export async function applyBillingDerivationToAllOrgs(database: AnyDb): Promise<ApplyResult[]> {
  const orgs = await database.all<{ id: string }>(sql`
    SELECT id FROM organisations WHERE status != 'archived'
  `)
  const results: ApplyResult[] = []
  for (const org of orgs) {
    try {
      results.push(await applyBillingDerivation(database, org.id))
    } catch (err) {
      console.warn(`[billing-derivation] failed for ${org.id}:`, err instanceof Error ? err.message : err)
    }
  }
  return results
}

/**
 * Reset the manual-override flags for one org so the next derivation pass
 * reclaims the affected fields. Used by the "Re-enable auto" UI. Silent
 * no-op when the flag columns don't exist yet.
 */
export async function clearManualOverrides(
  database: AnyDb,
  orgId: string,
  fields: { billingModel?: boolean; retainerDates?: boolean; customMrr?: boolean },
): Promise<void> {
  const updates: SQLWrapper[] = []
  if (fields.billingModel) updates.push(sql`billing_model_is_manual = 0`)
  if (fields.retainerDates) updates.push(sql`retainer_dates_is_manual = 0`)
  if (fields.customMrr) updates.push(sql`custom_mrr_is_manual = 0`)
  if (updates.length === 0) return
  const setClause = sql.join(updates, sql`, `)
  try {
    await database.run(sql`UPDATE organisations SET ${setClause} WHERE id = ${orgId}`)
  } catch {
    // Flag columns missing — caller will still hit applyBillingDerivation
    // which treats absent flags as "no manual override," so the desired
    // outcome (auto reclaims the field) still happens.
  }
}

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, and, lte, inArray } from 'drizzle-orm'
import { logAudit } from '@/lib/audit'
import {
  planStampInvoiced,
  type StampInvoicedEntry,
  type StampInvoicedOrg,
} from '@/lib/stamp-invoiced'

/**
 * POST /api/admin/time/stamp-invoiced
 *
 * IC.8: the pre-cutover step for the hourly-to-Xero export (IC.6 / CT.13).
 * Migration 0095 gave the export an idempotency key (time_entries.invoice_id,
 * invoiced_at) but no backfill, so every entry logged before the export existed
 * carries invoice_id = NULL, which reads as "never billed" whether or not it
 * actually was. Any of those hours already invoiced by hand (the old
 * ManyRequests flow, or typed straight into Xero) would be billed a SECOND time
 * the first time the export runs over that period.
 *
 * This route draws a line at a cutoff date and marks every billable entry on
 * or before it as already accounted for. It stamps invoiced_at = now and
 * leaves invoice_id NULL: invoice_id names the local invoice that billed the
 * hours, and there is no such invoice for work billed outside this app.
 * invoiced_at alone is enough, because POST /api/admin/billing/xero-export now
 * selects candidates with invoice_id IS NULL AND invoiced_at IS NULL, so a
 * stamped row drops out of the next export's candidate list exactly like an
 * already-invoiced row does. This route never calls Xero and never raises an
 * invoice; see lib/stamp-invoiced.ts for the pure planner.
 *
 * Body: { orgId?: string, before: 'YYYY-MM-DD' (required, inclusive), dryRun?: boolean }
 * `dryRun` DEFAULTS TO TRUE. The unqualified call is the plan; pass
 * {"dryRun": false} to actually stamp the rows.
 *
 * An entry that already carries invoice_id is refused, never re-stamped: it
 * was billed through the export (or by a future manual link) and stamping it
 * again would only hide when that happened. An entry already stamped by an
 * earlier run of this same route is reported, not re-counted, which is what
 * makes a second call with the same cutoff a no-op.
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ orgId, userId }, 'billing')
  if (featureDenied) return featureDenied

  const body = await req.json().catch(() => ({})) as {
    orgId?: unknown
    before?: unknown
    dryRun?: unknown
  }

  if (typeof body.before !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.before)) {
    return NextResponse.json(
      { error: 'before is required and must be a calendar date in YYYY-MM-DD form' },
      { status: 400 },
    )
  }
  if (body.orgId !== undefined && (typeof body.orgId !== 'string' || body.orgId === '')) {
    return NextResponse.json({ error: 'orgId must be a non-empty string' }, { status: 400 })
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return NextResponse.json({ error: 'dryRun must be true or false' }, { status: 400 })
  }

  const before = body.before
  const orgFilter = typeof body.orgId === 'string' ? body.orgId : undefined
  // Safer default: an operator who does not say gets the plan, not the stamp.
  const dryRun = body.dryRun !== false

  const database = await db() as DB

  const conditions = [
    eq(schema.timeEntries.billable, true),
    lte(schema.timeEntries.date, before),
  ]
  if (orgFilter) conditions.push(eq(schema.timeEntries.orgId, orgFilter))

  // Every billable entry on or before the cutoff, in whatever invoice state it
  // holds. Unlike the export, this reads invoice_id AND invoiced_at rather
  // than filtering on either, because a refusal has to name entries that are
  // already invoiced separately from entries this same route already stamped.
  const entryRows = await database
    .select({
      id: schema.timeEntries.id,
      orgId: schema.timeEntries.orgId,
      hours: schema.timeEntries.hours,
      hourlyRate: schema.timeEntries.hourlyRate,
      invoiceId: schema.timeEntries.invoiceId,
      invoicedAt: schema.timeEntries.invoicedAt,
    })
    .from(schema.timeEntries)
    .where(and(...conditions))

  const entries: StampInvoicedEntry[] = entryRows.map(row => ({
    id: row.id,
    orgId: row.orgId,
    hours: row.hours,
    hourlyRate: row.hourlyRate ?? null,
    invoiceId: row.invoiceId ?? null,
    invoicedAt: row.invoicedAt ?? null,
  }))

  const orgIds = [...new Set(entries.map(e => e.orgId))]

  if (orgIds.length === 0) {
    return NextResponse.json({
      success: true,
      before,
      dryRun,
      orgId: orgFilter ?? null,
      planCount: 0,
      plans: [],
      skippedCount: 0,
      skipped: [],
      stampedCount: 0,
    })
  }

  const orgRows = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
    .where(inArray(schema.organisations.id, orgIds))

  const orgs: StampInvoicedOrg[] = orgRows.map(row => ({ id: row.id, name: row.name }))

  const { plans, skipped } = planStampInvoiced({ entries, orgs, before })

  if (dryRun) {
    return NextResponse.json({
      success: true,
      before,
      dryRun: true,
      orgId: orgFilter ?? null,
      planCount: plans.length,
      plans,
      skippedCount: skipped.length,
      skipped,
      stampedCount: 0,
    })
  }

  const stampEntryIds = plans.flatMap(plan => plan.entryIds)

  if (stampEntryIds.length > 0) {
    const now = new Date().toISOString()

    // invoiced_at only. invoice_id is never written here: this run raises no
    // invoice, so there is no invoice id to record.
    await database
      .update(schema.timeEntries)
      .set({ invoicedAt: now })
      .where(inArray(schema.timeEntries.id, stampEntryIds))

    await logAudit(database, {
      action: 'time_entries_stamp_invoiced',
      userId,
      userType: 'team_member',
      entityType: 'time_entry',
      entityId: orgFilter ?? 'all_orgs',
      metadata: {
        reason: 'Pre-cutover stamp before the first live hourly Xero export (IC.8): marks hours already invoiced by hand as accounted for, so the next export cannot bill them again.',
        before,
        orgId: orgFilter ?? null,
        stampedCount: stampEntryIds.length,
        entryIds: stampEntryIds,
        plans: plans.map(plan => ({
          orgId: plan.orgId,
          orgName: plan.orgName,
          hours: plan.hours,
          entryCount: plan.entryCount,
          rates: plan.rates,
        })),
      },
    })
  }

  return NextResponse.json({
    success: true,
    before,
    dryRun: false,
    orgId: orgFilter ?? null,
    planCount: plans.length,
    plans,
    skippedCount: skipped.length,
    skipped,
    stampedCount: stampEntryIds.length,
  })
}

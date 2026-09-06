import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lt, inArray, isNull, isNotNull, sql } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'
import {
  planHourlyExport,
  type HourlyExportEntry,
  type HourlyExportOrg,
  type HourlyExportPlan,
} from '@/lib/hourly-export'
import { withInvoiceNumber } from '@/lib/invoice-number'
import { invoiceReference } from '@/lib/invoice-billing'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/billing/xero-export
 *
 * Turns a month of unbilled hourly time into draft invoices, locally and in
 * Xero. Four guards stand between the time sheet and a client's bill, and each
 * one names itself in the response rather than skipping quietly:
 *
 *  1. Idempotency. Only entries with time_entries.invoice_id IS NULL are
 *     candidates, and every entry billed is stamped with the invoice it landed
 *     on inside the same run (migration 0095). Re-running the same period
 *     produces zero new lines and says which clients were already exported.
 *  2. Billing model. Only organisations.billing_model = 'hourly' is eligible.
 *     A retainer client's hours are already paid for by the retainer, and a
 *     project client's by the project, so billing them per hour charges twice.
 *  3. Currency. Every line is built in the client's own invoice currency, and
 *     hours logged against another client that is not billed in that currency
 *     refuse the export rather than being converted here.
 *  4. Rates. A null rate resolves through organisations.default_hourly_rate; if
 *     it is still missing or zero the client's export is refused and the entry
 *     ids are returned. The old route dropped those clients with a bare
 *     `continue`.
 *
 * Body (all optional): { month?: 'YYYY-MM', dryRun?: boolean }
 * `dryRun` DEFAULTS TO TRUE. This route writes invoices and calls Xero, so the
 * unqualified call is the preview; pass {"dryRun": false} to apply.
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'billing')
  if (featureDenied) return featureDenied

  const body = await req.json().catch(() => ({})) as { month?: string; dryRun?: unknown }

  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return NextResponse.json({ error: 'dryRun must be true or false' }, { status: 400 })
  }
  // Safer default: an operator who does not say gets the plan, not the bills.
  const dryRun = body.dryRun !== false

  const now = new Date()
  let year: number
  let month: number

  if (body.month !== undefined) {
    if (typeof body.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) {
      return NextResponse.json(
        { error: 'month must be a calendar month in YYYY-MM form, for example 2026-08' },
        { status: 400 },
      )
    }
    ;[year, month] = body.month.split('-').map(Number)
  } else {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    year = prev.getFullYear()
    month = prev.getMonth() + 1
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-NZ', {
    month: 'long',
    year: 'numeric',
  })

  const database = await db() as unknown as D1

  const inWindow = and(
    gte(schema.timeEntries.date, startDate),
    lt(schema.timeEntries.date, endDate),
    eq(schema.timeEntries.billable, true),
  )

  // Candidates: billable, in the month, never exported. The requests join
  // carries the org that OWNS the work, which is not always the org being
  // billed and is the only per-entry currency signal that exists.
  const entryRows = await database
    .select({
      id: schema.timeEntries.id,
      orgId: schema.timeEntries.orgId,
      hours: schema.timeEntries.hours,
      hourlyRate: schema.timeEntries.hourlyRate,
      requestOrgId: schema.requests.orgId,
    })
    .from(schema.timeEntries)
    .leftJoin(schema.requests, eq(schema.timeEntries.requestId, schema.requests.id))
    .where(and(inWindow, isNull(schema.timeEntries.invoiceId)))

  // The other half of the same window: what an earlier run already billed. Read
  // so a re-run can say why it is doing nothing instead of returning an empty
  // list that looks like a broken query.
  const exportedRows = await database
    .select({
      id: schema.timeEntries.id,
      orgId: schema.timeEntries.orgId,
    })
    .from(schema.timeEntries)
    .where(and(inWindow, isNotNull(schema.timeEntries.invoiceId)))

  const entries: HourlyExportEntry[] = entryRows.map(row => ({
    id: row.id,
    orgId: row.orgId,
    hours: row.hours,
    hourlyRate: row.hourlyRate,
    requestOrgId: row.requestOrgId ?? null,
  }))
  const alreadyExported = exportedRows.map(row => ({ id: row.id, orgId: row.orgId }))

  const orgIds = [...new Set([
    ...entries.map(e => e.orgId),
    ...entries.map(e => e.requestOrgId).filter((id): id is string => Boolean(id)),
    ...alreadyExported.map(e => e.orgId),
  ])]

  if (orgIds.length === 0) {
    return NextResponse.json({
      success: true,
      month: monthLabel,
      dryRun,
      invoiceCount: 0,
      invoices: [],
      skippedCount: 0,
      skipped: [],
    })
  }

  // organisations.billing_model lives in migration 0016 and is not modelled in
  // db/schema.ts (the same reason lib/billing-derivation.ts reads it as raw
  // SQL), so it is selected as an expression alongside the typed columns.
  const orgRows = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      xeroContactId: schema.organisations.xeroContactId,
      defaultHourlyRate: schema.organisations.defaultHourlyRate,
      preferredCurrency: schema.organisations.preferredCurrency,
      billingModel: sql<string | null>`billing_model`,
    })
    .from(schema.organisations)
    .where(inArray(schema.organisations.id, orgIds))

  const orgs: HourlyExportOrg[] = orgRows.map(row => ({
    id: row.id,
    name: row.name,
    xeroContactId: row.xeroContactId ?? null,
    defaultHourlyRate: row.defaultHourlyRate ?? null,
    preferredCurrency: row.preferredCurrency ?? null,
    billingModel: row.billingModel ?? null,
  }))

  const { plans, skipped } = planHourlyExport({ entries, alreadyExported, orgs, monthLabel })

  if (dryRun) {
    return NextResponse.json({
      success: true,
      month: monthLabel,
      dryRun: true,
      invoiceCount: plans.length,
      invoices: plans.map(plan => ({ ...describePlan(plan), status: 'dry_run' })),
      skippedCount: skipped.length,
      skipped,
    })
  }

  const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
  const results = []

  for (const plan of plans) {
    const invoiceId = crypto.randomUUID()
    const invoiceNow = new Date().toISOString()
    let invoiceNumber: string | null = null

    try {
      // Raised here, so numbered here: this is the third dashboard rail that
      // mints from the studio sequence, and the number below is what Xero is
      // told the invoice is called. Only the invoice row is inside the retry;
      // the lines and the time-entry stamp follow once it has landed.
      invoiceNumber = await withInvoiceNumber(database, async (minted) => {
        await database.insert(schema.invoices).values({
          id: invoiceId,
          orgId: plan.orgId,
          source: 'xero',
          status: 'draft',
          number: minted,
          amountUsd: plan.amount,
          totalUsd: plan.amount,
          currency: plan.currency,
          dueDate,
          notes: `Auto-generated for ${monthLabel} billable hours`,
          createdAt: invoiceNow,
          updatedAt: invoiceNow,
        })
      })

      for (const line of plan.lines) {
        await database.insert(schema.invoiceItems).values({
          id: crypto.randomUUID(),
          invoiceId,
          description: line.description,
          quantity: line.hours,
          unitPriceUsd: line.rate,
          totalUsd: line.amount,
        })
      }

      // Stamp BEFORE the Xero call. The local invoice is the record of what was
      // billed; a Xero failure afterwards leaves a draft to push again, not a
      // month of hours that the next run would bill a second time.
      await database
        .update(schema.timeEntries)
        .set({ invoiceId, invoicedAt: invoiceNow })
        .where(inArray(schema.timeEntries.id, plan.entryIds))
    } catch (err) {
      console.error('[xero-export] failed to raise invoice', err)
      results.push({
        ...describePlan(plan),
        status: 'error',
        error: 'Could not raise the invoice for this client. Nothing was billed.',
      })
      continue
    }

    let xeroStatus = 'no_xero_contact'
    if (plan.xeroContactId) {
      // Same tax convention as the manual push (app/api/admin/invoices/xero-sync):
      // GST on NZD, no tax on anything else.
      const isNzd = plan.currency === 'NZD'
      const xeroResult = await callXeroAPI<{ Invoices?: Array<{ InvoiceID: string; InvoiceNumber: string }> }>('POST', '/Invoices', {
        Invoices: [{
          Type: 'ACCREC',
          Status: 'DRAFT',
          Contact: { ContactID: plan.xeroContactId },
          // Our number, not Xero's. The studio owns the sequence, so the bill
          // in Xero is called the same thing as the bill in the dashboard and
          // the reference on the client's transfer. Falls back to the short id
          // when the counter could not be reached, which is still a stable
          // string both sides can be matched on.
          InvoiceNumber: invoiceReference(invoiceId, invoiceNumber),
          DueDate: dueDate,
          CurrencyCode: plan.currency,
          LineAmountTypes: isNzd ? 'Exclusive' : 'NoTax',
          LineItems: plan.lines.map(line => ({
            Description: line.description,
            Quantity: line.hours,
            UnitAmount: line.rate,
            AccountCode: '200',
            TaxType: isNzd ? 'OUTPUT2' : 'NONE',
          })),
        }],
      })

      if (xeroResult?.Invoices?.[0]) {
        await database.update(schema.invoices).set({
          xeroInvoiceId: xeroResult.Invoices[0].InvoiceID,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.invoices.id, invoiceId))
        xeroStatus = 'synced'
      } else {
        xeroStatus = 'xero_failed'
      }
    }

    results.push({
      ...describePlan(plan),
      invoiceId,
      invoiceNumber,
      status: 'created',
      xeroStatus,
    })
  }

  return NextResponse.json({
    success: true,
    month: monthLabel,
    dryRun: false,
    invoiceCount: results.length,
    invoices: results,
    skippedCount: skipped.length,
    skipped,
  })
}

/** The client-facing shape of one planned invoice, dry run or applied. */
function describePlan(plan: HourlyExportPlan) {
  return {
    orgId: plan.orgId,
    orgName: plan.orgName,
    currency: plan.currency,
    hours: plan.hours,
    amount: plan.amount,
    entryCount: plan.entryIds.length,
    entryIds: plan.entryIds,
    lines: plan.lines,
  }
}

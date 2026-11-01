/**
 * GET /api/admin/reports/income-goal   (current UTC month only; ?month= other than the current one returns 400)
 *
 * LP.7: the data behind the overview "Income goal" bar. One month, NZD, five
 * numbers: paid, invoiced, unbilled, pipeline, and the gap to the take-home
 * target. The arithmetic lives in lib/income-goal.ts; this route only gathers
 * rows and says where each came from.
 *
 * Sources (each reuses an existing definition):
 *  - paid      invoices with a paid status and paid_at inside the month. This is
 *              what Xero or Stripe marked paid, not bank cash. NZD rows count
 *              ex-GST (amount minus discount); other currencies use total.
 *              Rules in lib/income-goal-invoices.ts.
 *  - invoiced  owed, unpaid invoices ISSUED this month (sent_at, else
 *              created_at). Older unpaid invoices come back as
 *              olderOutstandingNzd and stay out of projected and the gap.
 *  - Stripe charge twins (ch_ or py_ rows with an in_ twin under
 *    lib/stripe-dedupe.ts) are left out of Paid and Invoiced at read time and
 *    counted in notes.twinsExcluded. Nothing is deleted or changed. The import
 *    guard in lib/stripe-sync.ts can still write new twins, so this stays on.
 *  - Month boundaries are UTC, like the finance summary.
 *  - unbilled  billable time_entries dated in the month with no invoice link
 *              and no invoiced_at stamp, for clients whose billing_model is
 *              'hourly' (the export's own eligibility rule), priced with
 *              resolveRate() from lib/hourly-export.ts. Entries with no usable
 *              rate are counted in unratedHours and left out of the amount.
 *  - pipeline  open, non-archived deals whose expected_close_date is inside the
 *              month, or already passed by up to 90 days (rolled into this month),
 *              upfront_value_nzd times the stage probability: the same weighting
 *              as the pipeline-forecast route. No close date, or more than 90
 *              days overdue, means left out (stale deals are counted in
 *              notes.pipelineStaleDeals). Monthly recurring value is not
 *              counted. Only the current month is supported.
 *  - target    (finance.liamTakeHomeAnnual + finance.staciTakeHomeAnnual) / 12,
 *              take-home only, before costs and tax. These keys already exist
 *              (the finance page edits them). When one is unset this route
 *              uses the confirmed NZ$64k a year, whereas the finance summary
 *              falls back to a stale NZ$52k; they differ only if a key is unset.
 *
 * Admin only: Tahi admin org, full admin, and the financial_reports feature,
 * the same three guards as the finance summary.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireAdmin } from '@/lib/require-admin'
import { requireFeature } from '@/lib/require-feature'
import { owedStatusList, paidStatusList } from '@/lib/invoice-status'
import { resolveOrgCurrency, resolveRate } from '@/lib/hourly-export'
import { computeIncomeGoal, monthlyTargetFromAnnual, pipelineDealPlacement, type MoneyItem } from '@/lib/income-goal'
import { bucketInvoices, resolveChargeTwins, type GoalInvoiceRow } from '@/lib/income-goal-invoices'

export const dynamic = 'force-dynamic'

/** Confirmed 2026-09-26: NZ$64k each a year. Only used when a setting is unset. */
const DEFAULT_TAKE_HOME_ANNUAL_EACH = 64000

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

function settingNumber(map: Map<string, string | null>, key: string): number {
  const n = parseFloat(map.get(key) ?? '')
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TAKE_HOME_ANNUAL_EACH
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied
  const featureDenied = await requireFeature({ userId, orgId }, 'financial_reports')
  if (featureDenied) return featureDenied

  // The current month only, in UTC (the worker clock). The figures mix
  // point-in-time facts (what is unpaid now, deals open now) with the month,
  // so a past or future month would not be a snapshot of that month. A
  // `month` that is not the current one is refused rather than answered
  // misleadingly.
  const monthParam = new URL(req.url).searchParams.get('month')
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const monthKey = `${year}-${pad(month)}`
  if (monthParam !== null && !(MONTH_RE.test(monthParam) && monthParam === monthKey)) {
    return NextResponse.json({ error: `Only the current month (${monthKey}) is supported` }, { status: 400 })
  }
  const todayDate = now.toISOString().slice(0, 10)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const startIso = new Date(Date.UTC(year, month - 1, 1)).toISOString()
  const endIso = new Date(Date.UTC(nextYear, nextMonth - 1, 1)).toISOString()
  const startDate = `${monthKey}-01`
  const endDate = `${nextYear}-${pad(nextMonth)}-01`

  const database = await db()

  const [rates, settingRows, invoiceRows, timeRows, dealRows] = await Promise.all([
    database.select().from(schema.exchangeRates),
    database
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(inArray(schema.settings.key, ['finance.liamTakeHomeAnnual', 'finance.staciTakeHomeAnnual'])),
    // Invoices that can matter: paid in the month, owed and unpaid (any issue
    // date), and every Stripe row (twin detection needs the in_ side wherever
    // it sits). bucketInvoices() does the real sorting.
    database
      .select({
        id: schema.invoices.id,
        orgId: schema.invoices.orgId,
        stripeInvoiceId: schema.invoices.stripeInvoiceId,
        source: schema.invoices.source,
        status: schema.invoices.status,
        amountUsd: schema.invoices.amountUsd,
        discountAmountUsd: schema.invoices.discountAmountUsd,
        totalUsd: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
        createdAt: schema.invoices.createdAt,
        sentAt: schema.invoices.sentAt,
        paidAt: schema.invoices.paidAt,
        manyrequestsId: schema.invoices.manyrequestsId,
        xeroInvoiceId: schema.invoices.xeroInvoiceId,
      })
      .from(schema.invoices)
      // Wide on purpose: paid_at comes in several string shapes (including
      // '/Date(ms)/'), so a SQL range would lose rows. Dates are compared in
      // JS after normalising (lib/income-goal-invoices.ts).
      .where(or(
        inArray(schema.invoices.status, paidStatusList()),
        and(inArray(schema.invoices.status, owedStatusList()), isNull(schema.invoices.paidAt)),
        eq(schema.invoices.source, 'stripe'),
      )),
    database
      .select({
        orgId: schema.timeEntries.orgId,
        hours: schema.timeEntries.hours,
        hourlyRate: schema.timeEntries.hourlyRate,
      })
      .from(schema.timeEntries)
      .where(and(
        eq(schema.timeEntries.billable, true),
        isNull(schema.timeEntries.invoiceId),
        isNull(schema.timeEntries.invoicedAt),
        gte(schema.timeEntries.date, startDate),
        lt(schema.timeEntries.date, endDate),
      )),
    database
      .select({
        upfrontNzd: schema.deals.upfrontValueNzd,
        expectedCloseDate: schema.deals.expectedCloseDate,
        probability: schema.pipelineStages.probability,
      })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
      .where(and(
        eq(schema.pipelineStages.isClosedWon, 0),
        eq(schema.pipelineStages.isClosedLost, 0),
        sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`,
        // A close date at or before the end of the month. A date that has
        // already passed rolls into this month. NULL fails the comparison and
        // so stays out.
        sql`substr(${schema.deals.expectedCloseDate}, 1, 10) < ${endDate}`,
      )),
  ])

  // Unbilled: price each entry, per client. billing_model is not modelled in
  // db/schema.ts (migration 0016), so it is selected as an expression.
  const orgIds = [...new Set(timeRows.map(r => r.orgId))]
  const orgRows = orgIds.length === 0
    ? []
    : await database
        .select({
          id: schema.organisations.id,
          defaultHourlyRate: schema.organisations.defaultHourlyRate,
          preferredCurrency: schema.organisations.preferredCurrency,
          billingModel: sql<string | null>`billing_model`,
        })
        .from(schema.organisations)
        .where(inArray(schema.organisations.id, orgIds))
  const orgById = new Map(orgRows.map(o => [o.id, o]))

  const unbilledItems: MoneyItem[] = []
  let unbilledHours = 0
  let unratedHours = 0
  let skippedHours = 0
  for (const entry of timeRows) {
    const org = orgById.get(entry.orgId)
    const model = typeof org?.billingModel === 'string' ? org.billingModel.trim().toLowerCase() : ''
    // Only hourly clients are invoiced by the hour. Retainer and project hours
    // are already covered by what those clients pay, so they are not unbilled.
    if (!org || model !== 'hourly') continue
    const hours = Number(entry.hours)
    if (!Number.isFinite(hours) || hours <= 0) continue
    const currency = resolveOrgCurrency({ preferredCurrency: org.preferredCurrency ?? null })
    if (!currency) {
      skippedHours += hours
      continue
    }
    const rate = resolveRate(entry.hourlyRate ?? null, org.defaultHourlyRate ?? null)
    if (rate === null) {
      unratedHours += hours
      continue
    }
    unbilledHours += hours
    unbilledItems.push({ amount: hours * rate, currency })
  }

  const goalRows: GoalInvoiceRow[] = invoiceRows.map(r => ({
    ...r,
    status: r.status,
    discountAmountUsd: r.discountAmountUsd ?? null,
  }))
  const buckets = bucketInvoices(goalRows, resolveChargeTwins(goalRows.filter(r => r.source === 'stripe')), startIso, endIso)

  const placed = dealRows.map(d => ({
    deal: d,
    where: pipelineDealPlacement(d.expectedCloseDate, startDate, endDate, { isCurrentMonth: true, todayDate }),
  }))
  const counted = placed.filter(p => p.where === 'in' || p.where === 'rolled')
  const pipelineItems: MoneyItem[] = counted
    .map(p => p.deal)
    .map(d => ({
    amount: (d.upfrontNzd ?? 0) * ((d.probability ?? 0) / 100),
    currency: 'NZD',
  }))

  const settingsMap = new Map(settingRows.map(r => [r.key, r.value]))
  const liamAnnual = settingNumber(settingsMap, 'finance.liamTakeHomeAnnual')
  const staciAnnual = settingNumber(settingsMap, 'finance.staciTakeHomeAnnual')

  const result = computeIncomeGoal({
    targetMonthlyNzd: monthlyTargetFromAnnual(liamAnnual, staciAnnual),
    paid: buckets.paid,
    invoiced: buckets.invoiced,
    olderOutstanding: buckets.olderOutstanding,
    unbilled: unbilledItems,
    pipeline: pipelineItems,
    rates,
  })

  const round1 = (n: number) => Math.round(n * 10) / 10
  return NextResponse.json({
    month: monthKey,
    currency: 'NZD',
    ...result,
    notes: {
      unbilledHours: round1(unbilledHours),
      unratedHours: round1(unratedHours),
      skippedHours: round1(skippedHours),
      pipelineDeals: counted.length,
      pipelineRolledOverDeals: placed.filter(p => p.where === 'rolled').length,
      pipelineStaleDeals: placed.filter(p => p.where === 'stale').length,
      unknownDateInvoices: buckets.unknownDate,
      twinsExcluded: buckets.twinsExcluded,
      targetAnnualNzd: { liam: liamAnnual, staci: staciAnnual },
    },
  })
}

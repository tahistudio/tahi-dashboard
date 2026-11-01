/**
 * GET /api/admin/reports/income-goal?month=YYYY-MM
 *
 * LP.7: the data behind the overview "Income goal" bar. One month, NZD, five
 * numbers: paid, invoiced, unbilled, pipeline, and the gap to the take-home
 * target. The arithmetic lives in lib/income-goal.ts; this route only gathers
 * rows and says where each came from.
 *
 * Sources (each reuses an existing definition):
 *  - paid      invoices.paid_at inside the month, same basis as the finance
 *              summary's thisMonth revenue. Native amounts converted to NZD.
 *  - invoiced  owedStatusList() invoices (lib/invoice-status.ts), the same set
 *              as Receivables. Not limited to the month: an invoice sent last
 *              month and still unpaid is still money the studio is waiting on.
 *  - unbilled  billable time_entries dated in the month with no invoice link
 *              and no invoiced_at stamp, for clients whose billing_model is
 *              'hourly' (the export's own eligibility rule), priced with
 *              resolveRate() from lib/hourly-export.ts. Entries with no usable
 *              rate are counted in unratedHours and left out of the amount.
 *  - pipeline  open, non-archived deals whose expected_close_date is inside the
 *              month, upfront_value_nzd times the stage probability: the same
 *              weighting as the pipeline-forecast route and the overview's
 *              Pipeline ahead card.
 *  - target    (finance.liamTakeHomeAnnual + finance.staciTakeHomeAnnual) / 12.
 *              These keys already exist (the finance page edits them); when
 *              one is unset the confirmed NZ$64k a year is used.
 *
 * Admin only: Tahi admin org, full admin, and the financial_reports feature,
 * the same three guards as the finance summary.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireAdmin } from '@/lib/require-admin'
import { requireFeature } from '@/lib/require-feature'
import { owedStatusList } from '@/lib/invoice-status'
import { resolveOrgCurrency, resolveRate } from '@/lib/hourly-export'
import { computeIncomeGoal, monthlyTargetFromAnnual, type MoneyItem } from '@/lib/income-goal'

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

  // The month, in UTC (the worker clock). Default is the current month.
  const monthParam = new URL(req.url).searchParams.get('month')
  const now = new Date()
  let year = now.getUTCFullYear()
  let month = now.getUTCMonth() + 1
  if (monthParam !== null) {
    const m = MONTH_RE.exec(monthParam)
    if (!m) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
    year = Number(m[1])
    month = Number(m[2])
  }
  const monthKey = `${year}-${pad(month)}`
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const startIso = new Date(Date.UTC(year, month - 1, 1)).toISOString()
  const endIso = new Date(Date.UTC(nextYear, nextMonth - 1, 1)).toISOString()
  const startDate = `${monthKey}-01`
  const endDate = `${nextYear}-${pad(nextMonth)}-01`

  const database = await db()

  const [rates, settingRows, paidRows, invoicedRows, timeRows, dealRows] = await Promise.all([
    database.select().from(schema.exchangeRates),
    database
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(inArray(schema.settings.key, ['finance.liamTakeHomeAnnual', 'finance.staciTakeHomeAnnual'])),
    database
      .select({ amount: schema.invoices.totalUsd, currency: schema.invoices.currency })
      .from(schema.invoices)
      .where(and(gte(schema.invoices.paidAt, startIso), lt(schema.invoices.paidAt, endIso))),
    database
      .select({ amount: schema.invoices.totalUsd, currency: schema.invoices.currency })
      .from(schema.invoices)
      .where(inArray(schema.invoices.status, owedStatusList())),
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
        probability: schema.pipelineStages.probability,
      })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
      .where(and(
        eq(schema.pipelineStages.isClosedWon, 0),
        eq(schema.pipelineStages.isClosedLost, 0),
        sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`,
        sql`substr(${schema.deals.expectedCloseDate}, 1, 10) >= ${startDate}`,
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

  const pipelineItems: MoneyItem[] = dealRows.map(d => ({
    amount: (d.upfrontNzd ?? 0) * ((d.probability ?? 0) / 100),
    currency: 'NZD',
  }))

  const settingsMap = new Map(settingRows.map(r => [r.key, r.value]))
  const liamAnnual = settingNumber(settingsMap, 'finance.liamTakeHomeAnnual')
  const staciAnnual = settingNumber(settingsMap, 'finance.staciTakeHomeAnnual')

  const result = computeIncomeGoal({
    targetMonthlyNzd: monthlyTargetFromAnnual(liamAnnual, staciAnnual),
    paid: paidRows,
    invoiced: invoicedRows,
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
      pipelineDeals: dealRows.length,
      targetAnnualNzd: { liam: liamAnnual, staci: staciAnnual },
    },
  })
}

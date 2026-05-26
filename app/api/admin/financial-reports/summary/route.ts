/**
 * GET /api/admin/financial-reports/summary
 *
 * The "am I on track?" payload for /financial-reports. One round-trip
 * returns everything the top half of the page needs:
 *
 * - bankBalances: sum across Airwallex + Xero accounts, currency-grouped
 * - reserves: total accrued + per-pot breakdown
 * - disposableCash: bankBalances - reserves - 30-day expected outflows
 * - mrr: { retainer, project, combined } + 12-month rolling history
 * - arr: combined MRR × 12
 * - ytdRevenue: actual cash collected in current calendar year
 * - signedThisQuarter / 30d / 60d (the "are deals dry?" signal)
 * - statusFlags: traffic-light per axis (cash, mrr, margin, AR, reserves)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, gte, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db() as unknown as D1
  const nowIso = new Date().toISOString()
  const now = Date.now()
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()

  // Add take-home settings keys to the SELECT so they're in settingsMap.
  // ── Operator-configured reserve target ────────────────────────────
  // Three settings drive the cash traffic-light:
  //   finance.reserveTargetMonths  — months of burn to keep buffered (default 4)
  //   finance.monthlyBurnNzd       — operator's stated monthly burn (defaults to MRR if unset)
  //   finance.lastYearTaxOwed      — flat extra reserve for prior-year tax (default 0)
  // All three editable from the page settings card.
  const settingsRows = await database.all<{ key: string; value: string }>(sql`
    SELECT key, value FROM settings
    WHERE key IN (
      'finance.reserveTargetMonths',
      'finance.monthlyBurnNzd',
      'finance.lastYearTaxOwed',
      'finance.quarterlyTargetNzd',
      'finance.liamTakeHomeAnnual',
      'finance.staciTakeHomeAnnual',
      'finance.takeHomeTargetEach'
    )
  `)
  const settingsMap = new Map(settingsRows.map(r => [r.key, r.value]))
  const reserveTargetMonths = Math.max(1, Math.min(24, parseFloat(settingsMap.get('finance.reserveTargetMonths') ?? '4')))
  const monthlyBurnNzd = parseFloat(settingsMap.get('finance.monthlyBurnNzd') ?? '0') || null
  const lastYearTaxOwed = parseFloat(settingsMap.get('finance.lastYearTaxOwed') ?? '0') || 0
  // Quarterly target (NZD). Operator sets one figure for the current
  // quarter; the page shows progress against it.
  const quarterlyTargetNzd = parseFloat(settingsMap.get('finance.quarterlyTargetNzd') ?? '0') || 0
  // Take-home tracking (Liam + Staci). Both pay themselves the same.
  const liamTakeHome = parseFloat(settingsMap.get('finance.liamTakeHomeAnnual') ?? '52000') || 52000
  const staciTakeHome = parseFloat(settingsMap.get('finance.staciTakeHomeAnnual') ?? '52000') || 52000
  const takeHomeTargetEach = parseFloat(settingsMap.get('finance.takeHomeTargetEach') ?? '74000') || 74000

  // ── Bank balances (Airwallex first, Xero fallback) ────────────────
  const [airwallexBalances, xeroBankBalances] = await Promise.all([
    database.select().from(schema.airwallexBalances),
    database.select().from(schema.xeroBankBalances),
  ])

  const balancesByCurrency = new Map<string, { available: number; total: number; sources: string[] }>()
  for (const b of airwallexBalances) {
    const cur = b.currency ?? 'NZD'
    const e = balancesByCurrency.get(cur) ?? { available: 0, total: 0, sources: [] }
    e.available += b.availableBalance
    e.total += b.balance
    if (!e.sources.includes('airwallex')) e.sources.push('airwallex')
    balancesByCurrency.set(cur, e)
  }
  // Xero balances only count when Airwallex hasn't reported the
  // currency — otherwise we'd double-count the same cash. Airwallex is
  // the truth-of-truths.
  for (const b of xeroBankBalances) {
    const cur = b.currency ?? 'NZD'
    if (balancesByCurrency.has(cur)) continue
    const e = { available: b.balance, total: b.balance, sources: ['xero'] }
    balancesByCurrency.set(cur, e)
  }

  // ── Reserves ──────────────────────────────────────────────────────
  const reserves = await database
    .select()
    .from(schema.reserves)
    .where(eq(schema.reserves.active, true))

  const reservesTotal = reserves.reduce((sum, r) => sum + r.accruedAmount, 0)

  // ── MRR: retainers + projects (amortised over duration) ───────────
  // Retainer MRR = SUM of organisations.custom_mrr across active clients,
  // converting each from its native currency to NZD via the FX table.
  // Most Tahi clients bill in USD/GBP/EUR — assuming NZD was wrong.
  // Migration 0056 added custom_mrr_currency (default 'NZD' so existing
  // rows behave the same until edited).
  const retainerRowsByClient = await database.all<{ id: string; mrr: number | null; currency: string | null }>(sql`
    SELECT id, custom_mrr AS mrr, COALESCE(custom_mrr_currency, 'NZD') AS currency
    FROM organisations
    WHERE status = 'active'
      AND custom_mrr IS NOT NULL
      AND custom_mrr > 0
  `)
  // Convert each native amount to NZD via the exchange_rates table.
  // Rates are stored as rate_to_usd (how many USD per 1 unit of currency).
  // To go currency → NZD: (amount × rate_to_usd) ÷ nzd_rate_to_usd.
  const fxRows = await database.all<{ currency: string; rateToUsd: number }>(sql`
    SELECT currency, rate_to_usd AS rateToUsd FROM exchange_rates
  `)
  const fxMap = new Map<string, number>()
  for (const r of fxRows) fxMap.set(r.currency, Number(r.rateToUsd))
  const nzdRate = fxMap.get('NZD') ?? 0.6  // fallback NZD/USD ≈ 0.6
  function toNzd(amount: number, currency: string): number {
    if (currency === 'NZD') return amount
    const rate = fxMap.get(currency)
    if (!rate || rate <= 0 || nzdRate <= 0) return amount  // fallback: pass through if rate unknown
    return (amount * rate) / nzdRate
  }
  const retainerMrr = retainerRowsByClient.reduce(
    (sum, r) => sum + toNzd(Number(r.mrr ?? 0), r.currency ?? 'NZD'),
    0,
  )
  const retainerClientCount = retainerRowsByClient.length

  // Project MRR = sum over active projects of (price / months active).
  // Active = (startDate ≤ now AND expectedDelivery ≥ now) OR no
  // expectedDelivery (treat as ongoing, default 4-month amortisation).
  const projects = await database
    .select({
      id: schema.projects.id,
      priceUsd: schema.projects.priceUsd,
      startDate: schema.projects.startDate,
      expectedDelivery: schema.projects.expectedDelivery,
      deliveredAt: schema.projects.deliveredAt,
      status: schema.projects.status,
    })
    .from(schema.projects)
    .where(eq(schema.projects.status, 'active'))

  let projectMrr = 0
  for (const p of projects) {
    if (!p.priceUsd || p.priceUsd <= 0) continue
    const start = p.startDate ? new Date(p.startDate).getTime() : null
    const end = p.expectedDelivery ? new Date(p.expectedDelivery).getTime() : null
    if (start && start > now) continue
    if (end && end < now) continue
    const months = (start && end) ? Math.max(1, (end - start) / (30 * 86400_000)) : 4
    projectMrr += p.priceUsd / months
  }

  const combinedMrr = retainerMrr + projectMrr
  const arr = combinedMrr * 12

  // ── YTD revenue (any invoice with paidAt this calendar year) ─────
  // Don't filter on status='paid' string — Stripe + Xero imports use
  // different status vocabularies. paidAt set + > yearStart is the
  // reliable signal that money landed.
  const ytdRows = await database.all<{ total: number | null; cnt: number }>(sql`
    SELECT
      COALESCE(SUM(total_usd), 0) AS total,
      COUNT(*) AS cnt
    FROM invoices
    WHERE paid_at IS NOT NULL
      AND paid_at >= ${yearStart}
  `)
  const ytdRevenue = Number(ytdRows[0]?.total ?? 0)
  const ytdInvoiceCount = Number(ytdRows[0]?.cnt ?? 0)

  // ── Sales velocity (deals signed in trailing windows) ─────────────
  // "Signed" = deal on a closed-won pipeline stage with a closed_at in
  // the trailing window. Raw SQL because we need the stage join.
  const signedRows = await database.all<{ id: string; value: number; closedAt: string | null }>(sql`
    SELECT d.id AS id, COALESCE(d.value_nzd, d.value, 0) AS value, d.closed_at AS closedAt
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE s.is_closed_won = 1
      AND d.closed_at IS NOT NULL
      AND d.closed_at > datetime('now', '-90 days')
  `)

  const signed30 = signedRows.filter(d => d.closedAt && Date.now() - new Date(d.closedAt).getTime() < 30 * 86400_000)
  const signed60 = signedRows.filter(d => d.closedAt && Date.now() - new Date(d.closedAt).getTime() < 60 * 86400_000)
  const signed90 = signedRows

  // ── Outstanding AR ────────────────────────────────────────────────
  const outstandingRows = await database
    .select({ totalUsd: schema.invoices.totalUsd, dueDate: schema.invoices.dueDate })
    .from(schema.invoices)
    .where(eq(schema.invoices.status, 'sent'))
  const overdueRows = await database
    .select({ totalUsd: schema.invoices.totalUsd })
    .from(schema.invoices)
    .where(eq(schema.invoices.status, 'overdue'))
  const outstandingAr = outstandingRows.reduce((s, r) => s + (r.totalUsd ?? 0), 0)
              + overdueRows.reduce((s, r) => s + (r.totalUsd ?? 0), 0)

  // ── Tier 3 derivatives ────────────────────────────────────────────
  // Quarter-to-date revenue + projection. Quarter starts Jan/Apr/Jul/Oct.
  const nowDate = new Date()
  const quarterStartMonth = Math.floor(nowDate.getMonth() / 3) * 3
  const quarterStart = new Date(nowDate.getFullYear(), quarterStartMonth, 1).toISOString()
  const quarterEnd = new Date(nowDate.getFullYear(), quarterStartMonth + 3, 1)
  const quarterDaysElapsed = Math.max(1, Math.ceil((nowDate.getTime() - new Date(quarterStart).getTime()) / 86400_000))
  const quarterDaysTotal = Math.ceil((quarterEnd.getTime() - new Date(quarterStart).getTime()) / 86400_000)

  const quarterRevenueRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(total_usd), 0) AS total
    FROM invoices
    WHERE paid_at IS NOT NULL AND paid_at >= ${quarterStart}
  `)
  const quarterToDate = Number(quarterRevenueRows[0]?.total ?? 0)
  const quarterRunRate = quarterDaysElapsed > 0 ? (quarterToDate / quarterDaysElapsed) * quarterDaysTotal : 0

  // Year-end projection. We finalise this in the response builder once
  // ytdRevenue + effectiveMonthlyRevenue are computed (further down).
  const monthsRemaining = 11 - nowDate.getMonth()  // Dec → 0, Nov → 1 …

  // ── Trailing 5-month project revenue ──────────────────────────────
  // Sum of paid invoices linked to a project in the last 150 days ÷ 5.
  // This is the REAL number — what's actually landed in the bank from
  // project work. Pairs with the projection-based projectMrr above so
  // operator can see projection vs reality side by side.
  const trailingProjectRows = await database.all<{ total: number | null; cnt: number }>(sql`
    SELECT
      COALESCE(SUM(total_usd), 0) AS total,
      COUNT(*) AS cnt
    FROM invoices
    WHERE paid_at IS NOT NULL
      AND paid_at > datetime('now', '-150 days')
      AND project_id IS NOT NULL
  `)
  const trailing5moProjectRevenue = Number(trailingProjectRows[0]?.total ?? 0) / 5

  // Effective monthly revenue = retainer MRR + 5-month project actuals.
  // What Liam asked for as the headline.
  const effectiveMonthlyRevenue = retainerMrr + trailing5moProjectRevenue

  // ── Net new MRR this month (won this month - churned this month) ──
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const wonThisMonthRows = await database.all<{ total: number | null; cnt: number }>(sql`
    SELECT
      COALESCE(SUM(d.monthly_value_nzd), 0) AS total,
      COUNT(*) AS cnt
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE s.is_closed_won = 1
      AND d.closed_at IS NOT NULL
      AND d.closed_at >= ${monthStart}
      AND d.monthly_value_nzd > 0
  `)
  const churnedThisMonthRows = await database.all<{ cnt: number }>(sql`
    SELECT COUNT(*) AS cnt
    FROM subscriptions
    WHERE cancelled_at IS NOT NULL
      AND cancelled_at >= ${monthStart}
  `)
  const newMrrThisMonth = Number(wonThisMonthRows[0]?.total ?? 0)
  const wonDealsThisMonth = Number(wonThisMonthRows[0]?.cnt ?? 0)
  const churnedClientsThisMonth = Number(churnedThisMonthRows[0]?.cnt ?? 0)

  // ── Client concentration ──────────────────────────────────────────
  // % of MRR from top 1 + top 3 clients. Surfaces "if I lose Brogan's
  // tomorrow…" exposure. Reads only active clients with custom_mrr set.
  const concentrationRows = await database.all<{ name: string; mrr: number }>(sql`
    SELECT name, COALESCE(custom_mrr, 0) AS mrr
    FROM organisations
    WHERE status = 'active' AND custom_mrr IS NOT NULL AND custom_mrr > 0
    ORDER BY custom_mrr DESC
    LIMIT 10
  `)
  const totalNamedMrr = concentrationRows.reduce((s, r) => s + Number(r.mrr), 0)
  const topClientShare = totalNamedMrr > 0 && concentrationRows[0]
    ? (Number(concentrationRows[0].mrr) / totalNamedMrr)
    : 0
  const top3Share = totalNamedMrr > 0
    ? concentrationRows.slice(0, 3).reduce((s, r) => s + Number(r.mrr), 0) / totalNamedMrr
    : 0

  // ── AR aging buckets ──────────────────────────────────────────────
  // Outstanding invoices (sent + overdue) grouped by days since due.
  const arRows = await database.all<{ totalUsd: number | null; dueDate: string | null }>(sql`
    SELECT total_usd AS totalUsd, due_date AS dueDate
    FROM invoices
    WHERE status IN ('sent', 'overdue') AND paid_at IS NULL
  `)
  const arAging = { current: 0, days30: 0, days60: 0, days90: 0, days90plus: 0 }
  for (const r of arRows) {
    const amt = Number(r.totalUsd ?? 0)
    if (!r.dueDate) { arAging.current += amt; continue }
    const overdueMs = Date.now() - new Date(r.dueDate).getTime()
    if (overdueMs < 0) arAging.current += amt
    else if (overdueMs < 30 * 86400_000) arAging.days30 += amt
    else if (overdueMs < 60 * 86400_000) arAging.days60 += amt
    else if (overdueMs < 90 * 86400_000) arAging.days90 += amt
    else arAging.days90plus += amt
  }

  // ── GST + Corp tax (NZ tax year: Apr 1 → Mar 31) ──────────────────
  // NZ tax year != calendar year. Tax year starts April 1. If we're
  // currently before April, the active tax year started Apr 1 of the
  // previous calendar year.
  const monthsThisYear = new Date().getMonth() + 1
  const taxYearStartYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1
  const taxYearStart = new Date(taxYearStartYear, 3, 1).toISOString()  // April 1
  // Months elapsed within the NZ tax year (capped at 12).
  const monthsIntoTaxYear = Math.min(12, Math.max(1,
    (new Date().getFullYear() - taxYearStartYear) * 12 + (new Date().getMonth() - 3) + 1,
  ))

  const taxYearRevenueRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(total_usd), 0) AS total
    FROM invoices
    WHERE paid_at IS NOT NULL AND paid_at >= ${taxYearStart}
  `)
  const taxYearRevenue = Number(taxYearRevenueRows[0]?.total ?? 0)

  // GST: 15% of invoiced amount on NZ-domiciled clients. Sum of
  // tax_amount on tax-year invoices is the truest proxy.
  const gstRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(tax_amount_usd), 0) AS total
    FROM invoices
    WHERE paid_at IS NOT NULL AND paid_at >= ${taxYearStart}
  `)
  const gstOwedYtd = Number(gstRows[0]?.total ?? 0)

  // Corp tax (NZ): 28% of net profit, computed against the NZ tax year.
  const taxYearExpenseRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expense_commitments
    WHERE active = 1
      AND (start_date IS NULL OR start_date <= datetime('now'))
      AND (end_date IS NULL OR end_date >= ${taxYearStart})
  `)
  const taxYearExpensesApprox = Number(taxYearExpenseRows[0]?.total ?? 0) * monthsIntoTaxYear
  const ytdProfit = taxYearRevenue - taxYearExpensesApprox
  const corpTaxOwedYtd = Math.max(0, ytdProfit * 0.28)
  // Keep ytdExpensesApprox name for the existing response so the UI
  // doesn't break — but compute it against the NZ tax year now.
  const ytdExpensesApprox = taxYearExpensesApprox

  // ── YoY comparison (same calendar month last year vs this) ───────
  const thisMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const sameMonthLastYearStart = new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1).toISOString()
  const sameMonthLastYearEnd = new Date(new Date().getFullYear() - 1, new Date().getMonth() + 1, 1).toISOString()
  const thisMonthRevenueRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(total_usd), 0) AS total
    FROM invoices
    WHERE paid_at IS NOT NULL AND paid_at >= ${thisMonthStart}
  `)
  const lastYearMonthRevenueRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(total_usd), 0) AS total
    FROM invoices
    WHERE paid_at IS NOT NULL
      AND paid_at >= ${sameMonthLastYearStart}
      AND paid_at < ${sameMonthLastYearEnd}
  `)
  const yoyThisMonth = Number(thisMonthRevenueRows[0]?.total ?? 0)
  const yoyLastYear = Number(lastYearMonthRevenueRows[0]?.total ?? 0)
  const yoyDeltaPct = yoyLastYear > 0 ? ((yoyThisMonth - yoyLastYear) / yoyLastYear) : null

  // ── Tier 2: time-series + efficiency metrics ──────────────────────
  // 12-month revenue history grouped by month (for stacked area chart).
  const monthlyRevenueRows = await database.all<{ ym: string; total: number | null }>(sql`
    SELECT strftime('%Y-%m', paid_at) AS ym, COALESCE(SUM(total_usd), 0) AS total
    FROM invoices
    WHERE paid_at IS NOT NULL
      AND paid_at > datetime('now', '-13 months')
    GROUP BY ym
    ORDER BY ym ASC
  `)

  // Cost-mix: monthly outflow by category. Pulled from expense_commitments
  // (operator-confirmed truth).
  const costMixRows = await database.all<{ category: string; monthly: number | null; isDiscretionary: number }>(sql`
    SELECT category,
           COALESCE(SUM(
             CASE cadence
               WHEN 'monthly' THEN amount
               WHEN 'quarterly' THEN amount / 3.0
               WHEN 'annual' THEN amount / 12.0
               ELSE 0
             END
           ), 0) AS monthly,
           COALESCE(MAX(is_discretionary), 0) AS isDiscretionary
    FROM expense_commitments
    WHERE active = 1
    GROUP BY category
    ORDER BY monthly DESC
  `)

  // Discretionary vs essential split for the spend audit. Categories
  // are independent of the per-row is_discretionary flag (an essential
  // category can hold a discretionary line item).
  const discretionaryRows = await database.all<{ discMonthly: number | null; essMonthly: number | null }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN is_discretionary = 1 THEN
        CASE cadence WHEN 'monthly' THEN amount WHEN 'quarterly' THEN amount / 3.0 WHEN 'annual' THEN amount / 12.0 ELSE 0 END
        ELSE 0 END), 0) AS discMonthly,
      COALESCE(SUM(CASE WHEN is_discretionary = 0 OR is_discretionary IS NULL THEN
        CASE cadence WHEN 'monthly' THEN amount WHEN 'quarterly' THEN amount / 3.0 WHEN 'annual' THEN amount / 12.0 ELSE 0 END
        ELSE 0 END), 0) AS essMonthly
    FROM expense_commitments
    WHERE active = 1
  `)
  const discretionaryMonthly = Number(discretionaryRows[0]?.discMonthly ?? 0)
  const essentialMonthly = Number(discretionaryRows[0]?.essMonthly ?? 0)

  // Pipeline → cash funnel: open deals grouped by stage with value sum.
  // Closed-won shows separately as "signed".
  const pipelineFunnelRows = await database.all<{ stageName: string; position: number; isClosedWon: number; isClosedLost: number; cnt: number; value: number | null }>(sql`
    SELECT s.name AS stageName,
           s.position,
           s.is_closed_won AS isClosedWon,
           s.is_closed_lost AS isClosedLost,
           COUNT(d.id) AS cnt,
           COALESCE(SUM(d.value_nzd), 0) AS value
    FROM pipeline_stages s
    LEFT JOIN deals d ON d.stage_id = s.id
      AND (s.is_closed_lost IS NULL OR s.is_closed_lost = 0)
    GROUP BY s.id
    ORDER BY s.position ASC
  `)

  // Outstanding work value — sum of (monthly × months remaining) for
  // active won deals with engagement_end_date in the future.
  const outstandingWorkRows = await database.all<{ total: number | null; cnt: number }>(sql`
    SELECT
      COALESCE(SUM(
        d.monthly_value_nzd * MAX(0, (CAST((julianday(d.engagement_end_date) - julianday('now')) / 30.0 AS REAL)))
      ), 0) AS total,
      COUNT(*) AS cnt
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE s.is_closed_won = 1
      AND d.monthly_value_nzd > 0
      AND d.engagement_end_date IS NOT NULL
      AND d.engagement_end_date > datetime('now')
  `)

  // Win rate by source — looking at closed deals last 180 days.
  const winRateRows = await database.all<{ source: string | null; wonCnt: number; lostCnt: number }>(sql`
    SELECT
      d.source AS source,
      SUM(CASE WHEN s.is_closed_won = 1 THEN 1 ELSE 0 END) AS wonCnt,
      SUM(CASE WHEN s.is_closed_lost = 1 THEN 1 ELSE 0 END) AS lostCnt
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE (s.is_closed_won = 1 OR s.is_closed_lost = 1)
      AND d.closed_at IS NOT NULL
      AND d.closed_at > datetime('now', '-180 days')
    GROUP BY d.source
    ORDER BY wonCnt DESC
  `)

  // Average deal size + cycle length (last 90 days won deals).
  const dealStatsRows = await database.all<{ avgValue: number | null; avgCycle: number | null; cnt: number }>(sql`
    SELECT
      AVG(COALESCE(d.value_nzd, d.value, 0)) AS avgValue,
      AVG(CAST((julianday(d.closed_at) - julianday(d.created_at)) AS REAL)) AS avgCycle,
      COUNT(*) AS cnt
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE s.is_closed_won = 1
      AND d.closed_at IS NOT NULL
      AND d.closed_at > datetime('now', '-90 days')
  `)

  // Time-to-pay distribution (invoices paid in last 90 days).
  const ttpRows = await database.all<{ avgDays: number | null; minDays: number | null; maxDays: number | null; cnt: number }>(sql`
    SELECT
      AVG(CAST((julianday(paid_at) - julianday(due_date)) AS REAL)) AS avgDays,
      MIN(CAST((julianday(paid_at) - julianday(due_date)) AS REAL)) AS minDays,
      MAX(CAST((julianday(paid_at) - julianday(due_date)) AS REAL)) AS maxDays,
      COUNT(*) AS cnt
    FROM invoices
    WHERE paid_at IS NOT NULL
      AND due_date IS NOT NULL
      AND paid_at > datetime('now', '-90 days')
  `)

  // Cash conversion ratio (last 90 days): collected ÷ invoiced.
  const cashConvRows = await database.all<{ invoiced: number | null; collected: number | null }>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN created_at > datetime('now', '-90 days') THEN total_usd ELSE 0 END), 0) AS invoiced,
      COALESCE(SUM(CASE WHEN paid_at > datetime('now', '-90 days') THEN total_usd ELSE 0 END), 0) AS collected
    FROM invoices
  `)
  const invoiced90 = Number(cashConvRows[0]?.invoiced ?? 0)
  const collected90 = Number(cashConvRows[0]?.collected ?? 0)

  // Hours logged + cost. Profit per logged hour = (revenue ÷ hours) once
  // we know revenue per client; for now compute the agency-wide number.
  const hoursRows = await database.all<{ totalHours: number | null }>(sql`
    SELECT COALESCE(SUM(hours), 0) AS totalHours
    FROM time_entries
    WHERE date > date('now', '-90 days')
  `)
  const hoursLast90d = Number(hoursRows[0]?.totalHours ?? 0)
  const revenuePerHour = hoursLast90d > 0 ? collected90 / hoursLast90d : null

  // Outstanding deal pipeline value (open deals).
  const pipelineOpenRows = await database.all<{ value: number | null; cnt: number }>(sql`
    SELECT COALESCE(SUM(d.value_nzd), 0) AS value, COUNT(*) AS cnt
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE (s.is_closed_won IS NULL OR s.is_closed_won = 0)
      AND (s.is_closed_lost IS NULL OR s.is_closed_lost = 0)
  `)

  // ── Recent activity feed (last 5 paid invoices / new deals) ──────
  const recentInvoices = await database.all<{ id: string; totalUsd: number | null; paidAt: string | null; orgName: string | null }>(sql`
    SELECT i.id, i.total_usd AS totalUsd, i.paid_at AS paidAt, o.name AS orgName
    FROM invoices i
    LEFT JOIN organisations o ON i.org_id = o.id
    WHERE i.paid_at IS NOT NULL
    ORDER BY i.paid_at DESC
    LIMIT 5
  `)
  const recentDeals = await database.all<{ id: string; title: string; value: number; closedAt: string | null; orgName: string | null }>(sql`
    SELECT d.id, d.title, COALESCE(d.value_nzd, d.value, 0) AS value, d.closed_at AS closedAt, o.name AS orgName
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    LEFT JOIN organisations o ON d.org_id = o.id
    WHERE s.is_closed_won = 1 AND d.closed_at IS NOT NULL
    ORDER BY d.closed_at DESC
    LIMIT 5
  `)

  // ── Disposable cash math ──────────────────────────────────────────
  // Primary currency for the headline number: prefer NZD if present,
  // else first available. (Multi-currency is shown per-currency below.)
  const primaryCurrency = balancesByCurrency.has('NZD') ? 'NZD'
    : Array.from(balancesByCurrency.keys())[0] ?? 'NZD'
  const primaryBalance = balancesByCurrency.get(primaryCurrency)?.available ?? 0
  // Disposable = primary bank − reserve pots − last-year tax. The reserve
  // pot total + last-year tax both come out of what's safe to spend right
  // now. (Reserve target is a target, not a deduction.)
  const disposableCash = Math.max(0, primaryBalance - reservesTotal - lastYearTaxOwed)

  // Reserve target = months × burn + last-year tax pot. If burn isn't
  // configured yet, fall back to effective monthly revenue × 0.5 as a
  // rough proxy. The cash status traffic-light reads against this.
  const reserveTargetBurn = monthlyBurnNzd ?? (effectiveMonthlyRevenue > 0 ? effectiveMonthlyRevenue * 0.5 : 0)
  const reserveTargetAmount = reserveTargetBurn * reserveTargetMonths + lastYearTaxOwed
  const reserveTargetMonthsOfRunway = reserveTargetBurn > 0 ? primaryBalance / reserveTargetBurn : null

  // ── Status traffic lights ─────────────────────────────────────────
  // Simple rules for now — refined when we plug real margin data in.
  function statusFor(metric: 'cash' | 'mrr' | 'ar' | 'reserves' | 'velocity'): 'green' | 'amber' | 'red' {
    switch (metric) {
      case 'cash':
        // Compare against the operator-set reserve target. Green at
        // target, amber at half, red below half. If no burn is
        // configured, fall back to "absolute disposable > 0" which is
        // the only signal we trust.
        if (!reserveTargetBurn || reserveTargetAmount <= 0) {
          return disposableCash > 0 ? 'amber' : 'red'
        }
        if (disposableCash >= reserveTargetAmount) return 'green'
        if (disposableCash >= reserveTargetAmount / 2) return 'amber'
        return 'red'
      case 'mrr':
        // Unmeasured (no custom_mrr set on any active client) is amber,
        // not green. "$0 MRR" only counts as green when configured.
        if (retainerClientCount === 0 && projectMrr === 0) return 'amber'
        return combinedMrr > 0 ? 'green' : 'red'
      case 'ar':
        // Only red if overdue stack > 20% of MRR.
        return overdueRows.length === 0 ? 'green' : (outstandingAr > combinedMrr * 0.2 ? 'amber' : 'green')
      case 'reserves':
        // Tax reserve at expected rate? If a reserve with category=tax
        // has accrualRate set, treat undershoot as amber.
        const tax = reserves.find(r => r.category === 'tax')
        if (!tax || !tax.accrualRate) return 'amber'
        return 'green'
      case 'velocity':
        // No new contracts in 60 days = red. <2 in 90d = amber.
        if (signed60.length > 0) return 'green'
        if (signed90.length > 0) return 'amber'
        return 'red'
    }
  }

  return NextResponse.json({
    asOf: nowIso,
    primaryCurrency,
    bankBalances: Array.from(balancesByCurrency.entries()).map(([currency, v]) => ({
      currency,
      available: v.available,
      total: v.total,
      sources: v.sources,
    })),
    reserves: {
      total: reservesTotal,
      items: reserves.map(r => ({
        id: r.id,
        name: r.name,
        category: r.category,
        currency: r.currency,
        accruedAmount: r.accruedAmount,
        targetAmount: r.targetAmount,
        accrualRate: r.accrualRate,
      })),
    },
    disposableCash,
    reserveConfig: {
      targetMonths: reserveTargetMonths,
      monthlyBurnNzd,
      lastYearTaxOwed,
      targetAmount: reserveTargetAmount,
      targetBurn: reserveTargetBurn,
      monthsOfRunway: reserveTargetMonthsOfRunway,
    },
    mrr: {
      retainer: retainerMrr,
      project: projectMrr,
      combined: combinedMrr,
      // Data-quality flag: when 0 active clients have custom_mrr set
      // AND there are active clients overall, MRR is unmeasured (not
      // honestly $0). UI shows a "set up MRR per client" hint instead
      // of a green "on track" tile.
      retainerClientCount,
      configured: retainerClientCount > 0 || projectMrr > 0,
    },
    arr,
    ytdRevenue,
    ytdInvoiceCount,
    // Project revenue: projection (above, in mrr.project) vs trailing
    // 5-month actuals. UI shows both — projection drives planning,
    // actuals drive trust.
    projectRevenue: {
      projection: projectMrr,
      trailing5moActual: trailing5moProjectRevenue,
    },
    effectiveMonthlyRevenue,
    newMrrThisMonth: {
      amount: newMrrThisMonth,
      wonDeals: wonDealsThisMonth,
      churnedClients: churnedClientsThisMonth,
    },
    clientConcentration: {
      totalNamedMrr,
      topClientShare,
      top3Share,
      top: concentrationRows.slice(0, 5).map(r => ({ name: r.name, mrr: Number(r.mrr) })),
    },
    arAging,
    taxes: {
      gstOwedYtd,
      corpTaxOwedYtd,
      ytdProfit,
      ytdExpensesApprox,
      taxYearStart,
      taxYearRevenue,
      monthsIntoTaxYear,
    },
    yoy: {
      thisMonth: yoyThisMonth,
      lastYearSameMonth: yoyLastYear,
      deltaPct: yoyDeltaPct,
    },
    // ── Tier 3 surfaces ────────────────────────────────────────────
    quarterly: {
      target: quarterlyTargetNzd,
      actual: quarterToDate,
      projection: quarterRunRate,
      daysElapsed: quarterDaysElapsed,
      daysTotal: quarterDaysTotal,
      pctElapsed: quarterDaysElapsed / quarterDaysTotal,
      onPace: quarterlyTargetNzd > 0 ? quarterRunRate >= quarterlyTargetNzd : null,
    },
    takeHome: {
      liamAnnual: liamTakeHome,
      staciAnnual: staciTakeHome,
      combinedAnnual: liamTakeHome + staciTakeHome,
      combinedMonthly: (liamTakeHome + staciTakeHome) / 12,
      targetEach: takeHomeTargetEach,
      gapEach: Math.max(0, takeHomeTargetEach - liamTakeHome),
      gapCombined: Math.max(0, (takeHomeTargetEach * 2) - (liamTakeHome + staciTakeHome)),
    },
    yearEnd: {
      // Honest projection: YTD + (effective monthly revenue × months
      // remaining). Reflects what's likely to actually land.
      projection: ytdRevenue + (effectiveMonthlyRevenue * monthsRemaining),
      monthsRemaining,
    },
    forex: (() => {
      // Forex exposure = % of total cash held in non-NZD currencies.
      // Pulled from balancesByCurrency. We use the Xero+Airwallex
      // numbers we already aggregated.
      const totals = Array.from(balancesByCurrency.entries()).map(([cur, v]) => ({ currency: cur, available: v.available }))
      const nzd = totals.find(t => t.currency === 'NZD')?.available ?? 0
      const totalAll = totals.reduce((s, t) => s + t.available, 0)
      return {
        items: totals,
        nzdShare: totalAll > 0 ? nzd / totalAll : 1,
      }
    })(),
    monthlyRevenueHistory: monthlyRevenueRows.map(r => ({ ym: r.ym, total: Number(r.total ?? 0) })),
    costMix: costMixRows.map(r => ({ category: r.category, monthly: Number(r.monthly ?? 0) })),
    spendSplit: { discretionary: discretionaryMonthly, essential: essentialMonthly },
    pipelineFunnel: pipelineFunnelRows.map(r => ({
      stage: r.stageName,
      position: r.position,
      isClosedWon: !!r.isClosedWon,
      count: Number(r.cnt),
      value: Number(r.value ?? 0),
    })),
    outstandingWork: {
      value: Number(outstandingWorkRows[0]?.total ?? 0),
      contracts: Number(outstandingWorkRows[0]?.cnt ?? 0),
    },
    winRateBySource: winRateRows.map(r => {
      const won = Number(r.wonCnt)
      const lost = Number(r.lostCnt)
      const total = won + lost
      return {
        source: r.source ?? 'unspecified',
        won, lost, total,
        rate: total > 0 ? won / total : 0,
      }
    }),
    dealStats: {
      avgValue: Number(dealStatsRows[0]?.avgValue ?? 0),
      avgCycleDays: Number(dealStatsRows[0]?.avgCycle ?? 0),
      count: Number(dealStatsRows[0]?.cnt ?? 0),
    },
    timeToPay: {
      avgDays: Number(ttpRows[0]?.avgDays ?? 0),
      minDays: Number(ttpRows[0]?.minDays ?? 0),
      maxDays: Number(ttpRows[0]?.maxDays ?? 0),
      count: Number(ttpRows[0]?.cnt ?? 0),
    },
    cashConversion: {
      invoiced90d: invoiced90,
      collected90d: collected90,
      ratio: invoiced90 > 0 ? collected90 / invoiced90 : null,
    },
    productivity: {
      hoursLast90d,
      revenuePerHour,
    },
    pipelineOpen: {
      value: Number(pipelineOpenRows[0]?.value ?? 0),
      count: Number(pipelineOpenRows[0]?.cnt ?? 0),
    },
    recentActivity: {
      invoices: recentInvoices.map(i => ({
        id: i.id,
        totalUsd: Number(i.totalUsd ?? 0),
        paidAt: i.paidAt,
        orgName: i.orgName,
      })),
      deals: recentDeals.map(d => ({
        id: d.id,
        title: d.title,
        value: Number(d.value),
        closedAt: d.closedAt,
        orgName: d.orgName,
      })),
    },
    salesVelocity: {
      last30Days: { count: signed30.length, value: signed30.reduce((s, d) => s + (d.value ?? 0), 0) },
      last60Days: { count: signed60.length, value: signed60.reduce((s, d) => s + (d.value ?? 0), 0) },
      last90Days: { count: signed90.length, value: signed90.reduce((s, d) => s + (d.value ?? 0), 0) },
    },
    outstandingAr,
    overdueCount: overdueRows.length,
    status: {
      cash: statusFor('cash'),
      mrr: statusFor('mrr'),
      ar: statusFor('ar'),
      reserves: statusFor('reserves'),
      velocity: statusFor('velocity'),
    },
  })
}

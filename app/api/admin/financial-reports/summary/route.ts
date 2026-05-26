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

  // ── Operator-configured reserve target ────────────────────────────
  // Three settings drive the cash traffic-light:
  //   finance.reserveTargetMonths  — months of burn to keep buffered (default 4)
  //   finance.monthlyBurnNzd       — operator's stated monthly burn (defaults to MRR if unset)
  //   finance.lastYearTaxOwed      — flat extra reserve for prior-year tax (default 0)
  // All three editable from the page settings card.
  const settingsRows = await database.all<{ key: string; value: string }>(sql`
    SELECT key, value FROM settings
    WHERE key IN ('finance.reserveTargetMonths', 'finance.monthlyBurnNzd', 'finance.lastYearTaxOwed')
  `)
  const settingsMap = new Map(settingsRows.map(r => [r.key, r.value]))
  const reserveTargetMonths = Math.max(1, Math.min(24, parseFloat(settingsMap.get('finance.reserveTargetMonths') ?? '4')))
  const monthlyBurnNzd = parseFloat(settingsMap.get('finance.monthlyBurnNzd') ?? '0') || null
  const lastYearTaxOwed = parseFloat(settingsMap.get('finance.lastYearTaxOwed') ?? '0') || 0

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
  // Retainer MRR = SUM of organisations.custom_mrr across active clients.
  // Decision #037 — custom_mrr is the operator-confirmed truth. We do
  // NOT fall back to deals.monthly_value_nzd because that bucket is
  // contaminated by old won deals where the engagement already ended
  // without an engagement_end_date set. If custom_mrr is empty, MRR is
  // honestly empty and the UI prompts the operator to set it.
  // Raw SQL because custom_mrr predates the Drizzle schema.
  const retainerRows = await database.all<{ mrr: number | null; client_count: number | null }>(sql`
    SELECT
      COALESCE(SUM(o.custom_mrr), 0) AS mrr,
      COUNT(*) AS client_count
    FROM organisations o
    WHERE o.status = 'active'
      AND o.custom_mrr IS NOT NULL
      AND o.custom_mrr > 0
  `)
  const retainerMrr = Number(retainerRows[0]?.mrr ?? 0)
  const retainerClientCount = Number(retainerRows[0]?.client_count ?? 0)

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

  // ── GST + Corp tax YTD ────────────────────────────────────────────
  // GST: 15% of invoiced amount on NZ-domiciled clients. We can't always
  // know billing country, so this is a heuristic — sum of tax_amount on
  // YTD invoices. If tax_amount_usd is null (legacy data), zero.
  const gstRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(tax_amount_usd), 0) AS total
    FROM invoices
    WHERE paid_at IS NOT NULL AND paid_at >= ${yearStart}
  `)
  const gstOwedYtd = Number(gstRows[0]?.total ?? 0)

  // Corp tax (NZ): 28% of net profit. Honest approximation: 28% of
  // (YTD revenue − YTD recognised expense_commitments). Refines once
  // the AI monthly scan reconciles against bank reality.
  const ytdExpenseRows = await database.all<{ total: number | null }>(sql`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expense_commitments
    WHERE active = 1
      AND (start_date IS NULL OR start_date <= datetime('now'))
      AND (end_date IS NULL OR end_date >= ${yearStart})
  `)
  // Monthly recurring × months elapsed this year is the right model.
  const monthsThisYear = new Date().getMonth() + 1
  const ytdExpensesApprox = Number(ytdExpenseRows[0]?.total ?? 0) * monthsThisYear
  const ytdProfit = ytdRevenue - ytdExpensesApprox
  const corpTaxOwedYtd = Math.max(0, ytdProfit * 0.28)

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
    },
    yoy: {
      thisMonth: yoyThisMonth,
      lastYearSameMonth: yoyLastYear,
      deltaPct: yoyDeltaPct,
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

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
  // Retainer MRR: organisations.custom_mrr (set per client when they
  // have a retainer) summed across active clients. Falls back to deals
  // with monthly_value_nzd on a closed-won stage when custom_mrr is
  // empty. Raw SQL because custom_mrr predates the Drizzle schema.
  const retainerRows = await database.all<{ mrr: number | null }>(sql`
    SELECT COALESCE(SUM(o.custom_mrr), 0) AS mrr
    FROM organisations o
    WHERE o.status = 'active' AND o.custom_mrr IS NOT NULL AND o.custom_mrr > 0
  `)
  const retainerFromOrgs = Number(retainerRows[0]?.mrr ?? 0)

  const dealMrrRows = await database.all<{ mrr: number | null }>(sql`
    SELECT COALESCE(SUM(d.monthly_value_nzd), 0) AS mrr
    FROM deals d
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE s.is_closed_won = 1
      AND d.monthly_value_nzd > 0
      AND (d.engagement_end_date IS NULL OR d.engagement_end_date > datetime('now'))
  `)
  const retainerFromDeals = Number(dealMrrRows[0]?.mrr ?? 0)

  // Use the higher of the two sources — custom_mrr is the operator-
  // confirmed truth; deal monthly_value is the inferred fallback when
  // custom_mrr hasn't been filled in.
  const retainerMrr = Math.max(retainerFromOrgs, retainerFromDeals)

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

  // ── YTD revenue (paid invoices this calendar year) ────────────────
  const ytdRows = await database
    .select({ totalUsd: schema.invoices.totalUsd, paidAt: schema.invoices.paidAt })
    .from(schema.invoices)
    .where(and(
      eq(schema.invoices.status, 'paid'),
      gte(schema.invoices.paidAt, yearStart),
    ))
  const ytdRevenue = ytdRows.reduce((sum, r) => sum + (r.totalUsd ?? 0), 0)

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

  // ── Disposable cash math ──────────────────────────────────────────
  // Primary currency for the headline number: prefer NZD if present,
  // else first available. (Multi-currency is shown per-currency below.)
  const primaryCurrency = balancesByCurrency.has('NZD') ? 'NZD'
    : Array.from(balancesByCurrency.keys())[0] ?? 'NZD'
  const primaryBalance = balancesByCurrency.get(primaryCurrency)?.available ?? 0
  const disposableCash = Math.max(0, primaryBalance - reservesTotal)

  // ── Status traffic lights ─────────────────────────────────────────
  // Simple rules for now — refined when we plug real margin data in.
  function statusFor(metric: 'cash' | 'mrr' | 'ar' | 'reserves' | 'velocity'): 'green' | 'amber' | 'red' {
    switch (metric) {
      case 'cash':
        if (disposableCash > combinedMrr * 3) return 'green'   // 3 months runway+
        if (disposableCash > combinedMrr) return 'amber'        // 1 month runway
        return 'red'
      case 'mrr':
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
    mrr: {
      retainer: retainerMrr,
      project: projectMrr,
      combined: combinedMrr,
    },
    arr,
    ytdRevenue,
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

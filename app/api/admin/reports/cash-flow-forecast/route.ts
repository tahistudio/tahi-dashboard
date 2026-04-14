import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql, eq, and } from 'drizzle-orm'
import { buildRateMap, toNzd } from '@/lib/currency'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/reports/cash-flow-forecast?months=6
 *
 * 6-month (configurable) cash flow projection for the studio.
 *
 * Revenue projection per month =
 *   recurring MRR (sum of active clients' customMrr → NZD)
 *   + weighted pipeline value where expected close date falls in that month
 *     (value × probability for each deal, discounted for deals without
 *      closeDate by smearing across remaining months)
 *
 * Cost projection per month =
 *   recurring client_costs entries (category monthly)
 *   + non-recurring client_costs that fall in the month
 *
 * Net position = running balance per month (starts at 0, adds delta each month).
 *
 * Response: {
 *   months: [{ month: 'YYYY-MM', revenue, cost, net, cumulative }],
 *   summary: { totalRevenue, totalCost, totalNet }
 * }
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const months = Math.max(1, Math.min(24, parseInt(url.searchParams.get('months') ?? '6', 10)))

  const drizzle = (await db()) as D1
  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  // Build the list of month keys from now forward: current + N-1 future months
  const now = new Date()
  now.setUTCDate(1)
  now.setUTCHours(0, 0, 0, 0)
  const monthKeys: string[] = []
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1))
    monthKeys.push(d.toISOString().slice(0, 7))
  }

  // ── Revenue: recurring MRR from active clients with customMrr ──────────────
  const mrrRows = await drizzle.all<{ custom_mrr: number; preferred_currency: string | null }>(
    sql`SELECT custom_mrr, preferred_currency
        FROM organisations
        WHERE status = 'active' AND custom_mrr IS NOT NULL AND custom_mrr > 0`
  )
  let recurringMrrNzd = 0
  for (const row of mrrRows ?? []) {
    recurringMrrNzd += toNzd(row.custom_mrr, row.preferred_currency ?? 'NZD', rateMap)
  }

  // ── Revenue: weighted pipeline (one-off deals that might close) ────────────
  // Deals table uses stageId -> pipelineStages for stage info (including
  // probability and isClosedWon/Lost flags). Exclude closed deals.
  const deals = await drizzle
    .select({
      id: schema.deals.id,
      valueNzd: schema.deals.valueNzd,
      value: schema.deals.value,
      currency: schema.deals.currency,
      probability: schema.pipelineStages.probability,
      expectedCloseDate: schema.deals.expectedCloseDate,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(and(
      eq(schema.pipelineStages.isClosedWon, 0),
      eq(schema.pipelineStages.isClosedLost, 0),
    ))

  const pipelineByMonth: Record<string, number> = {}
  for (const d of deals) {
    const native = d.valueNzd ?? d.value ?? 0
    const amountNzd = d.valueNzd
      ? d.valueNzd
      : toNzd(native, d.currency ?? 'NZD', rateMap)
    const prob = (d.probability ?? 50) / 100
    const weighted = amountNzd * prob

    if (d.expectedCloseDate) {
      const closeMonth = d.expectedCloseDate.slice(0, 7)
      if (monthKeys.includes(closeMonth)) {
        pipelineByMonth[closeMonth] = (pipelineByMonth[closeMonth] ?? 0) + weighted
      }
    } else {
      // No close date: smear weighted value across the forecast window
      const perMonth = weighted / monthKeys.length
      for (const m of monthKeys) {
        pipelineByMonth[m] = (pipelineByMonth[m] ?? 0) + perMonth
      }
    }
  }

  // ── Costs: client_costs per month (recurring + one-offs) ───────────────────
  const costs = await drizzle
    .select({
      amount: schema.clientCosts.amount,
      currency: schema.clientCosts.currency,
      date: schema.clientCosts.date,
      recurring: schema.clientCosts.recurring,
    })
    .from(schema.clientCosts)
    .catch(() => [])  // tolerate pre-migration envs

  let recurringCostNzd = 0
  const oneOffCostByMonth: Record<string, number> = {}
  for (const c of costs ?? []) {
    const nzd = toNzd(c.amount, c.currency ?? 'NZD', rateMap)
    if (c.recurring) {
      recurringCostNzd += nzd
    } else if (c.date) {
      const m = c.date.slice(0, 7)
      if (monthKeys.includes(m)) {
        oneOffCostByMonth[m] = (oneOffCostByMonth[m] ?? 0) + nzd
      }
    }
  }

  // ── Assemble monthly forecast ──────────────────────────────────────────────
  let cumulative = 0
  let totalRevenue = 0
  let totalCost = 0

  const monthlyRows = monthKeys.map(month => {
    const revenue = recurringMrrNzd + (pipelineByMonth[month] ?? 0)
    const cost = recurringCostNzd + (oneOffCostByMonth[month] ?? 0)
    const net = revenue - cost
    cumulative += net
    totalRevenue += revenue
    totalCost += cost
    return { month, revenue, cost, net, cumulative }
  })

  return NextResponse.json({
    months: monthlyRows,
    summary: {
      totalRevenue,
      totalCost,
      totalNet: totalRevenue - totalCost,
      recurringMrrNzd,
      recurringCostNzd,
    },
  })
}

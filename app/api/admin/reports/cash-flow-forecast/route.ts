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
  // Now per-month: respects retainer_end_date so churning clients (Physitrack)
  // drop out of the forecast after their end date instead of projecting forever.
  // Try with retainer date columns (migration 0016). Fall back to
  // the old query without them if columns don't exist yet.
  type MrrRow = {
    custom_mrr: number
    preferred_currency: string | null
    retainer_start_date: string | null
    retainer_end_date: string | null
  }
  let mrrRows: MrrRow[] | null = null
  try {
    mrrRows = await drizzle.all<MrrRow>(
      sql`SELECT custom_mrr, preferred_currency, retainer_start_date, retainer_end_date
          FROM organisations
          WHERE status = 'active' AND custom_mrr IS NOT NULL AND custom_mrr > 0`
    )
  } catch {
    // retainer date columns don't exist yet (pre-0016)
    mrrRows = await drizzle.all<MrrRow>(
      sql`SELECT custom_mrr, preferred_currency, NULL as retainer_start_date, NULL as retainer_end_date
          FROM organisations
          WHERE status = 'active' AND custom_mrr IS NOT NULL AND custom_mrr > 0`
    )
  }

  // Build per-month MRR (some clients drop off mid-window)
  const mrrByMonth: Record<string, number> = {}
  for (const m of monthKeys) mrrByMonth[m] = 0
  for (const row of mrrRows ?? []) {
    const nzd = toNzd(row.custom_mrr, row.preferred_currency ?? 'NZD', rateMap)
    for (const m of monthKeys) {
      // Skip months before this client started
      if (row.retainer_start_date && row.retainer_start_date.slice(0, 7) > m) continue
      // Skip months after this client churns
      if (row.retainer_end_date && row.retainer_end_date.slice(0, 7) < m) continue
      mrrByMonth[m] += nzd
    }
  }
  // For the summary, use the CURRENT month's MRR (not a future month where churn has hit)
  const recurringMrrNzd = mrrByMonth[monthKeys[0]] ?? 0

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

  // ── Costs: commitments (primary) + Xero recurring (fallback) + client_costs ──
  //
  // Hierarchy of trust:
  //   1. expense_commitments — user-maintained fixed costs with explicit
  //      cadence. Authoritative when present (not polluted by accountant
  //      reclassifications or Xero journal entries).
  //   2. Xero recurring categories — only used if no commitments exist
  //      (first-time setup). Falls back to averaging auto-detected
  //      recurring categories over their observed months.
  //   3. client_costs — layered on top of the above for project-specific
  //      costs not yet in Xero (subcontractor fees, one-off software, etc).
  //
  // Commitments are projected month-by-month based on their cadence so a
  // quarterly $3,000 insurance bill doesn't distort a month it doesn't fall in.
  const commitments = await drizzle
    .select()
    .from(schema.expenseCommitments)
    .catch(() => [] as Array<typeof schema.expenseCommitments.$inferSelect>)
  const activeCommitments = commitments.filter(c => c.active)

  // Per-month commitment costs, in NZD.
  const commitmentByMonth: Record<string, number> = {}
  for (const m of monthKeys) commitmentByMonth[m] = 0

  // Respect startDate + endDate when placing commitment charges in months.
  // startDate filters out months before the commitment began (e.g. a new
  // hire starting mid-year shouldn't retroactively reduce past net position).
  // endDate filters out months after the commitment ends (e.g. the
  // StraightIn 4-month contract should drop off the forecast when done).
  function commitmentActiveInMonth(c: typeof schema.expenseCommitments.$inferSelect, monthKey: string): boolean {
    if (c.startDate && c.startDate.slice(0, 7) > monthKey) return false
    if (c.endDate && c.endDate.slice(0, 7) < monthKey) return false
    return true
  }

  function applyCommitment(c: typeof schema.expenseCommitments.$inferSelect) {
    const amountNzd = toNzd(c.amount, c.currency ?? 'NZD', rateMap)

    function addToMonth(monthKey: string, amt: number) {
      if (!(monthKey in commitmentByMonth)) return
      if (!commitmentActiveInMonth(c, monthKey)) return
      commitmentByMonth[monthKey] += amt
    }

    switch (c.cadence) {
      case 'monthly':
        for (const m of monthKeys) addToMonth(m, amountNzd)
        break
      case 'quarterly':
      case 'annual':
      case 'one_off': {
        if (!c.nextDueDate) {
          // No anchor date — spread quarterly as 1/3 per month, annual as 1/12
          const divisor = c.cadence === 'quarterly' ? 3 : c.cadence === 'annual' ? 12 : monthKeys.length
          const perMonth = amountNzd / divisor
          for (const m of monthKeys) addToMonth(m, perMonth)
          return
        }
        const anchor = new Date(c.nextDueDate)
        if (c.cadence === 'one_off') {
          addToMonth(c.nextDueDate.slice(0, 7), amountNzd)
          return
        }
        const stepMonths = c.cadence === 'quarterly' ? 3 : 12
        // Walk forward from anchor, placing the amount in each occurrence
        let cursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
        while (true) {
          const key = cursor.toISOString().slice(0, 7)
          if (key > monthKeys[monthKeys.length - 1]) break
          addToMonth(key, amountNzd)
          cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + stepMonths, 1))
        }
        // Also walk backward in case the anchor is in the future but some
        // occurrences fall in-window (the anchor is "next due", not first)
        cursor = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - stepMonths, 1))
        while (true) {
          const key = cursor.toISOString().slice(0, 7)
          if (key < monthKeys[0]) break
          addToMonth(key, amountNzd)
          cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - stepMonths, 1))
        }
        break
      }
    }
  }

  for (const c of activeCommitments) applyCommitment(c)

  // Fallback to Xero recurring detection only if no commitments exist.
  let recurringCostNzd = 0
  if (activeCommitments.length === 0) {
    const xeroExpenses = await drizzle
      .select()
      .from(schema.xeroExpenseCategories)
      .catch(() => [] as Array<typeof schema.xeroExpenseCategories.$inferSelect>)

    if (xeroExpenses.length > 0) {
      const recurringByAccount = new Map<string, { total: number; months: Set<string> }>()
      for (const e of xeroExpenses) {
        if (!e.isRecurring) continue
        const nzd = toNzd(e.amount, e.currency ?? 'NZD', rateMap)
        if (!recurringByAccount.has(e.accountName)) {
          recurringByAccount.set(e.accountName, { total: 0, months: new Set() })
        }
        const entry = recurringByAccount.get(e.accountName)!
        entry.total += nzd
        entry.months.add(e.monthKey)
      }
      for (const entry of recurringByAccount.values()) {
        if (entry.months.size > 0) {
          recurringCostNzd += entry.total / entry.months.size
        }
      }
    }
  }

  // Layer on client_costs (typically project-specific subcontractors or
  // software that aren't yet reflected in Xero).
  const costs = await drizzle
    .select({
      amount: schema.clientCosts.amount,
      currency: schema.clientCosts.currency,
      date: schema.clientCosts.date,
      recurring: schema.clientCosts.recurring,
    })
    .from(schema.clientCosts)
    .catch(() => [] as Array<{ amount: number; currency: string; date: string; recurring: boolean | null }>)

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
    // Revenue = per-month MRR (respects churn dates) + weighted pipeline
    const revenue = (mrrByMonth[month] ?? 0) + (pipelineByMonth[month] ?? 0)
    // Cost = per-month commitments + the xero-recurring fallback + dated one-offs
    const cost = (commitmentByMonth[month] ?? 0) + recurringCostNzd + (oneOffCostByMonth[month] ?? 0)
    const net = revenue - cost
    cumulative += net
    totalRevenue += revenue
    totalCost += cost
    return { month, revenue, cost, net, cumulative }
  })

  // Average monthly commitment cost across the window (for the summary card)
  const avgCommitmentCostNzd = monthKeys.length > 0
    ? Object.values(commitmentByMonth).reduce((s, v) => s + v, 0) / monthKeys.length
    : 0

  return NextResponse.json({
    months: monthlyRows,
    summary: {
      totalRevenue,
      totalCost,
      totalNet: totalRevenue - totalCost,
      recurringMrrNzd,
      // Prefer commitments-based number when commitments exist; otherwise fall
      // back to Xero-derived recurring for backwards compatibility.
      recurringCostNzd: avgCommitmentCostNzd > 0 ? avgCommitmentCostNzd : recurringCostNzd,
      commitmentCount: activeCommitments.length,
      commitmentSource: activeCommitments.length > 0 ? 'commitments' : 'xero_recurring',
    },
  })
}

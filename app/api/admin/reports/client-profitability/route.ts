import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, inArray, ne, sql } from 'drizzle-orm'
import { buildRateMap, toNzd } from '@/lib/currency'
import { getOrgScope } from '@/lib/require-access'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/reports/client-profitability
 *
 * Aggregates gross margin for every non-archived client in one pass.
 * Used by the Reports page scorecard (T597).
 *
 * For each client:
 *   revenueNzd = SUM(paid invoices -> NZD)
 *   costNzd    = SUM(client_costs -> NZD) + SUM(billable hours × defaultHourlyRate ?? 150)
 *   marginNzd  = revenue - cost
 *   marginPct  = (margin / revenue) * 100  (0 if no revenue)
 *
 * Response sorted by revenue desc (largest clients first).
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const drizzle = (await db()) as D1

  // Apply team-member scoping
  const scope = await getOrgScope(drizzle, userId)
  if (scope !== null && scope.length === 0) {
    return NextResponse.json({ clients: [] })
  }

  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  // Active (non-archived) orgs
  const orgs = await drizzle
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      planType: schema.organisations.planType,
      defaultHourlyRate: schema.organisations.defaultHourlyRate,
      status: schema.organisations.status,
    })
    .from(schema.organisations)
    .where(ne(schema.organisations.status, 'archived'))

  const scopedOrgs = scope === null ? orgs : orgs.filter(o => scope.includes(o.id))
  if (scopedOrgs.length === 0) return NextResponse.json({ clients: [] })

  const orgIds = scopedOrgs.map(o => o.id)

  // Revenue per org from paid invoices (sum in NZD)
  const paidInvoices = await drizzle
    .select({
      orgId: schema.invoices.orgId,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
    })
    .from(schema.invoices)
    .where(and(
      inArray(schema.invoices.orgId, orgIds),
      eq(schema.invoices.status, 'paid'),
    ))

  const revenueByOrg = new Map<string, number>()
  for (const inv of paidInvoices) {
    const nzd = toNzd(inv.totalUsd, inv.currency ?? 'NZD', rateMap)
    revenueByOrg.set(inv.orgId, (revenueByOrg.get(inv.orgId) ?? 0) + nzd)
  }

  // Client costs per org (tolerate pre-migration)
  const clientCosts = await drizzle
    .select({
      orgId: schema.clientCosts.orgId,
      amount: schema.clientCosts.amount,
      currency: schema.clientCosts.currency,
    })
    .from(schema.clientCosts)
    .where(inArray(schema.clientCosts.orgId, orgIds))
    .catch(() => [] as Array<{ orgId: string; amount: number; currency: string }>)

  const costByOrg = new Map<string, number>()
  for (const c of clientCosts) {
    const nzd = toNzd(c.amount, c.currency ?? 'NZD', rateMap)
    costByOrg.set(c.orgId, (costByOrg.get(c.orgId) ?? 0) + nzd)
  }

  // Billable hours per org (join time_entries -> requests for orgId)
  const hoursRows = await drizzle.all<{ org_id: string; total: number }>(sql`
    SELECT r.org_id as org_id, COALESCE(SUM(t.hours), 0) as total
    FROM time_entries t
    INNER JOIN requests r ON t.request_id = r.id
    WHERE r.org_id IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})
      AND t.billable = 1
    GROUP BY r.org_id
  `)
  const hoursByOrg = new Map<string, number>(
    (hoursRows ?? []).map(r => [r.org_id, r.total ?? 0])
  )

  const clients = scopedOrgs.map(o => {
    const revenueNzd = revenueByOrg.get(o.id) ?? 0
    const directCost = costByOrg.get(o.id) ?? 0
    const hours = hoursByOrg.get(o.id) ?? 0
    const hourlyRate = o.defaultHourlyRate ?? 150
    const timeCost = hours * hourlyRate
    const costNzd = directCost + timeCost
    const marginNzd = revenueNzd - costNzd
    const marginPct = revenueNzd > 0 ? (marginNzd / revenueNzd) * 100 : 0

    return {
      orgId: o.id,
      orgName: o.name,
      planType: o.planType,
      status: o.status,
      revenueNzd,
      directCostNzd: directCost,
      timeCostNzd: timeCost,
      billableHours: hours,
      hourlyRate,
      costNzd,
      marginNzd,
      marginPct,
    }
  })

  // Sort by revenue desc (biggest clients first, most insightful view)
  clients.sort((a, b) => b.revenueNzd - a.revenueNzd)

  return NextResponse.json({ clients })
}

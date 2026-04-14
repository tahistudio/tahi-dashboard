import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, isNotNull } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { buildRateMap, toNzd } from '@/lib/currency'

type Params = { params: Promise<{ id: string }> }
type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET /api/admin/clients/[id]/profitability
 *
 * Returns gross margin metrics for a single client.
 *
 * Revenue: sum of PAID invoices, converted to NZD via exchange_rates.
 * Costs:
 *   - Entries in client_costs, converted to NZD
 *   - Billable logged time × org.defaultHourlyRate (treated as a cost)
 *
 * Returns:
 *   { revenueNzd, costNzd, marginNzd, marginPct,
 *     byCategory: { contractor, software, hours, other, timeCost },
 *     timeCost: { hours, rate, cost },
 *     byMonth: [{ month, revenue, cost, margin }] }
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const drizzle = (await db()) as D1

  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  // Exchange rates
  const rateMap = buildRateMap(await drizzle.select().from(schema.exchangeRates))

  // Org (for hourly rate)
  const [org] = await drizzle
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      defaultHourlyRate: schema.organisations.defaultHourlyRate,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hourlyRateNzd = org.defaultHourlyRate ?? 150  // reasonable default if not configured

  // Paid invoices → revenue in NZD
  const paidInvoices = await drizzle
    .select({
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      paidAt: schema.invoices.paidAt,
      createdAt: schema.invoices.createdAt,
    })
    .from(schema.invoices)
    .where(and(
      eq(schema.invoices.orgId, id),
      eq(schema.invoices.status, 'paid'),
    ))

  let revenueNzd = 0
  const revenueByMonth: Record<string, number> = {}
  for (const inv of paidInvoices) {
    const nzd = toNzd(inv.totalUsd, inv.currency ?? 'NZD', rateMap)
    revenueNzd += nzd
    const when = inv.paidAt ?? inv.createdAt
    if (when) {
      const month = when.slice(0, 7) // YYYY-MM
      revenueByMonth[month] = (revenueByMonth[month] ?? 0) + nzd
    }
  }

  // Client costs → cost in NZD
  const costs = await drizzle
    .select()
    .from(schema.clientCosts)
    .where(eq(schema.clientCosts.orgId, id))

  const byCategory: Record<string, number> = {
    contractor: 0, software: 0, hours: 0, other: 0, timeCost: 0,
  }
  const costByMonth: Record<string, number> = {}
  let clientCostNzd = 0
  for (const c of costs) {
    const nzd = toNzd(c.amount, c.currency ?? 'NZD', rateMap)
    clientCostNzd += nzd
    byCategory[c.category] = (byCategory[c.category] ?? 0) + nzd
    const month = c.date.slice(0, 7)
    costByMonth[month] = (costByMonth[month] ?? 0) + nzd
  }

  // Billable time → cost (hours × hourly rate)
  const timeEntries = await drizzle
    .select({
      hours: schema.timeEntries.hours,
      date: schema.timeEntries.date,
    })
    .from(schema.timeEntries)
    .innerJoin(schema.requests, eq(schema.timeEntries.requestId, schema.requests.id))
    .where(and(
      eq(schema.requests.orgId, id),
      eq(schema.timeEntries.billable, true),
      isNotNull(schema.timeEntries.hours),
    ))

  let billableHours = 0
  for (const t of timeEntries) {
    const h = t.hours ?? 0
    billableHours += h
    if (t.date) {
      const month = t.date.slice(0, 7)
      costByMonth[month] = (costByMonth[month] ?? 0) + h * hourlyRateNzd
    }
  }
  const timeCostNzd = billableHours * hourlyRateNzd
  byCategory.timeCost = timeCostNzd

  const costNzd = clientCostNzd + timeCostNzd
  const marginNzd = revenueNzd - costNzd
  const marginPct = revenueNzd > 0 ? (marginNzd / revenueNzd) * 100 : 0

  // Align months across revenue and cost
  const allMonths = new Set<string>([
    ...Object.keys(revenueByMonth),
    ...Object.keys(costByMonth),
  ])
  const byMonth = Array.from(allMonths)
    .sort()
    .map(month => ({
      month,
      revenue: revenueByMonth[month] ?? 0,
      cost: costByMonth[month] ?? 0,
      margin: (revenueByMonth[month] ?? 0) - (costByMonth[month] ?? 0),
    }))

  return NextResponse.json({
    orgId: id,
    orgName: org.name,
    hourlyRateNzd,
    revenueNzd,
    costNzd,
    marginNzd,
    marginPct,
    byCategory,
    timeCost: {
      hours: billableHours,
      rate: hourlyRateNzd,
      cost: timeCostNzd,
    },
    byMonth,
  })
}

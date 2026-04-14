import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql, eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/billing/financial-health
// Aggregates: local invoice totals, pipeline projections, Xero P&L summary, Xero bank balances
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db() as unknown as D1

  // 1. Local invoice totals
  const [invoiceTotals] = await database
    .select({
      totalInvoiced: sql<number>`COALESCE(SUM(${schema.invoices.totalUsd}), 0)`,
      totalPaid: sql<number>`COALESCE(SUM(CASE WHEN ${schema.invoices.status} = 'paid' THEN ${schema.invoices.totalUsd} ELSE 0 END), 0)`,
      totalOutstanding: sql<number>`COALESCE(SUM(CASE WHEN ${schema.invoices.status} IN ('sent', 'overdue', 'viewed') THEN ${schema.invoices.totalUsd} ELSE 0 END), 0)`,
      invoiceCount: sql<number>`COUNT(*)`,
    })
    .from(schema.invoices)

  // 2. Pipeline projections (weighted by historical probability)
  const pipelineDeals = await database
    .select({
      value: schema.deals.valueNzd,
      probability: schema.pipelineStages.probability,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
      expectedCloseDate: schema.deals.expectedCloseDate,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  const openDeals = pipelineDeals.filter(d => !d.isClosedWon && !d.isClosedLost)
  const pipelineTotal = openDeals.reduce((s, d) => s + (d.value ?? 0), 0)
  const weightedForecast = openDeals.reduce((s, d) => s + ((d.value ?? 0) * (d.probability ?? 0) / 100), 0)

  // Monthly projected revenue from deals with expected close dates
  const monthlyProjections: Record<string, number> = {}
  for (const deal of openDeals) {
    if (deal.expectedCloseDate) {
      const month = deal.expectedCloseDate.slice(0, 7)
      monthlyProjections[month] = (monthlyProjections[month] ?? 0) + ((deal.value ?? 0) * (deal.probability ?? 0) / 100)
    }
  }

  // 3. MRR from active organisations with custom MRR set
  const orgsWithMrr = await database
    .select({
      customMrr: schema.organisations.customMrr,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.status, 'active'))

  let mrr = 0
  for (const org of orgsWithMrr) {
    if (org.customMrr && org.customMrr > 0) {
      mrr += org.customMrr
    }
  }

  // 4. Xero P&L (best effort, may fail if not connected)
  let xeroPnl = null
  try {
    const now = new Date()
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const endOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`

    const pnlData = await callXeroAPI<Record<string, unknown>>(
      'GET',
      `/Reports/ProfitAndLoss?fromDate=${startOfMonth}&toDate=${endOfMonth}`,
    )
    if (pnlData) xeroPnl = pnlData
  } catch { /* Xero not connected, skip */ }

  // 5. Xero bank balances (best effort)
  let xeroBanks = null
  try {
    const bankData = await callXeroAPI<{ Reports: Array<Record<string, unknown>> }>(
      'GET',
      '/Reports/BankSummary',
    )
    if (bankData) xeroBanks = bankData.Reports?.[0] ?? null
  } catch { /* skip */ }

  return NextResponse.json({
    invoices: {
      totalInvoiced: invoiceTotals?.totalInvoiced ?? 0,
      totalPaid: invoiceTotals?.totalPaid ?? 0,
      totalOutstanding: invoiceTotals?.totalOutstanding ?? 0,
      count: invoiceTotals?.invoiceCount ?? 0,
    },
    pipeline: {
      totalValue: pipelineTotal,
      weightedForecast: Math.round(weightedForecast),
      openDealCount: openDeals.length,
      monthlyProjections,
    },
    mrr,
    xero: {
      profitAndLoss: xeroPnl,
      bankSummary: xeroBanks,
    },
  })
}

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql, eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'
import { buildRateMap, toNzd, type RateMap } from '@/lib/currency'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Build a currency-to-NZD conversion map from exchange_rates table.
// See lib/currency.ts for the underlying math (tested in lib/__tests__/currency.test.ts).
async function getRateMap(database: D1): Promise<RateMap> {
  const rates = await database.select().from(schema.exchangeRates)
  return buildRateMap(rates)
}

// GET /api/admin/billing/financial-health
// Aggregates: local invoice totals, pipeline projections, Xero P&L summary, Xero bank balances
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db() as unknown as D1

  // Load exchange rates for currency conversion
  const rateMap = await getRateMap(database)

  // 1. Local invoice totals (per-invoice conversion to NZD)
  const allInvoices = await database
    .select({
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      status: schema.invoices.status,
    })
    .from(schema.invoices)

  let totalInvoiced = 0
  let totalPaid = 0
  let totalOutstanding = 0
  const invoiceCount = allInvoices.length

  for (const inv of allInvoices) {
    const nzd = toNzd(inv.totalUsd, inv.currency ?? 'USD', rateMap)
    totalInvoiced += nzd
    if (inv.status === 'paid') totalPaid += nzd
    if (inv.status === 'sent' || inv.status === 'overdue' || inv.status === 'viewed') totalOutstanding += nzd
  }

  // 2. Pipeline projections (weighted by historical probability)
  // valueNzd is already NZD-converted, use COALESCE with value for fallback
  const pipelineDeals = await database
    .select({
      valueNzd: schema.deals.valueNzd,
      value: schema.deals.value,
      currency: schema.deals.currency,
      probability: schema.pipelineStages.probability,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
      expectedCloseDate: schema.deals.expectedCloseDate,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  const openDeals = pipelineDeals.filter(d => !d.isClosedWon && !d.isClosedLost)
  const pipelineTotal = openDeals.reduce((s, d) => s + (d.valueNzd ?? d.value ?? 0), 0)
  const weightedForecast = openDeals.reduce((s, d) => s + ((d.valueNzd ?? d.value ?? 0) * (d.probability ?? 0) / 100), 0)

  // Monthly projected revenue from deals with expected close dates
  const monthlyProjections: Record<string, number> = {}
  for (const deal of openDeals) {
    if (deal.expectedCloseDate) {
      const month = deal.expectedCloseDate.slice(0, 7)
      const dealValue = deal.valueNzd ?? deal.value ?? 0
      monthlyProjections[month] = (monthlyProjections[month] ?? 0) + (dealValue * (deal.probability ?? 0) / 100)
    }
  }

  // 3. MRR from active organisations with custom MRR set
  // Each org's customMrr is in their preferredCurrency, so convert to NZD
  let mrr = 0
  try {
    const mrrRows = await database.all<{ custom_mrr: number; preferred_currency: string }>(
      sql`SELECT custom_mrr, preferred_currency FROM organisations WHERE status = 'active' AND custom_mrr > 0`
    )
    for (const row of mrrRows ?? []) {
      mrr += toNzd(row.custom_mrr, row.preferred_currency ?? 'NZD', rateMap)
    }
  } catch {
    // Column doesn't exist yet, fall back to 0
    mrr = 0
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
      totalInvoiced: Math.round(totalInvoiced),
      totalPaid: Math.round(totalPaid),
      totalOutstanding: Math.round(totalOutstanding),
      count: invoiceCount,
    },
    pipeline: {
      totalValue: pipelineTotal,
      weightedForecast: Math.round(weightedForecast),
      openDealCount: openDeals.length,
      monthlyProjections,
    },
    mrr: Math.round(mrr),
    xero: {
      profitAndLoss: xeroPnl,
      bankSummary: xeroBanks,
    },
  })
}

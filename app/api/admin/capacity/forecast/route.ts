import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'

// ── GET /api/admin/capacity/forecast ──────────────────────────────────────
// Returns forecasted capacity impact from pipeline deals weighted by
// probability, grouped by expected close month.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Get all open deals (not closed-won, not closed-lost) with their stage probability
  const deals = await database
    .select({
      dealId: schema.deals.id,
      title: schema.deals.title,
      valueNzd: schema.deals.valueNzd,
      estimatedHoursPerWeek: schema.deals.estimatedHoursPerWeek,
      expectedCloseDate: schema.deals.expectedCloseDate,
      probability: schema.pipelineStages.probability,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, sql`${schema.deals.stageId} = ${schema.pipelineStages.id}`)
    .where(sql`${schema.pipelineStages.isClosedWon} = 0 AND ${schema.pipelineStages.isClosedLost} = 0`)

  // Group by expected close month (YYYY-MM)
  const monthMap: Record<string, {
    month: string
    dealCount: number
    totalValueNzd: number
    weightedValueNzd: number
    totalHoursPerWeek: number
    weightedHoursPerWeek: number
    deals: Array<{
      id: string
      title: string
      valueNzd: number
      estimatedHoursPerWeek: number
      probability: number
      expectedCloseDate: string | null
    }>
  }> = {}

  for (const deal of deals) {
    const closeDate = deal.expectedCloseDate
    const month = closeDate ? closeDate.substring(0, 7) : 'unscheduled'
    const prob = (deal.probability ?? 0) / 100
    const hours = deal.estimatedHoursPerWeek ?? 0
    const value = Number(deal.valueNzd ?? 0)

    if (!monthMap[month]) {
      monthMap[month] = {
        month,
        dealCount: 0,
        totalValueNzd: 0,
        weightedValueNzd: 0,
        totalHoursPerWeek: 0,
        weightedHoursPerWeek: 0,
        deals: [],
      }
    }

    monthMap[month].dealCount++
    monthMap[month].totalValueNzd += value
    monthMap[month].weightedValueNzd += Math.round(value * prob)
    monthMap[month].totalHoursPerWeek += hours
    monthMap[month].weightedHoursPerWeek += Math.round(hours * prob * 10) / 10
    monthMap[month].deals.push({
      id: deal.dealId,
      title: deal.title,
      valueNzd: value,
      estimatedHoursPerWeek: hours,
      probability: deal.probability ?? 0,
      expectedCloseDate: closeDate,
    })
  }

  // Sort months chronologically, with 'unscheduled' at the end
  const months = Object.values(monthMap).sort((a, b) => {
    if (a.month === 'unscheduled') return 1
    if (b.month === 'unscheduled') return -1
    return a.month.localeCompare(b.month)
  })

  // Compute totals
  let totalWeightedHoursPerWeek = 0
  let totalWeightedValueNzd = 0
  for (const m of months) {
    totalWeightedHoursPerWeek += m.weightedHoursPerWeek
    totalWeightedValueNzd += m.weightedValueNzd
  }

  return NextResponse.json({
    months,
    totalWeightedHoursPerWeek: Math.round(totalWeightedHoursPerWeek * 10) / 10,
    totalWeightedValueNzd,
    totalOpenDeals: deals.length,
  })
}

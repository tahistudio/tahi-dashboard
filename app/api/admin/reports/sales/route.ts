import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { count, sum, sql } from 'drizzle-orm'

// ── GET /api/admin/reports/sales ───────────────────────────────────────────
// Returns pipeline value by stage, weighted pipeline, win rate, avg deal size,
// and avg days to close.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Pipeline value by stage (join deals with pipeline_stages)
  const pipelineByStage = await database
    .select({
      stageId: schema.pipelineStages.id,
      stageName: schema.pipelineStages.name,
      stageSlug: schema.pipelineStages.slug,
      probability: schema.pipelineStages.probability,
      position: schema.pipelineStages.position,
      colour: schema.pipelineStages.colour,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
      dealCount: count(schema.deals.id),
      totalValue: sum(schema.deals.valueNzd),
    })
    .from(schema.pipelineStages)
    .leftJoin(schema.deals, sql`${schema.deals.stageId} = ${schema.pipelineStages.id}`)
    .groupBy(schema.pipelineStages.id)
    .orderBy(schema.pipelineStages.position)

  // Compute derived metrics
  let totalPipelineValue = 0
  let weightedPipelineValue = 0
  let wonCount = 0
  let lostCount = 0
  let totalDealCount = 0

  for (const stage of pipelineByStage) {
    const stageValue = Number(stage.totalValue ?? 0)
    const stageProbability = stage.probability ?? 0
    totalDealCount += stage.dealCount

    totalPipelineValue += stageValue
    weightedPipelineValue += stageValue * (stageProbability / 100)

    if (stage.isClosedWon) {
      wonCount += stage.dealCount
    }
    if (stage.isClosedLost) {
      lostCount += stage.dealCount
    }
  }

  const closedTotal = wonCount + lostCount
  const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 10000) / 100 : 0
  const avgDealSize = totalDealCount > 0
    ? Math.round(totalPipelineValue / totalDealCount)
    : 0

  // Avg days to close for won deals
  const wonDeals = await database
    .select({
      createdAt: schema.deals.createdAt,
      closedAt: schema.deals.closedAt,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, sql`${schema.deals.stageId} = ${schema.pipelineStages.id}`)
    .where(sql`${schema.pipelineStages.isClosedWon} = 1`)

  let avgDaysToClose = 0
  if (wonDeals.length > 0) {
    let totalDays = 0
    let validCount = 0
    for (const deal of wonDeals) {
      if (deal.createdAt && deal.closedAt) {
        const created = new Date(deal.createdAt)
        const closed = new Date(deal.closedAt)
        const diffDays = (closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
        if (diffDays >= 0) {
          totalDays += diffDays
          validCount++
        }
      }
    }
    if (validCount > 0) {
      avgDaysToClose = Math.round((totalDays / validCount) * 10) / 10
    }
  }

  const stages = pipelineByStage.map((s) => ({
    id: s.stageId,
    name: s.stageName,
    slug: s.stageSlug,
    probability: s.probability,
    position: s.position,
    colour: s.colour,
    isClosedWon: s.isClosedWon,
    isClosedLost: s.isClosedLost,
    dealCount: s.dealCount,
    totalValue: Number(s.totalValue ?? 0),
  }))

  return NextResponse.json({
    stages,
    totalPipelineValue,
    weightedPipelineValue: Math.round(weightedPipelineValue),
    winRate,
    avgDealSize,
    avgDaysToClose,
    totalDeals: totalDealCount,
    wonCount,
    lostCount,
  })
}

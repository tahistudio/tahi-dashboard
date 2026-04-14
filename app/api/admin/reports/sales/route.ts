import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { count, sql } from 'drizzle-orm'

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
  // Exclude archived deals, and use COALESCE(valueNzd, value, 0) to match pipeline page logic
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
      totalValue: sql<number>`sum(COALESCE(${schema.deals.valueNzd}, ${schema.deals.value}, 0))`,
    })
    .from(schema.pipelineStages)
    .leftJoin(schema.deals, sql`${schema.deals.stageId} = ${schema.pipelineStages.id} AND (${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)
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

    // Only include open deals in pipeline totals
    if (!stage.isClosedWon && !stage.isClosedLost) {
      totalPipelineValue += stageValue
      weightedPipelineValue += stageValue * (stageProbability / 100)
    }

    if (stage.isClosedWon) {
      wonCount += stage.dealCount
    }
    if (stage.isClosedLost) {
      lostCount += stage.dealCount
    }
  }

  const closedTotal = wonCount + lostCount
  const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 10000) / 100 : 0
  const openDealCount = totalDealCount - wonCount - lostCount
  const avgDealSize = openDealCount > 0
    ? Math.round(totalPipelineValue / openDealCount)
    : 0

  // Avg days to close for won deals (exclude archived)
  const wonDeals = await database
    .select({
      createdAt: schema.deals.createdAt,
      closedAt: schema.deals.closedAt,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, sql`${schema.deals.stageId} = ${schema.pipelineStages.id}`)
    .where(sql`${schema.pipelineStages.isClosedWon} = 1 AND (${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

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

  // Per-source breakdowns: avg deal size by source and close rate by source
  // Exclude archived deals
  const allDealsWithSource = await database
    .select({
      source: schema.deals.source,
      valueNzd: schema.deals.valueNzd,
      value: schema.deals.value,
      stageId: schema.deals.stageId,
    })
    .from(schema.deals)
    .where(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  // Get closed-won and closed-lost stage IDs for close rate calc
  const closedWonStageIds = new Set(
    pipelineByStage.filter(s => s.isClosedWon).map(s => s.stageId)
  )
  const closedLostStageIds = new Set(
    pipelineByStage.filter(s => s.isClosedLost).map(s => s.stageId)
  )

  const sourceMap: Record<string, { totalValue: number; dealCount: number; wonCount: number; lostCount: number }> = {}

  for (const deal of allDealsWithSource) {
    const src = deal.source ?? 'unknown'
    if (!sourceMap[src]) {
      sourceMap[src] = { totalValue: 0, dealCount: 0, wonCount: 0, lostCount: 0 }
    }
    sourceMap[src].dealCount++
    sourceMap[src].totalValue += Number(deal.valueNzd ?? deal.value ?? 0)
    if (closedWonStageIds.has(deal.stageId)) {
      sourceMap[src].wonCount++
    }
    if (closedLostStageIds.has(deal.stageId)) {
      sourceMap[src].lostCount++
    }
  }

  const sourceBreakdowns = Object.entries(sourceMap).map(([source, data]) => {
    const closedCount = data.wonCount + data.lostCount
    const closeRate = closedCount > 0
      ? Math.round((data.wonCount / closedCount) * 10000) / 100
      : 0
    const avgDealSizeBySource = data.dealCount > 0
      ? Math.round(data.totalValue / data.dealCount)
      : 0

    return {
      source,
      dealCount: data.dealCount,
      totalValue: data.totalValue,
      avgDealSize: avgDealSizeBySource,
      wonCount: data.wonCount,
      lostCount: data.lostCount,
      closeRate,
    }
  }).sort((a, b) => b.totalValue - a.totalValue)

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
    sourceBreakdowns,
  })
}

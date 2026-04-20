import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { count, sql, eq } from 'drizzle-orm'
import { calculatePipelineTotals, type StageForMath, type DealForMath } from '@/lib/pipeline-math'

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

  // Compute weighted totals via the shared pipeline-math helper using
  // historical close rates where available (Decision #040). Fetch the
  // actual deals and their stages rather than aggregating by stage with
  // static probability only.
  const allDeals = await database
    .select({
      id: schema.deals.id,
      stageId: schema.deals.stageId,
      value: schema.deals.value,
      valueNzd: schema.deals.valueNzd,
      stageProbability: schema.pipelineStages.probability,
      stageIsClosedWon: schema.pipelineStages.isClosedWon,
      stageIsClosedLost: schema.pipelineStages.isClosedLost,
    })
    .from(schema.deals)
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  // Historical probability per stage: reuse the same formula as the
  // pipeline-stages endpoint (won / deals-reached) when >=3 deals.
  const stageProbMap: Map<string, number | null> = new Map()
  for (const stage of pipelineByStage) {
    if (stage.isClosedWon || stage.isClosedLost) {
      stageProbMap.set(stage.stageId, null)
      continue
    }
    const reachedOrBeyond = pipelineByStage.filter(s => (s.position ?? 0) >= (stage.position ?? 0))
    const reachCount = reachedOrBeyond.reduce((sum, s) => sum + s.dealCount, 0)
    const wonAtOrBeyond = pipelineByStage.filter(s => s.isClosedWon).reduce((sum, s) => sum + s.dealCount, 0)
    if (reachCount >= 3) {
      stageProbMap.set(stage.stageId, Math.round((wonAtOrBeyond / reachCount) * 100))
    } else {
      stageProbMap.set(stage.stageId, null)
    }
  }

  const stagesForMath: StageForMath[] = pipelineByStage.map(s => ({
    id: s.stageId,
    probability: s.probability ?? null,
    historicalProbability: stageProbMap.get(s.stageId) ?? null,
    isClosedWon: !!s.isClosedWon,
    isClosedLost: !!s.isClosedLost,
  }))

  const dealsForMath: DealForMath[] = allDeals.map(d => ({
    stageId: d.stageId,
    value: d.value,
    valueNzd: d.valueNzd,
    stageProbability: d.stageProbability ?? null,
    stageIsClosedWon: !!d.stageIsClosedWon,
    stageIsClosedLost: !!d.stageIsClosedLost,
  }))

  const totals = calculatePipelineTotals(dealsForMath, stagesForMath)
  const totalPipelineValue = totals.totalValue
  const weightedPipelineValue = totals.weightedValue
  const wonCount = totals.wonCount
  const lostCount = totals.lostCount
  const totalDealCount = allDeals.length
  const winRate = totals.winRate
  const avgDealSize = totals.avgDealSize

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

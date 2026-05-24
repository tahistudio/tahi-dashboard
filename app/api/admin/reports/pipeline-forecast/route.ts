/**
 * GET /api/admin/reports/pipeline-forecast
 *
 * Returns a weighted-by-stage-probability forecast of the active
 * deal pipeline. For each stage:
 *   - weighted upfront = SUM(upfrontValueNzd) × stage.probability
 *   - weighted monthly = SUM(monthlyValueNzd) × stage.probability
 *
 * Closed-won stages are excluded (they're realised, not forecast).
 * Closed-lost are also excluded. Everything in flight is included.
 *
 * Returns:
 *   {
 *     totalDeals,
 *     weightedUpfrontNzd,
 *     weightedMonthlyNzd,
 *     unweightedUpfrontNzd,
 *     unweightedMonthlyNzd,
 *     byStage: [{ stageId, name, slug, probability, dealCount,
 *                 upfrontNzd, monthlyNzd, weightedUpfrontNzd,
 *                 weightedMonthlyNzd, colour }],
 *   }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Pull all stages + the deals attached to each.
  const [stages, dealRows] = await Promise.all([
    database
      .select()
      .from(schema.pipelineStages)
      .orderBy(asc(schema.pipelineStages.position)),
    database
      .select({
        id: schema.deals.id,
        stageId: schema.deals.stageId,
        upfrontValueNzd: schema.deals.upfrontValueNzd,
        monthlyValueNzd: schema.deals.monthlyValueNzd,
      })
      .from(schema.deals),
  ])

  // Aggregate deals per stage.
  const byStageMap = new Map<string, { dealCount: number; upfrontNzd: number; monthlyNzd: number }>()
  for (const deal of dealRows) {
    const agg = byStageMap.get(deal.stageId) ?? { dealCount: 0, upfrontNzd: 0, monthlyNzd: 0 }
    agg.dealCount++
    agg.upfrontNzd += deal.upfrontValueNzd ?? 0
    agg.monthlyNzd += deal.monthlyValueNzd ?? 0
    byStageMap.set(deal.stageId, agg)
  }

  const byStage: Array<{
    stageId: string
    name: string
    slug: string
    probability: number
    position: number
    colour: string | null
    isClosedWon: boolean
    isClosedLost: boolean
    dealCount: number
    upfrontNzd: number
    monthlyNzd: number
    weightedUpfrontNzd: number
    weightedMonthlyNzd: number
  }> = []

  let totalDeals = 0
  let unweightedUpfrontNzd = 0
  let unweightedMonthlyNzd = 0
  let weightedUpfrontNzd = 0
  let weightedMonthlyNzd = 0

  for (const stage of stages) {
    const agg = byStageMap.get(stage.id) ?? { dealCount: 0, upfrontNzd: 0, monthlyNzd: 0 }
    const isWon = stage.isClosedWon === 1
    const isLost = stage.isClosedLost === 1
    const weightedU = isWon || isLost ? 0 : Math.round(agg.upfrontNzd * (stage.probability / 100))
    const weightedM = isWon || isLost ? 0 : Math.round(agg.monthlyNzd * (stage.probability / 100))

    byStage.push({
      stageId: stage.id,
      name: stage.name,
      slug: stage.slug,
      probability: stage.probability,
      position: stage.position,
      colour: stage.colour,
      isClosedWon: isWon,
      isClosedLost: isLost,
      dealCount: agg.dealCount,
      upfrontNzd: agg.upfrontNzd,
      monthlyNzd: agg.monthlyNzd,
      weightedUpfrontNzd: weightedU,
      weightedMonthlyNzd: weightedM,
    })

    totalDeals += agg.dealCount
    if (!isWon && !isLost) {
      unweightedUpfrontNzd += agg.upfrontNzd
      unweightedMonthlyNzd += agg.monthlyNzd
      weightedUpfrontNzd += weightedU
      weightedMonthlyNzd += weightedM
    }
  }

  return NextResponse.json({
    totalDeals,
    unweightedUpfrontNzd,
    unweightedMonthlyNzd,
    weightedUpfrontNzd,
    weightedMonthlyNzd,
    byStage,
  })
}

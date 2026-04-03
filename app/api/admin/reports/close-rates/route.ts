import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'

// ── GET /api/admin/reports/close-rates ─────────────────────────────────────
// Returns stage conversion rates, win/loss counts over time, and revenue per stage.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // 1. Get all pipeline stages ordered by position
  const stages = await database
    .select()
    .from(schema.pipelineStages)
    .orderBy(schema.pipelineStages.position)

  // 2. Get all deals with their current stage position
  const allDeals = await database
    .select({
      id: schema.deals.id,
      stageId: schema.deals.stageId,
      valueNzd: schema.deals.valueNzd,
      createdAt: schema.deals.createdAt,
      closedAt: schema.deals.closedAt,
      stagePosition: schema.pipelineStages.position,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, sql`${schema.deals.stageId} = ${schema.pipelineStages.id}`)

  // 3. Compute stage conversion rates
  // A deal has "passed through" stage N if its current stage position >= N.
  // Conversion from stage N to N+1 = deals at position >= N+1 / deals at position >= N.
  const stageConversions = []
  for (let i = 0; i < stages.length - 1; i++) {
    const currentPos = stages[i].position
    const nextPos = stages[i + 1].position

    const enteredCurrent = allDeals.filter(d => d.stagePosition >= currentPos).length
    const reachedNext = allDeals.filter(d => d.stagePosition >= nextPos).length

    stageConversions.push({
      fromStage: stages[i].name,
      fromSlug: stages[i].slug,
      toStage: stages[i + 1].name,
      toSlug: stages[i + 1].slug,
      entered: enteredCurrent,
      converted: reachedNext,
      conversionRate: enteredCurrent > 0
        ? Math.round((reachedNext / enteredCurrent) * 10000) / 100
        : 0,
    })
  }

  // 4. Win/loss counts over time (monthly for last 12 months)
  const now = new Date()
  const monthlyWinLoss: Array<{
    month: string
    won: number
    lost: number
    wonValue: number
    lostValue: number
  }> = []

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyWinLoss.push({ month: key, won: 0, lost: 0, wonValue: 0, lostValue: 0 })
  }

  for (const deal of allDeals) {
    const dateStr = deal.closedAt ?? deal.createdAt
    if (!dateStr) continue
    const d = new Date(dateStr)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const bucket = monthlyWinLoss.find(m => m.month === key)
    if (!bucket) continue

    if (deal.isClosedWon) {
      bucket.won++
      bucket.wonValue += deal.valueNzd
    } else if (deal.isClosedLost) {
      bucket.lost++
      bucket.lostValue += deal.valueNzd
    }
  }

  // 5. Revenue per stage (total value of deals currently in each stage)
  const revenueByStage = stages.map((stage) => {
    const dealsInStage = allDeals.filter(d => d.stageId === stage.id)
    const totalValue = dealsInStage.reduce((acc, d) => acc + d.valueNzd, 0)
    return {
      stageId: stage.id,
      stageName: stage.name,
      stageSlug: stage.slug,
      position: stage.position,
      dealCount: dealsInStage.length,
      totalValue,
    }
  })

  return NextResponse.json({
    stageConversions,
    monthlyWinLoss,
    revenueByStage,
  })
}

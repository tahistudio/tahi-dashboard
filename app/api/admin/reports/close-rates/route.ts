import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql, eq } from 'drizzle-orm'

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

  // 6. Compute stage velocity: avg days deals spend in each stage
  // Uses activities of type 'stage_change' to compute transitions.
  const stageChangeActivities = await database
    .select({
      dealId: schema.activities.dealId,
      createdAt: schema.activities.createdAt,
      description: schema.activities.description,
    })
    .from(schema.activities)
    .where(eq(schema.activities.type, 'stage_change'))
    .orderBy(schema.activities.createdAt)

  // Group stage transitions by deal
  const dealTransitions = new Map<string, Array<{ createdAt: string; description: string | null }>>()
  for (const act of stageChangeActivities) {
    if (!act.dealId) continue
    const existing = dealTransitions.get(act.dealId) ?? []
    existing.push({ createdAt: act.createdAt, description: act.description })
    dealTransitions.set(act.dealId, existing)
  }

  // Also get deal creation dates for the first stage duration
  const dealCreationMap = new Map<string, string>()
  for (const deal of allDeals) {
    dealCreationMap.set(deal.id, deal.createdAt ?? '')
  }

  // Compute avg days between consecutive stage transitions per stage
  const stageDurations = new Map<string, number[]>()

  for (const [dealId, transitions] of dealTransitions) {
    const sortedTransitions = transitions.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )

    // First transition: time from deal creation to first stage change
    const createdAt = dealCreationMap.get(dealId)
    if (createdAt && sortedTransitions.length > 0) {
      const firstTransition = sortedTransitions[0]
      const days = Math.max(0,
        (new Date(firstTransition.createdAt).getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
      )
      // Use the first stage name from the description if possible
      const firstStageName = stages.length > 0 ? stages[0].name : 'Initial'
      const existing = stageDurations.get(firstStageName) ?? []
      existing.push(days)
      stageDurations.set(firstStageName, existing)
    }

    // Subsequent transitions: time between each pair
    for (let i = 0; i < sortedTransitions.length - 1; i++) {
      const current = sortedTransitions[i]
      const next = sortedTransitions[i + 1]
      const days = Math.max(0,
        (new Date(next.createdAt).getTime() - new Date(current.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      )
      // Try to extract stage name from description (format: "Stage changed to X")
      const match = current.description?.match(/moved to (.+)/i)
        ?? current.description?.match(/changed to (.+)/i)
      const stageName = match?.[1]?.trim() ?? `Stage ${i + 1}`
      const existing = stageDurations.get(stageName) ?? []
      existing.push(days)
      stageDurations.set(stageName, existing)
    }
  }

  // Build stageVelocity array aligned with pipeline stages
  const stageVelocity = stages
    .filter(s => !s.isClosedWon && !s.isClosedLost)
    .map((stage) => {
      const durations = stageDurations.get(stage.name) ?? []
      const avgDays = durations.length > 0
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : 0
      return {
        stageId: stage.id,
        stageName: stage.name,
        stageSlug: stage.slug,
        position: stage.position,
        avgDays,
        dealCount: durations.length,
      }
    })

  return NextResponse.json({
    stageConversions,
    monthlyWinLoss,
    revenueByStage,
    stageVelocity,
  })
}

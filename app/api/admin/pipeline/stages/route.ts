import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc, eq, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const DEFAULT_STAGES = [
  { name: 'Lead',           slug: 'lead',           probability: 10,  position: 0, colour: '#60a5fa', isDefault: 1, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Discovery',      slug: 'discovery',      probability: 20,  position: 1, colour: '#a78bfa', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Proposal',       slug: 'proposal',       probability: 40,  position: 2, colour: '#fbbf24', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Negotiation',    slug: 'negotiation',    probability: 60,  position: 3, colour: '#fb923c', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Verbal Commit',  slug: 'verbal_commit',  probability: 80,  position: 4, colour: '#4ade80', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Stalled',        slug: 'stalled',        probability: 5,   position: 5, colour: '#94a3b8', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Closed Won',     slug: 'closed_won',     probability: 100, position: 6, colour: '#22c55e', isDefault: 0, isClosedWon: 1, isClosedLost: 0 },
  { name: 'Closed Lost',    slug: 'closed_lost',    probability: 0,   position: 7, colour: '#f87171', isDefault: 0, isClosedWon: 0, isClosedLost: 1 },
] as const

async function seedDefaultStages(database: D1) {
  const now = new Date().toISOString()
  for (const stage of DEFAULT_STAGES) {
    await database.insert(schema.pipelineStages).values({
      id: crypto.randomUUID(),
      name: stage.name,
      slug: stage.slug,
      probability: stage.probability,
      position: stage.position,
      colour: stage.colour,
      isDefault: stage.isDefault,
      isClosedWon: stage.isClosedWon,
      isClosedLost: stage.isClosedLost,
      createdAt: now,
    })
  }
}

// GET /api/admin/pipeline/stages
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db() as unknown as D1

  let stages = await database
    .select()
    .from(schema.pipelineStages)
    .orderBy(asc(schema.pipelineStages.position))

  // Auto-seed default stages if none exist
  if (stages.length === 0) {
    try {
      await seedDefaultStages(database)
      stages = await database
        .select()
        .from(schema.pipelineStages)
        .orderBy(asc(schema.pipelineStages.position))
    } catch (err) {
      console.error('Failed to seed default pipeline stages', err)
      return NextResponse.json({ error: 'Failed to initialize pipeline stages' }, { status: 500 })
    }
  }

  // Compute historical conversion probabilities from deal data
  const allDeals = await database
    .select({
      stagePosition: schema.pipelineStages.position,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  const wonCount = allDeals.filter(d => d.isClosedWon).length
  const totalDeals = allDeals.length

  // For each stage: deals that reached at least this position = those currently at this position or beyond
  // Since deals move forward, current position >= stage position means they passed through it
  const stagesWithHistory = stages.map(stage => {
    const dealsAtOrPast = allDeals.filter(d => d.stagePosition >= stage.position).length
    const historicalProbability = dealsAtOrPast >= 3
      ? Math.round((wonCount / dealsAtOrPast) * 100)
      : null // Not enough data, return null to use static probability
    return {
      ...stage,
      historicalProbability,
      dealsSampled: dealsAtOrPast,
      totalDeals,
    }
  })

  return NextResponse.json({ stages: stagesWithHistory })
}

// PUT /api/admin/pipeline/stages - bulk update (reorder, rename, change colors, probabilities)
export async function PUT(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    stages?: Array<{
      id: string
      name?: string
      slug?: string
      probability?: number
      position?: number
      colour?: string | null
      isDefault?: number
      isClosedWon?: number
      isClosedLost?: number
    }>
  }

  if (!body.stages || !Array.isArray(body.stages) || body.stages.length === 0) {
    return NextResponse.json({ error: 'stages array is required' }, { status: 400 })
  }

  // Validate all entries have an id
  for (const stage of body.stages) {
    if (!stage.id) {
      return NextResponse.json({ error: 'Each stage must have an id' }, { status: 400 })
    }
  }

  const database = await db() as unknown as D1

  for (const stage of body.stages) {
    const updates: Record<string, unknown> = {}

    if (stage.name !== undefined) updates.name = stage.name.trim()
    if (stage.slug !== undefined) updates.slug = stage.slug
    if (stage.probability !== undefined) updates.probability = stage.probability
    if (stage.position !== undefined) updates.position = stage.position
    if (stage.colour !== undefined) updates.colour = stage.colour
    if (stage.isDefault !== undefined) updates.isDefault = stage.isDefault
    if (stage.isClosedWon !== undefined) updates.isClosedWon = stage.isClosedWon
    if (stage.isClosedLost !== undefined) updates.isClosedLost = stage.isClosedLost

    if (Object.keys(updates).length > 0) {
      await database
        .update(schema.pipelineStages)
        .set(updates)
        .where(eq(schema.pipelineStages.id, stage.id))
    }
  }

  // Return the updated stages
  const stages = await database
    .select()
    .from(schema.pipelineStages)
    .orderBy(asc(schema.pipelineStages.position))

  return NextResponse.json({ stages })
}

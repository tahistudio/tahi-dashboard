import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc, eq, sql, inArray } from 'drizzle-orm'
import { computeStageProbabilities, type StageInfo, type ActivityStageEvent } from '@/lib/pipeline-probability'

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

  // Load all non-archived deals with their stage info.
  const allDeals = await database
    .select({
      id: schema.deals.id,
      stageId: schema.deals.stageId,
      stagePosition: schema.pipelineStages.position,
    })
    .from(schema.deals)
    .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .where(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  // Pull stage-history events from the activity log (Decision #041) so we
  // can compute historical probability via true journeys where available.
  // Read metadata via raw SQL \u2014 the column was added in migration 0017 and
  // isn't in the Drizzle schema yet (Decision #039 lesson).
  let stageEvents: ActivityStageEvent[] = []
  if (allDeals.length > 0) {
    try {
      const dealIds = allDeals.map(d => d.id).filter(id => /^[a-f0-9-]{36}$/i.test(id))
      if (dealIds.length > 0) {
        const list = dealIds.map(id => `'${id}'`).join(',')
        const res = await database.all(sql.raw(
          `SELECT deal_id, type, metadata, created_at FROM activities
           WHERE type IN ('deal_created', 'stage_change') AND deal_id IN (${list})`,
        )) as unknown as Array<{ deal_id: string; type: string; metadata: string | null; created_at: string }>
          | { results?: Array<{ deal_id: string; type: string; metadata: string | null; created_at: string }> }
        const rows = Array.isArray(res) ? res : (res?.results ?? [])
        stageEvents = rows.map(r => ({ dealId: r.deal_id, type: r.type, metadata: r.metadata, createdAt: r.created_at }))
      }
    } catch {
      // Migration 0017 not applied yet \u2014 fall back to linear inference only.
      stageEvents = []
    }
  }

  const stageInfos: StageInfo[] = stages.map(s => ({
    id: s.id,
    slug: s.slug,
    position: s.position,
    isClosedWon: s.isClosedWon,
    isClosedLost: s.isClosedLost,
  }))

  const probMap = computeStageProbabilities({
    stages: stageInfos,
    deals: allDeals.map(d => ({ id: d.id, stageId: d.stageId, stagePosition: d.stagePosition })),
    stageEvents,
  })

  const totalDeals = allDeals.length
  const stagesWithHistory = stages.map(stage => {
    const prob = probMap.get(stage.id)
    return {
      ...stage,
      historicalProbability: prob?.historicalProbability ?? null,
      dealsSampled: prob?.dealsSampled ?? 0,
      wonSampled: prob?.wonCount ?? 0,
      probabilitySource: prob?.source ?? 'insufficient',
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

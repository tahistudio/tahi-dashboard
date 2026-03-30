import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const DEFAULT_STAGES = [
  { name: 'Lead',           slug: 'lead',           probability: 10,  position: 0, colour: '#60a5fa', isDefault: 1, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Discovery',      slug: 'discovery',      probability: 20,  position: 1, colour: '#a78bfa', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Proposal',       slug: 'proposal',       probability: 40,  position: 2, colour: '#fbbf24', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Negotiation',    slug: 'negotiation',    probability: 60,  position: 3, colour: '#fb923c', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Verbal Commit',  slug: 'verbal_commit',  probability: 80,  position: 4, colour: '#4ade80', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Closed Won',     slug: 'closed_won',     probability: 100, position: 5, colour: '#22c55e', isDefault: 0, isClosedWon: 1, isClosedLost: 0 },
  { name: 'Closed Lost',    slug: 'closed_lost',    probability: 0,   position: 6, colour: '#f87171', isDefault: 0, isClosedWon: 0, isClosedLost: 1 },
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

  return NextResponse.json({ stages })
}

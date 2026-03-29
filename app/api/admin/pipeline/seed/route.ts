import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

const DEFAULT_STAGES = [
  { name: 'Inquiry',       slug: 'inquiry',       probability: 5,   position: 0, colour: '#60a5fa', isDefault: 1, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Contacted',     slug: 'contacted',     probability: 10,  position: 1, colour: '#a78bfa', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Discovery',     slug: 'discovery',     probability: 25,  position: 2, colour: '#fbbf24', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Proposal Sent', slug: 'proposal_sent', probability: 50,  position: 3, colour: '#fb923c', isDefault: 0, isClosedWon: 0, isClosedLost: 0 },
  { name: 'Won',           slug: 'won',           probability: 100, position: 4, colour: '#4ade80', isDefault: 0, isClosedWon: 1, isClosedLost: 0 },
  { name: 'Lost',          slug: 'lost',          probability: 0,   position: 5, colour: '#f87171', isDefault: 0, isClosedWon: 0, isClosedLost: 1 },
  { name: 'Stalled',       slug: 'stalled',       probability: 0,   position: 6, colour: '#8a9987', isDefault: 0, isClosedWon: 0, isClosedLost: 1 },
] as const

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  // Check if stages already exist
  const existing = await database.select().from(schema.pipelineStages).limit(1)
  if (existing.length > 0) {
    return NextResponse.json({ message: 'Pipeline stages already seeded', count: existing.length })
  }

  const inserted = []
  for (const stage of DEFAULT_STAGES) {
    const id = crypto.randomUUID()
    await database.insert(schema.pipelineStages).values({
      id,
      name: stage.name,
      slug: stage.slug,
      probability: stage.probability,
      position: stage.position,
      colour: stage.colour,
      isDefault: stage.isDefault,
      isClosedWon: stage.isClosedWon,
      isClosedLost: stage.isClosedLost,
    })
    inserted.push({ id, name: stage.name, slug: stage.slug })
  }

  return NextResponse.json({ message: 'Pipeline stages seeded', stages: inserted })
}

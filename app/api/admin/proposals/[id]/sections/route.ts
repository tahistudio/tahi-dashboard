import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

const SECTION_TYPES = [
  // Legacy / generic
  'cover', 'overview', 'terms', 'about', 'testimonial', 'scope_shared', 'text',
  // Phase 4 sales-led types (data shape lives in app/p/proposal/[token]/section-blocks.tsx)
  'value_anchor', 'process', 'differentiators', 'case_study',
  'testimonial_stack', 'faq', 'guarantee', 'retainer_offer',
  // Phase 9 — founder-led credibility slide
  'founders',
] as const

// POST /api/admin/proposals/[id]/sections
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: proposalId } = await ctx.params
  const body = await req.json() as {
    type?: string
    title?: string | null
    subtitle?: string | null
    data?: unknown
    position?: number
  }
  if (!body.type || !SECTION_TYPES.includes(body.type as typeof SECTION_TYPES[number])) {
    return NextResponse.json({ error: `type must be one of ${SECTION_TYPES.join(', ')}` }, { status: 400 })
  }

  const database = await db() as unknown as D1
  let position = body.position
  if (position == null) {
    const [maxRow] = await database
      .select({ maxPos: sql<number>`COALESCE(MAX(${schema.proposalSections.position}), -1)` })
      .from(schema.proposalSections)
      .where(eq(schema.proposalSections.proposalId, proposalId))
    position = (maxRow?.maxPos ?? -1) + 1
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.proposalSections).values({
    id,
    proposalId,
    type: body.type,
    title: body.title?.trim() ?? null,
    subtitle: body.subtitle?.trim() ?? null,
    data: body.data === undefined ? null : JSON.stringify(body.data),
    position,
    createdAt: now,
    updatedAt: now,
  })
  await database.update(schema.proposals).set({ updatedAt: now }).where(eq(schema.proposals.id, proposalId))
  return NextResponse.json({ id }, { status: 201 })
}

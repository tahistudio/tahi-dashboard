import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/proposals/templates — list ─────────────────────────────
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const database = await db() as unknown as D1
  const items = await database
    .select({
      id: schema.proposalTemplates.id,
      name: schema.proposalTemplates.name,
      description: schema.proposalTemplates.description,
      createdAt: schema.proposalTemplates.createdAt,
      updatedAt: schema.proposalTemplates.updatedAt,
    })
    .from(schema.proposalTemplates)
    .orderBy(desc(schema.proposalTemplates.updatedAt))
  return NextResponse.json({ items })
}

// ── POST /api/admin/proposals/templates ──────────────────────────────────
//
// Two ways to seed a template:
// 1. fromProposalId — snapshot the current proposal's sections + variants
// 2. snapshot — pass a hand-authored snapshot directly (used by tests / MCP)
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name?: string
    description?: string
    fromProposalId?: string
    snapshot?: unknown
    variableDefs?: unknown
  }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const database = await db() as unknown as D1

  let snapshot: unknown
  if (body.fromProposalId) {
    const [proposal] = await database
      .select({
        title: schema.proposals.title,
        subtitle: schema.proposals.subtitle,
      })
      .from(schema.proposals)
      .where(eq(schema.proposals.id, body.fromProposalId))
      .limit(1)
    if (!proposal) return NextResponse.json({ error: 'Source proposal not found' }, { status: 404 })

    const sections = await database
      .select({
        type: schema.proposalSections.type,
        title: schema.proposalSections.title,
        subtitle: schema.proposalSections.subtitle,
        data: schema.proposalSections.data,
        position: schema.proposalSections.position,
      })
      .from(schema.proposalSections)
      .where(eq(schema.proposalSections.proposalId, body.fromProposalId))
      .orderBy(asc(schema.proposalSections.position))

    const variants = await database
      .select({
        name: schema.proposalVariants.name,
        tagline: schema.proposalVariants.tagline,
        oneOffAmount: schema.proposalVariants.oneOffAmount,
        monthlyAmount: schema.proposalVariants.monthlyAmount,
        currency: schema.proposalVariants.currency,
        scopeHtml: schema.proposalVariants.scopeHtml,
        pricingNotesHtml: schema.proposalVariants.pricingNotesHtml,
        ctaLabel: schema.proposalVariants.ctaLabel,
        isFeatured: schema.proposalVariants.isFeatured,
        position: schema.proposalVariants.position,
      })
      .from(schema.proposalVariants)
      .where(eq(schema.proposalVariants.proposalId, body.fromProposalId))
      .orderBy(asc(schema.proposalVariants.position))

    snapshot = {
      title: proposal.title,
      subtitle: proposal.subtitle,
      sections: sections.map(s => ({ ...s, data: s.data ? safeParse(s.data) : null })),
      variants,
    }
  } else if (body.snapshot) {
    snapshot = body.snapshot
  } else {
    return NextResponse.json({ error: 'fromProposalId or snapshot required' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.proposalTemplates).values({
    id,
    name: body.name.trim(),
    description: body.description?.trim() ?? null,
    snapshot: JSON.stringify(snapshot),
    variableDefs: body.variableDefs ? JSON.stringify(body.variableDefs) : null,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })
  return NextResponse.json({ id }, { status: 201 })
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

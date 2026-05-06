import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// ── GET /api/admin/proposals/[id] ─────────────────────────────────────
// Returns proposal + sections + variants + recent acceptances (for audit).
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [proposal] = await database
    .select({
      id: schema.proposals.id,
      orgId: schema.proposals.orgId,
      dealId: schema.proposals.dealId,
      title: schema.proposals.title,
      subtitle: schema.proposals.subtitle,
      preparedFor: schema.proposals.preparedFor,
      preparedBy: schema.proposals.preparedBy,
      effectiveDate: schema.proposals.effectiveDate,
      expiresAt: schema.proposals.expiresAt,
      status: schema.proposals.status,
      publicShareToken: schema.proposals.publicShareToken,
      publicSharedAt: schema.proposals.publicSharedAt,
      decidedAt: schema.proposals.decidedAt,
      decidedVariantId: schema.proposals.decidedVariantId,
      createdAt: schema.proposals.createdAt,
      updatedAt: schema.proposals.updatedAt,
      orgName: schema.organisations.name,
      dealTitle: schema.deals.title,
    })
    .from(schema.proposals)
    .leftJoin(schema.organisations, eq(schema.proposals.orgId, schema.organisations.id))
    .leftJoin(schema.deals, eq(schema.proposals.dealId, schema.deals.id))
    .where(eq(schema.proposals.id, id))
    .limit(1)

  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  const [sections, variants, acceptances] = await Promise.all([
    database.select().from(schema.proposalSections)
      .where(eq(schema.proposalSections.proposalId, id))
      .orderBy(asc(schema.proposalSections.position)),
    database.select().from(schema.proposalVariants)
      .where(eq(schema.proposalVariants.proposalId, id))
      .orderBy(asc(schema.proposalVariants.position)),
    database.select().from(schema.proposalAcceptances)
      .where(eq(schema.proposalAcceptances.proposalId, id))
      .orderBy(asc(schema.proposalAcceptances.acceptedAt)),
  ])

  return NextResponse.json({ proposal, sections, variants, acceptances })
}

// ── PATCH /api/admin/proposals/[id] ────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json() as {
    title?: string
    subtitle?: string | null
    orgId?: string | null
    dealId?: string | null
    preparedFor?: string | null
    preparedBy?: string | null
    effectiveDate?: string | null
    expiresAt?: string | null
    status?: 'draft' | 'shared' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
  }

  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.subtitle !== undefined) updates.subtitle = body.subtitle?.trim() ?? null
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.dealId !== undefined) updates.dealId = body.dealId
  if (body.preparedFor !== undefined) updates.preparedFor = body.preparedFor?.trim() ?? null
  if (body.preparedBy !== undefined) updates.preparedBy = body.preparedBy?.trim() ?? null
  if (body.effectiveDate !== undefined) updates.effectiveDate = body.effectiveDate
  if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt
  if (body.status !== undefined) updates.status = body.status

  await database.update(schema.proposals).set(updates).where(eq(schema.proposals.id, id))
  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/proposals/[id] ───────────────────────────────────
// Cascades to sections + variants + acceptances via FK CASCADE.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  await database.delete(schema.proposals).where(eq(schema.proposals.id, id))
  return NextResponse.json({ success: true })
}

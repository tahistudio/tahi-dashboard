import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── GET /api/admin/proposals ──────────────────────────────────────────
// List with filters: orgId, dealId, status. Joins org + deal names.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const filterDealId = url.searchParams.get('dealId')
  const filterStatus = url.searchParams.get('status')

  const database = await db() as unknown as D1
  const conditions = []
  if (filterOrgId) conditions.push(eq(schema.proposals.orgId, filterOrgId))
  if (filterDealId) conditions.push(eq(schema.proposals.dealId, filterDealId))
  if (filterStatus) conditions.push(eq(schema.proposals.status, filterStatus))

  const items = await database
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
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.proposals.updatedAt))

  return NextResponse.json({ items })
}

// ── POST /api/admin/proposals ─────────────────────────────────────────
// Create a proposal. Optionally seeds a default cover section + a single
// "Standard" variant when no sections/variants are supplied.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    title?: string
    subtitle?: string
    orgId?: string | null
    dealId?: string | null
    preparedFor?: string
    preparedBy?: string
    effectiveDate?: string
    expiresAt?: string
    /** If true, seed a default variant + cover section so the new proposal
     *  isn't visually empty when the user opens the editor. */
    seedDefaults?: boolean
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.proposals).values({
    id,
    orgId: body.orgId ?? null,
    dealId: body.dealId ?? null,
    title: body.title.trim(),
    subtitle: body.subtitle?.trim() ?? null,
    preparedFor: body.preparedFor?.trim() ?? null,
    preparedBy: body.preparedBy?.trim() ?? null,
    effectiveDate: body.effectiveDate ?? null,
    expiresAt: body.expiresAt ?? null,
    status: 'draft',
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  let defaultVariantId: string | null = null
  let defaultSectionId: string | null = null

  if (body.seedDefaults !== false) {
    // Seed a single Standard variant so the editor + viewer have something
    // to render on first load.
    defaultVariantId = crypto.randomUUID()
    await database.insert(schema.proposalVariants).values({
      id: defaultVariantId,
      proposalId: id,
      name: 'Standard',
      tagline: null,
      oneOffAmount: 0,
      monthlyAmount: 0,
      currency: 'NZD',
      ctaLabel: 'Accept this package',
      isFeatured: 1,
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    // Seed an executive overview placeholder.
    defaultSectionId = crypto.randomUUID()
    await database.insert(schema.proposalSections).values({
      id: defaultSectionId,
      proposalId: id,
      type: 'overview',
      title: 'Executive overview',
      subtitle: null,
      data: JSON.stringify({ html: '' }),
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ id, defaultVariantId, defaultSectionId }, { status: 201 })
}

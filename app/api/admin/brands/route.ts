import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, like, and, inArray, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'

// ── GET /api/admin/brands ──────────────────────────────────────────────────
// Query params: ?search=acme&orgId=xxx&page=1
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const search = url.searchParams.get('search') ?? ''
  const filterOrgId = url.searchParams.get('orgId')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit = 50
  const offset = (page - 1) * limit

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Apply team member access scoping
  const scopedOrgIds = await resolveAccessScoping(drizzle, userId)

  const conditions = []

  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      return NextResponse.json({ items: [], page, limit })
    }
    conditions.push(inArray(schema.brands.orgId, scopedOrgIds))
  }

  if (filterOrgId) {
    conditions.push(eq(schema.brands.orgId, filterOrgId))
  }

  if (search) {
    conditions.push(like(schema.brands.name, `%${search}%`))
  }

  const brands = await drizzle
    .select({
      id: schema.brands.id,
      orgId: schema.brands.orgId,
      name: schema.brands.name,
      logoUrl: schema.brands.logoUrl,
      website: schema.brands.website,
      primaryColour: schema.brands.primaryColour,
      notes: schema.brands.notes,
      createdAt: schema.brands.createdAt,
      updatedAt: schema.brands.updatedAt,
      orgName: schema.organisations.name,
      contactCount: sql<number>`(SELECT COUNT(*) FROM brand_contacts WHERE brand_contacts.brand_id = ${schema.brands.id})`,
      requestCount: sql<number>`(SELECT COUNT(*) FROM requests WHERE requests.brand_id = ${schema.brands.id})`,
    })
    .from(schema.brands)
    .leftJoin(schema.organisations, eq(schema.brands.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.brands.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ items: brands, page, limit })
}

// ── POST /api/admin/brands ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    orgId?: string
    logoUrl?: string
    website?: string
    primaryColour?: string
    notes?: string
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Brand name is required' }, { status: 400 })
  }
  if (!body.orgId?.trim()) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await drizzle.insert(schema.brands).values({
    id,
    orgId: body.orgId.trim(),
    name: body.name.trim(),
    logoUrl: body.logoUrl?.trim() || null,
    website: body.website?.trim() || null,
    primaryColour: body.primaryColour?.trim() || null,
    notes: body.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

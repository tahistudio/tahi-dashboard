import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

/**
 * Portal brand assets. The signed-in client's sub-brands (name, logo, primary
 * colour, website, notes) live in the existing `brands` table, one row per
 * brand. This route reads and manages the caller's own org's brand records; no
 * new table is needed.
 *
 * GET    - list the org's brand records (any signed-in org member).
 * POST   - create a brand record (client admin only).
 * PATCH  - update a brand record (client admin only).
 * DELETE - remove a brand record (client admin only).
 *
 * Scope: getPortalAuth resolves the caller to their D1 org; every query is
 * filtered by that orgId, so a client can only ever touch their own brands. The
 * Tahi admin org is rejected; a Tahi admin previewing Client view
 * (impersonating) is read-only. Writes require contacts.portalRole === 'admin',
 * mirroring the People invite gate; members get a read-only view.
 *
 * TODO(brand-assets): multiple logos, full colour palettes, uploaded typefaces
 * and guideline PDFs need R2 storage + a brand_assets table. Today each brand
 * carries a single logo URL and a single primary colour.
 */

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

async function requireClientAdmin(
  drizzle: Drizzle,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const [contact] = await drizzle
    .select({ portalRole: schema.contacts.portalRole })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.clerkUserId, userId)))
    .limit(1)
  return contact?.portalRole === 'admin'
}

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const items = await drizzle
    .select({
      id: schema.brands.id,
      name: schema.brands.name,
      logoUrl: schema.brands.logoUrl,
      website: schema.brands.website,
      primaryColour: schema.brands.primaryColour,
      notes: schema.brands.notes,
    })
    .from(schema.brands)
    .where(eq(schema.brands.orgId, orgId))
    .orderBy(asc(schema.brands.createdAt))

  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  if (!(await requireClientAdmin(drizzle, orgId, userId))) {
    return NextResponse.json({ error: 'Only workspace admins can manage brands' }, { status: 403 })
  }

  const body = (await req.json()) as {
    name?: string
    logoUrl?: string
    website?: string
    primaryColour?: string
    notes?: string
  }

  const name = body.name?.trim()
  if (!name) {
    return NextResponse.json({ error: 'Brand name is required' }, { status: 400 })
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await drizzle.insert(schema.brands).values({
    id,
    orgId,
    name,
    logoUrl: body.logoUrl?.trim() || null,
    website: body.website?.trim() || null,
    primaryColour: body.primaryColour?.trim() || null,
    notes: body.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  if (!(await requireClientAdmin(drizzle, orgId, userId))) {
    return NextResponse.json({ error: 'Only workspace admins can manage brands' }, { status: 403 })
  }

  const body = (await req.json()) as {
    id?: string
    name?: string
    logoUrl?: string
    website?: string
    primaryColour?: string
    notes?: string
  }

  const id = body.id?.trim()
  if (!id) {
    return NextResponse.json({ error: 'Brand id is required' }, { status: 400 })
  }

  // Confirm the brand belongs to the caller's org before mutating.
  const [existing] = await drizzle
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(and(eq(schema.brands.id, id), eq(schema.brands.orgId, orgId)))
    .limit(1)
  if (!existing) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
  }

  const updates: Record<string, string | null> = {}
  if (body.name !== undefined) {
    const trimmed = body.name.trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'Brand name cannot be empty' }, { status: 400 })
    }
    updates.name = trimmed
  }
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl.trim() || null
  if (body.website !== undefined) updates.website = body.website.trim() || null
  if (body.primaryColour !== undefined) updates.primaryColour = body.primaryColour.trim() || null
  if (body.notes !== undefined) updates.notes = body.notes.trim() || null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  await drizzle
    .update(schema.brands)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(schema.brands.id, id))

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  if (!(await requireClientAdmin(drizzle, orgId, userId))) {
    return NextResponse.json({ error: 'Only workspace admins can manage brands' }, { status: 403 })
  }

  const id = new URL(req.url).searchParams.get('id')?.trim()
  if (!id) {
    return NextResponse.json({ error: 'Brand id is required' }, { status: 400 })
  }

  // Scope the delete to the caller's org so no cross-tenant id can be removed.
  await drizzle
    .delete(schema.brands)
    .where(and(eq(schema.brands.id, id), eq(schema.brands.orgId, orgId)))

  return NextResponse.json({ success: true })
}

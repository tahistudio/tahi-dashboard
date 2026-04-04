import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type RouteContext = { params: Promise<{ id: string }> }

// ── GET /api/admin/brands/[id] ─────────────────────────────────────────────
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'Brand ID is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Fetch brand with org name
  const rows = await drizzle
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
      requestCount: sql<number>`(SELECT COUNT(*) FROM requests WHERE requests.brand_id = ${schema.brands.id})`,
    })
    .from(schema.brands)
    .leftJoin(schema.organisations, eq(schema.brands.orgId, schema.organisations.id))
    .where(eq(schema.brands.id, id))
    .limit(1)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
  }

  const brand = rows[0]

  // Fetch contacts linked to this brand
  const contacts = await drizzle
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      role: schema.contacts.role,
      isPrimary: schema.contacts.isPrimary,
    })
    .from(schema.brandContacts)
    .innerJoin(schema.contacts, eq(schema.brandContacts.contactId, schema.contacts.id))
    .where(eq(schema.brandContacts.brandId, id))

  return NextResponse.json({ ...brand, contacts })
}

// ── PATCH /api/admin/brands/[id] ───────────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'Brand ID is required' }, { status: 400 })
  }

  const body = await req.json() as {
    name?: string
    logoUrl?: string | null
    website?: string | null
    primaryColour?: string | null
    notes?: string | null
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify brand exists
  const existing = await drizzle
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.id, id))
    .limit(1)

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  }

  if (body.name !== undefined) {
    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Brand name cannot be empty' }, { status: 400 })
    }
    updates.name = body.name.trim()
  }
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl?.trim() || null
  if (body.website !== undefined) updates.website = body.website?.trim() || null
  if (body.primaryColour !== undefined) updates.primaryColour = body.primaryColour?.trim() || null
  if (body.notes !== undefined) updates.notes = body.notes?.trim() || null

  await drizzle
    .update(schema.brands)
    .set(updates)
    .where(eq(schema.brands.id, id))

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/brands/[id] ──────────────────────────────────────────
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (!id) {
    return NextResponse.json({ error: 'Brand ID is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify brand exists
  const existing = await drizzle
    .select({ id: schema.brands.id })
    .from(schema.brands)
    .where(eq(schema.brands.id, id))
    .limit(1)

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 })
  }

  // Clear brandId on requests that reference this brand
  await drizzle
    .update(schema.requests)
    .set({ brandId: null })
    .where(eq(schema.requests.brandId, id))

  // brandContacts cascade-deletes via FK, but delete explicitly for safety on D1
  await drizzle
    .delete(schema.brandContacts)
    .where(eq(schema.brandContacts.brandId, id))

  // Delete the brand
  await drizzle
    .delete(schema.brands)
    .where(eq(schema.brands.id, id))

  return NextResponse.json({ success: true })
}

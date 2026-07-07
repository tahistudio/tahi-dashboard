import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Writes are client-admin only (contacts.portal_role === 'admin'), matching
// the sibling /api/portal/brands and /api/portal/people write endpoints.
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

/**
 * Portal organisation settings. The signed-in client's own company identity.
 *
 * GET  /api/portal/organisation  - read the caller's organisations row.
 * PATCH                          - update name / website / industry / logoUrl.
 *
 * Scope: getPortalAuth resolves the caller's Clerk org to their D1
 * organisations.id, so this only ever touches the caller's own row. The Tahi
 * admin org is rejected (admins manage clients through /api/admin). A Tahi admin
 * previewing Client view (impersonating) is read-only, mirroring
 * /api/portal/requests and /api/portal/profile.
 *
 * Brand colour: the organisations table has no brand-colour column today, so the
 * client's brand colour is NOT persisted here. It lives per sub-brand in the
 * `brands` table (see /api/portal/brands). TODO(org-brand-colour): if a single
 * org-level accent is ever wanted, add an accent_colour column + migration and
 * accept it below.
 */

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [org] = await drizzle
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      website: schema.organisations.website,
      industry: schema.organisations.industry,
      logoUrl: schema.organisations.logoUrl,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  return NextResponse.json({ organisation: org })
}

export async function PATCH(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const databaseForGate = await db()
  if (!(await requireClientAdmin(databaseForGate as Drizzle, orgId, userId))) {
    return NextResponse.json(
      { error: 'Only workspace admins can update the organisation' },
      { status: 403 },
    )
  }

  const body = (await req.json()) as {
    name?: string
    website?: string
    industry?: string
    logoUrl?: string
  }

  const updates: Record<string, string | null> = {}
  // name is NOT NULL; only apply when a non-empty value is supplied.
  if (body.name !== undefined) {
    const trimmed = body.name.trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'Organisation name cannot be empty' }, { status: 400 })
    }
    updates.name = trimmed
  }
  if (body.website !== undefined) updates.website = body.website.trim() || null
  if (body.industry !== undefined) updates.industry = body.industry.trim() || null
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl.trim() || null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle
    .update(schema.organisations)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(eq(schema.organisations.id, orgId))

  return NextResponse.json({ success: true })
}

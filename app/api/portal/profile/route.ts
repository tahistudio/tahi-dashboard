import { getPortalAuth } from '@/lib/server-auth'
import { isPortalAdminContact } from '@/lib/portal-access'
import { contactIdentityWhere } from '@/lib/portal-identity'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

/**
 * GET /api/portal/profile
 * Returns the contact record for the current user within their org, plus the
 * workspace-admin verdict already made for them.
 *
 * `isAdmin` is the server's own answer, from the one helper every portal write
 * route gates on (lib/portal-access.ts). The settings sub-nav used to re-derive
 * it in the browser from `portalRole === 'admin'`, which reads false for the
 * primary contact of any workspace whose role column still holds the NOT NULL
 * 'member' default: the owner was shown no People section while the API behind
 * it would have let them in. Clients must not have to guess this.
 *
 * PREVIEW. A studio session in Client view keeps its own Clerk id, so matching
 * a contacts row on it inside a client org found nothing and this route said
 * `contact: null, isAdmin: false`. The settings shell reads exactly that, so
 * the preview hid People and Organisation: the studio was shown a portal no
 * client has. `contactId` from getPortalAuth names the seat being previewed
 * (lib/portal-identity.ts, the same seat an acting write is recorded against),
 * and `preview` says so out loud so the shell can keep its banner logic
 * without re-deriving the mode.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId, contactId, previewContact } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const preview = previewContact === true

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [contact] = await drizzle
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      role: schema.contacts.role,
      isPrimary: schema.contacts.isPrimary,
      portalRole: schema.contacts.portalRole,
      phone: schema.contacts.phone,
    })
    .from(schema.contacts)
    .where(contactIdentityWhere(orgId, userId, contactId))
    .limit(1)

  if (!contact) {
    // No linked contact row: basic info only, and not an admin of anything.
    // In a preview this now means the org genuinely has nobody in it, rather
    // than the operator's own login failing to match a client workspace.
    return NextResponse.json({
      contact: null,
      orgId,
      isAdmin: false,
      preview,
    })
  }

  return NextResponse.json({
    contact,
    orgId,
    isAdmin: isPortalAdminContact(contact),
    preview,
  })
}

/**
 * PATCH /api/portal/profile
 * Update the current user's contact info (name, role, phone).
 */
export async function PATCH(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    role?: string
    phone?: string
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [contact] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(
      eq(schema.contacts.orgId, orgId),
      eq(schema.contacts.clerkUserId, userId),
    ))
    .limit(1)

  if (!contact) {
    return NextResponse.json({ error: 'Contact record not found' }, { status: 404 })
  }

  const updates: Record<string, string> = {}
  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.role !== undefined) updates.role = body.role?.trim() ?? ''
  if (body.phone !== undefined) updates.phone = typeof body.phone === 'string' ? body.phone.trim() : ''

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  await drizzle
    .update(schema.contacts)
    .set({
      ...updates,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.contacts.id, contact.id))

  return NextResponse.json({ success: true })
}

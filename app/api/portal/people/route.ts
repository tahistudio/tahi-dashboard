import { getPortalAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

/**
 * Portal people roster. The signed-in client's teammates, backed by the
 * `contacts` table for their org.
 *
 * GET    - list the org's contacts (name, email, portalRole, isPrimary, pending).
 *          Any signed-in org member may read the roster.
 * POST   - invite a teammate (client admin only). Creates a Clerk organization
 *          invitation first, then, only on success, records a pending contact row
 *          so a "Pending" chip always corresponds to a real invitation.
 * PATCH  - edit a teammate's name / permission level (client admin only). The
 *          last admin cannot be demoted.
 * DELETE - remove a teammate (client admin only). Pending invites are revoked
 *          in Clerk first; active members lose their Clerk org membership.
 *          You cannot remove yourself or the primary contact.
 *
 * Scope: getPortalAuth resolves the caller to their D1 org; queries filter by
 * that orgId so a client only ever sees / edits their own roster. The Tahi admin
 * org is rejected. A Tahi admin previewing Client view (impersonating) is
 * read-only and, having no client Clerk session, cannot send invitations
 * (mirrors /api/portal/invites).
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

  const rows = await drizzle
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      role: schema.contacts.role,
      portalRole: schema.contacts.portalRole,
      isPrimary: schema.contacts.isPrimary,
      clerkUserId: schema.contacts.clerkUserId,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, orgId))
    .orderBy(asc(schema.contacts.createdAt))

  // A contact that has never signed in (no Clerk user id) is a pending invite.
  const items = rows.map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    role: c.role,
    portalRole: c.portalRole,
    isPrimary: !!c.isPrimary,
    pending: !c.clerkUserId,
  }))

  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const { orgId, clerkOrgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Invitations must target the caller's own Clerk org. An admin in Client view
  // has no client Clerk session here, so this is not the place to send them.
  if (impersonating || !clerkOrgId) {
    return NextResponse.json(
      { error: 'Invites can only be sent from your own account' },
      { status: 400 },
    )
  }

  const database = await db()
  const drizzle = database as Drizzle

  if (!(await requireClientAdmin(drizzle, orgId, userId))) {
    return NextResponse.json(
      { error: 'Only workspace admins can invite teammates' },
      { status: 403 },
    )
  }

  const body = (await req.json()) as {
    name?: string
    email?: string
    portalRole?: string
  }

  const name = body.name?.trim() || ''
  const email = body.email?.trim().toLowerCase() || ''
  const portalRole = body.portalRole === 'admin' ? 'admin' : 'member'

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  // Do not create a second contact row for an email already on the roster.
  const [existing] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.email, email)))
    .limit(1)
  if (existing) {
    return NextResponse.json({ error: 'That email is already on your roster' }, { status: 409 })
  }

  // Send the Clerk invitation FIRST. Only record the pending contact if it
  // succeeds, so a "Pending" chip always maps to a real invitation.
  try {
    const clerk = await clerkClient()
    await clerk.organizations.createOrganizationInvitation({
      organizationId: clerkOrgId,
      inviterUserId: userId,
      emailAddress: email,
      role: 'org:member',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not send the invitation' },
      { status: 502 },
    )
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await drizzle.insert(schema.contacts).values({
    id,
    orgId,
    name: name || email,
    email,
    portalRole,
    isPrimary: false,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json(
    { id, name: name || email, email, portalRole, isPrimary: false, pending: true },
    { status: 201 },
  )
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
    return NextResponse.json(
      { error: 'Only workspace admins can manage teammates' },
      { status: 403 },
    )
  }

  const body = (await req.json()) as { id?: string; name?: string; portalRole?: string }
  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const [target] = await drizzle
    .select({
      id: schema.contacts.id,
      portalRole: schema.contacts.portalRole,
    })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.id, body.id)))
    .limit(1)
  if (!target) {
    return NextResponse.json({ error: 'Teammate not found' }, { status: 404 })
  }

  const updates: Record<string, string> = {}
  if (body.name?.trim()) updates.name = body.name.trim()
  if (body.portalRole === 'admin' || body.portalRole === 'member') {
    // Never demote the last admin: the org would lock itself out of settings.
    if (target.portalRole === 'admin' && body.portalRole === 'member') {
      const admins = await drizzle
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.portalRole, 'admin')))
      if (admins.length <= 1) {
        return NextResponse.json(
          { error: 'Your workspace needs at least one admin' },
          { status: 409 },
        )
      }
    }
    updates.portalRole = body.portalRole
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  await drizzle
    .update(schema.contacts)
    .set({ ...updates, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.id, body.id)))

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { orgId, clerkOrgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating || !clerkOrgId) {
    return NextResponse.json(
      { error: 'Teammates can only be removed from your own account' },
      { status: 400 },
    )
  }

  const database = await db()
  const drizzle = database as Drizzle

  if (!(await requireClientAdmin(drizzle, orgId, userId))) {
    return NextResponse.json(
      { error: 'Only workspace admins can manage teammates' },
      { status: 403 },
    )
  }

  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const [target] = await drizzle
    .select({
      id: schema.contacts.id,
      email: schema.contacts.email,
      isPrimary: schema.contacts.isPrimary,
      clerkUserId: schema.contacts.clerkUserId,
    })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.id, id)))
    .limit(1)
  if (!target) {
    return NextResponse.json({ error: 'Teammate not found' }, { status: 404 })
  }
  if (target.clerkUserId === userId) {
    return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 409 })
  }
  if (target.isPrimary) {
    return NextResponse.json(
      { error: 'The primary contact cannot be removed. Ask the studio to reassign it first.' },
      { status: 409 },
    )
  }

  // Detach from Clerk FIRST so the roster never claims someone is gone while
  // they can still sign in. Pending invite: revoke it; active member: remove
  // the org membership.
  try {
    const clerk = await clerkClient()
    if (!target.clerkUserId) {
      const invitations = await clerk.organizations.getOrganizationInvitationList({
        organizationId: clerkOrgId,
        status: ['pending'],
      })
      const match = invitations.data.find(
        (inv) => inv.emailAddress.toLowerCase() === target.email.toLowerCase(),
      )
      if (match) {
        await clerk.organizations.revokeOrganizationInvitation({
          organizationId: clerkOrgId,
          invitationId: match.id,
          requestingUserId: userId,
        })
      }
    } else {
      await clerk.organizations.deleteOrganizationMembership({
        organizationId: clerkOrgId,
        userId: target.clerkUserId,
      })
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not remove the teammate from sign-in' },
      { status: 502 },
    )
  }

  await drizzle
    .delete(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.id, id)))

  return NextResponse.json({ ok: true })
}

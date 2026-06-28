import { getRequestAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, isNull } from 'drizzle-orm'
import { resolveInvite } from '@/lib/onboarding-invites'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/portal/accept-invite { token }
 *
 * Consume a client onboarding invite: join the signed-in user to the
 * pre-created org with no payment step.
 *
 * Security (the link is a bearer token, so we bind and claim it carefully):
 *   - Email binding: the signed-in user's verified primary email MUST equal the
 *     invite's contactEmail. A forwarded link is useless to anyone else.
 *   - Single-use, claimed ATOMICALLY (UPDATE ... WHERE used_at IS NULL) before
 *     any membership is granted, so two racing requests cannot both win.
 *   - Expiry enforced.
 *   - The first person to accept a brand-new org's invite creates its Clerk org
 *     (and is its admin, as the owner); anyone joining an already-existing org
 *     is added as a plain member, never an admin.
 *
 * Returns { orgId (D1), clerkOrgId }; the client then calls Clerk setActive.
 */
export async function POST(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  if (!body.token) return NextResponse.json({ error: 'token is required' }, { status: 400 })

  const database = (await db()) as D1
  const invite = await resolveInvite(database, body.token)
  if (!invite || invite.flow !== 'client' || !invite.orgId) {
    return NextResponse.json({ error: 'Invalid invite' }, { status: 400 })
  }
  if (invite.expired) {
    return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })
  }
  if (!invite.contactEmail) {
    // An unbound invite cannot be safely claimed; the studio must re-issue it
    // with the invitee's email so we can verify who is accepting.
    return NextResponse.json({ error: 'This invite is not linked to an email. Ask the studio for a new link.' }, { status: 400 })
  }

  // Email binding: only the invited person (verified) may accept.
  const clerk = await clerkClient()
  const user = await clerk.users.getUser(userId)
  const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
  const userEmail = (primary?.emailAddress ?? '').toLowerCase()
  const verified = primary?.verification?.status === 'verified'
  if (!verified || userEmail !== invite.contactEmail.toLowerCase()) {
    return NextResponse.json(
      { error: 'This invite was sent to a different email address.' },
      { status: 403 },
    )
  }

  const [org] = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      clerkOrgId: schema.organisations.clerkOrgId,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, invite.orgId))
    .limit(1)
  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  const now = new Date().toISOString()

  // Atomic single-use claim: only the request that flips used_at from NULL wins.
  const claimed = await database
    .update(schema.onboardingInvites)
    .set({ usedAt: now, usedByUserId: userId, updatedAt: now })
    .where(and(eq(schema.onboardingInvites.id, invite.id), isNull(schema.onboardingInvites.usedAt)))
    .returning({ id: schema.onboardingInvites.id })

  if (claimed.length === 0) {
    // Already used. Idempotent only if THIS user is the one who used it.
    const [row] = await database
      .select({ usedByUserId: schema.onboardingInvites.usedByUserId })
      .from(schema.onboardingInvites)
      .where(eq(schema.onboardingInvites.id, invite.id))
      .limit(1)
    if (row?.usedByUserId !== userId) {
      return NextResponse.json({ error: 'This invite has already been used.' }, { status: 409 })
    }
  }

  let clerkOrgId = org.clerkOrgId
  if (clerkOrgId) {
    // Join an existing Clerk org as a plain member (never auto-admin).
    try {
      await clerk.organizations.createOrganizationMembership({
        organizationId: clerkOrgId,
        userId,
        role: 'org:member',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (!/already a member|already exists/i.test(msg)) {
        // Non-fatal: membership likely already present; continue.
      }
    }
  } else {
    // Lazily create the Clerk org; the first invited user becomes its admin (owner).
    const created = await clerk.organizations.createOrganization({ name: org.name, createdBy: userId })
    clerkOrgId = created.id
    await database
      .update(schema.organisations)
      .set({ clerkOrgId, updatedAt: now })
      .where(eq(schema.organisations.id, org.id))
  }

  // Link the matching contact to this Clerk user (best-effort).
  try {
    await database
      .update(schema.contacts)
      .set({ clerkUserId: userId, updatedAt: now })
      .where(and(eq(schema.contacts.orgId, org.id), eq(schema.contacts.email, invite.contactEmail.toLowerCase())))
  } catch {
    // non-fatal
  }

  return NextResponse.json({ ok: true, orgId: org.id, clerkOrgId })
}

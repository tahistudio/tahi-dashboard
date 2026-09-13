import { getRequestAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, isNull } from 'drizzle-orm'
import { resolveInvite } from '@/lib/onboarding-invites'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/team/accept-invite { token }
 *
 * Consume a team onboarding invite (app/api/admin/team/[id]/invite mints it):
 * join the signed-in user to the Tahi Studio Clerk org. The client-side
 * mirror of app/api/portal/accept-invite, for the flow 'team' half of
 * lib/onboarding-invites.ts.
 *
 * Security (the link is a bearer token, so we bind and claim it carefully):
 *   - Email binding: the signed-in user's verified primary email MUST equal
 *     the invite's contactEmail. A forwarded link is useless to anyone else.
 *   - Single-use, claimed ATOMICALLY (UPDATE ... WHERE used_at IS NULL) before
 *     any membership is granted, so two racing requests cannot both win.
 *   - Expiry enforced.
 *
 * team_members linking (lib/team-link.ts, run from the dashboard layout once
 * this session's orgId is the Tahi org) is untouched by this route: it claims
 * the roster row by verified email on the next page load, exactly as it did
 * when Clerk's own invitation flow granted the membership.
 *
 * Returns { ok, clerkOrgId }; the client then calls Clerk setActive.
 */
export async function POST(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  if (!body.token) return NextResponse.json({ error: 'token is required' }, { status: 400 })

  const database = (await db()) as D1
  const invite = await resolveInvite(database, body.token)
  if (!invite || invite.flow !== 'team') {
    return NextResponse.json({ error: 'Invalid invite' }, { status: 400 })
  }
  if (invite.expired) {
    return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })
  }
  if (!invite.contactEmail) {
    // An unbound invite cannot be safely claimed; the studio must re-issue it.
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

  const organizationId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!organizationId) {
    return NextResponse.json({ error: 'Invites are not configured yet' }, { status: 500 })
  }

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

  // Grant membership. Clerk org role stays 'member': everything the hire can
  // actually do is decided by this app's roles and scope, not by their Clerk
  // org role. Non-fatal on "already a member": a retry after a partial
  // failure (e.g. the claim above raced) must still succeed.
  try {
    await clerk.organizations.createOrganizationMembership({
      organizationId,
      userId,
      role: 'org:member',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (!/already a member|already exists/i.test(message)) {
      return NextResponse.json(
        { error: 'Could not add you to the Tahi workspace. Ask the studio to try again.' },
        { status: 502 },
      )
    }
  }

  // The token is consumed: clear the survival cookie the middleware set so a
  // later visit doesn't re-trigger an accept attempt on a spent invite.
  const res = NextResponse.json({ ok: true, clerkOrgId: organizationId })
  res.cookies.set('tahi-invite-token', '', { path: '/', maxAge: 0 })
  return res
}

import { getPortalAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/portal/invites
 * Invite colleagues to the authenticated client's org. Body: { emails: string[] }.
 * Each becomes a Clerk organization invitation (role org:member); they get an
 * email immediately. Returns a per-email result so the UI can report failures.
 *
 * WORKSPACE ADMIN ONLY, exactly like its sibling POST /api/portal/people. The
 * two routes now do the same thing (Clerk invitation plus a roster row), so a
 * weaker gate here would simply be the way round the gate there: a plain member
 * seat could add an outsider to the roster and, once the contact link claims
 * the row on first sign-in, hand them a full portal identity. The self-serve
 * onboarding step that calls this is run by the person who provisioned the
 * workspace, and all three creation paths now stamp that person portalRole
 * 'admin', so nobody legitimate loses the ability to invite.
 *
 * A successful invitation also writes the waiting `contacts` row, deny by
 * default (portalRole 'member', clerkUserId still null). That row is the thing
 * the colleague CLAIMS on their first dashboard load
 * (lib/contact-link-server.ts), which is what gives them an identity in the
 * product rather than a bare login: without it they had no portal role, no
 * notifications, and their messages were stamped with a raw Clerk id.
 * Contact writes are best effort: a D1 hiccup must not lose an invitation that
 * Clerk has already sent.
 */
export async function POST(req: NextRequest) {
  const { orgId, clerkOrgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Invitations must target the caller's own Clerk org. An admin in Client view
  // has no client Clerk session here, so this is not the place to send them.
  if (impersonating || !clerkOrgId) {
    return NextResponse.json({ error: 'Invites can only be sent from your own account' }, { status: 400 })
  }

  const body = (await req.json()) as { emails?: string[] }
  const emails = (body.emails ?? [])
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  if (emails.length === 0) {
    return NextResponse.json({ error: 'No valid emails' }, { status: 400 })
  }

  const database = (await db()) as D1

  // Workspace-admin gate, the same one POST /api/portal/people applies. Read
  // through the caller's own contact row: a session with no linked contact is
  // not an admin, so this is deny by default.
  const [caller] = await database
    .select({ portalRole: schema.contacts.portalRole })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.clerkUserId, userId)))
    .limit(1)
  if (caller?.portalRole !== 'admin') {
    return NextResponse.json(
      { error: 'Only workspace admins can invite teammates' },
      { status: 403 },
    )
  }

  // The roster, read once, before anything is sent. Two jobs: skip an address
  // that already has portal access (re-inviting someone who is already in is
  // noise), and keep the contact write case-insensitively idempotent, because a
  // second row with the same email at one org is exactly what makes
  // lib/contact-link-server.ts refuse to link either of them.
  //
  // A roster entry with no clerk_user_id is NOT skipped: that is someone the
  // studio added by hand who has never been let in, and sending them the
  // invitation is the whole point of this route.
  let roster: { email: string | null; clerkUserId: string | null }[] = []
  try {
    roster = await database
      .select({ email: schema.contacts.email, clerkUserId: schema.contacts.clerkUserId })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, orgId))
  } catch (err) {
    console.error('[portal-invites] failed to read the roster:', err)
  }
  const known = new Set(
    roster.map(c => c.email?.trim().toLowerCase()).filter((e): e is string => !!e),
  )
  const alreadyIn = new Set(
    roster
      .filter(c => !!c.clerkUserId)
      .map(c => c.email?.trim().toLowerCase())
      .filter((e): e is string => !!e),
  )

  const clerk = await clerkClient()
  const results = await Promise.all(
    emails.map(async emailAddress => {
      if (alreadyIn.has(emailAddress.toLowerCase())) {
        return { email: emailAddress, invited: false, error: 'Already has access to this workspace' }
      }
      try {
        await clerk.organizations.createOrganizationInvitation({
          organizationId: clerkOrgId,
          inviterUserId: userId,
          emailAddress,
          role: 'org:member',
        })
        return { email: emailAddress, invited: true }
      } catch (err) {
        return { email: emailAddress, invited: false, error: err instanceof Error ? err.message : 'Failed' }
      }
    }),
  )

  const invitedEmails = results.filter(r => r.invited).map(r => r.email.toLowerCase())
  if (invitedEmails.length > 0) {
    try {
      const now = new Date().toISOString()
      for (const email of invitedEmails) {
        if (known.has(email)) continue
        known.add(email)
        await database.insert(schema.contacts).values({
          id: crypto.randomUUID(),
          orgId,
          name: email.split('@')[0],
          email,
          isPrimary: false,
          // Deny by default: a colleague is a member until someone promotes them.
          portalRole: 'member',
          createdAt: now,
          updatedAt: now,
        })
      }
    } catch (err) {
      console.error('[portal-invites] failed to write contact rows:', err)
    }
  }

  return NextResponse.json({ results, invited: results.filter(r => r.invited).length })
}

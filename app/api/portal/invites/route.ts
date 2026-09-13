import { createElement } from 'react'
import { getPortalAuth } from '@/lib/server-auth'
import { isOrgAdmin } from '@/lib/portal-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

import { ensureClientInvite } from '@/lib/onboarding-invites'
import { sendEmail } from '@/lib/email'
import { SeatInviteEmail } from '@/emails/seat-invite'
import { resolveDeliveryPolicy } from '@/lib/email-gate'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/portal/invites
 * Invite colleagues to the authenticated client's org. Body: { emails: string[] }.
 * Each gets our own app invite token (lib/onboarding-invites.ts, the same one
 * the client's own first-contact welcome email carries) and a Studio Ledger
 * email through lib/email-delivery.ts. Returns a per-email result so the UI
 * can report failures.
 *
 * WHY NOT A CLERK ORGANIZATION INVITATION. This route used to call
 * `clerk.organizations.createOrganizationInvitation`, which fires an email
 * from Clerk's own systems the moment it is called. The Backend API's
 * org-invitation params carry no `notify` flag (unlike the plain, non-org
 * Invitation API), so there is no supported way to keep that call from
 * emailing. Minting our own token and joining an EXISTING Clerk org via
 * `createOrganizationMembership` at accept time
 * (app/api/portal/accept-invite/route.ts) sends no Clerk mail at all, so the
 * Studio Ledger email below is the only email the colleague receives.
 *
 * WORKSPACE ADMIN ONLY, exactly like its sibling POST /api/portal/people. The
 * two routes now do the same thing (an invite token plus a roster row), so a
 * weaker gate here would simply be the way round the gate there: a plain member
 * seat could add an outsider to the roster and, once the contact link claims
 * the row on first sign-in, hand them a full portal identity. The self-serve
 * onboarding step that calls this is run by the person who provisioned the
 * workspace; the creation paths now stamp that person portalRole 'admin', and
 * lib/portal-access.ts covers the workspaces created before they did by reading
 * the primary contact as an admin, so nobody legitimate loses the ability to
 * invite.
 *
 * A successful send also writes the waiting `contacts` row, deny by default
 * (portalRole 'member', clerkUserId still null). That row is the thing the
 * colleague CLAIMS on their first dashboard load (lib/contact-link-server.ts),
 * which is what gives them an identity in the product rather than a bare
 * login: without it they had no portal role, no notifications, and their
 * messages were stamped with a raw Clerk id. Contact writes are best effort: a
 * D1 hiccup must not lose an invite the email has already carried.
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

  // Workspace-admin gate, the same one POST /api/portal/people applies, asked
  // of the same helper (lib/portal-access.ts). It reads through the caller's
  // own contact row, so a session with no linked contact is not an admin: deny
  // by default. It also honours the primary contact whose portal_role still
  // reads the NOT NULL 'member' default, which is what lets a fresh owner
  // invite their first colleague at all.
  if (!(await isOrgAdmin(database, orgId, userId))) {
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

  // Who is sending this, and what they are named, for the email's greeting and
  // its "invited by" line. The caller is already proven to be this org's admin
  // above, so a contact row for them exists.
  const [org] = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)
  const orgName = org?.name?.trim() || 'your workspace'

  const [caller] = await database
    .select({ name: schema.contacts.name })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.clerkUserId, userId)))
    .limit(1)
  const inviterName = caller?.name?.trim() || 'A teammate'

  // Resolved once, ahead of the fan-out: sendEmail would otherwise pay a
  // settings read per recipient.
  const policy = await resolveDeliveryPolicy()
  const suppressed: string[] = []

  const results = await Promise.all(
    emails.map(async emailAddress => {
      if (alreadyIn.has(emailAddress.toLowerCase())) {
        return { email: emailAddress, invited: false, error: 'Already has access to this workspace' }
      }

      // Mint (or reuse) our own invite token instead of a Clerk organization
      // invitation. Accepting it (app/api/portal/accept-invite/route.ts) joins
      // this EXISTING Clerk org via createOrganizationMembership, which sends
      // no email of its own, so the Studio Ledger email below is the only mail
      // this colleague receives.
      const invite = await ensureClientInvite(database, {
        flow: 'client',
        orgId,
        contactEmail: emailAddress,
        contactName: emailAddress.split('@')[0],
        createdById: userId,
      })

      const outcome = await sendEmail(
        emailAddress,
        `${inviterName} invited you to ${orgName} on Tahi`,
        createElement(SeatInviteEmail, {
          contactName: emailAddress.split('@')[0],
          inviterName,
          orgName,
          inviteUrl: invite.link,
          boundEmail: emailAddress.toLowerCase(),
          expiresAt: invite.expiresAt,
          audience: 'client',
        }),
        undefined,
        { template: 'seat-invite', orgId, policy },
      )

      if (!outcome.success) {
        if (outcome.suppressedCount && outcome.suppressedCount > 0) {
          suppressed.push(emailAddress)
          return { email: emailAddress, invited: false, withheld: true, error: outcome.error }
        }
        return { email: emailAddress, invited: false, error: outcome.error ?? 'Failed to send' }
      }
      return { email: emailAddress, invited: true }
    }),
  )

  const invitedEmails = results.filter(r => r.invited).map(r => r.email.toLowerCase())

  // Nobody was invited and the allowlist is why. 409 rather than a 200 holding
  // a list of failures, so the caller cannot read "results: []" as success.
  if (invitedEmails.length === 0 && suppressed.length > 0) {
    return NextResponse.json({
      error: 'Held back by the email allowlist',
      message: 'None of these addresses are on the delivery allowlist.',
      results,
      suppressed,
      invited: 0,
    }, { status: 409 })
  }
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

  return NextResponse.json({
    results,
    invited: results.filter(r => r.invited).length,
    suppressed,
  })
}

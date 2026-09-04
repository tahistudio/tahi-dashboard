/**
 * lib/contact-link-server.ts - the client twin of lib/team-link-server.ts.
 *
 * WHY THIS EXISTS
 * `contacts.clerkUserId` is the join between a client login and everything the
 * portal knows about that person: their portal role, notification delivery,
 * message authorship, request participation and the "has portal access" signal
 * on the client detail page. Only two code paths ever wrote it (self-serve
 * provisioning, and accepting an onboarding invite), so a second seat who
 * arrived by a Clerk organization invitation signed in with a valid session and
 * resolved to no contact row at all.
 *
 * This module supplies the missing link step: on a client's first dashboard
 * load we match their VERIFIED primary email to a waiting row at their own org
 * and claim it. The row is written when the colleague is invited (see
 * app/api/portal/invites/route.ts), exactly as an admin writes a team_members
 * row before a hire signs in.
 *
 * HARD RULES (mirroring lib/team-link.ts, which owns the decision core):
 *   - Only ever CLAIMS a row that already exists at the caller's OWN org. It
 *     never creates one, and it never looks outside that org, so a person who
 *     is a contact at two clients cannot be linked to the wrong workspace.
 *   - Verified email only. An unverified address can be attacker controlled.
 *   - Two rows sharing an email at one org links NEITHER. Guessing could hand
 *     the wrong portal role to the wrong person.
 *   - Compare-and-set on `clerk_user_id IS NULL`, so concurrent sign-ins cannot
 *     both win and an existing link is never overwritten by a claim.
 *   - Lazy: an already-linked contact pays one indexed lookup and nothing else.
 *   - Never throws. A Clerk or D1 hiccup degrades to "not linked yet" rather
 *     than a broken portal shell.
 *
 * Called from app/(dashboard)/layout.tsx only, alongside the team half, for the
 * same reason: a page layout is the one place we know a real human just
 * authenticated in a browser, and the MCP service token must never trip a link.
 */

import { clerkClient } from '@clerk/nextjs/server'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { decideCandidate, normaliseEmail, type TeamLinkCandidate } from '@/lib/team-link'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The MCP service token identity. It has no human inbox, so it never links. */
const SERVICE_USER_ID = 'api-service'

export type ContactLinkOutcome =
  /** Caller is signed into the Tahi org (or no org). Nothing was read. */
  | 'not_client_org'
  /** No usable Clerk user id (signed out, or the MCP service identity). */
  | 'no_user'
  /** The Clerk org has no linked D1 organisation yet. */
  | 'no_org_row'
  /** A contact already points at this Clerk user. No further work was done. */
  | 'already_linked'
  /** No verified primary email on the Clerk account. */
  | 'email_unverified'
  /** No contact at this org carries this email. A row is never created. */
  | 'no_match'
  /** More than one contact at this org carries this email. Nothing linked. */
  | 'ambiguous'
  /** The row was claimed by this sign-in (was unlinked). */
  | 'linked'
  /** The row held a stale id and was corrected to this verified-email owner. */
  | 'relinked'
  /** A concurrent request claimed the row first. Benign. */
  | 'lost_race'

/**
 * Link the signed-in client user to their waiting `contacts` row, if there is
 * exactly one at their org and it is unclaimed.
 *
 * @param userId    Clerk user id from the session.
 * @param clerkOrgId The session's Clerk organization id (NOT the D1 org id).
 */
export async function linkContactOnSignIn(
  userId: string | null,
  clerkOrgId: string | null,
): Promise<ContactLinkOutcome> {
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!clerkOrgId || (tahiOrgId && clerkOrgId === tahiOrgId)) return 'not_client_org'
  if (!userId || userId === SERVICE_USER_ID) return 'no_user'

  try {
    const drizzle = (await db()) as unknown as Drizzle

    // Miss check first, scoped to nothing: if any contact anywhere already
    // points at this Clerk user, the identity is resolved and we stop before
    // paying for the Clerk round trip.
    const [linked] = await drizzle
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.clerkUserId, userId))
      .limit(1)
    if (linked) return 'already_linked'

    // Resolve the caller's own D1 org. Everything below is scoped to it, which
    // is what makes a person who is a contact at two clients unambiguous here.
    const [org] = await drizzle
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.clerkOrgId, clerkOrgId))
      .limit(1)
    if (!org) return 'no_org_row'

    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
    const verified = primary?.verification?.status === 'verified'
    const email = verified ? normaliseEmail(primary?.emailAddress) : null
    if (!email) return 'email_unverified'

    // lower() on both sides: contact emails are hand-entered by the studio and
    // by clients inviting colleagues, so casing will not always agree.
    const candidates: TeamLinkCandidate[] = await drizzle
      .select({
        id: schema.contacts.id,
        email: schema.contacts.email,
        clerkUserId: schema.contacts.clerkUserId,
      })
      .from(schema.contacts)
      .where(and(
        eq(schema.contacts.orgId, org.id),
        sql`lower(${schema.contacts.email}) = ${email}`,
      ))

    const decision = decideCandidate(candidates, userId)
    const now = new Date().toISOString()

    if (decision.outcome === 'link') {
      // Compare-and-set: the WHERE clerk_user_id IS NULL is what makes this
      // safe under concurrent sign-ins.
      const claimed = await drizzle
        .update(schema.contacts)
        .set({ clerkUserId: userId, updatedAt: now })
        .where(and(
          eq(schema.contacts.id, decision.teamMemberId),
          isNull(schema.contacts.clerkUserId),
        ))
        .returning({ id: schema.contacts.id })
      if (claimed.length === 0) return 'lost_race'

      await logAudit(drizzle as unknown as DB, {
        action: 'contact.login_linked',
        userId,
        userType: 'contact',
        entityType: 'contact',
        entityId: decision.teamMemberId,
        metadata: { email, orgId: org.id, matchedBy: 'verified_email' },
      })
      return 'linked'
    }

    if (decision.outcome === 'relink') {
      // Correct a stale link. Compare-and-set on the OLD id so a concurrent
      // correction cannot clobber a newer one. Only reached after a verified
      // email match at this org, so the caller owns this row.
      const rewritten = await drizzle
        .update(schema.contacts)
        .set({ clerkUserId: userId, updatedAt: now })
        .where(and(
          eq(schema.contacts.id, decision.teamMemberId),
          eq(schema.contacts.clerkUserId, decision.staleClerkUserId),
        ))
        .returning({ id: schema.contacts.id })
      if (rewritten.length === 0) return 'lost_race'

      await logAudit(drizzle as unknown as DB, {
        action: 'contact.login_relinked',
        userId,
        userType: 'contact',
        entityType: 'contact',
        entityId: decision.teamMemberId,
        metadata: { email, orgId: org.id, matchedBy: 'verified_email' },
      })
      return 'relinked'
    }

    if (decision.outcome === 'ambiguous') {
      // Operator-visible misconfiguration: two contact rows at one org share an
      // email. Logged rather than written so a repeated page load cannot flood
      // the audit table.
      console.error(
        '[contact-link] not linked: ambiguous',
        JSON.stringify({ email, orgId: org.id, matchedIds: candidates.map(c => c.id) }),
      )
      return 'ambiguous'
    }

    return decision.outcome === 'already_linked' ? 'already_linked' : 'no_match'
  } catch (err) {
    console.error('[contact-link] link attempt failed:', err)
    return 'no_match'
  }
}

import { getPortalAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/portal/invites
 * Invite colleagues to the authenticated client's org. Body: { emails: string[] }.
 * Each becomes a Clerk organization invitation (role org:member); they get an
 * email immediately. Returns a per-email result so the UI can report failures.
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

  const clerk = await clerkClient()
  const results = await Promise.all(
    emails.map(async emailAddress => {
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
      const database = (await db()) as D1
      const existing = await database
        .select({ email: schema.contacts.email })
        .from(schema.contacts)
        .where(eq(schema.contacts.orgId, orgId))
      const known = new Set(existing.map(c => c.email?.trim().toLowerCase()))
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

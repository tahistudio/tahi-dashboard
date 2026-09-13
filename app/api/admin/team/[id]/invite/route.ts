import { createElement } from 'react'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireManagePermissions } from '@/lib/require-permission'
import { requireFeature } from '@/lib/require-feature'
import { logAudit } from '@/lib/audit'
import { createInvite } from '@/lib/onboarding-invites'
import { sendEmail } from '@/lib/email'
import { SeatInviteEmail } from '@/emails/seat-invite'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The MCP service token has no Clerk membership, so it cannot be an inviter. */
const SERVICE_USER_ID = 'api-service'

/**
 * POST /api/admin/team/[id]/invite
 *
 * Send the Tahi-org invite for an existing roster row. This is the step that
 * used to be missing entirely: /team could create a team_members row but
 * nothing ever gave that person a login.
 *
 * WHY NOT A CLERK ORGANIZATION INVITATION. This used to call
 * `clerk.organizations.createOrganizationInvitation`, which fires an email
 * from Clerk's own systems the moment it is called, with no way to suppress
 * it (the Backend API's org-invitation params carry no `notify` flag). It now
 * mints our own app invite token (lib/onboarding-invites.ts, flow 'team') and
 * emails the Studio Ledger kit through lib/email-delivery.ts instead, so Clerk
 * never emails. The loop it closes: invite here -> the hire follows OUR link
 * to /welcome?token=... -> signs up / signs in -> accepts
 * (app/api/admin/team/accept-invite) which creates their Tahi org membership
 * via createOrganizationMembership (no Clerk mail) -> on their first dashboard
 * load lib/team-link.ts claims this row by verified email -> their assigned
 * role and scope apply.
 *
 * Manager-gated (same primitive as the other team writes) because sending this
 * invitation is what turns a roster row into an actual seat.
 * Returns { success, status, message }.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const { denied } = await requireManagePermissions(drizzle, auth)
  if (denied) return denied
  const featureDenied = await requireFeature(auth, 'team')
  if (featureDenied) return featureDenied

  const { id } = await params

  const [member] = await drizzle
    .select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      email: schema.teamMembers.email,
      clerkUserId: schema.teamMembers.clerkUserId,
    })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.id, id))
    .limit(1)

  if (!member) {
    return NextResponse.json({ error: 'Team member not found' }, { status: 404 })
  }

  const email = member.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'This team member needs a valid email address before they can be invited' },
      { status: 400 },
    )
  }

  if (member.clerkUserId) {
    return NextResponse.json({
      success: true,
      status: 'already_linked',
      message: `${member.name} already has a login linked to this record.`,
    })
  }

  const organizationId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!organizationId) {
    console.error('[team-invite] NEXT_PUBLIC_TAHI_ORG_ID is not configured')
    return NextResponse.json({ error: 'Invites are not configured yet' }, { status: 500 })
  }

  // Who is sending this, for the email's "invited by" line. Falls back to the
  // studio name rather than failing the invite over a Clerk profile read.
  let inviterName = 'The Tahi team'
  if (auth.userId && auth.userId !== SERVICE_USER_ID) {
    try {
      const clerk = await clerkClient()
      const inviter = await clerk.users.getUser(auth.userId)
      const full = `${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim()
      if (full) inviterName = full
    } catch {
      // non-fatal: the fallback name still reads fine
    }
  }

  const invite = await createInvite(drizzle, {
    flow: 'team',
    contactEmail: email,
    contactName: member.name,
    createdById: auth.userId && auth.userId !== SERVICE_USER_ID ? auth.userId : null,
  })

  const outcome = await sendEmail(
    email,
    `${inviterName} invited you to Tahi Studio on Tahi`,
    createElement(SeatInviteEmail, {
      contactName: member.name,
      inviterName,
      orgName: 'Tahi Studio',
      inviteUrl: invite.link,
      boundEmail: email,
      expiresAt: invite.expiresAt,
      audience: 'team',
    }),
    undefined,
    { template: 'seat-invite', orgId: null },
  )

  if (!outcome.success) {
    if (outcome.suppressedCount && outcome.suppressedCount > 0) {
      return NextResponse.json({
        error: 'Held back by the email allowlist',
        message: `We cannot invite ${email} yet. ${outcome.error ?? ''}`.trim(),
      }, { status: 409 })
    }
    console.error('[team-invite] send failed:', outcome.error)
    return NextResponse.json(
      { error: 'Could not send the invite. Try again shortly.' },
      { status: 502 },
    )
  }

  await logAudit(drizzle as unknown as DB, {
    action: 'team_member.invited',
    userId: auth.userId,
    entityType: 'team_member',
    entityId: member.id,
    metadata: { email },
  })

  return NextResponse.json({
    success: true,
    status: 'invited',
    message: `Invite sent to ${email}.`,
  })
}

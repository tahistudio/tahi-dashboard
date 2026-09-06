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
import { publicUrl } from '@/lib/app-url'
import { guardOutboundAddress } from '@/lib/email-gate'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The MCP service token has no Clerk membership, so it cannot be an inviter. */
const SERVICE_USER_ID = 'api-service'

/**
 * Clerk answers "already invited" and "already a member" as thrown errors with
 * no stable single field to read, so both the top-level message and every entry
 * in `errors[]` are flattened and matched. Returns null for a genuine failure.
 */
function inviteConflict(err: unknown): 'already_member' | 'already_invited' | null {
  const parts: string[] = []
  if (err instanceof Error && err.message) parts.push(err.message)
  if (typeof err === 'object' && err !== null && 'errors' in err) {
    const list = (err as { errors?: unknown }).errors
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) continue
        const rec = entry as Record<string, unknown>
        for (const key of ['code', 'message', 'longMessage']) {
          const value = rec[key]
          if (typeof value === 'string') parts.push(value)
        }
      }
    }
  }
  const blob = parts.join(' ').toLowerCase()
  if (/already a member|already_a_member|already belongs|membership already/.test(blob)) {
    return 'already_member'
  }
  if (/duplicate_record|already exists|already been invited|pending invitation|already invited/.test(blob)) {
    return 'already_invited'
  }
  return null
}

/**
 * POST /api/admin/team/[id]/invite
 *
 * Send the Tahi-org Clerk invitation for an existing roster row. This is the
 * step that used to be missing entirely: /team could create a team_members row
 * but nothing ever gave that person a login, and the client-side invite flow
 * (app/api/portal/accept-invite) rejects anything that is not flow 'client'.
 *
 * The loop it closes: invite here -> the hire accepts Clerk's email -> they
 * join the Tahi org -> on their first dashboard load lib/team-link.ts claims
 * this row by verified email -> their assigned role and scope apply.
 *
 * Manager-gated (same primitive as the other team writes) because sending this
 * invitation is what turns a roster row into an actual seat.
 * Returns { success, status, message }: an already-invited or already-member
 * email is a 200 with a distinct status, not an error.
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

  // CLERK IS A SECOND MAIL TRANSPORT and this is where it is asked to fire.
  // createOrganizationInvitation sends an invitation email from Clerk's own
  // systems to whatever address we hand it, so lib/email-delivery.ts never
  // sees it and cannot filter it. Left alone, "no teammate receives anything
  // from this system until Liam has verified it" was true of every Resend
  // template and quietly false of the one email that turns a roster row into a
  // person with a login. So the same rule is asked here, and a withheld
  // address is written to email_suppressions before we answer, which is what
  // makes the blackout provable rather than merely intended.
  //
  // No orgId: this is the studio's own workspace, not a client's, so the
  // per-client exemption on `email.allowedOrgIds` has nothing to say about it.
  const gate = await guardOutboundAddress(email, {
    template: 'clerk-org-invite',
    subject: `Clerk invitation to the Tahi workspace for ${member.name}`,
    orgId: null,
  })
  if (!gate.allowed) {
    return NextResponse.json({
      error: 'Held back by the email allowlist',
      message: `Clerk would email the invitation to ${email} itself, and that address is not on the delivery allowlist. ${gate.reason}`,
    }, { status: 409 })
  }

  try {
    const clerk = await clerkClient()
    await clerk.organizations.createOrganizationInvitation({
      organizationId,
      emailAddress: email,
      // Clerk org role stays 'member'. Everything the hire can actually do is
      // decided by this app's roles and scope, not by their Clerk org role.
      role: 'org:member',
      ...(auth.userId && auth.userId !== SERVICE_USER_ID ? { inviterUserId: auth.userId } : {}),
      redirectUrl: publicUrl('/overview'),
    })
  } catch (err) {
    const conflict = inviteConflict(err)
    if (conflict === 'already_member') {
      return NextResponse.json({
        success: true,
        status: 'already_member',
        message: `${email} is already in the Tahi workspace. They will be linked to this record the next time they sign in.`,
      })
    }
    if (conflict === 'already_invited') {
      return NextResponse.json({
        success: true,
        status: 'already_invited',
        message: `${email} already has a pending invite. Ask them to check their inbox.`,
      })
    }
    console.error('[team-invite] Clerk invitation failed:', err)
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

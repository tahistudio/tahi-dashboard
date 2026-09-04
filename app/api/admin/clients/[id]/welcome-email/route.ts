import { createElement } from 'react'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { sendEmail } from '@/lib/email'
import { ensureClientInvite, personaForPlanType } from '@/lib/onboarding-invites'
import WelcomeEmail from '@/emails/welcome'

type Params = { params: Promise<{ id: string }> }
type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface SendResult {
  contactId: string
  email: string
  sent: boolean
  /** The tokened link, so the operator can copy it if the send failed. */
  link: string
  error?: string
}

/**
 * POST /api/admin/clients/[id]/welcome-email
 *
 * The welcome email IS the invite. It used to point at the bare portal root,
 * which meant a migrated client who followed it signed up, joined nothing, and
 * self-provisioned a brand new empty workspace while their real data sat in an
 * org they could never reach. Now every recipient gets a link carrying a live
 * onboarding invite token bound to their own address, so following it drops
 * them into the workspace the studio already built.
 *
 * Body (all optional):
 *   contactId   - send to just this contact instead of everyone.
 *   persona     - override the persona carried on the token. Defaults to the
 *                 already-engaged persona for the org's plan, so an invited
 *                 client is never asked to pay for a workspace we set up.
 *
 * Invites are reused, not re-minted, so re-sending never invalidates the link
 * already sitting in someone's inbox. The response reports per contact what
 * actually happened; the caller no longer has to guess.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const featureDenied = await requireFeature(auth, 'clients')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = (await db()) as D1

  const scopeDenied = await requireAccessToOrg(database, auth.userId, id)
  if (scopeDenied) return scopeDenied

  const body = (await req.json().catch(() => ({}))) as {
    contactId?: string
    persona?: string
  }

  const [org] = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      planType: schema.organisations.planType,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)

  if (!org) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const allContacts = await database
    .select({
      id: schema.contacts.id,
      email: schema.contacts.email,
      name: schema.contacts.name,
      isPrimary: schema.contacts.isPrimary,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, id))

  const targets = (body.contactId
    ? allContacts.filter(c => c.id === body.contactId)
    : allContacts
  ).filter(c => !!c.email?.trim())

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error: body.contactId
          ? 'That contact was not found on this client, or has no email address'
          : 'This client has no contact with an email address to invite',
      },
      { status: 400 },
    )
  }

  const persona = body.persona ?? personaForPlanType(org.planType)

  const results: SendResult[] = []
  for (const contact of targets) {
    const email = contact.email.trim()
    const invite = await ensureClientInvite(database, {
      flow: 'client',
      orgId: org.id,
      persona,
      contactEmail: email,
      contactName: contact.name,
      createdById: auth.userId ?? null,
    })

    const outcome = await sendEmail(
      email,
      `Welcome to Tahi Studio, ${contact.name.split(' ')[0] ?? contact.name}`,
      createElement(WelcomeEmail, {
        contactName: contact.name,
        orgName: org.name,
        // The CTA carries the token: this is what makes the welcome an invite.
        dashboardUrl: invite.link,
      }),
    )

    results.push({
      contactId: contact.id,
      email,
      sent: outcome.success,
      link: invite.link,
      ...(outcome.success ? {} : { error: outcome.error ?? 'Failed to send' }),
    })
  }

  const sentCount = results.filter(r => r.sent).length
  // 502 when every send failed: the invites exist and the links are in the
  // response, but nothing was delivered, and the operator must know that.
  const status = sentCount === 0 ? 502 : 200

  return NextResponse.json(
    { success: sentCount > 0, sent: sentCount, total: results.length, results },
    { status },
  )
}

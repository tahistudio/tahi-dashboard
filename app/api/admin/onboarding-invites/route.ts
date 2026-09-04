import { createElement } from 'react'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import {
  CLIENT_PERSONAS,
  createInvite,
  ensureClientInvite,
  type MintedInvite,
} from '@/lib/onboarding-invites'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { sendEmail } from '@/lib/email'
import { ClientInviteEmail } from '@/emails/client-invite'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * GET  /api/admin/onboarding-invites?orgId=...  - list invites for an org.
 * POST /api/admin/onboarding-invites            - mint a new invite link, and
 *                                                 optionally email it.
 *
 * Tahi creates the client (org) first, then mints an opaque token here. The
 * returned link signs the client straight into the pre-created org with no
 * payment step (the persona plus any contract/schedule/proposal are carried on
 * the token, server-trusted).
 *
 * DELIVERY. Minting a link and delivering it are separate acts, so `send` is
 * opt-in: pass `send: true` (the client detail button and the MCP tool both do)
 * to email the invite with emails/client-invite.tsx. Without it the caller gets
 * a link back to copy by hand, which is what the e2e helper and any
 * "copy link" affordance want. The response always reports what actually
 * happened (`emailed`, `emailError`) rather than swallowing the outcome.
 *
 * Admin only, access-scoped to the target org, and gated on the `clients`
 * feature because an invite hands out access to a client's whole workspace.
 */
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const denied = await requireFeature(auth, 'clients')
  if (denied) return denied

  const target = new URL(req.url).searchParams.get('orgId')
  if (!target) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const database = (await db()) as D1

  const scopeDenied = await requireAccessToOrg(database, auth.userId, target)
  if (scopeDenied) return scopeDenied

  const invites = await database
    .select()
    .from(schema.onboardingInvites)
    .where(eq(schema.onboardingInvites.orgId, target))
    .orderBy(desc(schema.onboardingInvites.createdAt))

  return NextResponse.json({ invites })
}

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const denied = await requireFeature(auth, 'clients')
  if (denied) return denied

  const body = (await req.json().catch(() => ({}))) as {
    orgId?: string
    persona?: string
    flow?: 'client' | 'team'
    contractId?: string
    scheduleId?: string
    proposalId?: string
    contactEmail?: string
    contactName?: string
    expiresInDays?: number
    /** Email the link with emails/client-invite.tsx. Client flow only. */
    send?: boolean
    /** Reuse a live invite for this contact instead of minting another. */
    reuse?: boolean
  }

  const flow: 'client' | 'team' = body.flow === 'team' ? 'team' : 'client'
  const persona = body.persona
  const targetOrgId = body.orgId

  if (flow === 'client') {
    if (!targetOrgId) {
      return NextResponse.json({ error: 'orgId is required for a client invite' }, { status: 400 })
    }
    if (!persona || !(CLIENT_PERSONAS as readonly string[]).includes(persona)) {
      return NextResponse.json(
        { error: `persona must be one of: ${CLIENT_PERSONAS.join(', ')}` },
        { status: 400 },
      )
    }
    // contactEmail is mandatory: accept-invite binds the link to this address so
    // a forwarded link cannot be used by anyone else to seize the workspace.
    if (!body.contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)) {
      return NextResponse.json(
        { error: 'contactEmail is required so the invite link can be bound to the invitee' },
        { status: 400 },
      )
    }
  }

  const database = (await db()) as D1

  let orgName = ''
  if (flow === 'client' && targetOrgId) {
    const scopeDenied = await requireAccessToOrg(database, auth.userId, targetOrgId)
    if (scopeDenied) return scopeDenied

    const [org] = await database
      .select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, targetOrgId))
      .limit(1)
    if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
    orgName = org.name
  }

  const opts = {
    flow,
    orgId: flow === 'client' ? targetOrgId ?? null : null,
    persona: flow === 'client' ? persona ?? null : null,
    contractId: body.contractId ?? null,
    scheduleId: body.scheduleId ?? null,
    proposalId: body.proposalId ?? null,
    contactEmail: body.contactEmail ?? null,
    contactName: body.contactName ?? null,
    expiresInDays: body.expiresInDays,
    createdById: auth.userId ?? null,
  }

  let invite: MintedInvite
  if (flow === 'client' && body.reuse && targetOrgId && body.contactEmail) {
    invite = await ensureClientInvite(database, {
      ...opts,
      orgId: targetOrgId,
      contactEmail: body.contactEmail,
    })
  } else {
    invite = await createInvite(database, opts)
  }

  // Delivery. A failed send is reported, never thrown: the link is already
  // minted and the operator can still copy it.
  let emailed = false
  let emailError: string | null = null
  if (body.send && flow === 'client' && body.contactEmail) {
    const result = await sendEmail(
      body.contactEmail,
      `Your ${orgName || 'Tahi Studio'} portal is ready`,
      createElement(ClientInviteEmail, {
        contactName: body.contactName?.trim() || body.contactEmail.split('@')[0],
        orgName: orgName || 'your workspace',
        inviteUrl: invite.link,
        boundEmail: body.contactEmail.toLowerCase(),
        expiresAt: invite.expiresAt,
      }),
    )
    emailed = result.success
    emailError = result.success ? null : result.error ?? 'Failed to send'
  }

  return NextResponse.json({
    token: invite.token,
    path: invite.path,
    link: invite.link,
    expiresAt: invite.expiresAt,
    reused: invite.reused,
    emailed,
    emailError,
  })
}

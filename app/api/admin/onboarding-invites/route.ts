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
  personaForPlanType,
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
 * PERSONA is optional on a client invite. Omit it and the org's plan decides
 * (personaForPlanType), which is the same rule the welcome route and admin
 * client creation apply, so no caller has to carry its own copy of it.
 *
 * DELIVERY. Minting a link and delivering it are separate acts, so `send` is
 * opt-in: pass `send: true` (the client detail button and the MCP tool both do)
 * to email the invite with emails/client-invite.tsx. Without it the caller gets
 * a link back to copy by hand, which is what the e2e helper and any
 * "copy link" affordance want. The response always reports what actually
 * happened (`emailed`, `emailError`) rather than swallowing the outcome.
 *
 * Admin only, access-scoped to the target org, and gated on the feature the
 * invite hands out: `clients` for a client invite (it is access to a client's
 * whole workspace), `team` for a teammate onboarding link.
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

  // Gate on the feature the invite actually hands out. A client invite is
  // access to a client's whole workspace, so it needs `clients`; a team invite
  // is a teammate onboarding link and has nothing to do with the clients
  // surface, so gating it on `clients` refused a team member who can manage the
  // roster but not the client list for a reason unrelated to what they asked
  // for. Access scoping below is client-flow only for the same reason.
  const denied = await requireFeature(auth, flow === 'team' ? 'team' : 'clients')
  if (denied) return denied

  if (flow === 'client') {
    if (!targetOrgId) {
      return NextResponse.json({ error: 'orgId is required for a client invite' }, { status: 400 })
    }
    // Optional: omit it and the org's plan decides (see below). A value that is
    // supplied still has to be one we know.
    if (persona !== undefined && !(CLIENT_PERSONAS as readonly string[]).includes(persona)) {
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
  let resolvedPersona: string | null = persona ?? null
  if (flow === 'client' && targetOrgId) {
    const scopeDenied = await requireAccessToOrg(database, auth.userId, targetOrgId)
    if (scopeDenied) return scopeDenied

    const [org] = await database
      .select({
        id: schema.organisations.id,
        name: schema.organisations.name,
        planType: schema.organisations.planType,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, targetOrgId))
      .limit(1)
    if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
    orgName = org.name
    // One copy of the plan-to-persona rule, server side, next to the plan it
    // reads. Callers that know better (the MCP tool, a scripted backfill) can
    // still pass an explicit persona; the UI does not have to guess.
    resolvedPersona = persona ?? personaForPlanType(org.planType)
  }

  const opts = {
    flow,
    orgId: flow === 'client' ? targetOrgId ?? null : null,
    persona: flow === 'client' ? resolvedPersona : null,
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

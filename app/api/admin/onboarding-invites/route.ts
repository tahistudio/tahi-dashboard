import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { generateInviteToken } from '@/lib/onboarding-invites'

export const dynamic = 'force-dynamic'

const CLIENT_PERSONAS = ['retainer', 'project', 'existing_project', 'existing_retainer'] as const

/**
 * GET  /api/admin/onboarding-invites?orgId=...  - list invites for an org.
 * POST /api/admin/onboarding-invites            - mint a new invite link.
 *
 * Tahi creates the client (org) first, then mints an opaque token here. The
 * returned link signs the client straight into the pre-created org with no
 * payment step (the persona + any contract/schedule/proposal are carried on
 * the token, server-trusted). Admin only.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const target = new URL(req.url).searchParams.get('orgId')
  if (!target) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })

  const database = await db()
  const invites = await database
    .select()
    .from(schema.onboardingInvites)
    .where(eq(schema.onboardingInvites.orgId, target))
    .orderBy(desc(schema.onboardingInvites.createdAt))

  return NextResponse.json({ invites })
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  const database = await db()

  if (flow === 'client' && targetOrgId) {
    const [org] = await database
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, targetOrgId))
      .limit(1)
    if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  const token = generateInviteToken()
  const now = new Date().toISOString()
  // Default a 14-day expiry so an invite link is never immortal.
  const days = body.expiresInDays && body.expiresInDays > 0 ? body.expiresInDays : 14
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString()

  await database.insert(schema.onboardingInvites).values({
    token,
    flow,
    orgId: flow === 'client' ? targetOrgId ?? null : null,
    persona: flow === 'client' ? persona ?? null : null,
    contractId: body.contractId ?? null,
    scheduleId: body.scheduleId ?? null,
    proposalId: body.proposalId ?? null,
    contactEmail: body.contactEmail?.toLowerCase() ?? null,
    contactName: body.contactName ?? null,
    expiresAt,
    createdById: userId ?? null,
    createdAt: now,
    updatedAt: now,
  })

  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const path = flow === 'team' ? `/welcome?token=${token}` : `/onboarding?token=${token}`
  return NextResponse.json({ token, path, link: `${base}${path}` })
}

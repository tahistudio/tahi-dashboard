import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { acceptClientInvite, resolveInvite } from '@/lib/onboarding-invites'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/portal/accept-invite { token }
 *
 * Thin wrapper: all of the acceptance logic (email binding, the atomic
 * single-use claim, the Clerk membership, the contact link/promotion, and the
 * onboardingComplete stamp) lives in lib/onboarding-invites.ts
 * acceptClientInvite, shared with the seat branch of
 * app/(onboarding)/onboarding/page.tsx so both callers agree on exactly one
 * set of rules.
 *
 * Returns { orgId (D1), clerkOrgId }; the client then calls Clerk setActive.
 */
export async function POST(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  if (!body.token) return NextResponse.json({ error: 'token is required' }, { status: 400 })

  const database = (await db()) as D1
  const invite = await resolveInvite(database, body.token)
  const result = await acceptClientInvite(database, userId, invite)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // The token is consumed: clear the survival cookie the middleware set so a
  // later visit doesn't re-trigger an accept attempt on a spent invite.
  const res = NextResponse.json({ ok: true, orgId: result.orgId, clerkOrgId: result.clerkOrgId })
  res.cookies.set('tahi-invite-token', '', { path: '/', maxAge: 0 })
  return res
}

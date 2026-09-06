/**
 * /api/admin/impersonate/mode : arm or disarm Act as client.
 *
 * Client view has two modes. `view` is the historical read-only lens: every
 * portal write answers 403 and nothing in a client's workspace can change.
 * `act` lets a super admin work inside that workspace for real, with every row
 * attributed to them and every write recorded in the audit log.
 *
 * The mode travels as a browser cookie (lib/preview-cookie.ts owns its name and
 * its parsing), which means the browser could write it without asking. That is
 * fine and deliberate: the cookie is INTENT, and `getPortalAuth` re-derives the
 * RIGHT on every single request by re-reading the roles table. Forging the
 * cookie buys nothing.
 *
 * This route exists anyway, for two reasons a cookie alone cannot cover:
 *   - Entering the mode is a decision, and a decision deserves a server that
 *     says yes or no in one place, with the same rule the write path uses. A
 *     non-super-admin gets 403 here and would be ignored there; both answers
 *     agree because both call resolvePermissions.
 *   - Arming a mode with nothing to aim it at is a bug waiting to surface, so
 *     the route refuses unless a resolvable preview org cookie is already set.
 *
 * Disarming (`mode: 'view'`) is deliberately NOT gated. Whoever holds the
 * cookie may always put it down, exactly like the exit hatches next door.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { resolvePermissions } from '@/lib/permissions'
import { resolveTeamMember } from '@/lib/team-identity'
import {
  ACT_MODE_VALUE,
  IMPERSONATE_MODE_COOKIE,
  IMPERSONATE_ORG_COOKIE,
  readPreviewMode,
  resolvePreviewOrgId,
  type PreviewMode,
} from '@/lib/preview-cookie'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Same cookie contract the banner and both exit hatches use: path=/ so it
 * covers the basePath, SameSite=Lax, and NO Max-Age, so it dies with the
 * browser session. Not httpOnly on purpose: the banner has to be able to clear
 * it locally when the operator exits, and reading it grants nothing.
 */
function arm(res: NextResponse): NextResponse {
  res.cookies.set(IMPERSONATE_MODE_COOKIE, ACT_MODE_VALUE, { path: '/', sameSite: 'lax' })
  return res
}

function disarm(res: NextResponse): NextResponse {
  res.cookies.set(IMPERSONATE_MODE_COOKIE, '', { path: '/', maxAge: 0, sameSite: 'lax' })
  return res
}

interface ActEligibility {
  ok: boolean
  reason: string | null
}

/**
 * May this session act as the client it is previewing? The same three
 * conditions lib/server-auth.ts re-checks on every write, asked once here so
 * the UI and the write path can never disagree about the answer.
 */
async function eligibility(
  userId: string | null,
  clerkOrgId: string | null,
): Promise<ActEligibility> {
  if (!userId || !clerkOrgId) {
    return { ok: false, reason: 'Sign in as a Tahi Studio super admin.' }
  }
  const database = await db()
  const drizzle = database as Drizzle
  const access = await resolvePermissions(
    drizzle as unknown as Parameters<typeof resolvePermissions>[0],
    { userId, orgId: clerkOrgId },
  )
  if (!access.isSuperAdmin) {
    return {
      ok: false,
      reason: 'Acting as a client is limited to super admins.',
    }
  }
  const member = await resolveTeamMember(drizzle, userId)
  if (!member) {
    return {
      ok: false,
      // The service token is the usual traveller down this branch: it is
      // verified by TAHI_API_TOKEN and has no roster row by design, so it can
      // never be the person an acting write is attributed to.
      reason: 'Acting as a client needs a team member profile linked to your login.',
    }
  }
  return { ok: true, reason: null }
}

/**
 * GET : what mode is this browser in, and may it enter act mode at all.
 * Read-only; the banner uses it to decide whether to paint the control.
 */
export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const previewOrgId = resolvePreviewOrgId(true, req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value)
  const mode: PreviewMode = previewOrgId
    ? readPreviewMode(req.cookies.get(IMPERSONATE_MODE_COOKIE)?.value)
    : 'view'

  let canAct = false
  let reason: string | null = null
  try {
    const verdict = await eligibility(userId, orgId)
    canAct = verdict.ok
    reason = verdict.reason
  } catch {
    // Fail closed: a resolver hiccup reports "not allowed", which matches what
    // the write path would do with the same hiccup.
    canAct = false
    reason = 'Could not resolve your access just now.'
  }

  return NextResponse.json({ mode, previewOrgId, canAct, reason })
}

/**
 * POST { mode: 'act' | 'view' } : arm or disarm.
 *
 * 'act' requires a super admin with a roster row AND a preview already pointed
 * at a client. 'view' always succeeds.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { mode?: unknown }
  try {
    body = (await req.json()) as { mode?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.mode !== ACT_MODE_VALUE && body.mode !== 'view') {
    return NextResponse.json({ error: "mode must be 'act' or 'view'" }, { status: 400 })
  }

  if (body.mode === 'view') {
    return disarm(NextResponse.json({ ok: true, mode: 'view' }))
  }

  const previewOrgId = resolvePreviewOrgId(true, req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value)
  if (!previewOrgId) {
    return NextResponse.json(
      { error: 'Open Client view for a client before acting as them.' },
      { status: 400 },
    )
  }

  let verdict: ActEligibility
  try {
    verdict = await eligibility(userId, orgId)
  } catch {
    return NextResponse.json({ error: 'Could not resolve your access just now.' }, { status: 500 })
  }
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 403 })
  }

  return arm(NextResponse.json({ ok: true, mode: 'act', previewOrgId }))
}

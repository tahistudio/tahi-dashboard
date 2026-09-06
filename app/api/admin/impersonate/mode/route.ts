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
 *
 * BEFORE THIS MODE IS ARMED IN A LIVE ENVIRONMENT, read this.
 *
 * Act mode adds no email path: every opened route notifies the STUDIO only
 * (notifyAllAdmins and notifyRequestTeam resolve `team_members` rows and skip
 * contact participants), the review and PATCH paths are bell-only, and the
 * automation executor refuses send_email. Nothing here can put a message in a
 * client's inbox. What it DOES do is make those studio sends reachable on
 * demand for the first time: in the read-only preview every one of these
 * writes answered 403, so no mail fired at all.
 *
 * That means the standing rule "no real teammate receives any mail until it is
 * verified" rests on the send allowlist in the email layer, which is a
 * different workstream. Do not arm this mode in an environment where that
 * allowlist is not in place and RESEND_API_KEY is live.
 *
 * The same applies to `dispatchDomainEvent` on the request-created and review
 * paths: it fires outgoing webhooks exactly as a real client write does. That
 * channel is not new, but an acting write is the first way an operator can
 * trigger it from inside a client's workspace on purpose.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { resolveActEligibility, type ActEligibility } from '@/lib/acting-eligibility'
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

/**
 * May this session act as the client it is previewing? The same two conditions
 * lib/server-auth.ts re-checks on every acting write, asked through the same
 * module (lib/acting-eligibility.ts) so the UI and the write path can never
 * disagree about the answer.
 */
async function eligibility(
  userId: string | null,
  clerkOrgId: string | null,
): Promise<ActEligibility> {
  const database = await db()
  return resolveActEligibility(database as Drizzle, userId, clerkOrgId)
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

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { SERVICE_USER_ID } from '@/lib/team-identity'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import {
  CONSENT_ASSERTION_TTL_SECONDS,
  isUsableIdentitySecret,
  nowSeconds,
  signIdentityEnvelope,
  verifyIdentityEnvelope,
} from '@/lib/mcp-identity'
import {
  buildConsentRedirect,
  parseConsentCallback,
  resolveMcpConsentEligibility,
} from '@/lib/mcp-profile-server'

const NO_STORE = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
}

function text(body: string, status: number): NextResponse {
  return new NextResponse(body, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' } })
}

function originOf(value: string | undefined | null): string | null {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * The browser form on /mcp/authorize posts here. Approve mints a short-lived
 * signed assertion and sends the browser back to the worker callback; Cancel
 * sends it back with access_denied. Browser only: a service bearer can never
 * consent for a person.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const allowedOrigins = [originOf(req.url), originOf(process.env.NEXT_PUBLIC_APP_URL)]
  if (!origin || !allowedOrigins.includes(origin)) {
    return text('Forbidden: this request did not come from the dashboard.', 403)
  }

  const auth = await getRequestAuth(req)
  if (auth.userId === SERVICE_USER_ID) return text('Forbidden: a service token cannot approve a connection.', 403)
  if (!auth.userId) return text('Sign in to approve this connection.', 401)

  const secret = process.env.MCP_IDENTITY_SECRET

  const form = await req.formData().catch(() => null)
  const reqToken = form?.get('req')
  const decision = form?.get('decision')
  const claims = await verifyIdentityEnvelope(
    typeof reqToken === 'string' ? reqToken : null,
    secret,
    'mcp_consent_request',
  )
  if (!claims || typeof reqToken !== 'string') {
    return text('This connection link has expired or is not valid. Start connecting again from Claude.', 400)
  }

  const cb = parseConsentCallback(claims.cb)
  if (!cb) return text('The connection callback address is not valid.', 400)

  if (decision === 'deny') {
    return NextResponse.redirect(buildConsentRedirect(cb, { req: reqToken, error: 'access_denied' }), {
      status: 303,
      headers: NO_STORE,
    })
  }
  if (decision !== 'approve') return text('Choose Approve or Cancel.', 400)

  const database = await db()
  const eligibility = await resolveMcpConsentEligibility(database, { userId: auth.userId, orgId: auth.orgId })
  if (!eligibility.ok) return text(`Forbidden: ${eligibility.reason}`, 403)

  if (!isUsableIdentitySecret(secret)) {
    return text('Claude connections are not configured on the dashboard yet. Ask Liam to finish the setup.', 503)
  }

  const now = nowSeconds()
  const assertion = await signIdentityEnvelope(
    {
      typ: 'mcp_consent',
      nonce: claims.nonce,
      tm: eligibility.member.teamMemberId,
      cu: auth.userId,
      p: eligibility.profile,
      name: eligibility.member.name,
      iat: now,
      exp: now + CONSENT_ASSERTION_TTL_SECONDS,
    },
    secret,
  )

  let redirectHost: string | null = null
  try {
    redirectHost = new URL(claims.ruri).host
  } catch {
    redirectHost = null
  }
  try {
    await logAudit(database, {
      action: 'mcp.connector_approved',
      userId: auth.userId,
      userType: 'team_member',
      entityType: 'team_member',
      entityId: eligibility.member.teamMemberId,
      metadata: {
        teamMemberId: eligibility.member.teamMemberId,
        profile: eligibility.profile,
        redirectHost,
      },
    })
  } catch {
    // An audit failure must never block the approval redirect.
  }

  return NextResponse.redirect(buildConsentRedirect(cb, { req: reqToken, assertion }), {
    status: 303,
    headers: NO_STORE,
  })
}

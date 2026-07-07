import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// Settings key that holds the short-lived, single-use OAuth state nonce.
// The callback verifies + consumes it before exchanging the code, which
// prevents CSRF (an attacker cannot forge a callback carrying our nonce).
const XERO_STATE_KEY = 'xero_oauth_state'
// Nonce lifetime: the user should complete consent well within 10 minutes.
const XERO_STATE_TTL_MS = 10 * 60 * 1000

/**
 * GET /api/admin/integrations/xero/connect
 * Stub: returns the Xero OAuth authorization URL.
 */
export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const clientId = process.env.XERO_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({
      success: false,
      message: 'Xero integration not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET.',
    })
  }

  // Use the request origin to build the redirect URI dynamically
  // This ensures it works on any deployment (Webflow Cloud, localhost, etc.)
  const requestUrl = new URL(req.url)
  const redirectUri = `${requestUrl.origin}/api/admin/integrations/xero/callback`
  const scopes = 'openid profile email accounting.transactions accounting.contacts accounting.reports.read accounting.settings offline_access'

  // Generate a random single-use state nonce and persist it (short-lived
  // settings row - same key/value store other integrations use). The
  // callback verifies + deletes it. A settings row is used rather than a
  // signed cookie because the cross-origin redirect back from login.xero.com
  // strips SameSite cookies under some policies (see the google callback note).
  const stateNonce = crypto.randomUUID()
  const database = await db()
  const nowIso = new Date().toISOString()
  const stateValue = JSON.stringify({
    nonce: stateNonce,
    expiresAt: new Date(Date.now() + XERO_STATE_TTL_MS).toISOString(),
  })
  const existingState = await database
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, XERO_STATE_KEY))
    .limit(1)
  if (existingState.length > 0) {
    await database
      .update(schema.settings)
      .set({ value: stateValue, updatedAt: nowIso })
      .where(eq(schema.settings.key, XERO_STATE_KEY))
  } else {
    await database.insert(schema.settings).values({
      key: XERO_STATE_KEY,
      value: stateValue,
      updatedAt: nowIso,
    })
  }

  const authUrl = new URL('https://login.xero.com/identity/connect/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('state', stateNonce)

  return NextResponse.json({
    success: true,
    authorizationUrl: authUrl.toString(),
  })
}

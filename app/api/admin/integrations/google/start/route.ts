/**
 * GET /api/admin/integrations/google/start
 *
 * Kicks off the Google OAuth flow. Returns a JSON { url } that the
 * client redirects to. We could redirect server-side instead, but JSON
 * keeps the client in control of the navigation (and easier to debug
 * if the env vars are missing).
 *
 * Scopes:
 *   - calendar.events.readonly  (sync upcoming + past meetings)
 *   - drive.readonly            (pull "Notes by Gemini" docs)
 *   - analytics.readonly        (GA4 Data API — for /content-studio ideation)
 *   - webmasters.readonly       (Search Console — query gaps + index coverage)
 *   - userinfo.email            (display connected account)
 *
 * Required env vars (set in Webflow Cloud or wrangler):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET   (only used on callback)
 *   GOOGLE_REDIRECT_URI    (optional — defaults to host + /api/admin/integrations/google/callback)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// Settings key that holds the short-lived, single-use OAuth state nonce.
// The callback verifies + consumes it before exchanging the code, which
// prevents CSRF (an attacker cannot forge a callback carrying our nonce).
// Same mechanism as the Xero connect/callback pair: a settings row rather
// than a signed cookie, because the cross-origin redirect back from
// accounts.google.com strips SameSite cookies under some policies.
const GOOGLE_STATE_KEY = 'google_oauth_state'
// Nonce lifetime: the user should complete consent well within 10 minutes.
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({
      error: 'GOOGLE_CLIENT_ID not configured. Add it to the Webflow Cloud environment, plus GOOGLE_CLIENT_SECRET.',
    }, { status: 500 })
  }

  // Default redirect URI: same host + dashboard basePath.
  const host = req.headers.get('host') ?? 'localhost'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const defaultRedirect = `${proto}://${host}/api/admin/integrations/google/callback`
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? defaultRedirect

  // Generate a random single-use state nonce and persist it (short-lived
  // settings row). The callback verifies + deletes it before the token
  // exchange, so a forged callback can never overwrite the stored tokens.
  const stateNonce = crypto.randomUUID()
  const database = await db()
  const nowIso = new Date().toISOString()
  const stateValue = JSON.stringify({
    nonce: stateNonce,
    expiresAt: new Date(Date.now() + GOOGLE_STATE_TTL_MS).toISOString(),
  })
  const existingState = await database
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, GOOGLE_STATE_KEY))
    .limit(1)
  if (existingState.length > 0) {
    await database
      .update(schema.settings)
      .set({ value: stateValue, updatedAt: nowIso })
      .where(eq(schema.settings.key, GOOGLE_STATE_KEY))
  } else {
    await database.insert(schema.settings).values({
      key: GOOGLE_STATE_KEY,
      value: stateValue,
      updatedAt: nowIso,
    })
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',          // get a refresh token
    prompt: 'consent',               // force refresh-token issuance on re-auth
    include_granted_scopes: 'true',
    state: stateNonce,
  })

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return NextResponse.json({ url, redirectUri })
}

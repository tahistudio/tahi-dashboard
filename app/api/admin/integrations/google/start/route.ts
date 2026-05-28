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
 *   GOOGLE_REDIRECT_URI    (optional — defaults to host + /dashboard/api/admin/integrations/google/callback)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({
      error: 'GOOGLE_CLIENT_ID not configured. Add it to the Webflow Cloud environment, plus GOOGLE_CLIENT_SECRET.',
    }, { status: 500 })
  }

  // Default redirect URI: same host + dashboard basePath.
  const host = req.headers.get('host') ?? 'localhost'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const defaultRedirect = `${proto}://${host}/dashboard/api/admin/integrations/google/callback`
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? defaultRedirect

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',          // get a refresh token
    prompt: 'consent',               // force refresh-token issuance on re-auth
    include_granted_scopes: 'true',
  })

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  return NextResponse.json({ url, redirectUri })
}

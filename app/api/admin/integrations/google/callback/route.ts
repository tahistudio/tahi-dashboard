/**
 * GET /api/admin/integrations/google/callback?code=...
 *
 * OAuth callback. Exchanges the authorisation code for access +
 * refresh tokens, stores them on integrations row with
 * service='google_workspace', then redirects to /settings#google.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// NOTE: This callback is intentionally public (see middleware.ts public
// route list). The cross-origin redirect from accounts.google.com strips
// the Clerk session cookie under some SameSite + cookie-prefix policies,
// which used to leave the user bounced to /sign-in instead of completing
// the connection. Auth is implicitly provided by:
//   1. The single-use Google authorization code (bound to our registered
//      redirect_uri — an attacker cannot forge one).
//   2. The token exchange itself, which fails for any non-genuine code.
//   3. The org-wide integrations row (only one google_workspace per
//      install), so token storage doesn't need to identify a user.

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
  error?: string
  error_description?: string
}

interface GoogleUserInfo {
  email?: string
  verified_email?: boolean
  name?: string
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error')

  // Build the settings redirect URL relative to this host so it works
  // on both prod and local dev.
  const host = req.headers.get('host') ?? 'localhost'
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const settingsUrl = (suffix: string) => `${proto}://${host}/dashboard/settings#google${suffix}`

  if (oauthError) {
    return NextResponse.redirect(settingsUrl(`?error=${encodeURIComponent(oauthError)}`))
  }
  if (!code) {
    return NextResponse.redirect(settingsUrl('?error=no_code'))
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(settingsUrl('?error=missing_env'))
  }

  const defaultRedirect = `${proto}://${host}/dashboard/api/admin/integrations/google/callback`
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? defaultRedirect

  // 1. Exchange code → tokens
  let tokens: GoogleTokenResponse
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    tokens = await tokenRes.json() as GoogleTokenResponse
    if (!tokenRes.ok || tokens.error) {
      return NextResponse.redirect(settingsUrl(`?error=${encodeURIComponent(tokens.error ?? 'token_exchange_failed')}`))
    }
  } catch (err) {
    return NextResponse.redirect(settingsUrl(`?error=${encodeURIComponent(err instanceof Error ? err.message : 'token_exchange_failed')}`))
  }
  if (!tokens.access_token) {
    return NextResponse.redirect(settingsUrl('?error=no_access_token'))
  }

  // 2. Fetch the user's email (for display in Settings)
  let email: string | null = null
  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (userRes.ok) {
      const u = await userRes.json() as GoogleUserInfo
      email = u.email ?? null
    }
  } catch { /* best-effort */ }

  // 3. Upsert integrations row (service='google_workspace' is unique)
  const database = await db()
  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null
  const now = new Date().toISOString()

  const existing = await database
    .select({ id: schema.integrations.id })
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'google_workspace'))
    .limit(1)

  const config = JSON.stringify({
    email,
    scopes: tokens.scope ?? '',
    connectedAt: now,
  })

  if (existing.length > 0) {
    await database
      .update(schema.integrations)
      .set({
        status: 'connected',
        accessToken: tokens.access_token,
        // Google only re-issues refresh_token on first consent OR with
        // prompt=consent. If we don't get one back, keep the existing.
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        tokenExpiresAt: expiresAt,
        config,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(schema.integrations.id, existing[0].id))
  } else {
    await database.insert(schema.integrations).values({
      id: crypto.randomUUID(),
      service: 'google_workspace',
      status: 'connected',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: expiresAt,
      config,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.redirect(settingsUrl('?connected=1'))
}

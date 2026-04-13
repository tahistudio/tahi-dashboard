import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * GET /api/admin/integrations/xero/callback
 * Stub: handles the Xero OAuth callback, exchanges code for tokens,
 * and stores them in the integrations table.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    // Redirect to settings with error indicator
    return NextResponse.redirect(
      new URL('/settings?xero=error', new URL(req.url).origin),
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings?xero=error', new URL(req.url).origin),
    )
  }

  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL('/settings?xero=error', new URL(req.url).origin),
    )
  }

  // Exchange authorization code for access token
  let accessToken: string | null = null
  let refreshToken: string | null = null
  let expiresIn: number | null = null

  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${new URL(req.url).origin}/api/admin/integrations/xero/callback`,
      }),
    })

    if (!tokenRes.ok) {
      console.error('Xero token exchange failed:', tokenRes.status, tokenRes.statusText)
      return NextResponse.redirect(
        new URL('/settings?xero=error', new URL(req.url).origin),
      )
    }

    const tokenData = await tokenRes.json() as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
    }

    accessToken = tokenData.access_token ?? null
    refreshToken = tokenData.refresh_token ?? null
    expiresIn = tokenData.expires_in ?? null

    if (!accessToken) {
      console.error('No access token in Xero response')
      return NextResponse.redirect(
        new URL('/settings?xero=error', new URL(req.url).origin),
      )
    }
  } catch (err) {
    console.error('Failed to exchange Xero authorization code:', err)
    return NextResponse.redirect(
      new URL('/settings?xero=error', new URL(req.url).origin),
    )
  }

  try {
    const database = await db()
    const now = new Date().toISOString()

    // Calculate token expiry time
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null

    // Upsert integration record
    const existing = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.service, 'xero'))
      .limit(1)

    if (existing.length > 0) {
      await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
        .update(schema.integrations)
        .set({
          status: 'connected',
          accessToken,
          refreshToken: refreshToken ?? undefined,
          tokenExpiresAt,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(schema.integrations.service, 'xero'))
    } else {
      await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
        .insert(schema.integrations)
        .values({
          id: crypto.randomUUID(),
          service: 'xero',
          status: 'connected',
          accessToken,
          refreshToken: refreshToken ?? null,
          tokenExpiresAt,
          config: JSON.stringify({ connectedAt: now }),
          createdAt: now,
          updatedAt: now,
        })
    }
  } catch (err) {
    console.error('Failed to store Xero integration record:', err)
    return NextResponse.redirect(
      new URL('/settings?xero=error', new URL(req.url).origin),
    )
  }

  return NextResponse.redirect(
    new URL('/settings?xero=connected', new URL(req.url).origin),
  )
}

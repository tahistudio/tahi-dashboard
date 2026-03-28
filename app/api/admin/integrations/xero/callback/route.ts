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
      new URL('/settings?xero=error', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    )
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings?xero=error', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    )
  }

  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL('/settings?xero=error', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
    )
  }

  // Stub: in production this would exchange the code for tokens
  // const tokenRes = await fetch('https://identity.xero.com/connect/token', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/x-www-form-urlencoded',
  //     'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
  //   },
  //   body: new URLSearchParams({
  //     grant_type: 'authorization_code',
  //     code,
  //     redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/integrations/xero/callback`,
  //   }),
  // })

  try {
    const database = await db()
    const now = new Date().toISOString()

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
          // accessToken and refreshToken would be set from the token exchange
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
          config: JSON.stringify({ connectedAt: now }),
          createdAt: now,
          updatedAt: now,
        })
    }
  } catch {
    console.error('Failed to store Xero integration record')
  }

  return NextResponse.redirect(
    new URL('/settings?xero=connected', process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  )
}

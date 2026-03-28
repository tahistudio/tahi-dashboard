import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/integrations/xero/connect
 * Stub: returns the Xero OAuth authorization URL.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const clientId = process.env.XERO_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({
      success: false,
      message: 'Xero integration not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET.',
    })
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/admin/integrations/xero/callback`
  const scopes = 'openid profile email accounting.transactions accounting.contacts offline_access'

  const authUrl = new URL('https://login.xero.com/identity/connect/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', scopes)
  authUrl.searchParams.set('state', crypto.randomUUID())

  return NextResponse.json({
    success: true,
    authorizationUrl: authUrl.toString(),
  })
}

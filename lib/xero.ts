import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * Xero API utilities for OAuth token management and API calls
 */

interface XeroTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

interface XeroIntegration {
  id: string
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: string | null
  config: string | null
}

/**
 * Get the Xero integration record with current tokens
 */
export async function getXeroIntegration(): Promise<XeroIntegration | null> {
  const database = await db()
  const result = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'xero'))
    .limit(1)

  return result.length > 0 ? result[0] : null
}

/**
 * Check if Xero token is expired
 */
export function isTokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return true
  return new Date(tokenExpiresAt) <= new Date()
}

/**
 * Refresh the Xero access token using refresh token
 */
export async function refreshXeroToken(): Promise<boolean> {
  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('Xero credentials not configured')
    return false
  }

  const integration = await getXeroIntegration()
  if (!integration || !integration.refreshToken) {
    console.error('No Xero refresh token available')
    return false
  }

  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: integration.refreshToken,
      }),
    })

    if (!tokenRes.ok) {
      console.error('Xero token refresh failed:', tokenRes.status, tokenRes.statusText)
      return false
    }

    const tokenData = (await tokenRes.json()) as XeroTokenResponse

    const database = await db()
    const now = new Date().toISOString()
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

    await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
      .update(schema.integrations)
      .set({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? integration.refreshToken,
        tokenExpiresAt,
        updatedAt: now,
      })
      .where(eq(schema.integrations.service, 'xero'))

    return true
  } catch (err) {
    console.error('Failed to refresh Xero token:', err)
    return false
  }
}

/**
 * Get a valid Xero access token, refreshing if necessary
 */
export async function getValidXeroToken(): Promise<string | null> {
  const integration = await getXeroIntegration()

  if (!integration || !integration.accessToken) {
    console.error('Xero not connected')
    return null
  }

  if (isTokenExpired(integration.tokenExpiresAt)) {
    const refreshed = await refreshXeroToken()
    if (!refreshed) {
      return null
    }

    const updated = await getXeroIntegration()
    return updated?.accessToken ?? null
  }

  return integration.accessToken
}

/**
 * Make an authenticated call to the Xero API
 */
export async function callXeroAPI<T>(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T | null> {
  const token = await getValidXeroToken()
  if (!token) {
    console.error('Unable to obtain valid Xero token')
    return null
  }

  try {
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Xero-tenant-id': process.env.XERO_TENANT_ID || '',
      },
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const res = await fetch(`https://api.xero.com/api.xro/2.0${endpoint}`, options)

    if (!res.ok) {
      console.error(`Xero API error (${method} ${endpoint}):`, res.status, res.statusText)
      return null
    }

    return (await res.json()) as T
  } catch (err) {
    console.error(`Xero API call failed (${method} ${endpoint}):`, err)
    return null
  }
}

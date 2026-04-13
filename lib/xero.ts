import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * Xero API utilities for Custom Connection token management and API calls.
 *
 * Custom Connections use client_credentials grant type (no user consent needed).
 * Token is fetched with client_id + client_secret, cached in DB, and
 * auto-refreshed when expired.
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
 * Check if Xero token is expired (with 60s buffer)
 */
export function isTokenExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return true
  return new Date(tokenExpiresAt).getTime() <= Date.now() + 60000
}

/**
 * Get a fresh Xero access token using client_credentials grant.
 * This works for Custom Connection apps (no user consent flow needed).
 * Falls back to refresh_token grant if a refresh token exists.
 */
export async function fetchXeroToken(): Promise<boolean> {
  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('Xero credentials not configured')
    return false
  }

  // Try client_credentials first (Custom Connection)
  try {
    const tokenRes = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
    })

    if (tokenRes.ok) {
      const tokenData = (await tokenRes.json()) as XeroTokenResponse
      await storeXeroToken(tokenData)
      return true
    }

    // If client_credentials fails, try refresh_token as fallback
    const integration = await getXeroIntegration()
    if (integration?.refreshToken) {
      const refreshRes = await fetch('https://identity.xero.com/connect/token', {
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

      if (refreshRes.ok) {
        const tokenData = (await refreshRes.json()) as XeroTokenResponse
        await storeXeroToken(tokenData, integration.refreshToken)
        return true
      }
    }

    console.error('Xero token fetch failed:', tokenRes.status, tokenRes.statusText)
    return false
  } catch (err) {
    console.error('Failed to fetch Xero token:', err)
    return false
  }
}

async function storeXeroToken(tokenData: XeroTokenResponse, existingRefreshToken?: string): Promise<void> {
  const database = await db()
  const now = new Date().toISOString()
  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Check if integration record exists
  const existing = await drizzle
    .select({ id: schema.integrations.id })
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'xero'))
    .limit(1)

  if (existing.length > 0) {
    await drizzle
      .update(schema.integrations)
      .set({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? existingRefreshToken ?? null,
        tokenExpiresAt,
        updatedAt: now,
      })
      .where(eq(schema.integrations.service, 'xero'))
  } else {
    await drizzle
      .insert(schema.integrations)
      .values({
        id: crypto.randomUUID(),
        service: 'xero',
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        tokenExpiresAt,
        createdAt: now,
        updatedAt: now,
      })
  }
}

// Keep old name as alias for backward compatibility
export const refreshXeroToken = fetchXeroToken

/**
 * Get a valid Xero access token, auto-fetching if expired
 */
export async function getValidXeroToken(): Promise<string | null> {
  const integration = await getXeroIntegration()

  // If we have a valid cached token, use it
  if (integration?.accessToken && !isTokenExpired(integration.tokenExpiresAt)) {
    return integration.accessToken
  }

  // Token missing or expired - fetch a new one
  const fetched = await fetchXeroToken()
  if (!fetched) {
    return null
  }

  const updated = await getXeroIntegration()
  return updated?.accessToken ?? null
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

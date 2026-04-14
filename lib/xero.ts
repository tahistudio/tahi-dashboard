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

export class XeroAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string,
    public method: string,
    public responseBody?: string,
  ) {
    super(message)
    this.name = 'XeroAPIError'
  }
}

/**
 * Throwing variant of callXeroAPI. Use this when you need to surface the
 * actual Xero validation error back to the caller (e.g. invoice sync UI).
 * Throws XeroAPIError on HTTP error (with Xero's response body attached)
 * or a generic Error if no token can be obtained.
 */
export async function callXeroAPIOrThrow<T>(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = await getValidXeroToken()
  if (!token) {
    throw new Error('Unable to obtain valid Xero token (check XERO_CLIENT_ID/SECRET and tenant connection)')
  }

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Xero-tenant-id': process.env.XERO_TENANT_ID || '',
    },
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const res = await fetch(`https://api.xero.com/api.xro/2.0${endpoint}`, options)

  if (!res.ok) {
    let errText = ''
    try { errText = await res.text() } catch { /* ignore */ }
    throw new XeroAPIError(
      `Xero API ${method} ${endpoint} failed: ${res.status} ${res.statusText}${errText ? ' - ' + errText.slice(0, 500) : ''}`,
      res.status,
      endpoint,
      method,
      errText,
    )
  }

  return (await res.json()) as T
}

/**
 * Make an authenticated call to the Xero API.
 * Returns null on any error (logged to console). Use callXeroAPIOrThrow
 * when you need the actual error surfaced.
 */
export async function callXeroAPI<T>(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<T | null> {
  try {
    return await callXeroAPIOrThrow<T>(method, endpoint, body)
  } catch (err) {
    console.error('[xero]', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * lib/airwallex.ts — Airwallex API client for the bank-of-truth sync.
 *
 * Airwallex auth model:
 *   POST /api/v1/authentication/login with x-client-id + x-api-key
 *   headers returns a Bearer token valid for ~30 min. We cache it in
 *   the `integrations` table the same way Xero does.
 *
 * Env vars (set on Webflow Cloud + the MCP worker):
 *   AIRWALLEX_CLIENT_ID    — jBAIJ_... (public, can commit)
 *   AIRWALLEX_API_KEY      — the scoped secret (secret, never commit)
 *   AIRWALLEX_ACCOUNT_ID   — acct_... (public)
 *   AIRWALLEX_ORG_ID       — org_... (public)
 *
 * Endpoints:
 *   Production:  https://api.airwallex.com
 *   Demo (sandbox): https://api-demo.airwallex.com  (not used here)
 */

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

const AIRWALLEX_BASE = 'https://api.airwallex.com'
const SERVICE_KEY = 'airwallex'

interface AirwallexLoginResponse {
  token: string
  expires_at: string
}

interface AirwallexBalance {
  currency: string
  total_amount: number
  available_amount: number
}

interface AirwallexBalanceResponse {
  balances: AirwallexBalance[]
}

interface AirwallexTransaction {
  id: string
  amount: number
  currency: string
  source_type?: string
  transaction_type?: string
  description?: string
  reference?: string
  source?: string
  status: string
  posted_at?: string
  created_at: string
}

interface AirwallexTransactionsResponse {
  items: AirwallexTransaction[]
  has_more?: boolean
  next_cursor?: string
}

export class AirwallexNotConfiguredError extends Error {
  constructor() { super('Airwallex env vars missing (AIRWALLEX_CLIENT_ID + AIRWALLEX_API_KEY)') }
}

/** Read the cached access token from the integrations table. */
async function readCachedToken(): Promise<{ token: string; expiresAt: string } | null> {
  const database = await db() as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const [row] = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, SERVICE_KEY))
    .limit(1)
  if (!row?.accessToken || !row?.tokenExpiresAt) return null
  // 60s safety margin so an in-flight request doesn't time out mid-call.
  if (new Date(row.tokenExpiresAt).getTime() <= Date.now() + 60_000) return null
  return { token: row.accessToken, expiresAt: row.tokenExpiresAt }
}

/** Persist a fresh access token + expiry. */
async function writeCachedToken(token: string, expiresAt: string): Promise<void> {
  const database = await db() as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const now = new Date().toISOString()
  const [existing] = await database
    .select({ id: schema.integrations.id })
    .from(schema.integrations)
    .where(eq(schema.integrations.service, SERVICE_KEY))
    .limit(1)
  if (existing) {
    await database
      .update(schema.integrations)
      .set({ accessToken: token, tokenExpiresAt: expiresAt, updatedAt: now })
      .where(eq(schema.integrations.id, existing.id))
  } else {
    await database.insert(schema.integrations).values({
      id: crypto.randomUUID(),
      service: SERVICE_KEY,
      accessToken: token,
      tokenExpiresAt: expiresAt,
      createdAt: now,
      updatedAt: now,
    })
  }
}

/** Exchange the client_id + api_key for a fresh Bearer token. */
async function login(): Promise<{ token: string; expiresAt: string }> {
  const clientId = process.env.AIRWALLEX_CLIENT_ID
  const apiKey = process.env.AIRWALLEX_API_KEY
  if (!clientId || !apiKey) throw new AirwallexNotConfiguredError()

  const res = await fetch(`${AIRWALLEX_BASE}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'x-client-id': clientId,
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Airwallex login failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = await res.json() as AirwallexLoginResponse
  return { token: data.token, expiresAt: data.expires_at }
}

/**
 * Get a current Bearer token. Reads cache first, only logs in when
 * the cache is empty or expired.
 */
export async function getAirwallexToken(): Promise<string> {
  const cached = await readCachedToken()
  if (cached) return cached.token
  const fresh = await login()
  await writeCachedToken(fresh.token, fresh.expiresAt)
  return fresh.token
}

/** Helper for authed GET requests to the Airwallex API. */
async function airwallexGet<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
  const token = await getAirwallexToken()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === 'string' && v.length > 0) qs.set(k, v)
  }
  const url = `${AIRWALLEX_BASE}${path}${qs.toString() ? `?${qs}` : ''}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Airwallex GET ${path} failed (${res.status}): ${body.slice(0, 200)}`)
  }
  return await res.json() as T
}

/** Fetch the current balance per currency for the configured account. */
export async function listBalances(): Promise<AirwallexBalance[]> {
  const data = await airwallexGet<AirwallexBalanceResponse>('/api/v1/balances/current')
  return data.balances ?? []
}

/**
 * Fetch financial transactions since a given ISO date. Airwallex paginates;
 * we follow next_cursor until exhausted. Capped at 10 pages for safety.
 */
export async function listTransactions(opts: {
  fromCreatedAt?: string  // ISO 8601
  toCreatedAt?: string
}): Promise<AirwallexTransaction[]> {
  const all: AirwallexTransaction[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const data = await airwallexGet<AirwallexTransactionsResponse>('/api/v1/financial_transactions', {
      from_created_at: opts.fromCreatedAt,
      to_created_at: opts.toCreatedAt,
      page_after: cursor,
      page_size: '200',
    })
    all.push(...(data.items ?? []))
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return all
}

export type { AirwallexBalance, AirwallexTransaction }

/**
 * lib/mcp-identity.ts - the signed envelopes the MCP worker and the dashboard
 * pass each other so a connector session belongs to one real team member.
 *
 * Three envelopes, one shared secret (MCP_IDENTITY_SECRET, set on both the
 * worker and the dashboard), each carrying its own `typ` so one can never be
 * replayed as another:
 *
 *   mcp_consent_request  worker -> dashboard. The OAuth parameters Claude sent
 *                        to GET /authorize, already validated by the worker
 *                        (allowlisted callback, S256 PKCE), plus a nonce and
 *                        the worker URL to come back to. The dashboard only
 *                        shows a consent screen for a request it can verify.
 *   mcp_consent          dashboard -> worker. "This signed-in Clerk user is
 *                        team member X with MCP profile P and approved the
 *                        request carrying nonce N." Two minutes to live.
 *   mcp_actor            worker -> dashboard, on every tool call, alongside
 *                        TAHI_API_TOKEN. Names the person a write is made
 *                        for. It changes the RECORDED actor only; the bearer
 *                        token stays the authorisation (lib/server-auth.ts).
 *
 * Pure Web Crypto, no imports: the worker bundles this file by relative path
 * and the app's Vitest run covers it (workers/** is not collected).
 */

export type McpProfile = 'full' | 'designer'

export const MCP_PROFILES: readonly McpProfile[] = ['full', 'designer']

/** A stored or claimed profile value, or null for anything else. */
export function parseMcpProfile(value: unknown): McpProfile | null {
  return value === 'full' || value === 'designer' ? value : null
}

/** Header the worker sends the signed mcp_actor envelope in. */
export const MCP_ACTOR_HEADER = 'x-tahi-mcp-actor'

/** Shorter secrets are treated as unset: the envelopes fail closed. */
export const MIN_IDENTITY_SECRET_LENGTH = 32

export const CONSENT_REQUEST_TTL_SECONDS = 10 * 60
export const CONSENT_ASSERTION_TTL_SECONDS = 2 * 60
export const ACTOR_TTL_SECONDS = 5 * 60

/** Clock skew tolerated on `iat` between the worker and the dashboard. */
const MAX_FUTURE_SKEW_SECONDS = 60

export interface ConsentRequestClaims {
  typ: 'mcp_consent_request'
  /** OAuth client_id */
  cid: string
  /** redirect_uri, already allowlisted by the worker */
  ruri: string
  /** OAuth state, echoed back to the client untouched */
  st: string | null
  /** PKCE code_challenge (S256 only) */
  cc: string
  /** Worker URL the dashboard sends the browser back to */
  cb: string
  nonce: string
  iat: number
  exp: number
}

export interface ConsentClaims {
  typ: 'mcp_consent'
  nonce: string
  /** team_members.id */
  tm: string
  /** Clerk user id of the person who approved */
  cu: string
  p: McpProfile
  /** Display name, for the standing instructions and logs */
  name: string
  iat: number
  exp: number
}

export interface ActorClaims {
  typ: 'mcp_actor'
  tm: string
  cu: string
  p: McpProfile
  iat: number
  exp: number
}

export type IdentityClaims = ConsentRequestClaims | ConsentClaims | ActorClaims
export type IdentityType = IdentityClaims['typ']

type ClaimsOf<T extends IdentityType> = Extract<IdentityClaims, { typ: T }>

export function isUsableIdentitySecret(secret: string | undefined | null): secret is string {
  return typeof secret === 'string' && secret.trim().length >= MIN_IDENTITY_SECRET_LENGTH
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/** 128 bits of randomness, base64url. */
export function randomNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (value.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

async function hmac(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret.trim()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return bytesToBase64Url(new Uint8Array(sig))
}

/** Length-blind comparison, no early exit on the first differing character. */
function safeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/**
 * Sign claims into `base64url(json).base64url(hmac)`. Throws when the secret
 * is unusable: minting with a weak or missing key must be loud, not silent.
 */
export async function signIdentityEnvelope(claims: IdentityClaims, secret: string | undefined | null): Promise<string> {
  if (!isUsableIdentitySecret(secret)) throw new Error('MCP_IDENTITY_SECRET is not configured')
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(claims)))
  return `${encoded}.${await hmac(encoded, secret)}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Field-level shape check per envelope type, after the signature passed. */
function hasShape(claims: Record<string, unknown>, typ: IdentityType): boolean {
  switch (typ) {
    case 'mcp_consent_request':
      return (
        isNonEmptyString(claims.cid) &&
        isNonEmptyString(claims.ruri) &&
        (claims.st === null || typeof claims.st === 'string') &&
        isNonEmptyString(claims.cc) &&
        isNonEmptyString(claims.cb) &&
        isNonEmptyString(claims.nonce)
      )
    case 'mcp_consent':
      return (
        isNonEmptyString(claims.nonce) &&
        isNonEmptyString(claims.tm) &&
        isNonEmptyString(claims.cu) &&
        parseMcpProfile(claims.p) !== null &&
        typeof claims.name === 'string'
      )
    case 'mcp_actor':
      return isNonEmptyString(claims.tm) && isNonEmptyString(claims.cu) && parseMcpProfile(claims.p) !== null
  }
}

/**
 * Verify an envelope of the expected type. Null on any failure: bad shape,
 * bad signature, wrong `typ`, expired, issued in the future, or an unusable
 * secret. Callers treat null as "no identity", never as a partial one.
 */
export async function verifyIdentityEnvelope<T extends IdentityType>(
  token: string | null | undefined,
  secret: string | undefined | null,
  typ: T,
  now: number = nowSeconds(),
): Promise<ClaimsOf<T> | null> {
  if (!token || !isUsableIdentitySecret(secret)) return null
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [encoded, signature] = parts

  if (!safeEquals(signature, await hmac(encoded, secret))) return null

  const bytes = base64UrlToBytes(encoded)
  if (!bytes) return null
  let claims: unknown
  try {
    claims = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return null
  const record = claims as Record<string, unknown>

  if (record.typ !== typ) return null
  if (typeof record.iat !== 'number' || typeof record.exp !== 'number') return null
  if (!Number.isFinite(record.iat) || !Number.isFinite(record.exp)) return null
  if (record.exp <= now) return null
  if (record.iat > now + MAX_FUTURE_SKEW_SECONDS) return null
  if (!hasShape(record, typ)) return null

  return record as unknown as ClaimsOf<T>
}

/** Build the per-call actor envelope the worker forwards to the dashboard. */
export function actorClaims(
  identity: { tm: string; cu: string; p: McpProfile },
  now: number = nowSeconds(),
): ActorClaims {
  return { typ: 'mcp_actor', tm: identity.tm, cu: identity.cu, p: identity.p, iat: now, exp: now + ACTOR_TTL_SECONDS }
}

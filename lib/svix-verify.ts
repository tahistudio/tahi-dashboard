/**
 * lib/svix-verify.ts - Svix webhook signature verification, Web Crypto only.
 *
 * WHY HAND-ROLLED. Clerk signs its webhooks with Svix. The official `svix`
 * package is a Node library (it reaches for node:crypto and Buffer) and this
 * app runs on the Cloudflare Workers runtime, where neither exists. It is also
 * not in package.json and this task adds no dependency. The protocol is small
 * and fully specified, so it lives here instead:
 *
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64( HMAC-SHA256( signed content, key ) )
 *   key            = base64-decode( secret without its `whsec_` prefix )
 *   header         = space separated `v<version>,<base64>` pairs, e.g.
 *                    "v1,g0hM9S.. v1,bm9ldGhl.."
 *
 * A delivery is valid when ANY v1 signature in the header matches, and only
 * when the timestamp is inside the tolerance window (default five minutes),
 * which is what stops a captured-and-replayed delivery from being accepted
 * forever. Replay INSIDE the window is a separate concern, handled by the
 * svix-id ledger in lib/clerk-webhook.ts.
 *
 * Pure: no D1, no environment, no framework. The caller reads the secret and
 * the raw body and hands them over, so this file stays testable in a plain
 * node environment (see app/api/__tests__/clerk-webhook.test.ts).
 */

/** Svix's own default, and Clerk's: five minutes either side of now. */
export const SVIX_DEFAULT_TOLERANCE_SECONDS = 5 * 60

export interface SvixHeaders {
  id: string
  timestamp: string
  signature: string
}

export type SvixVerifyFailure =
  /** One of the three svix-* headers was absent or empty. */
  | 'missing_headers'
  /** The configured secret is not decodable base64 / is empty. */
  | 'malformed_secret'
  /** svix-timestamp was not an integer number of seconds. */
  | 'malformed_timestamp'
  /** The delivery is older or newer than the tolerance window. */
  | 'stale_timestamp'
  /** The header carried no `v1,...` pair we could compare. */
  | 'no_v1_signature'
  /** Every candidate signature failed to match. */
  | 'signature_mismatch'

export type SvixVerifyResult =
  | { ok: true }
  | { ok: false; reason: SvixVerifyFailure }

/**
 * Pull the three Svix headers off a request. Returns null when any is missing,
 * so the caller can answer 400 without inspecting each one.
 */
export function readSvixHeaders(headers: Headers): SvixHeaders | null {
  const id = headers.get('svix-id')?.trim()
  const timestamp = headers.get('svix-timestamp')?.trim()
  const signature = headers.get('svix-signature')?.trim()
  if (!id || !timestamp || !signature) return null
  return { id, timestamp, signature }
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/**
 * The raw HMAC key behind a `whsec_...` secret.
 *
 * Svix secrets are the literal string `whsec_` followed by base64. The prefix
 * is presentation only and is NOT part of the key: signing with it included
 * produces a signature that never matches, which is the classic way to get a
 * verifier that rejects every genuine delivery.
 */
export function decodeSvixSecret(secret: string): Uint8Array | null {
  const trimmed = secret.trim()
  if (!trimmed) return null
  const body = trimmed.startsWith('whsec_') ? trimmed.slice('whsec_'.length) : trimmed
  if (!body) return null
  const bytes = base64ToBytes(body)
  if (!bytes || bytes.length === 0) return null
  return bytes
}

/** Length-safe constant-time string comparison (mirrors the Xero webhook). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Every base64 signature the header offers under version v1.
 *
 * Svix may rotate keys, in which case one delivery carries several signatures.
 * Unknown versions are dropped rather than compared: a future v2 scheme is not
 * an HMAC-SHA256 of this content and matching it here would be meaningless.
 */
export function parseSvixSignatureHeader(header: string): string[] {
  return header
    .split(' ')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const comma = part.indexOf(',')
      if (comma < 0) return null
      const version = part.slice(0, comma)
      const value = part.slice(comma + 1)
      return version === 'v1' && value ? value : null
    })
    .filter((v): v is string => v !== null)
}

/** base64( HMAC-SHA256( `${id}.${timestamp}.${body}`, key ) ). */
async function signContent(key: Uint8Array, content: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    // BufferSource, so the exact byte view is passed rather than the whole
    // underlying buffer (Uint8Array from atob is exact, but be explicit).
    key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(content))
  return bytesToBase64(new Uint8Array(sig))
}

export interface SvixVerifyInput {
  headers: SvixHeaders
  /** The RAW request body, exactly as received. Never a re-serialised object. */
  body: string
  /** The `whsec_...` value from CLERK_WEBHOOK_SECRET. */
  secret: string
  /** Milliseconds since epoch. Injectable so the window is testable. */
  nowMs?: number
  toleranceSeconds?: number
}

/**
 * Verify a Svix-signed delivery. Never throws: every failure mode is a reason
 * the caller can turn into a status code and a log line.
 */
export async function verifySvixSignature(input: SvixVerifyInput): Promise<SvixVerifyResult> {
  const { headers, body, secret } = input
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing_headers' }
  }

  const key = decodeSvixSecret(secret)
  if (!key) return { ok: false, reason: 'malformed_secret' }

  // Integer seconds only. parseInt would happily read "12abc" as 12, so the
  // shape is checked before the value.
  if (!/^-?\d+$/.test(headers.timestamp)) {
    return { ok: false, reason: 'malformed_timestamp' }
  }
  const timestampMs = Number(headers.timestamp) * 1000
  const nowMs = input.nowMs ?? Date.now()
  const toleranceMs = (input.toleranceSeconds ?? SVIX_DEFAULT_TOLERANCE_SECONDS) * 1000
  if (Math.abs(nowMs - timestampMs) > toleranceMs) {
    return { ok: false, reason: 'stale_timestamp' }
  }

  const candidates = parseSvixSignatureHeader(headers.signature)
  if (candidates.length === 0) return { ok: false, reason: 'no_v1_signature' }

  const expected = await signContent(key, `${headers.id}.${headers.timestamp}.${body}`)

  // Compare against EVERY candidate, without short-circuiting on the first
  // match, so the work does not depend on which signature was the right one.
  let matched = false
  for (const candidate of candidates) {
    if (timingSafeEqual(candidate, expected)) matched = true
  }
  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' }
}

/**
 * Sign content the way Svix does. Exported for tests, which have to produce a
 * genuine delivery to prove the verifier accepts one; nothing in the app signs
 * an inbound webhook.
 */
export async function svixSignForTest(secret: string, content: string): Promise<string> {
  const key = decodeSvixSecret(secret)
  if (!key) throw new Error('svixSignForTest: undecodable secret')
  return signContent(key, content)
}

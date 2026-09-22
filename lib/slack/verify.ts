/**
 * lib/slack/verify.ts
 *
 * Slack request signing, which is the only thing between Slack's servers and
 * two routes that can decide work on a founder's behalf. There is no bearer
 * token on an inbound Slack delivery: the signature IS the authentication.
 *
 * Slack's v0 scheme, exactly:
 *   basestring = `v0:${x-slack-request-timestamp}:${rawBody}`
 *   signature  = `v0=` + hex( HMAC-SHA256( basestring, SLACK_SIGNING_SECRET ) )
 * compared against the `x-slack-signature` header, with the timestamp rejected
 * outside a five minute window so a captured delivery cannot be replayed.
 *
 * The RAW body matters: JSON.parse then re-stringify changes bytes and every
 * signature fails. Both routes therefore read `await req.text()` once and pass
 * that string here and to the parser.
 *
 * Web Crypto only (no Node `crypto`), because this runs on Workers.
 */

/** Slack's documented replay window. */
export const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 60 * 5

export type SlackVerifyFailure =
  /** The worker has no SLACK_SIGNING_SECRET. Our mistake, not Slack's. */
  | 'not_configured'
  /** One of the two headers is absent or unreadable. */
  | 'missing_headers'
  /** Outside the five minute window, in either direction. */
  | 'stale_timestamp'
  /** The body, the secret or both are not what was signed. */
  | 'bad_signature'

export type SlackVerifyResult = { ok: true } | { ok: false; reason: SlackVerifyFailure }

export interface SlackSignatureInput {
  /** The body exactly as it arrived, byte for byte. */
  rawBody: string
  timestamp: string | null
  signature: string | null
  signingSecret: string | null | undefined
  /** Injected in tests; defaults to now. */
  nowSeconds?: number
  toleranceSeconds?: number
}

/** Length-safe constant-time comparison (mirrors the Xero webhook). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  const bytes = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

/**
 * Verify one Slack delivery.
 *
 * The order is deliberate: configuration, then headers, then the clock, then
 * the hash. Checking the timestamp before hashing means a flood of replayed
 * deliveries costs no crypto, and it keeps the three refusals distinguishable
 * in tests while the routes answer all of them with the same 401.
 */
export async function verifySlackSignature(input: SlackSignatureInput): Promise<SlackVerifyResult> {
  const secret = input.signingSecret
  if (!secret) return { ok: false, reason: 'not_configured' }

  const { timestamp, signature } = input
  if (!timestamp || !signature) return { ok: false, reason: 'missing_headers' }

  const sent = Number(timestamp)
  if (!Number.isFinite(sent)) return { ok: false, reason: 'missing_headers' }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? SLACK_TIMESTAMP_TOLERANCE_SECONDS
  if (Math.abs(now - sent) > tolerance) return { ok: false, reason: 'stale_timestamp' }

  const expected = `v0=${await hmacHex(secret, `v0:${timestamp}:${input.rawBody}`)}`
  return timingSafeEqual(expected, signature) ? { ok: true } : { ok: false, reason: 'bad_signature' }
}

/** Route-side wrapper: reads Slack's two headers and the worker's secret. */
export async function verifySlackRequest(
  headers: Headers,
  rawBody: string,
  overrides: { signingSecret?: string | null; nowSeconds?: number } = {},
): Promise<SlackVerifyResult> {
  return verifySlackSignature({
    rawBody,
    timestamp: headers.get('x-slack-request-timestamp'),
    signature: headers.get('x-slack-signature'),
    signingSecret: overrides.signingSecret ?? process.env.SLACK_SIGNING_SECRET ?? null,
    nowSeconds: overrides.nowSeconds,
  })
}

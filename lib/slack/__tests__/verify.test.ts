/**
 * lib/slack/verify.ts, the only thing standing between Slack's servers and a
 * route that can decide work on a founder's behalf.
 *
 * What is pinned here:
 *
 *   THE SIGNATURE ITSELF, computed the way Slack computes it (v0 HMAC SHA-256
 *   over `v0:<timestamp>:<rawBody>`, hex, lower case), because a helper that
 *   hashes the parsed body or the wrong separator would accept nothing real
 *   and be discovered only after the app was installed.
 *
 *   THE THREE REFUSALS, separately: a wrong secret, a replayed timestamp and a
 *   missing header are different bugs and the route answers 401 to all three
 *   without saying which.
 *
 *   NOT CONFIGURED IS NOT UNAUTHORISED. A worker missing SLACK_SIGNING_SECRET
 *   is our mistake, not Slack's, and it has to read differently in the logs or
 *   the first install will look like a Slack problem for an hour.
 */
import { describe, it, expect } from 'vitest'
import { verifySlackSignature, verifySlackRequest, SLACK_TIMESTAMP_TOLERANCE_SECONDS } from '../verify'

const SECRET = 'shhh-signing-secret'
const BODY = '{"type":"event_callback","event_id":"Ev1"}'
const NOW = 1_760_000_000

/** Sign exactly as Slack does, so the test is not the implementation twice. */
async function sign(body: string, timestamp: number, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${timestamp}:${body}`))
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return `v0=${hex}`
}

describe('verifySlackSignature', () => {
  it('accepts a body signed with the shared secret', async () => {
    const result = await verifySlackSignature({
      rawBody: BODY,
      timestamp: String(NOW),
      signature: await sign(BODY, NOW, SECRET),
      signingSecret: SECRET,
      nowSeconds: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a signature made with a different secret', async () => {
    const result = await verifySlackSignature({
      rawBody: BODY,
      timestamp: String(NOW),
      signature: await sign(BODY, NOW, 'not-the-secret'),
      signingSecret: SECRET,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a body that changed after it was signed', async () => {
    const signature = await sign(BODY, NOW, SECRET)
    const result = await verifySlackSignature({
      rawBody: BODY.replace('Ev1', 'Ev2'),
      timestamp: String(NOW),
      signature,
      signingSecret: SECRET,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a replay older than the five minute window, before it hashes anything', async () => {
    const stale = NOW - SLACK_TIMESTAMP_TOLERANCE_SECONDS - 1
    const result = await verifySlackSignature({
      rawBody: BODY,
      timestamp: String(stale),
      signature: await sign(BODY, stale, SECRET),
      signingSecret: SECRET,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('rejects a timestamp from the future by the same window', async () => {
    const ahead = NOW + SLACK_TIMESTAMP_TOLERANCE_SECONDS + 1
    const result = await verifySlackSignature({
      rawBody: BODY,
      timestamp: String(ahead),
      signature: await sign(BODY, ahead, SECRET),
      signingSecret: SECRET,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'stale_timestamp' })
  })

  it('accepts a timestamp right on the edge of the window', async () => {
    const edge = NOW - SLACK_TIMESTAMP_TOLERANCE_SECONDS
    const result = await verifySlackSignature({
      rawBody: BODY,
      timestamp: String(edge),
      signature: await sign(BODY, edge, SECRET),
      signingSecret: SECRET,
      nowSeconds: NOW,
    })
    expect(result.ok).toBe(true)
  })

  it('refuses a missing header rather than treating it as an empty signature', async () => {
    const noSig = await verifySlackSignature({ rawBody: BODY, timestamp: String(NOW), signature: null, signingSecret: SECRET, nowSeconds: NOW })
    const noTs = await verifySlackSignature({ rawBody: BODY, timestamp: null, signature: 'v0=abc', signingSecret: SECRET, nowSeconds: NOW })
    expect(noSig).toEqual({ ok: false, reason: 'missing_headers' })
    expect(noTs).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('refuses a non-numeric timestamp', async () => {
    const result = await verifySlackSignature({ rawBody: BODY, timestamp: 'soon', signature: 'v0=abc', signingSecret: SECRET, nowSeconds: NOW })
    expect(result).toEqual({ ok: false, reason: 'missing_headers' })
  })

  it('says NOT CONFIGURED rather than unauthorised when the worker has no secret', async () => {
    const result = await verifySlackSignature({
      rawBody: BODY,
      timestamp: String(NOW),
      signature: await sign(BODY, NOW, SECRET),
      signingSecret: undefined,
      nowSeconds: NOW,
    })
    expect(result).toEqual({ ok: false, reason: 'not_configured' })
  })
})

describe('verifySlackRequest', () => {
  it('reads the two Slack headers off a real Headers object', async () => {
    const headers = new Headers({
      'x-slack-request-timestamp': String(NOW),
      'x-slack-signature': await sign(BODY, NOW, SECRET),
    })
    const result = await verifySlackRequest(headers, BODY, { signingSecret: SECRET, nowSeconds: NOW })
    expect(result.ok).toBe(true)
  })

  it('rejects when the headers are absent entirely', async () => {
    const result = await verifySlackRequest(new Headers(), BODY, { signingSecret: SECRET, nowSeconds: NOW })
    expect(result).toEqual({ ok: false, reason: 'missing_headers' })
  })
})

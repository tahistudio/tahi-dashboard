/**
 * Dynamic client registration (RFC 7591) on the MCP worker: stateless, answers
 * with the one static client id, every redirect_uri must pass the allowlist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import worker from '../../../workers/mcp-server/src/index'

const env = {
  TAHI_API_TOKEN: 'service-token',
  OAUTH_CLIENT_ID: 'static-cid',
  OAUTH_CLIENT_SECRET: 'super-secret-value-do-not-leak',
  OAUTH_TOKEN_SIGNING_KEY: 'token-signing-key-0123456789-abcdefghij',
  MCP_IDENTITY_SECRET: 'flow-identity-secret-0123456789-abcdef',
}
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'

let ipCounter = 0

function register(body: unknown, opts: { envOverride?: Record<string, unknown>; raw?: string } = {}) {
  ipCounter += 1
  const req = new Request('https://mcp.example/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `10.0.0.${ipCounter}` },
    body: opts.raw ?? JSON.stringify(body),
  })
  return worker.fetch(req, { ...env, ...(opts.envOverride ?? {}) } as never)
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /register', () => {
  it('returns the static client id for an allowed redirect', async () => {
    const res = await register({ redirect_uris: [REDIRECT], client_name: 'Claude' })
    expect(res.status).toBe(201)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.client_id).toBe('static-cid')
    expect(json.token_endpoint_auth_method).toBe('none')
    expect(json.grant_types).toEqual(['authorization_code', 'refresh_token'])
    expect(json.response_types).toEqual(['code'])
    expect(json.redirect_uris).toEqual([REDIRECT])
    expect(json.client_name).toBe('Claude')
  })

  it('sanitises and caps client_name', async () => {
    const res = await register({ redirect_uris: [REDIRECT], client_name: `<b>${'x'.repeat(500)}</b>` })
    const json = (await res.json()) as { client_name: string }
    expect(json.client_name).not.toContain('<')
    expect(json.client_name.length).toBeLessThanOrEqual(100)
  })

  it('rejects a redirect host that is not allowlisted', async () => {
    const res = await register({ redirect_uris: [REDIRECT, 'https://evil.example/cb'] })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_redirect_uri')
  })

  it('rejects missing, empty and non-array redirect_uris', async () => {
    for (const body of [{}, { redirect_uris: [] }, { redirect_uris: REDIRECT }, { redirect_uris: [42] }]) {
      const res = await register(body)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toBe('invalid_redirect_uri')
    }
  })

  it('rejects more than ten redirect_uris', async () => {
    const res = await register({ redirect_uris: Array.from({ length: 11 }, () => REDIRECT) })
    expect(res.status).toBe(400)
  })

  it('rejects an oversized body', async () => {
    const res = await register({ redirect_uris: [REDIRECT], client_name: 'x'.repeat(9000) })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client_metadata')
  })

  it('rejects non-JSON bodies', async () => {
    const res = await register(null, { raw: 'redirect_uris=abc' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client_metadata')
  })

  it('answers 503 when OAUTH_CLIENT_ID is unset', async () => {
    const res = await register({ redirect_uris: [REDIRECT] }, { envOverride: { OAUTH_CLIENT_ID: undefined } })
    expect(res.status).toBe(503)
  })

  it('never includes a secret in any response', async () => {
    const responses = [
      await register({ redirect_uris: [REDIRECT], client_secret: 'abc' }),
      await register({ redirect_uris: ['https://evil.example/cb'] }),
      await register({}),
      await register({ redirect_uris: [REDIRECT] }, { envOverride: { OAUTH_CLIENT_ID: undefined } }),
    ]
    for (const res of responses) {
      const text = await res.text()
      expect(text).not.toContain(env.OAUTH_CLIENT_SECRET)
      expect(text).not.toContain(env.OAUTH_TOKEN_SIGNING_KEY)
      expect(text).not.toContain(env.MCP_IDENTITY_SECRET)
      expect(text).not.toContain('client_secret')
    }
  })

  it('answers the CORS preflight', async () => {
    const res = await worker.fetch(new Request('https://mcp.example/register', { method: 'OPTIONS' }), env as never)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('throttles one source address', async () => {
    const hit = () =>
      worker.fetch(
        new Request('https://mcp.example/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
          body: JSON.stringify({ redirect_uris: [REDIRECT] }),
        }),
        env as never,
      )
    let last = 201
    for (let i = 0; i < 121; i++) last = (await hit()).status
    expect(last).toBe(429)
  })
})

describe('authorization server metadata', () => {
  it('advertises registration_endpoint', async () => {
    const res = await worker.fetch(new Request('https://mcp.example/.well-known/oauth-authorization-server'), env as never)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.registration_endpoint).toBe('https://mcp.example/register')
  })
})

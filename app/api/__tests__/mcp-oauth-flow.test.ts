/**
 * End to end through the MCP worker's fetch handler: Clerk consent hand-off,
 * code and token minting with identity, refresh re-check against the
 * dashboard, profile enforcement on tools/list and tools/call, and the
 * signed actor header on dashboard calls. The dashboard is a stubbed fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import worker, { TOOLS } from '../../../workers/mcp-server/src/index'
import {
  signIdentityEnvelope,
  verifyIdentityEnvelope,
  nowSeconds,
  MCP_ACTOR_HEADER,
  type McpProfile,
} from '@/lib/mcp-identity'

const SECRET = 'flow-identity-secret-0123456789-abcdef'
const env = {
  TAHI_API_TOKEN: 'service-token',
  OAUTH_CLIENT_ID: 'cid',
  OAUTH_CLIENT_SECRET: 'connector-client-secret',
  OAUTH_TOKEN_SIGNING_KEY: 'token-signing-key-0123456789-abcdefghij',
  MCP_IDENTITY_SECRET: SECRET,
}
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const VERIFIER = 'v'.repeat(64)

type Call = { url: string; init?: RequestInit }
let calls: Call[] = []
let identityAnswer: () => Response

function call(req: Request) {
  return worker.fetch(req, env as never)
}

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function consentCookie(res: Response): string {
  const set = res.headers.get('Set-Cookie') ?? ''
  return set.split(';')[0]
}

async function startAuthorize() {
  const url = new URL('https://mcp.example/authorize')
  url.search = new URLSearchParams({
    client_id: 'cid', redirect_uri: REDIRECT, response_type: 'code', state: 'st',
    code_challenge: await challenge(VERIFIER), code_challenge_method: 'S256',
  }).toString()
  return call(new Request(url))
}

async function consentFor(req: string, profile: McpProfile, nonceOverride?: string) {
  const claims = await verifyIdentityEnvelope(req, SECRET, 'mcp_consent_request')
  const now = nowSeconds()
  return signIdentityEnvelope({
    typ: 'mcp_consent', nonce: nonceOverride ?? claims!.nonce, tm: `tm-${profile}`, cu: `user-${profile}`,
    p: profile, name: profile === 'designer' ? 'Staci' : 'Liam', iat: now, exp: now + 120,
  }, SECRET)
}

async function connect(profile: McpProfile) {
  const start = await startAuthorize()
  const req = new URL(start.headers.get('Location')!).searchParams.get('req')!
  const cb = new URL('https://mcp.example/authorize/callback')
  cb.searchParams.set('req', req)
  cb.searchParams.set('assertion', await consentFor(req, profile))
  const back = await call(new Request(cb, { headers: { Cookie: consentCookie(start) } }))
  const code = new URL(back.headers.get('Location')!).searchParams.get('code')!
  const tokenRes = await call(new Request('https://mcp.example/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'cid', code_verifier: VERIFIER, redirect_uri: REDIRECT }).toString(),
  }))
  return (await tokenRes.json()) as { access_token: string; refresh_token: string }
}

function rpc(token: string, method: string, params?: Record<string, unknown>) {
  return call(new Request('https://mcp.example/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }))
}

function refresh(refreshToken: string) {
  return call(new Request('https://mcp.example/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'cid' }).toString(),
  }))
}

beforeEach(() => {
  calls = []
  identityAnswer = () => Response.json({ active: true, profile: 'designer', clerkUserId: 'user-designer', name: 'Staci' })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/api/admin/mcp/identity')) return identityAnswer()
    return Response.json({ ok: true })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('consent hand-off', () => {
  it('sends the browser to the dashboard with a signed request, minting nothing', async () => {
    const res = await startAuthorize()
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('Location')!)
    expect(location.origin + location.pathname).toBe('https://portal.tahi.studio/mcp/authorize')
    expect(location.searchParams.has('code')).toBe(false)
    const claims = await verifyIdentityEnvelope(location.searchParams.get('req'), SECRET, 'mcp_consent_request')
    expect(claims).toMatchObject({ cid: 'cid', ruri: REDIRECT, st: 'st', cb: 'https://mcp.example/authorize/callback' })
  })

  it('answers 503 when the token signing key is missing or short', async () => {
    const res = await worker.fetch(new Request('https://mcp.example/authorize?client_id=cid&redirect_uri=' + encodeURIComponent(REDIRECT) + '&code_challenge=x&code_challenge_method=S256'), { ...env, OAUTH_TOKEN_SIGNING_KEY: 'short' } as never)
    expect(res.status).toBe(503)
  })

  it('has dropped the client_credentials grant', async () => {
    const res = await call(new Request('https://mcp.example/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'cid', client_secret: env.OAUTH_CLIENT_SECRET }).toString(),
    }))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('unsupported_grant_type')
  })

  it('answers 503 rather than consenting when the identity secret is missing', async () => {
    const res = await worker.fetch(new Request('https://mcp.example/authorize?client_id=cid&redirect_uri=' + encodeURIComponent(REDIRECT) + '&code_challenge=x&code_challenge_method=S256'), { ...env, MCP_IDENTITY_SECRET: '' } as never)
    expect(res.status).toBe(503)
  })

  it('still refuses a callback host that is not allowlisted', async () => {
    const res = await call(new Request('https://mcp.example/authorize?client_id=cid&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&code_challenge=x&code_challenge_method=S256'))
    expect(res.status).toBe(400)
  })

  it('mints a code bound to the approving person and returns state', async () => {
    const start = await startAuthorize()
    const req = new URL(start.headers.get('Location')!).searchParams.get('req')!
    const cb = new URL('https://mcp.example/authorize/callback')
    cb.searchParams.set('req', req)
    cb.searchParams.set('assertion', await consentFor(req, 'designer'))
    const res = await call(new Request(cb, { headers: { Cookie: consentCookie(start) } }))
    const back = new URL(res.headers.get('Location')!)
    expect(back.origin + back.pathname).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('st')
    expect(back.searchParams.get('code')).toBeTruthy()
  })

  it('sets a host-only, http-only consent cookie bound to the request', async () => {
    const res = await startAuthorize()
    const set = res.headers.get('Set-Cookie') ?? ''
    expect(set).toMatch(/^__Host-tahi_mcp_consent=/)
    expect(set).toContain('HttpOnly')
    expect(set).toContain('Secure')
    expect(set).toContain('Path=/')
  })

  it('refuses a valid approval returned to a browser that did not start the flow', async () => {
    const start = await startAuthorize()
    const req = new URL(start.headers.get('Location')!).searchParams.get('req')!
    const cb = new URL('https://mcp.example/authorize/callback')
    cb.searchParams.set('req', req)
    cb.searchParams.set('assertion', await consentFor(req, 'full'))
    expect((await call(new Request(cb))).status).toBe(400)
    const other = await startAuthorize()
    expect((await call(new Request(cb, { headers: { Cookie: consentCookie(other) } }))).status).toBe(400)
  })

  it('refuses an assertion made for a different request (nonce mismatch)', async () => {
    const start = await startAuthorize()
    const req = new URL(start.headers.get('Location')!).searchParams.get('req')!
    const cb = new URL('https://mcp.example/authorize/callback')
    cb.searchParams.set('req', req)
    cb.searchParams.set('assertion', await consentFor(req, 'full', 'some-other-nonce'))
    const res = await call(new Request(cb, { headers: { Cookie: consentCookie(start) } }))
    expect(res.status).toBe(400)
    expect(res.headers.get('Location')).toBeNull()
  })

  it('refuses an assertion signed with another secret', async () => {
    const start = await startAuthorize()
    const req = new URL(start.headers.get('Location')!).searchParams.get('req')!
    const claims = await verifyIdentityEnvelope(req, SECRET, 'mcp_consent_request')
    const now = nowSeconds()
    const forged = await signIdentityEnvelope({ typ: 'mcp_consent', nonce: claims!.nonce, tm: 't', cu: 'u', p: 'full', name: 'x', iat: now, exp: now + 60 }, 'attacker-secret-0123456789-0123456789')
    const cb = new URL('https://mcp.example/authorize/callback')
    cb.searchParams.set('req', req)
    cb.searchParams.set('assertion', forged)
    expect((await call(new Request(cb, { headers: { Cookie: consentCookie(start) } }))).status).toBe(400)
  })

  it('passes a cancel back to the client as access_denied', async () => {
    const start = await startAuthorize()
    const req = new URL(start.headers.get('Location')!).searchParams.get('req')!
    const res = await call(new Request(`https://mcp.example/authorize/callback?req=${encodeURIComponent(req)}&error=access_denied`, { headers: { Cookie: consentCookie(start) } }))
    const back = new URL(res.headers.get('Location')!)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.has('code')).toBe(false)
  })

  it('has retired the shared approval key form', async () => {
    const res = await call(new Request('https://mcp.example/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'approval_key=anything',
    }))
    expect(res.status).toBe(410)
  })
})

describe('designer session', () => {
  it('initialize carries the designer instructions', async () => {
    const { access_token } = await connect('designer')
    const body = (await (await rpc(access_token, 'initialize')).json()) as { result: { instructions: string } }
    expect(body.result.instructions).toContain('Staci')
    expect(body.result.instructions).toContain('hand_off_to_developer')
  })

  it('tools/list hides billing writes and keeps tasks', async () => {
    const { access_token } = await connect('designer')
    const body = (await (await rpc(access_token, 'tools/list')).json()) as { result: { tools: { name: string }[] } }
    const names = body.result.tools.map((t) => t.name)
    expect(names).toContain('create_task')
    expect(names).toContain('get_bank_balances')
    expect(names).not.toContain('create_invoice')
    expect(names).not.toContain('update_settings')
  })

  it('tools/call refuses a blocked tool without touching the dashboard', async () => {
    const { access_token } = await connect('designer')
    const body = (await (await rpc(access_token, 'tools/call', { name: 'create_invoice', arguments: { orgId: 'o' } })).json()) as { result: { isError: boolean } }
    expect(body.result.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('portal_send_message (writing as a client) is hidden and refused', async () => {
    const { access_token } = await connect('designer')
    const list = (await (await rpc(access_token, 'tools/list')).json()) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).not.toContain('portal_send_message')
    const res = (await (await rpc(access_token, 'tools/call', { name: 'portal_send_message', arguments: { orgId: 'o', body: 'x', confirmed: true } })).json()) as { result: { isError: boolean } }
    expect(res.result.isError).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('tools/call refuses an unconfirmed client message, then sends once confirmed without the flag', async () => {
    const { access_token } = await connect('designer')
    const refused = (await (await rpc(access_token, 'tools/call', { name: 'post_request_message', arguments: { requestId: 'r1', content: 'Hello' } })).json()) as { result: { isError: boolean } }
    expect(refused.result.isError).toBe(true)
    expect(calls).toHaveLength(0)

    await rpc(access_token, 'tools/call', { name: 'post_request_message', arguments: { requestId: 'r1', content: 'Hello', confirmed: 'true' } })
    expect(calls).toHaveLength(1)
    expect(String(calls[0].init?.body)).not.toContain('confirmed')
  })

  it('forwards the service bearer plus a signed actor naming the person', async () => {
    const { access_token } = await connect('designer')
    await rpc(access_token, 'tools/call', { name: 'update_task', arguments: { taskId: 't1', title: 'New' } })
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer service-token')
    const actor = await verifyIdentityEnvelope(headers[MCP_ACTOR_HEADER], SECRET, 'mcp_actor')
    expect(actor).toMatchObject({ tm: 'tm-designer', cu: 'user-designer', p: 'designer' })
  })
})

describe('path traversal through arguments (security review H1)', () => {
  const hostile = ['../invoices/INV1', '..', 'abc?', '%2e%2e', 'a/b', 'x#y', 'a\\b']

  it('refuses every tool with an id argument, on both profiles, before any dashboard call', async () => {
    for (const profile of ['full', 'designer'] as const) {
      const { access_token } = await connect(profile)
      for (const tool of TOOLS) {
        const props = Object.keys(tool.inputSchema.properties ?? {}).filter((k) => /(^id$|Id$|_id$)/.test(k))
        if (props.length === 0) continue
        for (const bad of hostile) {
          calls = []
          const args: Record<string, unknown> = { confirmed: true }
          for (const key of props) args[key] = bad
          const body = (await (await rpc(access_token, 'tools/call', { name: tool.name, arguments: args })).json()) as { result: { isError?: boolean } }
          expect(body.result.isError, `${profile} ${tool.name} ${bad}`).toBe(true)
          expect(calls, `${profile} ${tool.name} ${bad}`).toHaveLength(0)
        }
      }
    }
  }, 120_000)
})

describe('designer time entries', () => {
  it('are pinned to the person and never carry a rate or billable flag', async () => {
    const { access_token } = await connect('designer')
    await rpc(access_token, 'tools/call', { name: 'log_time_entry', arguments: { requestId: 'r1', hours: 2, teamMemberId: 'tm-someone-else', hourlyRate: 500, billable: false, sneaky: 'x' } })
    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    expect(sent.teamMemberId).toBe('tm-designer')
    expect(sent).not.toHaveProperty('hourlyRate')
    expect(sent).not.toHaveProperty('billable')
    expect(sent).not.toHaveProperty('sneaky')
  })
})

describe('full session', () => {
  it('lists every tool and calls a billing write', async () => {
    const { access_token } = await connect('full')
    const list = (await (await rpc(access_token, 'tools/list')).json()) as { result: { tools: { name: string }[] } }
    expect(list.result.tools.map((t) => t.name)).toContain('create_invoice')
    const res = (await (await rpc(access_token, 'tools/call', { name: 'get_overview', arguments: {} })).json()) as { result: { isError?: boolean } }
    expect(res.result.isError).toBeUndefined()
  })
})

describe('refresh', () => {
  it('re-checks the person and rotates both tokens', async () => {
    const { refresh_token } = await connect('designer')
    const res = await refresh(refresh_token)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { access_token: string; refresh_token: string }
    expect(body.refresh_token).toBeTruthy()
    const check = calls.find((c) => c.url.includes('/api/admin/mcp/identity'))
    expect(check?.url).toContain('teamMemberId=tm-designer')
    expect((check?.init?.headers as Record<string, string>).Authorization).toBe('Bearer service-token')
  })

  it.each([
    ['inactive', { active: false, profile: null, clerkUserId: 'user-designer', name: 'Staci' }],
    ['profile changed', { active: true, profile: 'full', clerkUserId: 'user-designer', name: 'Staci' }],
    ['login changed', { active: true, profile: 'designer', clerkUserId: 'user-other', name: 'Staci' }],
  ])('refuses with invalid_grant when %s', async (_label, answer) => {
    const { refresh_token } = await connect('designer')
    identityAnswer = () => Response.json(answer)
    const res = await refresh(refresh_token)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant')
  })

  it.each([502, 404, 403, 429])('answers 503 (keep the refresh token) when the identity check returns %s', async (status) => {
    const { refresh_token } = await connect('designer')
    identityAnswer = () => new Response('nope', { status })
    expect((await refresh(refresh_token)).status).toBe(503)
  })
})

describe('retired tokens', () => {
  it('refuses an identity-less access token from the shared-key era', async () => {
    const now = Math.floor(Date.now() / 1000)
    const payload = btoa(JSON.stringify({ sub: 'cid', iat: now, exp: now + 3600, type: 'access_token' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.OAUTH_TOKEN_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
    const legacy = `${payload}.${btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
    expect((await rpc(legacy, 'tools/list')).status).toBe(401)
  })
})

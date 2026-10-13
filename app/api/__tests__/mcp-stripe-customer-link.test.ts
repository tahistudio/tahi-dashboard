import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { executeTool, TOOLS } from '../../../workers/mcp-server/src/index'
import { DESIGNER_BLOCKED_TOOLS, DESIGNER_CONFIRM_TOOLS, DESIGNER_READ_TOOLS, DESIGNER_WRITE_TOOLS, classifyTool } from '../../../workers/mcp-server/src/tool-profiles'
import { isDesignerRequestAllowed } from '@/lib/mcp-designer-routes'

const env = {
  TAHI_API_TOKEN: 'qa-dashboard-token', OAUTH_CLIENT_ID: 'qa-connector',
  OAUTH_TOKEN_SIGNING_KEY: 'qa-only-token-signing-key-0123456789',
  MCP_IDENTITY_SECRET: 'qa-only-identity-secret-0123456789-abc',
}
const fetchMock = vi.fn<typeof fetch>()

async function profileToken(profile: 'full' | 'designer') {
  const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    sub: env.OAUTH_CLIENT_ID, iat: now, exp: now + 3600, type: 'access_token',
    tm: profile === 'full' ? 'tm_liam' : 'tm_staci', cu: profile === 'full' ? 'user_liam' : 'user_staci',
    p: profile, name: profile === 'full' ? 'Liam' : 'Staci',
  })))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.OAUTH_TOKEN_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  return `${payload}.${b64url(signature)}`
}

async function rpc(profile: 'full' | 'designer', method: string, params?: Record<string, unknown>) {
  return worker.fetch(new Request('https://mcp.example.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await profileToken(profile)}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), env)
}

async function call(args: Record<string, unknown>, profile: 'full' | 'designer' = 'full') {
  const response = await rpc(profile, 'tools/call', { name: 'link_stripe_customer', arguments: args })
  return await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({ dryRun: true, previewKey: 'signed-preview' }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('MCP Stripe customer linking classification and schema', () => {
  it('declares customer and organisation ids plus preview/apply arguments', async () => {
    const response = await rpc('full', 'tools/list')
    const payload = await response.json() as { result: { tools: typeof TOOLS } }
    const tool = payload.result.tools.find(tool => tool.name === 'link_stripe_customer')
    expect(tool?.inputSchema.required).toEqual(['orgId', 'stripeCustomerId'])
    expect(tool?.inputSchema.properties).toMatchObject({
      orgId: { type: 'string' }, stripeCustomerId: { type: 'string' }, dryRun: { type: 'boolean' }, previewKey: { type: 'string' },
    })
    expect(tool?.description).toContain('super_admin')
    expect(tool?.description).toContain('403 by design')
  })

  it('explicitly blocks this money action in the designer classification and dashboard route list', () => {
    expect(DESIGNER_BLOCKED_TOOLS.has('link_stripe_customer')).toBe(true)
    expect(classifyTool('link_stripe_customer', 'designer')).toBe('blocked')
    expect(classifyTool('link_stripe_customer', 'full')).toBe('write')
    expect(isDesignerRequestAllowed('POST', '/api/admin/integrations/stripe/link-customer')).toBe(false)
    for (const name of DESIGNER_BLOCKED_TOOLS) {
      expect(TOOLS.some(tool => tool.name === name)).toBe(true)
      for (const allowed of [DESIGNER_READ_TOOLS, DESIGNER_WRITE_TOOLS, DESIGNER_CONFIRM_TOOLS]) expect(allowed.has(name)).toBe(false)
    }
  })

  it('hides the tool and refuses calls for the designer even with confirmation', async () => {
    const response = await rpc('designer', 'tools/list')
    const payload = await response.json() as { result: { tools: typeof TOOLS } }
    expect(payload.result.tools.some(tool => tool.name === 'link_stripe_customer')).toBe(false)
    const result = await call({ orgId: 'org-a', stripeCustomerId: 'cus_QA', dryRun: false, confirmed: true }, 'designer')
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0].text).toContain('not available on the designer profile')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('MCP Stripe customer linking actual dispatch', () => {
  it('defaults to preview and forwards no undeclared write arguments', async () => {
    await call({ orgId: 'org-a', stripeCustomerId: 'cus_QA', unrelated: 'ignored' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://portal.tahi.studio/api/admin/integrations/stripe/link-customer')
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: `Bearer ${env.TAHI_API_TOKEN}` } })
    expect(JSON.parse(String(init?.body))).toEqual({ orgId: 'org-a', stripeCustomerId: 'cus_QA', dryRun: true })
  })

  it('coerces a connector boolean and passes the signed preview unchanged', async () => {
    await call({ orgId: 'org-a', stripeCustomerId: 'cus_QA', dryRun: 'false', previewKey: 'signed-preview' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      orgId: 'org-a', stripeCustomerId: 'cus_QA', dryRun: false, previewKey: 'signed-preview',
    })
  })

  it.each(['orgId', 'stripeCustomerId'])('validates %s with the path safety helper even for direct dispatch', async argument => {
    await expect(executeTool('link_stripe_customer', {
      orgId: 'org-a', stripeCustomerId: 'cus_QA', [argument]: '../other?write=1',
    }, { bearer: 'qa-token', actor: null }, { token: 'qa-mr', baseUrl: 'https://mr.example/api/v1' })).rejects.toThrow(`${argument} is not a valid id`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['orgId', 'stripeCustomerId'])('refuses missing %s before building a request', async argument => {
    const args: Record<string, unknown> = { orgId: 'org-a', stripeCustomerId: 'cus_QA' }
    delete args[argument]
    const result = await call(args)
    expect(result.result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the super-admin service refusal without retrying or widening authorization', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Linking a Stripe customer requires a super admin.' }, { status: 403 }))
    const result = await call({ orgId: 'org-a', stripeCustomerId: 'cus_QA' })
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0].text).toContain('super admin')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { executeTool, TOOLS } from '../../../workers/mcp-server/src/index'
import { DESIGNER_BLOCKED_TOOLS, classifyTool } from '../../../workers/mcp-server/src/tool-profiles'
import { isDesignerRequestAllowed } from '@/lib/mcp-designer-routes'

const env = {
  TAHI_API_TOKEN: 'qa-dashboard-token', OAUTH_CLIENT_ID: 'qa-connector',
  OAUTH_TOKEN_SIGNING_KEY: 'qa-only-token-signing-key-0123456789',
  MCP_IDENTITY_SECRET: 'qa-only-identity-secret-0123456789-abc',
}
const fetchMock = vi.fn<typeof fetch>()

async function rpc(profile: 'full' | 'designer', method: string, params?: Record<string, unknown>) {
  const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    sub: env.OAUTH_CLIENT_ID, iat: now, exp: now + 3600, type: 'access_token',
    tm: profile === 'full' ? 'tm_liam' : 'tm_staci', cu: profile === 'full' ? 'user_liam' : 'user_staci',
    p: profile, name: profile === 'full' ? 'Liam' : 'Staci',
  })))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.OAUTH_TOKEN_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  return worker.fetch(new Request('https://mcp.example.test/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${payload}.${b64url(signature)}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), env)
}

async function call(args: Record<string, unknown>, profile: 'full' | 'designer' = 'full') {
  const response = await rpc(profile, 'tools/call', { name: 'confirm_xero_contact', arguments: args })
  return await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('MCP Xero contact confirmation parity', () => {
  it('declares and requires both identity arguments', () => {
    const tool = TOOLS.find(tool => tool.name === 'confirm_xero_contact')
    expect(tool?.inputSchema.required).toEqual(['orgId', 'contactId'])
    expect(tool?.inputSchema.properties).toMatchObject({ orgId: { type: 'string' }, contactId: { type: 'string' } })
  })

  it('classifies this money write as blocked for the designer at both layers', () => {
    expect(DESIGNER_BLOCKED_TOOLS.has('confirm_xero_contact')).toBe(true)
    expect(classifyTool('confirm_xero_contact', 'designer')).toBe('blocked')
    expect(classifyTool('confirm_xero_contact', 'full')).toBe('write')
    expect(isDesignerRequestAllowed('PATCH', '/api/admin/integrations/xero/match-contacts')).toBe(false)
  })

  it('hides and refuses the tool for the designer even with confirmation', async () => {
    const response = await rpc('designer', 'tools/list')
    const payload = await response.json() as { result: { tools: typeof TOOLS } }
    expect(payload.result.tools.some(tool => tool.name === 'confirm_xero_contact')).toBe(false)
    const result = await call({ orgId: 'org-a', contactId: 'contact-a', confirmed: true }, 'designer')
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0].text).toContain('not available on the designer profile')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('PATCHes the existing confirmation route with only the expected fields', async () => {
    const result = await call({ orgId: 'org-a', contactId: 'contact-a', unrelated: 'ignored' })
    expect(result.result.isError).not.toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://portal.tahi.studio/api/admin/integrations/xero/match-contacts')
    expect(init).toMatchObject({ method: 'PATCH', headers: { Authorization: `Bearer ${env.TAHI_API_TOKEN}` } })
    expect(JSON.parse(String(init?.body))).toEqual({ orgId: 'org-a', xeroContactId: 'contact-a' })
  })

  it.each(['orgId', 'contactId'])('validates %s even for direct dispatch', async argument => {
    await expect(executeTool('confirm_xero_contact', {
      orgId: 'org-a', contactId: 'contact-a', [argument]: '../other?write=1',
    }, { bearer: 'qa-token', actor: null }, { token: 'qa-mr', baseUrl: 'https://mr.example/api/v1' })).rejects.toThrow(`${argument} is not a valid id`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['orgId', 'contactId'])('refuses missing %s without a request', async argument => {
    const args: Record<string, unknown> = { orgId: 'org-a', contactId: 'contact-a' }
    delete args[argument]
    const result = await call(args)
    expect(result.result.isError).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a contact collision without retrying', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'This Xero contact is already linked to another client.' }, { status: 409 }))
    const result = await call({ orgId: 'org-a', contactId: 'contact-a' })
    expect(result.result.isError).toBe(true)
    expect(result.result.content[0].text).toContain('already linked to another client')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

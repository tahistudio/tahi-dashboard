import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { TOOLS } from '../../../workers/mcp-server/src/index'

const env = {
  TAHI_API_TOKEN: 'qa-dashboard-token', OAUTH_CLIENT_ID: 'qa-connector',
  OAUTH_TOKEN_SIGNING_KEY: 'qa-only-token-signing-key-0123456789',
  MCP_IDENTITY_SECRET: 'qa-only-identity-secret-0123456789-abc',
}

/**
 * A full-profile access token, signed the way the worker signs them. The
 * client_credentials grant this spec used to call is gone (Decision #070):
 * every session names a person.
 */
async function fullProfileToken(): Promise<string> {
  const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const now = Math.floor(Date.now() / 1000)
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    sub: env.OAUTH_CLIENT_ID, iat: now, exp: now + 3600, type: 'access_token',
    tm: 'tm-liam', cu: 'user_liam', p: 'full', name: 'Liam',
  })))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.OAUTH_TOKEN_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))
  return `${payload}.${b64url(sig)}`
}
const fetchMock = vi.fn<typeof fetch>()
let accessToken: string

async function rpc(method: string, params?: Record<string, unknown>) {
  return worker.fetch(new Request('https://mcp.example.test/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }), env)
}

beforeEach(async () => {
  fetchMock.mockReset()
  // Every outbound request stays in this spy, including unexpected paths.
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'invoice-qa', number: 'INV-QA' }), {
    headers: { 'Content-Type': 'application/json' },
  }))
  accessToken = await fullProfileToken()
})

afterEach(() => vi.unstubAllGlobals())

describe('MCP create_invoice actual tool schema', () => {
  it('requires orgId and non-empty structured lineItems instead of obsolete USD totals', async () => {
    const response = await rpc('tools/list')
    expect(response.status).toBe(200)
    const payload = await response.json() as { result: { tools: typeof TOOLS } }
    const tool = payload.result.tools.find(tool => tool.name === 'create_invoice')
    expect(tool).toBeDefined()
    expect(tool?.inputSchema.required).toEqual(['orgId', 'lineItems'])
    const properties = tool!.inputSchema.properties
    expect(properties).not.toHaveProperty('amountUsd')
    expect(properties).not.toHaveProperty('totalUsd')
    expect(properties.lineItems).toMatchObject({
      type: 'array', minItems: 1,
      items: {
        type: 'object', required: ['description', 'quantity', 'unitAmount'], additionalProperties: false,
        properties: { description: { type: 'string' }, quantity: { type: 'number' }, unitAmount: { type: 'number' } },
      },
    })
    expect(properties.currency).toMatchObject({ type: 'string', enum: ['NZD', 'USD', 'AUD', 'GBP', 'EUR'] })
    expect(properties.source).toMatchObject({ type: 'string', enum: ['manual', 'stripe', 'xero'] })
    expect(properties.subscriptionId).toMatchObject({ type: 'string' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('MCP create_invoice actual worker dispatch', () => {
  const items = [{ description: 'QA work', quantity: 2, unitAmount: 125.5 }]

  it('POSTs currency-denominated items unchanged to the invoice route and returns its id/number', async () => {
    const args = {
      orgId: 'org-qa', lineItems: items, currency: 'AUD', source: 'manual',
      subscriptionId: 'sub-qa', notes: 'QA draft', dueDate: '2026-10-31',
    }
    const response = await rpc('tools/call', { name: 'create_invoice', arguments: args })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://portal.tahi.studio/api/admin/invoices')
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: `Bearer ${env.TAHI_API_TOKEN}` } })
    expect(JSON.parse(String(init?.body))).toEqual(args)
    const payload = await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } }
    expect(payload.result.isError).not.toBe(true)
    expect(JSON.parse(payload.result.content[0].text)).toEqual({ id: 'invoice-qa', number: 'INV-QA' })
  })

  it('coerces a connector JSON string into the lineItems array using the newly declared schema', async () => {
    await rpc('tools/call', { name: 'create_invoice', arguments: { orgId: 'org-qa', lineItems: JSON.stringify(items) } })
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body).toEqual({ orgId: 'org-qa', lineItems: items })
    expect(body).not.toHaveProperty('currency')
    expect(body).not.toHaveProperty('source')
  })

  it('forwards draft rail intent without calling Stripe or Xero itself', async () => {
    await rpc('tools/call', { name: 'create_invoice', arguments: { orgId: 'org-qa', lineItems: items, source: 'stripe' } })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://portal.tahi.studio/api/admin/invoices')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ source: 'stripe' })
  })

  it('reports an API validation failure as an MCP tool error', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'lineItems must be a non-empty array' }), { status: 400 }))
    const response = await rpc('tools/call', { name: 'create_invoice', arguments: { orgId: 'org-qa', lineItems: [] } })
    const payload = await response.json() as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(payload.result.isError).toBe(true)
    expect(payload.result.content[0].text).toContain('lineItems must be a non-empty array')
  })
})

/**
 * Unit tests for the /api/mcp POST auth gate.
 *
 * The handler proxies tools/call to /api/admin/* with the server's own
 * TAHI_API_TOKEN, so it must reject any caller that is not the Tahi admin
 * (Clerk session or Bearer TAHI_API_TOKEN, both resolved by getRequestAuth).
 * Rejections keep the JSON-RPC error shape and echo the request id when the
 * body is parseable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) =>
    !!(process.env.NEXT_PUBLIC_TAHI_ORG_ID && orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID),
}))

import { POST } from '@/app/api/mcp/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'

function makeRequest(body: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

function mockAuth(orgId: string | null) {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: orgId ? 'user_1' : null, orgId, sessionId: null })
}

describe('POST /api/mcp auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  })

  it('rejects unauthenticated callers with a JSON-RPC error echoing the id', async () => {
    mockAuth(null)
    const res = await POST(makeRequest(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })))
    expect(res.status).toBe(403)
    const json = await res.json() as { jsonrpc: string; id: unknown; error: { code: number; message: string } }
    expect(json.jsonrpc).toBe('2.0')
    expect(json.id).toBe(7)
    expect(json.error.code).toBe(-32001)
    expect(json.error.message).toBe('Unauthorized')
  })

  it('rejects non-Tahi org callers', async () => {
    mockAuth('org_client')
    const res = await POST(makeRequest(JSON.stringify({ jsonrpc: '2.0', id: 'abc', method: 'tools/call', params: { name: 'list_clients' } })))
    expect(res.status).toBe(403)
    const json = await res.json() as { id: unknown; error: { code: number } }
    expect(json.id).toBe('abc')
    expect(json.error.code).toBe(-32001)
  })

  it('rejects unauthenticated callers with an unparseable body (null id)', async () => {
    mockAuth(null)
    const res = await POST(makeRequest('not json'))
    expect(res.status).toBe(403)
    const json = await res.json() as { id: unknown; error: { code: number } }
    expect(json.id).toBeNull()
    expect(json.error.code).toBe(-32001)
  })

  it('serves initialize and tools/list to the Tahi admin', async () => {
    mockAuth('org_tahi')
    const init = await POST(makeRequest(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })))
    expect(init.status).toBe(200)
    const initJson = await init.json() as { result: { serverInfo: { name: string } } }
    expect(initJson.result.serverInfo.name).toBe('Tahi Dashboard MCP Server')

    const list = await POST(makeRequest(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })))
    expect(list.status).toBe(200)
    const listJson = await list.json() as { result: { tools: { name: string }[] } }
    expect(listJson.result.tools.length).toBeGreaterThan(0)
  })
})

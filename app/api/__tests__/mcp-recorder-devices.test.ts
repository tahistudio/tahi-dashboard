import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOLS, executeTool } from '../../../workers/mcp-server/src/index'
import { assertSafeIdArgs } from '../../../workers/mcp-server/src/path-safety'
import { DESIGNER_BLOCKED_TOOLS, classifyTool, gateToolCall, toolsForProfile } from '../../../workers/mcp-server/src/tool-profiles'
import { isDesignerRequestAllowed } from '@/lib/mcp-designer-routes'

const credentials = { bearer: 'test-service-token', actor: 'test-signed-actor' }
const manyRequests = { token: 'unused', baseUrl: 'https://old.example/api/v1' }

function interceptedCalls() {
  const calls: { url: URL; method: string; headers: Headers; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined })
    return Response.json({ items: [] })
  }))
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('recorder device MCP access', () => {
  it.each(['list_recorder_devices', 'revoke_recorder_device'])('explicitly blocks %s for designers even with confirmation', name => {
    expect(DESIGNER_BLOCKED_TOOLS.has(name)).toBe(true)
    expect(classifyTool(name, 'designer')).toBe('blocked')
    expect(gateToolCall(name, { deviceId: 'device-1', confirmed: true }, 'designer', 'Staci').ok).toBe(false)
    expect(toolsForProfile(TOOLS, 'designer').some(tool => tool.name === name)).toBe(false)
    expect(gateToolCall(name, { deviceId: 'device-1' }, 'full', 'Liam').ok).toBe(true)
  })

  it('keeps pairing exclusive to the signed-in Settings flow', () => {
    expect(TOOLS.some(tool => /pair.*recorder|recorder.*pair/.test(tool.name))).toBe(false)
    expect(isDesignerRequestAllowed('POST', '/api/admin/recorder-devices/device-1/revoke')).toBe(false)
    expect(isDesignerRequestAllowed('POST', '/api/admin/recorder-devices/pairing-code')).toBe(false)
  })
})

describe('recorder device MCP dispatch', () => {
  it('lists only through the own-account management endpoint with the signed actor envelope', async () => {
    const calls = interceptedCalls()
    await executeTool('list_recorder_devices', {}, credentials, manyRequests)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/api/admin/recorder-devices')
    expect(calls[0].method).toBe('GET')
    expect(calls[0].headers.get('Authorization')).toBe('Bearer test-service-token')
    expect([...calls[0].headers.values()]).toContain('test-signed-actor')
  })

  it('revokes the explicitly named device and drops unrelated arguments', async () => {
    const calls = interceptedCalls()
    const definition = TOOLS.find(tool => tool.name === 'revoke_recorder_device')
    expect(definition?.inputSchema.required).toEqual(['deviceId'])
    expect(definition?.inputSchema.properties).toMatchObject({ deviceId: { type: 'string' } })
    await executeTool('revoke_recorder_device', { deviceId: 'device-1', teamMemberId: 'someone-else' }, credentials, manyRequests)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/api/admin/recorder-devices/device-1/revoke')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({})
    expect([...calls[0].headers.values()]).toContain('test-signed-actor')
  })

  it.each(['../other', 'device/revoke', 'device?x=1', '%2e%2e', ''])('refuses unsafe or absent device id %j before dispatch', async deviceId => {
    const calls = interceptedCalls()
    if (deviceId) expect(() => assertSafeIdArgs({ deviceId })).toThrow()
    await expect(executeTool('revoke_recorder_device', { deviceId }, credentials, manyRequests)).rejects.toThrow()
    expect(calls).toEqual([])
  })
})

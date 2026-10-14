import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOLS, executeTool } from '../../../workers/mcp-server/src/index'
import { coerceArgs } from '../../../workers/mcp-server/src/coerce'
import { assertSafeIdArgs } from '../../../workers/mcp-server/src/path-safety'
import { classifyTool, gateToolCall, toolsForProfile } from '../../../workers/mcp-server/src/tool-profiles'
import { isDesignerRequestAllowed } from '@/lib/mcp-designer-routes'

const credentials = { bearer: 'test-service-token', actor: 'test-signed-actor' }
const manyRequests = { token: 'unused', baseUrl: 'https://old.example/api/v1' }

interface DashboardCall {
  url: URL
  method: string
  headers: Headers
  body: unknown
}

function interceptedCalls(): DashboardCall[] {
  const calls: DashboardCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined,
    })
    return Response.json({ ok: true })
  }))
  return calls
}

function definition(name: string) {
  const found = TOOLS.find(tool => tool.name === name)
  if (!found) throw new Error(`Missing tool ${name}`)
  return found
}

afterEach(() => vi.unstubAllGlobals())

describe('manual call recording MCP profiles', () => {
  it.each(['list_meeting_recordings', 'get_meeting_recording'])('allows designer reads through %s', name => {
    expect(classifyTool(name, 'designer')).toBe('read')
    expect(gateToolCall(name, { id: 'rec-1' }, 'designer', 'Staci').ok).toBe(true)
    expect(toolsForProfile(TOOLS, 'designer').some(tool => tool.name === name)).toBe(true)
  })

  it('keeps recording links blocked for designers even with confirmation', () => {
    const args = { id: 'rec-1', orgId: 'org-1', confirmed: true }
    expect(classifyTool('link_meeting_recording', 'designer')).toBe('blocked')
    expect(gateToolCall('link_meeting_recording', args, 'designer', 'Staci').ok).toBe(false)
    expect(toolsForProfile(TOOLS, 'designer').some(tool => tool.name === 'link_meeting_recording')).toBe(false)
    expect(isDesignerRequestAllowed('PATCH', '/api/admin/recordings/rec-1/link')).toBe(false)
    expect(gateToolCall('link_meeting_recording', args, 'full', 'Liam').ok).toBe(true)
  })
})

describe('manual call recording MCP dispatch', () => {
  it('forwards scheduled reminder filters through the existing read tool', async () => {
    const calls = interceptedCalls()
    const args = { orgId: 'org-1', status: 'scheduled', since: '2026-10-14T21:00:00Z', until: '2026-10-14T21:02:00Z', limit: 100 }
    await executeTool('list_calls', args, credentials, manyRequests)
    expect(calls[0].url.pathname).toBe('/api/admin/calls')
    for (const [key, value] of Object.entries(args)) expect(calls[0].url.searchParams.get(key)).toBe(String(value))
    expect(classifyTool('list_calls', 'designer')).toBe('read')
  })
  it('lists recordings through the guarded admin route', async () => {
    const calls = interceptedCalls()
    await executeTool('list_meeting_recordings', {}, credentials, manyRequests)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/api/admin/recordings')
    expect(calls[0].method).toBe('GET')
    expect(calls[0].headers.get('Authorization')).toBe('Bearer test-service-token')
  })

  it('gets recording details without losing the named actor envelope', async () => {
    const calls = interceptedCalls()
    await executeTool('get_meeting_recording', { id: 'rec-1' }, credentials, manyRequests)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/api/admin/recordings/rec-1')
    expect(calls[0].method).toBe('GET')
    expect([...calls[0].headers.values()]).toContain('test-signed-actor')
  })

  it('links only the explicitly selected client', async () => {
    const calls = interceptedCalls()
    await executeTool('link_meeting_recording', { id: 'rec-1', orgId: 'org-1', title: 'discard this' }, credentials, manyRequests)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.pathname).toBe('/api/admin/recordings/rec-1/link')
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].body).toEqual({ orgId: 'org-1' })
  })

  it.each(['discovery', 'scheduled'])('links the explicit %s call with its table', async callKind => {
    const calls = interceptedCalls()
    await executeTool('link_meeting_recording', { id: 'rec-1', callKind, callId: 'call-1' }, credentials, manyRequests)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ callKind, callId: 'call-1' })
  })

  it.each([
    {},
    { orgId: 'org-1', callKind: 'scheduled', callId: 'call-1' },
    { callKind: 'scheduled' },
    { callId: 'call-1' },
    { callKind: 'unknown', callId: 'call-1' },
  ])('refuses missing or ambiguous link selection %j before dispatch', async selection => {
    const calls = interceptedCalls()
    await expect(executeTool('link_meeting_recording', { id: 'rec-1', ...selection }, credentials, manyRequests)).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it.each(['../invoices/x', 'x?redirect=1', '%2e%2e', 'x/y'])('refuses unsafe recording and link ids %s before dispatch', async id => {
    const calls = interceptedCalls()
    await expect(executeTool('get_meeting_recording', { id }, credentials, manyRequests)).rejects.toThrow('id is not a valid id')
    await expect(executeTool('link_meeting_recording', { id, orgId: 'org-1' }, credentials, manyRequests)).rejects.toThrow('id is not a valid id')
    await expect(executeTool('link_meeting_recording', { id: 'rec-1', orgId: id }, credentials, manyRequests)).rejects.toThrow('orgId is not a valid id')
    await expect(executeTool('link_meeting_recording', { id: 'rec-1', callKind: 'scheduled', callId: id }, credentials, manyRequests)).rejects.toThrow('callId is not a valid id')
    expect(calls).toEqual([])
  })

  it('declares id arguments so the shared RPC path guard checks them', () => {
    const schema = definition('link_meeting_recording').inputSchema
    expect(schema.required).toEqual(['id'])
    expect(schema.properties).toHaveProperty('orgId')
    expect(schema.properties).toHaveProperty('callId')
    expect(schema.properties?.callKind).toMatchObject({ enum: ['discovery', 'scheduled'] })
    const args = coerceArgs(schema, { id: 'rec-1', callId: '../settings', callKind: 'scheduled' })
    expect(() => assertSafeIdArgs(args)).toThrow('callId is not a valid id')
  })
})

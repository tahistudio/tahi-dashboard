/**
 * The dashboard's designer route list (lib/mcp-designer-routes.ts) agrees
 * with the worker's profile table: every call a designer tool dispatches is
 * allowed, and blocked tools' writes are refused unless the exact route is
 * one an allowed tool also uses (listed below with the reason).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TOOLS, executeTool } from '../../../workers/mcp-server/src/index'
import { classifyTool } from '../../../workers/mcp-server/src/tool-profiles'
import { isDesignerRequestAllowed } from '@/lib/mcp-designer-routes'

// Arguments the dispatchers validate before building a path.
const OVERRIDES: Record<string, unknown> = {
  subjectType: 'task',
  source: 'request',
  subject: 'task',
}

function dummy(key: string, def: Record<string, unknown>): unknown {
  if (key in OVERRIDES) return OVERRIDES[key]
  if (Array.isArray(def.enum) && def.enum.length) return def.enum[0]
  const t = Array.isArray(def.type) ? def.type[0] : def.type
  if (t === 'number' || t === 'integer') return 1
  if (t === 'boolean') return true
  if (t === 'array') return ['id1']
  if (t === 'object') return {}
  return key === 'title' ? 'four word long title here' : 'id1'
}

async function dispatched(toolName: string): Promise<{ method: string; path: string }[]> {
  const tool = TOOLS.find((t) => t.name === toolName)!
  const calls: { method: string; path: string }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname })
    return Response.json({})
  }))
  const args: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(tool.inputSchema.properties ?? {})) args[key] = dummy(key, def as Record<string, unknown>)
  await executeTool(toolName, args, { bearer: 'b', actor: null }, { token: 't', baseUrl: 'https://mr.example/api/v1' }).catch(() => undefined)
  return calls
}

/**
 * Blocked tools that share a method and route with an allowed one. The
 * worker refuses them by name; the dashboard cannot tell them apart.
 */
const SHARED_ROUTE: Record<string, string> = {
  link_request_to_schedule_row: 'PATCH /api/admin/requests/:id, the route update_request_fields uses',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('designer route list', () => {
  it('allows every call an allowed designer tool makes', async () => {
    const misses: string[] = []
    for (const tool of TOOLS) {
      if (classifyTool(tool.name, 'designer') === 'blocked') continue
      const calls = await dispatched(tool.name)
      expect(calls.length, `${tool.name} dispatched nothing`).toBeGreaterThan(0)
      for (const call of calls) {
        if (call.path.startsWith('/api/v1/')) continue // ManyRequests reads, not the dashboard
        if (!isDesignerRequestAllowed(call.method, call.path)) misses.push(`${tool.name}: ${call.method} ${call.path}`)
      }
    }
    expect(misses).toEqual([])
  })

  it('refuses the writes of blocked tools', async () => {
    const leaks: string[] = []
    for (const tool of TOOLS) {
      if (classifyTool(tool.name, 'designer') !== 'blocked') continue
      if (tool.name in SHARED_ROUTE) continue
      for (const call of await dispatched(tool.name)) {
        if (call.path.startsWith('/api/v1/')) continue
        if (call.method === 'GET') continue
        if (isDesignerRequestAllowed(call.method, call.path)) leaks.push(`${tool.name}: ${call.method} ${call.path}`)
      }
    }
    expect(leaks).toEqual([])
  })

  it('always allows reads and refuses unknown writes', () => {
    expect(isDesignerRequestAllowed('GET', '/api/admin/invoices')).toBe(true)
    expect(isDesignerRequestAllowed('PATCH', '/api/admin/invoices/x')).toBe(false)
    expect(isDesignerRequestAllowed('POST', '/api/admin/settings')).toBe(false)
    expect(isDesignerRequestAllowed('POST', '/api/portal/messages')).toBe(false)
    expect(isDesignerRequestAllowed('POST', '/api/admin/tasks/../invoices')).toBe(false)
  })

  it('never lets the id wildcard match a static sibling route (security re-review L-B)', () => {
    expect(isDesignerRequestAllowed('PATCH', '/api/admin/requests/bulk')).toBe(false)
    expect(isDesignerRequestAllowed('DELETE', '/api/admin/tasks/bulk')).toBe(false)
    expect(isDesignerRequestAllowed('DELETE', '/api/uploads/presign')).toBe(false)
    expect(isDesignerRequestAllowed('DELETE', '/api/uploads/confirm')).toBe(false)
    expect(isDesignerRequestAllowed('PATCH', '/api/admin/timers/ping')).toBe(false)
    // The literal routes that are meant to be reachable still are.
    expect(isDesignerRequestAllowed('PATCH', '/api/admin/tasks/bulk')).toBe(true)
    expect(isDesignerRequestAllowed('POST', '/api/admin/requests/bulk-assign')).toBe(true)
    // An id that merely starts with a reserved word is still an id.
    expect(isDesignerRequestAllowed('PATCH', '/api/admin/requests/bulky-request-1')).toBe(true)
  })
})

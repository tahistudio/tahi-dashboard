import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOLS, executeTool } from '../../../workers/mcp-server/src/index'
import { classifyTool, toolsForProfile } from '../../../workers/mcp-server/src/tool-profiles'
import { isDesignerRequestAllowed } from '@/lib/mcp-designer-routes'

afterEach(() => { vi.unstubAllGlobals() })

describe('bounded Airwallex sync MCP parity', () => {
  it('uses the dashboard sync route without widening its transaction window', async () => {
    const calls: Array<{ method: string; path: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search })
      return Response.json({ ok: true })
    }))

    expect(TOOLS.find(tool => tool.name === 'sync_airwallex')?.inputSchema.properties).toEqual({})
    await executeTool('sync_airwallex', {}, { bearer: 'test-token', actor: null }, { token: 'unused', baseUrl: 'https://unused.example/api/v1' })
    expect(calls).toEqual([{ method: 'POST', path: '/api/admin/integrations/airwallex/sync' }])
  })

  it('refuses finance sync for designer through both enforcement layers', () => {
    expect(classifyTool('sync_airwallex', 'designer')).toBe('blocked')
    expect(classifyTool('sync_airwallex', 'full')).toBe('write')
    expect(toolsForProfile(TOOLS, 'designer').some(tool => tool.name === 'sync_airwallex')).toBe(false)
    expect(isDesignerRequestAllowed('POST', '/api/admin/integrations/airwallex/sync')).toBe(false)
  })
})

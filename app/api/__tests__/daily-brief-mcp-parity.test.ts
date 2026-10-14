import { afterEach, describe, expect, it, vi } from 'vitest'
import { TOOLS, executeTool } from '../../../workers/mcp-server/src/index'
import { classifyTool, toolsForProfile } from '../../../workers/mcp-server/src/tool-profiles'
import { isDesignerRequestAllowed } from '@/lib/mcp-designer-routes'

afterEach(() => { vi.unstubAllGlobals() })

describe('daily brief MCP parity', () => {
  it.each([
    ['get_daily_brief', 'GET', '/api/admin/overview/brief'],
    ['refresh_daily_brief', 'POST', '/api/admin/overview/brief/refresh?force=1'],
  ])('dispatches %s to the same source used by the dashboard', async (name, method, path) => {
    const calls: Array<{ method: string; path: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search })
      return Response.json({ urgent: [], week: [], slept: [], generatedAt: '2026-10-14T00:00:00.000Z' })
    }))

    expect(TOOLS.find(tool => tool.name === name)?.inputSchema.properties).toEqual({})
    await executeTool(name, {}, { bearer: 'test-token', actor: null }, { token: 'unused', baseUrl: 'https://unused.example/api/v1' })
    expect(calls).toEqual([{ method, path }])
  })

  it('classifies the read and refuses cache regeneration for the designer in both enforcement layers', () => {
    expect(classifyTool('get_daily_brief', 'designer')).toBe('read')
    expect(classifyTool('refresh_daily_brief', 'designer')).toBe('blocked')
    expect(classifyTool('refresh_daily_brief', 'full')).toBe('write')
    expect(toolsForProfile(TOOLS, 'designer').some(tool => tool.name === 'get_daily_brief')).toBe(true)
    expect(toolsForProfile(TOOLS, 'designer').some(tool => tool.name === 'refresh_daily_brief')).toBe(false)
    expect(isDesignerRequestAllowed('POST', '/api/admin/overview/brief/refresh')).toBe(false)
  })
})

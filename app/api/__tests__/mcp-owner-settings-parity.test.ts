import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool, TOOLS } from '../../../workers/mcp-server/src/index'

function description(name: string): string {
  const tool = TOOLS.find(tool => tool.name === name)
  if (!tool) throw new Error(`${name} not found in TOOLS`)
  return tool.description
}

afterEach(() => vi.unstubAllGlobals())

describe('MCP owner mutation descriptions match the browser-only guards', () => {
  it.each(['assign_team_role', 'copy_access', 'update_team_member', 'delete_team_member'])(
    '%s explains the super admin browser session and designed service refusal', name => {
      expect(description(name)).toContain('super_admin browser session')
      expect(description(name)).toContain('service token returns 403 by design')
      expect(description(name)).toContain('last super_admin or usable owner login cannot be removed')
    },
  )

  it('clearing a role denies by default and granting or demoting an owner is browser-only', () => {
    const text = description('assign_team_role')
    expect(text).toContain('roleId null to clear (deny by default)')
    expect(text).toContain('Granting super_admin (owner), demoting an owner or clearing an owner role')
    expect(text).not.toContain('default admin level')
  })

  it('copying either privileged source or demoting an owner target is browser-only', () => {
    expect(description('copy_access')).toContain('Copying from an admin or super_admin source, or demoting an owner target')
  })

  it('distinguishes actual role or login changes from unchanged values and profile edits', () => {
    expect(description('update_team_member')).toContain('Role or login changes require')
    expect(description('update_team_member')).toContain('Unchanged role or login values and ordinary profile edits retain the admin gate')
    expect(description('delete_team_member')).toContain('Removing a super_admin (owner)')
  })
})

describe('MCP settings parity', () => {
  it('describes secret redaction and the reserved lock key', () => {
    expect(description('get_settings')).toContain('permissions.ownerMutationLock is omitted')
    expect(description('get_settings')).toContain('hasSecret')
    expect(description('get_settings')).toContain('webhook_endpoint_')
    expect(description('update_settings')).toContain('permissions.ownerMutationLock is reserved')
    expect(description('update_settings')).not.toContain('Any key is accepted')
  })

  it('returns only the redacted settings API response', async () => {
    const settings = { settings: { webhook_endpoint_one: JSON.stringify({ id: 'one', hasSecret: true }) } }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(settings))
    vi.stubGlobal('fetch', fetchMock)
    const result = await executeTool('get_settings', {}, { bearer: 'qa-token', actor: null }, { token: 'qa-mr', baseUrl: 'https://mr.example/api/v1' })
    expect(JSON.parse(result)).toEqual(settings)
    expect(fetchMock.mock.calls[0][0]).toBe('https://portal.tahi.studio/api/admin/settings')
  })

  it('propagates refusal of a null reserved-lock write without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Reserved setting' }, { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(executeTool('update_settings', { key: 'permissions.ownerMutationLock', value: null },
      { bearer: 'qa-token', actor: null }, { token: 'qa-mr', baseUrl: 'https://mr.example/api/v1' })).rejects.toThrow('Reserved setting')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://portal.tahi.studio/api/admin/settings')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ key: 'permissions.ownerMutationLock', value: null })
  })
})

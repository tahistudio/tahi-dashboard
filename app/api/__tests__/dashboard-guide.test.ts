/**
 * The "how this works" guide: lib/dashboard-guide.ts, the two GET routes,
 * and the worker's MCP tool list (CLAUDE.md rule 14, MCP parity).
 *
 * Every tool name inside the guide's "What the MCP can do" section must be a
 * tool the worker actually registers, or an assistant reading the guide would
 * be told to call a tool that does not exist. The relative import into
 * workers/ is deliberate: the `@/` alias resolves from the repo root and the
 * worker sits outside the Next app, and vitest.config.ts excludes
 * `workers/**` from collection while still resolving an import into it (see
 * app/api/__tests__/mcp-plan-tools.test.ts, which does the same).
 */
import { describe, it, expect, vi } from 'vitest'
import { GUIDE_SECTIONS, getGuideSection, guideSectionsFor } from '@/lib/dashboard-guide'
import { TOOLS } from '../../../workers/mcp-server/src/index'

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name))

/** Every **bold** span's contents, comma-split and trimmed, one array per
 *  matching span. Mirrors components/tahi/chat-markdown.tsx's own BOLD regex
 *  so the test reads the section the same way a rendered page would. */
function boldSpans(body: string): string[][] {
  const matches = [...body.matchAll(/\*\*(.+?)\*\*/g)]
  return matches.map((m) => m[1].split(',').map((s) => s.trim()))
}

/** A bold span's contents look like a tool-name list (snake_case tokens),
 *  as opposed to a bolded English phrase like "Needs your approval". */
function looksLikeToolNameList(tokens: string[]): boolean {
  return tokens.every((t) => /^[a-z][a-z0-9_]*$/.test(t) && t.includes('_'))
}

describe('GUIDE_SECTIONS', () => {
  it('has no duplicate keys', () => {
    const keys = GUIDE_SECTIONS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('carries no em dash or en dash in any title or body', () => {
    // Unicode escapes, not the literal glyphs, so this file's own diff never
    // trips the same rule it is checking for.
    const emOrEnDash = /[\u2013\u2014]/
    for (const section of GUIDE_SECTIONS) {
      expect(section.title).not.toMatch(emOrEnDash)
      expect(section.body).not.toMatch(emOrEnDash)
    }
  })

  it('uses only bold and lists, never a markdown heading', () => {
    for (const section of GUIDE_SECTIONS) {
      expect(section.body).not.toMatch(/^#/m)
    }
  })

  it('getGuideSection resolves a known key and returns undefined for an unknown one', () => {
    expect(getGuideSection('hand-offs')?.title).toContain('Hand-offs')
    expect(getGuideSection('not-a-real-key')).toBeUndefined()
  })
})

describe('suggestions-from-calls names the duplicate guard (CN.1d contract section 5)', () => {
  it('says a new task or request is checked against what already exists, and names the fallback verbs', () => {
    const section = getGuideSection('suggestions-from-calls')
    if (!section) throw new Error('suggestions-from-calls section is missing from GUIDE_SECTIONS')
    expect(section.body).toContain('checked against what already exists')
    expect(section.body).toContain('Approve anyway')
  })
})

describe('guideSectionsFor', () => {
  it('gives the client audience only sections marked client or both', () => {
    const clientSections = guideSectionsFor('client')
    for (const section of clientSections) {
      expect(['client', 'both']).toContain(section.audience)
    }
    // At least one section stays team-only (the MCP tool list): clients have
    // no MCP access, so it must not leak into their slice.
    expect(clientSections.find((s) => s.key === 'mcp-guide')).toBeUndefined()
  })

  it('gives the team audience every section', () => {
    expect(guideSectionsFor('team').length).toBe(GUIDE_SECTIONS.length)
  })
})

describe('the MCP section names only real tools', () => {
  const mcpSection = getGuideSection('mcp-guide')
  if (!mcpSection) throw new Error('mcp-guide section is missing from GUIDE_SECTIONS')

  const toolNameSpans = boldSpans(mcpSection.body).filter(looksLikeToolNameList)

  it('found at least one bolded tool-name list to check (a canary against a silent parse change)', () => {
    expect(toolNameSpans.length).toBeGreaterThan(0)
  })

  it('every named tool is registered on the worker', () => {
    const missing: string[] = []
    for (const span of toolNameSpans) {
      for (const name of span) {
        if (!TOOL_NAMES.has(name)) missing.push(name)
      }
    }
    expect(missing).toEqual([])
  })

  it('names the three hand-off tools specifically', () => {
    const flat = toolNameSpans.flat()
    expect(flat).toContain('hand_off_request')
    expect(flat).toContain('hand_back_request')
    expect(flat).toContain('list_requests_waiting_on_clients')
    expect(flat).toContain('get_dashboard_guide')
  })
})

describe('GET /api/admin/guide', () => {
  it('403s a non-admin caller', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server-auth', () => ({
      getRequestAuth: async () => ({ orgId: 'org_client', userId: 'user_1' }),
      isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
    }))
    const { GET } = await import('@/app/api/admin/guide/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/admin/guide'))
    expect(res.status).toBe(403)
    vi.doUnmock('@/lib/server-auth')
  })

  it('returns every section for an admin caller', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server-auth', () => ({
      getRequestAuth: async () => ({ orgId: 'org_tahi', userId: 'user_1' }),
      isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
    }))
    const { GET } = await import('@/app/api/admin/guide/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/admin/guide'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sections: { key: string }[] }
    expect(json.sections.length).toBe(GUIDE_SECTIONS.length)
    expect(json.sections.some((s) => s.key === 'mcp-guide')).toBe(true)
    vi.doUnmock('@/lib/server-auth')
  })

  it('returns one section when ?key is given, 404 for an unknown key', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server-auth', () => ({
      getRequestAuth: async () => ({ orgId: 'org_tahi', userId: 'user_1' }),
      isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
    }))
    const { GET } = await import('@/app/api/admin/guide/route')
    const { NextRequest } = await import('next/server')
    const ok = await GET(new NextRequest('http://localhost/api/admin/guide?key=blockers'))
    expect(ok.status).toBe(200)
    const okJson = (await ok.json()) as { section: { key: string } }
    expect(okJson.section.key).toBe('blockers')

    const notFound = await GET(new NextRequest('http://localhost/api/admin/guide?key=nope'))
    expect(notFound.status).toBe(404)
    vi.doUnmock('@/lib/server-auth')
  })
})

describe('GET /api/portal/guide', () => {
  it('401s an unauthenticated caller', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server-auth', () => ({
      getPortalAuth: async () => ({ orgId: null, userId: null }),
    }))
    const { GET } = await import('@/app/api/portal/guide/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/portal/guide'))
    expect(res.status).toBe(401)
    vi.doUnmock('@/lib/server-auth')
  })

  it('returns only client-audience sections, never the team-only MCP section', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server-auth', () => ({
      getPortalAuth: async () => ({ orgId: 'org_client_1', userId: 'user_contact_1' }),
    }))
    const { GET } = await import('@/app/api/portal/guide/route')
    const { NextRequest } = await import('next/server')
    const res = await GET(new NextRequest('http://localhost/api/portal/guide'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sections: { key: string; audience: string }[] }
    expect(json.sections.length).toBeGreaterThan(0)
    for (const section of json.sections) {
      expect(['client', 'both']).toContain(section.audience)
    }
    expect(json.sections.some((s) => s.key === 'mcp-guide')).toBe(false)
    vi.doUnmock('@/lib/server-auth')
  })

  it('404s an unknown ?key and never leaks a team-only section by key', async () => {
    vi.resetModules()
    vi.doMock('@/lib/server-auth', () => ({
      getPortalAuth: async () => ({ orgId: 'org_client_1', userId: 'user_contact_1' }),
    }))
    const { GET } = await import('@/app/api/portal/guide/route')
    const { NextRequest } = await import('next/server')
    const teamOnly = await GET(new NextRequest('http://localhost/api/portal/guide?key=mcp-guide'))
    expect(teamOnly.status).toBe(404)

    const ok = await GET(new NextRequest('http://localhost/api/portal/guide?key=hand-offs'))
    expect(ok.status).toBe(200)
    vi.doUnmock('@/lib/server-auth')
  })
})

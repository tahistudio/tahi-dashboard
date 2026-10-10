/** Feature grants permit real writes, but cannot bypass proposal ownership. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  resolvePermissions: vi.fn(),
}))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: vi.fn() }))

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { resolveAccessScoping } from '@/lib/access-scoping'
import * as docs from '@/app/api/admin/docs/route'
import * as doc from '@/app/api/admin/docs/[id]/route'
import { POST as importDocs } from '@/app/api/admin/docs/import/route'
import { POST as seedDocs } from '@/app/api/admin/docs/seed/route'
import { POST as createSection } from '@/app/api/admin/proposals/[id]/sections/route'
import { PATCH as updateSection, DELETE as deleteSection } from '@/app/api/admin/proposals/[id]/sections/[sectionId]/route'

let fixture: ReturnType<typeof permissionSqlite>
let access: ResolvedAccess

function request(path: string, method = 'GET', body?: unknown, headers?: HeadersInit) {
  return new NextRequest(`http://localhost/api/admin/${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const context = (id = 'proposal-a', sectionId = 'section-a') => ({ params: Promise.resolve({ id, sectionId }) })
const importBody = { pages: [{ title: 'Studio guide', category: 'operations', content: '# Private' }] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  vi.stubEnv('TAHI_API_TOKEN', 'isolated-seed-test-secret')
  fixture = permissionSqlite([
    schema.docPages, schema.docVersions, schema.teamMembers, schema.proposals,
    schema.proposalSections, schema.deals,
  ])
  access = {
    userId: 'user_member', orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set(['docs', 'proposals']), overrides: new Map(),
  }
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_member', orgId: 'org_tahi', sessionId: 'session-1' })
  vi.mocked(resolvePermissions).mockImplementation(async () => access)
  vi.mocked(resolveAccessScoping).mockResolvedValue(['org-a'])
  for (const [id, org, deal] of [
    ['proposal-a', 'org-a', null], ['proposal-b', 'org-b', null],
    ['proposal-unlinked', null, null], ['proposal-inherited-b', null, 'deal-b'],
  ] as const) fixture.insert(schema.proposals, { id, org_id: org, deal_id: deal, updated_at: '2026-01-01T00:00:00Z' })
  fixture.insert(schema.deals, { id: 'deal-b', org_id: 'org-b' })
  for (const [id, proposal] of [['section-a', 'proposal-a'], ['section-b', 'proposal-b']] as const) {
    fixture.insert(schema.proposalSections, { id, proposal_id: proposal, title: 'Original', position: 0 })
  }
})

afterEach(() => {
  fixture.close()
  vi.unstubAllEnvs()
})

describe('Docs feature access', () => {
  it('allows a granted member to create, read, update and delete a doc with versions', async () => {
    const created = await docs.POST(request('docs', 'POST', { title: '  Studio guide  ', contentMd: '# Private' }))
    expect(created.status).toBe(201)
    const { id } = await created.json() as { id: string }
    expect(fixture.rows(schema.docPages)).toMatchObject([{ id, title: 'Studio guide', author_id: 'user_member', content_text: '# Private', content_tiptap: null }])
    expect(fixture.rows(schema.docVersions)).toMatchObject([{ page_id: id, saved_by_id: 'user_member' }])

    const list = await docs.GET(request('docs'))
    expect(list.status).toBe(200)
    await expect(list.json()).resolves.toMatchObject({ pages: [{ id, title: 'Studio guide' }] })
    const detail = await doc.GET(request(`docs/${id}`), context(id))
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({ page: { id }, versions: [{ pageId: id }] })

    const updated = await doc.PATCH(request(`docs/${id}`, 'PATCH', { contentMd: '# Revised' }), context(id))
    expect(updated.status).toBe(200)
    expect(fixture.rows(schema.docPages)[0].content_text).toBe('# Revised')
    expect(fixture.rows(schema.docVersions)).toHaveLength(2)
    const removed = await doc.DELETE(request(`docs/${id}`, 'DELETE'), context(id))
    expect(removed.status).toBe(200)
    expect(fixture.rows(schema.docPages)).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it('allows a granted member to import docs with a version for each page', async () => {
    const response = await importDocs(request('docs/import', 'POST', importBody))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, created: 1 })
    expect(fixture.rows(schema.docPages)).toMatchObject([{ title: 'Studio guide', author_id: 'user_member' }])
    expect(fixture.rows(schema.docVersions)).toHaveLength(1)
    expect(fixture.errors).toEqual([])
  })

  it.each(['roleless', 'feature denied'])('denies a %s member the public seed fallback before writes', async denial => {
    if (denial === 'roleless') access.viewableResources = new Set()
    else access.overrides.set('docs', 'deny')
    const response = await seedDocs(request('docs/seed', 'POST', importBody))
    expect({ status: response.status, pages: fixture.rows(schema.docPages).length, versions: fixture.rows(schema.docVersions).length })
      .toEqual({ status: 403, pages: 0, versions: 0 })
  })

  it('preserves verified service-secret seed access without a Clerk session', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null, sessionId: null })
    const response = await seedDocs(request('docs/seed', 'POST', importBody, { 'x-seed-key': 'isolated-seed-test-secret' }))
    expect(response.status).toBe(200)
    expect(fixture.rows(schema.docPages)).toHaveLength(1)
    expect(resolvePermissions).not.toHaveBeenCalled()
    expect(fixture.errors).toEqual([])
  })
})

const sectionWrites = [
  { method: 'POST', body: { type: 'text', title: '  New section  ', data: { private: true } }, call: createSection },
  { method: 'PATCH', body: { title: '  Updated  ' }, call: updateSection },
  { method: 'DELETE', body: undefined, call: deleteSection },
] as const

describe('Proposal section ownership and writes', () => {
  it.each(sectionWrites)('$method allows a member with feature and client grants', async route => {
    const response = await route.call(request('proposals/proposal-a/sections', route.method, route.body), context())
    expect(response.status).toBe(route.method === 'POST' ? 201 : 200)
    const rows = fixture.rows(schema.proposalSections)
    if (route.method === 'POST') expect(rows).toMatchObject([
      { id: 'section-a' }, { id: 'section-b' },
      { proposal_id: 'proposal-a', title: 'New section', position: 1, data: '{"private":true}' },
    ])
    if (route.method === 'PATCH') expect(rows.find(row => row.id === 'section-a')?.title).toBe('Updated')
    if (route.method === 'DELETE') expect(rows.map(row => row.id)).toEqual(['section-b'])
    expect(rows.find(row => row.id === 'section-b')).toMatchObject({ title: 'Original', proposal_id: 'proposal-b' })
    expect(fixture.rows(schema.proposals).find(row => row.id === 'proposal-a')?.updated_at).not.toBe('2026-01-01T00:00:00Z')
    expect(fixture.errors).toEqual([])
  })

  describe.each(['proposal-b', 'proposal-inherited-b', 'proposal-unlinked'])('inaccessible %s', proposalId => {
    it.each(sectionWrites)('$method returns 403 before modifying sections or parent timestamps', async route => {
      const before = { sections: fixture.rows(schema.proposalSections), proposals: fixture.rows(schema.proposals) }
      const response = await route.call(request(`proposals/${proposalId}/sections`, route.method, route.body), context(proposalId))
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
      expect(fixture.rows(schema.proposalSections)).toEqual(before.sections)
      expect(fixture.rows(schema.proposals)).toEqual(before.proposals)
      expect(fixture.queries.filter(query => /^\s*(insert|update|delete)\b/i.test(query))).toEqual([])
      expect(fixture.errors).toEqual([])
    })
  })

  it.each(sectionWrites.filter(route => route.method !== 'POST'))('$method cannot target another proposal section by ID', async route => {
    const before = fixture.rows(schema.proposalSections)
    const response = await route.call(request('proposals/proposal-a/sections/section-b', route.method, route.body), context('proposal-a', 'section-b'))
    expect(response.status).toBe(200)
    expect(fixture.rows(schema.proposalSections)).toEqual(before)
    expect(fixture.errors).toEqual([])
  })
})

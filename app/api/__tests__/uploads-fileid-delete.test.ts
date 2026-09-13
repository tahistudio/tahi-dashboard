/**
 * Unit tests for DELETE /api/uploads/[fileId].
 *
 * One route serves both the admin and the portal delete (the established
 * pattern for the whole /api/uploads/* surface - see uploads-confirm.test.ts
 * and lib/upload-access.ts). The behaviour under test:
 *   - signed-out callers are refused before any DB read
 *   - a missing file is a 404
 *   - a non-admin is scoped to their own org (decideUploadRead's existing
 *     cross-org refusal, 403 - see lib/upload-access.ts)
 *   - a non-admin (contact) may delete a file their OWN org uploaded, never
 *     a studio deliverable (uploadedByType 'team_member'), the tightening
 *     this route adds over plain read access
 *   - an admin is scoped by team-member access to the file's org, any
 *     uploader
 *   - the R2 object is removed before the D1 row; a storage failure (or a
 *     missing STORAGE binding) leaves the row in place and answers 502
 *   - a successful delete removes both and writes one audit_log row
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories are hoisted, shared state goes through vi.hoisted
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  state: {
    orgResults: [] as Array<Array<{ id: string }>>,
    fileRows: [] as Array<{
      id: string
      orgId: string
      uploadedByType: string
      filename: string
      storageKey: string
    }>,
    deleteCalls: [] as string[],
    hasStorage: true,
    storageDelete: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn().mockImplementation(async () => ({
    env: h.state.hasStorage ? { STORAGE: { delete: h.state.storageDelete } } : {},
  })),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    files: { __t: 'files' },
    organisations: { __t: 'organisations', id: 'id', clerkOrgId: 'clerk_org_id' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}))

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockImplementation(async () => ({
    select: () => ({
      from: (table: { __t?: string }) => ({
        where: () => ({
          limit: async () => {
            switch (table?.__t) {
              case 'organisations': return h.state.orgResults.shift() ?? []
              case 'files': return h.state.fileRows
              default: return []
            }
          },
        }),
      }),
    }),
    delete: (table: { __t?: string }) => ({
      where: async () => { h.state.deleteCalls.push(table?.__t ?? 'unknown') },
    }),
  })),
}))

import { DELETE } from '@/app/api/uploads/[fileId]/route'
import { getRequestAuth } from '@/lib/server-auth'
import { requireAccessToOrg } from '@/lib/require-access'
import { logAudit } from '@/lib/audit'
import { NextRequest } from 'next/server'

function makeRequest(fileId: string): { req: NextRequest; ctx: { params: Promise<{ fileId: string }> } } {
  return {
    req: new NextRequest(`http://localhost:3000/api/uploads/${fileId}`, { method: 'DELETE' }),
    ctx: { params: Promise.resolve({ fileId }) },
  }
}

function asClient(orgId = 'org_client_clerk') {
  vi.mocked(getRequestAuth).mockResolvedValue({
    userId: 'user_client',
    orgId,
    sessionId: 'sess_2',
  })
}

describe('DELETE /api/uploads/[fileId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_admin',
      orgId: 'org_tahi',
      sessionId: 'sess_1',
    })
    vi.mocked(requireAccessToOrg).mockResolvedValue(null)
    h.state.orgResults = []
    h.state.fileRows = []
    h.state.deleteCalls = []
    h.state.hasStorage = true
    h.state.storageDelete = vi.fn().mockResolvedValue(undefined)
  })

  it('401s a signed-out caller before touching the database', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null, sessionId: null })
    const { req, ctx } = makeRequest('file_1')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(401)
    expect(h.state.deleteCalls).toHaveLength(0)
  })

  it('404s a file id that does not exist', async () => {
    h.state.fileRows = []
    const { req, ctx } = makeRequest('file_missing')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(404)
  })

  it('refuses a client whose org does not own the file (cross-org)', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    h.state.fileRows = [{ id: 'file_1', orgId: 'org_other_d1', uploadedByType: 'contact', filename: 'a.png', storageKey: 'org_other_d1/general/1-a.png' }]
    const { req, ctx } = makeRequest('file_1')
    const res = await DELETE(req, ctx)
    // Established convention for this route (see lib/upload-access.ts /
    // decideUploadRead): an org mismatch answers 403, not 404 - the same
    // status GET already uses for a file outside the caller's org.
    expect(res.status).toBe(403)
    expect(h.state.deleteCalls).toHaveLength(0)
  })

  it('refuses a contact deleting a studio deliverable in their own org', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    h.state.fileRows = [{ id: 'file_2', orgId: 'org_client_d1', uploadedByType: 'team_member', filename: 'deliverable.pdf', storageKey: 'org_client_d1/general/1-d.pdf' }]
    const { req, ctx } = makeRequest('file_2')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(403)
    expect(h.state.deleteCalls).toHaveLength(0)
    expect(h.state.storageDelete).not.toHaveBeenCalled()
  })

  it('allows a contact to delete a file their own org uploaded', async () => {
    asClient()
    h.state.orgResults = [[{ id: 'org_client_d1' }]]
    h.state.fileRows = [{ id: 'file_3', orgId: 'org_client_d1', uploadedByType: 'contact', filename: 'brief.docx', storageKey: 'org_client_d1/general/1-b.docx' }]
    const { req, ctx } = makeRequest('file_3')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect(h.state.storageDelete).toHaveBeenCalledWith('org_client_d1/general/1-b.docx')
    expect(h.state.deleteCalls).toEqual(['files'])
  })

  it('lets an admin delete a studio deliverable (any uploader, scoped by org access)', async () => {
    h.state.fileRows = [{ id: 'file_4', orgId: 'org_client_d1', uploadedByType: 'team_member', filename: 'deliverable.pdf', storageKey: 'org_client_d1/general/1-d.pdf' }]
    const { req, ctx } = makeRequest('file_4')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect(requireAccessToOrg).toHaveBeenCalledWith(expect.anything(), 'user_admin', 'org_client_d1')
    expect(h.state.deleteCalls).toEqual(['files'])
  })

  it('refuses an admin with no access to the file\'s org', async () => {
    vi.mocked(requireAccessToOrg).mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    )
    h.state.fileRows = [{ id: 'file_5', orgId: 'org_out_of_scope', uploadedByType: 'team_member', filename: 'x.png', storageKey: 'org_out_of_scope/general/1-x.png' }]
    const { req, ctx } = makeRequest('file_5')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(403)
    expect(h.state.deleteCalls).toHaveLength(0)
  })

  it('leaves the row in place and answers 502 when the R2 delete fails', async () => {
    h.state.storageDelete.mockRejectedValue(new Error('R2 unavailable'))
    h.state.fileRows = [{ id: 'file_6', orgId: 'org_client_d1', uploadedByType: 'team_member', filename: 'x.png', storageKey: 'org_client_d1/general/1-x.png' }]
    const { req, ctx } = makeRequest('file_6')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(502)
    expect(h.state.deleteCalls).toHaveLength(0)
    const json = await res.json() as { error: string }
    expect(json.error).toBeTruthy()
  })

  it('leaves the row in place and answers 502 when the STORAGE binding is missing', async () => {
    h.state.hasStorage = false
    h.state.fileRows = [{ id: 'file_7', orgId: 'org_client_d1', uploadedByType: 'team_member', filename: 'x.png', storageKey: 'org_client_d1/general/1-x.png' }]
    const { req, ctx } = makeRequest('file_7')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(502)
    expect(h.state.deleteCalls).toHaveLength(0)
    expect(h.state.storageDelete).not.toHaveBeenCalled()
  })

  it('removes both the R2 object and the row on success, and writes one audit row', async () => {
    h.state.fileRows = [{ id: 'file_8', orgId: 'org_client_d1', uploadedByType: 'team_member', filename: 'deliverable.pdf', storageKey: 'org_client_d1/general/1-d.pdf' }]
    const { req, ctx } = makeRequest('file_8')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as { success: boolean }
    expect(json.success).toBe(true)
    expect(h.state.storageDelete).toHaveBeenCalledWith('org_client_d1/general/1-d.pdf')
    expect(h.state.deleteCalls).toEqual(['files'])
    expect(logAudit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'file.deleted',
      userId: 'user_admin',
      userType: 'team_member',
      entityType: 'file',
      entityId: 'file_8',
    }))
  })
})

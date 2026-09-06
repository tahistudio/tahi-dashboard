/**
 * POST /api/admin/import/manyrequests in SNAPSHOT mode.
 *
 * The property this file exists for: a super admin can run the import from a
 * pre-fetched snapshot with NO MANYREQUESTS_API_TOKEN on this worker, and the
 * token is never consulted in that mode. Everything else (the super-admin gate,
 * dryRun defaulting TRUE, the audit row on an apply) holds exactly as it does
 * on the live path, and the live path itself is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn().mockResolvedValue({ isSuperAdmin: true, isAdmin: true, level: 'super_admin' }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/import/manyrequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import/manyrequests')>()
  return {
    ...actual,
    // No token on this worker, which is the whole point of the snapshot path.
    manyRequestsTokenFromEnv: vi.fn(() => null),
    createManyRequestsClient: vi.fn(() => ({ live: true })),
    createSnapshotClient: vi.fn((snapshot: Parameters<typeof actual.createSnapshotClient>[0]) =>
      actual.createSnapshotClient(snapshot),
    ),
    runImport: vi.fn().mockResolvedValue({
      dryRun: true,
      entities: [],
      samples: {},
      skipped: {},
      unmapped: {},
      mailProbeBefore: { suppressions: 2, notifications: 27 },
      mailProbeAfter: { suppressions: 2, notifications: 27 },
      mailSilent: true,
      mailWitnesses: { notifications: 'live', suppressions: 'live', degraded: false },
      warnings: [],
    }),
  }
})

import { POST, GET } from '@/app/api/admin/import/manyrequests/route'
import { NextRequest } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import {
  createManyRequestsClient,
  createSnapshotClient,
  manyRequestsTokenFromEnv,
  runImport,
  type ManyRequestsClient,
} from '@/lib/import/manyrequests'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/import/manyrequests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type RunArgs = {
  client: ManyRequestsClient
  dryRun: boolean
  entities: string[]
}

function snapshot() {
  return {
    organizations: [{ id: 18, name: 'Blank Space Inc' }],
    membersByOrg: { '18': [{ id: 40, name: 'Saif Al-Janabi', email: 'saif@blankspaceinc.ca' }] },
    requests: [{ id: 347, title: 'Custom Redirects', status: 'In progress', organization: { id: 18, name: 'Blank Space Inc' } }],
  }
}

function resetMocks() {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' })
  vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
  vi.mocked(requireFeature).mockResolvedValue(null)
  vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: true } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
  vi.mocked(manyRequestsTokenFromEnv).mockReturnValue(null)
}

describe('POST /api/admin/import/manyrequests with a snapshot', () => {
  beforeEach(resetMocks)

  it('runs from the snapshot with NO token configured, and says so', async () => {
    const res = await POST(makeRequest({ snapshot: snapshot() }))
    expect(res.status).toBe(200)
    const json = await res.json() as { source: string; snapshotCounts: Record<string, number> }
    expect(json.source).toBe('snapshot')
    expect(json.snapshotCounts).toEqual({
      organizations: 1,
      membersByOrg: 1,
      brandsByOrg: 0,
      subscriptionsByOrg: 0,
      clients: 0,
      services: 0,
      requests: 1,
      invoices: 0,
    })
    expect(createSnapshotClient).toHaveBeenCalledTimes(1)
    expect(createManyRequestsClient).not.toHaveBeenCalled()
  })

  it('hands runImport the snapshot client, not the live one', async () => {
    await POST(makeRequest({ snapshot: snapshot() }))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(await args.client.listOrganizations()).toEqual([{ id: 18, name: 'Blank Space Inc' }])
    expect(await args.client.listOrgMembers('18')).toHaveLength(1)
    expect((await args.client.getRequest('347')).title).toBe('Custom Redirects')
  })

  it('never consults the token in snapshot mode', async () => {
    await POST(makeRequest({ snapshot: snapshot() }))
    expect(manyRequestsTokenFromEnv).not.toHaveBeenCalled()
  })

  it('still defaults to a DRY RUN', async () => {
    await POST(makeRequest({ snapshot: snapshot() }))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.dryRun).toBe(true)
  })

  it('refuses a snapshot with a missing id as 400 naming the key path, and runs nothing', async () => {
    const res = await POST(makeRequest({ snapshot: { requests: [{ title: 'no id' }] } }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('snapshot.requests[0].id')
    expect(runImport).not.toHaveBeenCalled()
    expect(createSnapshotClient).not.toHaveBeenCalled()
  })

  it('refuses a snapshot with an unknown key by name', async () => {
    const res = await POST(makeRequest({ snapshot: { organizations: [], notice: 'pasted whole' } }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('notice')
    expect(runImport).not.toHaveBeenCalled()
  })

  it('refuses an explicit null snapshot rather than falling through to a live run', async () => {
    vi.mocked(manyRequestsTokenFromEnv).mockReturnValue('token_123')
    const res = await POST(makeRequest({ snapshot: null }))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('snapshot must be a plain object')
    expect(runImport).not.toHaveBeenCalled()
    expect(createManyRequestsClient).not.toHaveBeenCalled()
  })

  it('keeps the super-admin gate in front of the snapshot', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
    const res = await POST(makeRequest({ snapshot: snapshot() }))
    expect(res.status).toBe(403)
    expect(createSnapshotClient).not.toHaveBeenCalled()
    expect(runImport).not.toHaveBeenCalled()
  })

  it('keeps the org gate in front of the snapshot', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client', sessionId: 's' })
    const res = await POST(makeRequest({ snapshot: snapshot() }))
    expect(res.status).toBe(403)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('records the source and the snapshot counts on the audit row of an apply', async () => {
    await POST(makeRequest({ dryRun: false, snapshot: snapshot() }))
    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.metadata).toMatchObject({ source: 'snapshot', snapshotCounts: { organizations: 1, requests: 1 } })
  })

  it('reads a multi-megabyte snapshot body once and accepts it', async () => {
    const description = 'x'.repeat(600)
    const requests = Array.from({ length: 4000 }, (_unused, index) => ({
      id: index + 1,
      title: `Request ${index + 1}`,
      description,
      organization: { id: 18, name: 'Blank Space Inc' },
    }))
    const body = JSON.stringify({ snapshot: { organizations: [{ id: 18 }], requests } })
    expect(body.length).toBeGreaterThan(2 * 1024 * 1024)
    const req = new NextRequest('http://localhost:3000/api/admin/import/manyrequests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { snapshotCounts: Record<string, number> }
    expect(json.snapshotCounts.requests).toBe(4000)
  })
})

describe('POST /api/admin/import/manyrequests without a snapshot is unchanged', () => {
  beforeEach(resetMocks)

  it('answers 400 naming the token when none is configured', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('MANYREQUESTS_API_TOKEN')
    expect(runImport).not.toHaveBeenCalled()
    expect(createSnapshotClient).not.toHaveBeenCalled()
  })

  it('runs live with the token, reports source live and carries no snapshot counts', async () => {
    vi.mocked(manyRequestsTokenFromEnv).mockReturnValue('token_123')
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    const json = await res.json() as { source: string; snapshotCounts?: unknown }
    expect(json.source).toBe('live')
    expect('snapshotCounts' in json).toBe(false)
    expect(createManyRequestsClient).toHaveBeenCalledWith({ token: 'token_123' })
    expect(createSnapshotClient).not.toHaveBeenCalled()
  })

  it('records source live on the audit row of an apply', async () => {
    vi.mocked(manyRequestsTokenFromEnv).mockReturnValue('token_123')
    await POST(makeRequest({ dryRun: false }))
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.metadata).toMatchObject({ source: 'live', snapshotCounts: null })
  })
})

describe('GET /api/admin/import/manyrequests', () => {
  beforeEach(resetMocks)

  it('names the snapshot body as the alternative to the token', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/import/manyrequests'))
    expect(res.status).toBe(200)
    const json = await res.json() as { tokenConfigured: boolean; snapshotKeys: string[]; note: string }
    expect(json.tokenConfigured).toBe(false)
    expect(json.snapshotKeys).toEqual([
      'organizations',
      'membersByOrg',
      'brandsByOrg',
      'subscriptionsByOrg',
      'clients',
      'services',
      'requests',
      'invoices',
    ])
    expect(json.note).toContain('body.snapshot')
  })
})

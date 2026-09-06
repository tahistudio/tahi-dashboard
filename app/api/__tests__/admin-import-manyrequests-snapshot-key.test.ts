/**
 * The snapshot-by-key path of POST /api/admin/import/manyrequests: the route
 * reads the export from the studio bucket server-side, feeds it to the same
 * validator as a body snapshot, never consults the token, refuses a bad key
 * with the storage module's status, and refuses body and key together.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const objects: Record<string, string> = {}

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({
    env: {
      STORAGE: {
        async get(key: string) {
          const text = objects[key]
          if (text === undefined) return null
          return { size: text.length, text: async () => text }
        },
      },
    },
  }),
}))

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
    manyRequestsTokenFromEnv: vi.fn(() => null),
    createManyRequestsClient: vi.fn(() => ({ live: true })),
    runImport: vi.fn().mockResolvedValue({
      dryRun: true,
      entities: [],
      samples: {},
      skipped: {},
      unmapped: {},
      mailProbeBefore: { suppressions: 0, notifications: 0 },
      mailProbeAfter: { suppressions: 0, notifications: 0 },
      mailSilent: true,
      mailWitnesses: { notifications: 'live', suppressions: 'live', degraded: false },
      warnings: [],
    }),
  }
})

import { POST } from '@/app/api/admin/import/manyrequests/route'
import { NextRequest } from 'next/server'
import { logAudit } from '@/lib/audit'
import { manyRequestsTokenFromEnv, runImport } from '@/lib/import/manyrequests'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/import/manyrequests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const GOOD_KEY = 'imports/manyrequests/snapshot-test.json'

describe('POST /api/admin/import/manyrequests with snapshotKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(objects)) delete objects[key]
    objects[GOOD_KEY] = JSON.stringify({
      organizations: [{ id: 3, name: 'Glasswall' }],
      requests: [{ id: 347, title: 'Custom Redirects' }],
    })
  })

  it('reads the export from the bucket, runs a dry run and never consults the token', async () => {
    const res = await POST(makeRequest({ snapshotKey: GOOD_KEY }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { source: string; snapshotKey: string; snapshotCounts: Record<string, number>; dryRun: boolean }
    expect(json.source).toBe('snapshot')
    expect(json.snapshotKey).toBe(GOOD_KEY)
    expect(json.snapshotCounts.organizations).toBe(1)
    expect(json.snapshotCounts.requests).toBe(1)
    expect(json.dryRun).toBe(true)
    expect(manyRequestsTokenFromEnv).not.toHaveBeenCalled()
    expect(runImport).toHaveBeenCalledTimes(1)
    const call = vi.mocked(runImport).mock.calls[0][0]
    expect(call.dryRun).toBe(true)
    const rows = await call.client.listOrganizations()
    expect(rows).toEqual([{ id: 3, name: 'Glasswall' }])
  })

  it('records the key on the audit row of an apply', async () => {
    const res = await POST(makeRequest({ snapshotKey: GOOD_KEY, dryRun: false }))
    expect(res.status).toBe(200)
    const audit = vi.mocked(logAudit).mock.calls.at(-1)?.[1] as { metadata?: { snapshotKey?: string; source?: string } }
    expect(audit.metadata?.snapshotKey).toBe(GOOD_KEY)
    expect(audit.metadata?.source).toBe('snapshot')
  })

  it('answers 404 when the object is missing and runs nothing', async () => {
    const res = await POST(makeRequest({ snapshotKey: 'imports/manyrequests/nope.json' }))
    expect(res.status).toBe(404)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('answers 400 for a key outside the import prefix and runs nothing', async () => {
    const res = await POST(makeRequest({ snapshotKey: 'uploads/some-client-file.json' }))
    expect(res.status).toBe(400)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('answers 400 when the stored object fails the snapshot validator', async () => {
    objects['imports/manyrequests/bad.json'] = JSON.stringify({ organizations: [{ name: 'no id' }] })
    const res = await POST(makeRequest({ snapshotKey: 'imports/manyrequests/bad.json' }))
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toContain('Snapshot refused')
    expect(runImport).not.toHaveBeenCalled()
  })

  it('refuses a body snapshot and a key in the same call', async () => {
    const res = await POST(makeRequest({ snapshotKey: GOOD_KEY, snapshot: { organizations: [] } }))
    expect(res.status).toBe(400)
    expect(runImport).not.toHaveBeenCalled()
  })
})

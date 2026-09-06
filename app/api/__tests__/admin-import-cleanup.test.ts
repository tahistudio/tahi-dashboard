/**
 * POST /api/admin/import/cleanup: the gates and the defaults.
 *
 * This is the destructive door in the ManyRequests migration, so it carries the
 * same super-admin gate as the data export, defaults to a dry run, and defaults
 * wipeDemo to false. The refusal logic itself is pinned in
 * lib/import/manyrequests/__tests__/cleanup.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn().mockResolvedValue({ isSuperAdmin: true }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/import/manyrequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import/manyrequests')>()
  return {
    ...actual,
    runCleanup: vi.fn().mockResolvedValue({
      dryRun: true,
      archive: [],
      hardDelete: [],
      refused: [],
      wipeDemo: null,
      applied: { archived: 0, orgsDeleted: 0, rowsDeleted: 0 },
      warnings: [],
    }),
  }
})

import { POST, GET } from '@/app/api/admin/import/cleanup/route'
import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import { runCleanup } from '@/lib/import/manyrequests'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/import/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type CleanupArgs = { dryRun: boolean; archive: string[]; hardDelete: string[]; wipeDemo: boolean }

describe('POST /api/admin/import/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' })
    vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: true } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
  })

  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client', sessionId: 's' })
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(403)
    expect(runCleanup).not.toHaveBeenCalled()
  })

  it('refuses an admin who is not a super admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(403)
    expect(runCleanup).not.toHaveBeenCalled()
  })

  it('honours the settings feature gate', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(403)
    expect(runCleanup).not.toHaveBeenCalled()
  })

  it('defaults to a dry run with wipeDemo off', async () => {
    await POST(makeRequest({ hardDelete: ['org_a'] }))
    const args = vi.mocked(runCleanup).mock.calls[0][1] as unknown as CleanupArgs
    expect(args.dryRun).toBe(true)
    expect(args.wipeDemo).toBe(false)
  })

  it('treats a non-false dryRun as a dry run', async () => {
    await POST(makeRequest({ dryRun: 0, hardDelete: ['org_a'] }))
    const args = vi.mocked(runCleanup).mock.calls[0][1] as unknown as CleanupArgs
    expect(args.dryRun).toBe(true)
  })

  it('deduplicates and trims the id lists', async () => {
    await POST(makeRequest({ archive: [' org_a ', 'org_a', 'org_b', 42, ''], hardDelete: [] }))
    const args = vi.mocked(runCleanup).mock.calls[0][1] as unknown as CleanupArgs
    expect(args.archive).toEqual(['org_a', 'org_b'])
  })

  it('writes no audit row when nothing was actually applied', async () => {
    await POST(makeRequest({ dryRun: false, archive: ['org_a'] }))
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('writes an audit row when something was applied', async () => {
    vi.mocked(runCleanup).mockResolvedValue({
      dryRun: false,
      archive: [{ orgId: 'org_a', name: 'Acme Corp', children: {} }],
      hardDelete: [],
      refused: [],
      wipeDemo: null,
      applied: { archived: 1, orgsDeleted: 0, rowsDeleted: 0 },
      warnings: [],
    })
    await POST(makeRequest({ dryRun: false, archive: ['org_a'] }))
    expect(logAudit).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logAudit).mock.calls[0][1].action).toBe('manyrequests_cleanup')
  })

  it('turns a thrown failure into a 500 with the message', async () => {
    vi.mocked(runCleanup).mockRejectedValue(new Error('D1_ERROR: no such table'))
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(500)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('no such table')
  })
})

describe('GET /api/admin/import/cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' })
    vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
    vi.mocked(requireFeature).mockResolvedValue(null)
  })

  it('publishes the hard-delete allowlist so a caller can see what is deletable at all', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/import/cleanup'))
    expect(res.status).toBe(200)
    const json = await res.json() as { hardDeleteAllowlist: Array<{ name: string }>; defaults: { dryRun: boolean } }
    expect(json.defaults.dryRun).toBe(true)
    expect(json.hardDeleteAllowlist.map((row) => row.name)).toContain('Acme Corp')
    expect(json.hardDeleteAllowlist.map((row) => row.name)).not.toContain('Glasswall Solutions Ltd')
  })

  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client', sessionId: 's' })
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/import/cleanup'))
    expect(res.status).toBe(403)
  })
})

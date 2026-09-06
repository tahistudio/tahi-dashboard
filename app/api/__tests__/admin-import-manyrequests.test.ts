/**
 * POST /api/admin/import/manyrequests: the gates and the defaults.
 *
 * The two that matter:
 *   - super_admin only. The MCP service token resolves to admin, not
 *     super_admin, so it cannot rewrite the client list, the request history
 *     and the ledger without a human identity behind it.
 *   - dryRun DEFAULTS TRUE. An import is only ever applied when someone says so
 *     out loud, and an audit row is written for an apply and never for a
 *     preview.
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
    manyRequestsTokenFromEnv: vi.fn(() => 'token_123'),
    createManyRequestsClient: vi.fn(() => ({})),
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
import { runImport, manyRequestsTokenFromEnv } from '@/lib/import/manyrequests'
import { NextResponse } from 'next/server'

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/import/manyrequests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type RunArgs = {
  dryRun: boolean
  entities: string[]
  since: string | null
  closedAs: string
  requestDetailLimit: number | null
  requestDetailOffset: number | null
}

describe('POST /api/admin/import/manyrequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' })
    vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: true } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
    vi.mocked(manyRequestsTokenFromEnv).mockReturnValue('token_123')
  })

  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client', sessionId: 's' })
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(403)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('refuses an admin who is not a super admin', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(403)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('honours the settings feature gate', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(403)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('defaults to a DRY RUN when the body says nothing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(200)
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.dryRun).toBe(true)
  })

  it('treats any non-false dryRun as a dry run, so a stray string cannot apply', async () => {
    await POST(makeRequest({ dryRun: 'false' }))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.dryRun).toBe(true)
  })

  it('applies only on an explicit boolean false', async () => {
    await POST(makeRequest({ dryRun: false }))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.dryRun).toBe(false)
  })

  it('writes an audit row for an apply and none for a dry run', async () => {
    await POST(makeRequest({ dryRun: true }))
    expect(logAudit).not.toHaveBeenCalled()
    await POST(makeRequest({ dryRun: false }))
    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.action).toBe('manyrequests_import')
    expect(entry.metadata).toHaveProperty('mailProbeBefore')
    expect(entry.metadata).toHaveProperty('mailProbeAfter')
  })

  it('runs every entity in dependency order when none are named', async () => {
    await POST(makeRequest({}))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.entities).toEqual([
      'team', 'organisations', 'contacts', 'brands', 'services', 'subscriptions', 'requests', 'messages', 'invoices',
    ])
  })

  it('filters unknown entity names and says so', async () => {
    const res = await POST(makeRequest({ entities: ['organisations', 'nonsense'] }))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.entities).toEqual(['organisations'])
    const json = await res.json() as { warnings: string[] }
    expect(json.warnings.join(' ')).toContain('nonsense')
  })

  it('refuses a body whose entities are all unknown rather than silently running everything', async () => {
    const res = await POST(makeRequest({ entities: ['nonsense'] }))
    expect(res.status).toBe(400)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('normalises since and defaults closedAs to cancelled', async () => {
    await POST(makeRequest({ since: '2026-01-01', closedAs: 'nonsense' }))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.since).toBe('2026-01-01T00:00:00.000Z')
    expect(args.closedAs).toBe('cancelled')
  })

  it('accepts the three real closedAs rulings', async () => {
    for (const ruling of ['cancelled', 'delivered', 'archived']) {
      vi.clearAllMocks()
      vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: true } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
      vi.mocked(manyRequestsTokenFromEnv).mockReturnValue('token_123')
      await POST(makeRequest({ closedAs: ruling }))
      const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
      expect(args.closedAs).toBe(ruling)
    }
  })

  it('answers 400 with a usable message when the ManyRequests token is not configured', async () => {
    vi.mocked(manyRequestsTokenFromEnv).mockReturnValue(null)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('MANYREQUESTS_API_TOKEN')
    expect(runImport).not.toHaveBeenCalled()
  })

  it('returns the mail probe from both ends of the run', async () => {
    const res = await POST(makeRequest({}))
    const json = await res.json() as {
      mailProbeBefore: { suppressions: number; notifications: number }
      mailProbeAfter: { suppressions: number; notifications: number }
      mailSilent: boolean
    }
    expect(json.mailProbeBefore).toEqual(json.mailProbeAfter)
    expect(json.mailSilent).toBe(true)
  })

  it('shouts when the mail probe moved, so a silent failure cannot look like a success', async () => {
    vi.mocked(runImport).mockResolvedValue({
      dryRun: false,
      entities: [],
      samples: {},
      skipped: {},
      unmapped: {},
      mailProbeBefore: { suppressions: 2, notifications: 27 },
      mailProbeAfter: { suppressions: 2, notifications: 31 },
      mailSilent: false,
      mailWitnesses: { notifications: 'live', suppressions: 'live', degraded: false },
      warnings: [],
    })
    const res = await POST(makeRequest({ dryRun: false }))
    const json = await res.json() as { warnings: string[] }
    expect(json.warnings.join(' ')).toContain('MAIL PROBE MOVED')
  })

  it('turns a thrown read failure into a 500 with the message, not an unhandled crash', async () => {
    vi.mocked(runImport).mockRejectedValue(new Error('ManyRequests GET /requests returned 404'))
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(500)
    const json = await res.json() as { error: string }
    expect(json.error).toContain('404')
  })

  it('still records an audit row when an APPLY dies, so a partial write is never untraceable', async () => {
    vi.mocked(runImport).mockRejectedValue(new Error('D1_ERROR: too many SQL variables'))
    const res = await POST(makeRequest({ dryRun: false }))
    expect(res.status).toBe(500)
    expect(logAudit).toHaveBeenCalledTimes(1)
    const entry = vi.mocked(logAudit).mock.calls[0][1]
    expect(entry.action).toBe('manyrequests_import')
    expect(entry.metadata).toMatchObject({ failed: true })
  })

  it('writes no audit row when a DRY RUN dies, because a preview changed nothing', async () => {
    vi.mocked(runImport).mockRejectedValue(new Error('boom'))
    const res = await POST(makeRequest({ dryRun: true }))
    expect(res.status).toBe(500)
    expect(logAudit).not.toHaveBeenCalled()
  })

  it('passes the request detail window straight through so a long run can be walked', async () => {
    await POST(makeRequest({ requestDetailOffset: 100, requestDetailLimit: 100 }))
    const args = vi.mocked(runImport).mock.calls[0][0] as unknown as RunArgs
    expect(args.requestDetailOffset).toBe(100)
    expect(args.requestDetailLimit).toBe(100)
  })

  it('warns when only one mail witness was live', async () => {
    vi.mocked(runImport).mockResolvedValue({
      dryRun: true,
      entities: [],
      samples: {},
      skipped: {},
      unmapped: {},
      mailProbeBefore: { suppressions: null, notifications: 27 },
      mailProbeAfter: { suppressions: null, notifications: 27 },
      mailSilent: true,
      mailWitnesses: { notifications: 'live', suppressions: 'unavailable', degraded: true },
      warnings: [],
    })
    const res = await POST(makeRequest({}))
    const json = await res.json() as { warnings: string[] }
    expect(json.warnings.join(' ')).toContain('MAIL PROBE DEGRADED')
  })
})

describe('GET /api/admin/import/manyrequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 'sess_1' })
    vi.mocked(isTahiAdmin).mockImplementation((orgId: string | null) => orgId === 'org_tahi')
    vi.mocked(requireFeature).mockResolvedValue(null)
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: true } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
    vi.mocked(manyRequestsTokenFromEnv).mockReturnValue('token_123')
  })

  it('describes the contract without reaching ManyRequests or D1', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/import/manyrequests')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json() as { entities: string[]; defaults: { dryRun: boolean }; tokenConfigured: boolean }
    expect(json.defaults.dryRun).toBe(true)
    expect(json.entities[0]).toBe('team')
    expect(json.tokenConfigured).toBe(true)
    expect(runImport).not.toHaveBeenCalled()
  })

  it('refuses a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'u', orgId: 'org_client', sessionId: 's' })
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/import/manyrequests'))
    expect(res.status).toBe(403)
  })

  it('refuses an admin who is not a super admin, so the credential state is not disclosed', async () => {
    vi.mocked(resolvePermissions).mockResolvedValue({ isSuperAdmin: false } as unknown as Awaited<ReturnType<typeof resolvePermissions>>)
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/import/manyrequests'))
    expect(res.status).toBe(403)
  })
})

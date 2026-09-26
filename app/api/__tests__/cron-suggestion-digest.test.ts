/**
 * POST /api/admin/cron/suggestion-digest: the wiring only.
 *
 * What the digest says and to whom is lib/slack/__tests__/digest.test.ts's
 * job. What matters here is that nobody but the scheduler or an admin can
 * fire it, that the two knobs reach the run exactly as the query spelled
 * them, and that the run's summary comes back intact, because that summary
 * is what a dry run through the MCP tool reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
// The run is stubbed; the flag parser is the real one, because reading the
// query is the only logic this route has.
vi.mock('@/lib/slack/digest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/slack/digest')>()
  return {
    runSuggestionDigest: vi.fn(),
    parseDigestFlag: actual.parseDigestFlag,
  }
})

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { runSuggestionDigest } from '@/lib/slack/digest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/cron/suggestion-digest/route'

const SUMMARY = {
  ran: false,
  reason: 'slack_not_configured' as const,
  weekKey: '2026-W40',
  recipients: 0,
  sent: 0,
  alreadySent: 0,
  nothingToSay: 0,
  failed: 0,
}

function post(headers: Record<string, string> = {}, query = '') {
  return new NextRequest(`http://localhost/api/admin/cron/suggestion-digest${query}`, {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  vi.mocked(db).mockResolvedValue({ insert: () => ({ values: async () => ({}) }) } as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null } as never)
  vi.mocked(runSuggestionDigest).mockResolvedValue(SUMMARY)
  vi.stubEnv('TAHI_CRON_SECRET', 'shhh')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('POST /api/admin/cron/suggestion-digest', () => {
  it('refuses a caller who is neither the scheduler nor an admin', async () => {
    const res = await POST(post())
    expect(res.status).toBe(403)
    expect(runSuggestionDigest).not.toHaveBeenCalled()
  })

  it('refuses a signed-in client', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client' } as never)
    const res = await POST(post())
    expect(res.status).toBe(403)
    expect(runSuggestionDigest).not.toHaveBeenCalled()
  })

  it('refuses a wrong cron secret', async () => {
    const res = await POST(post({ 'x-cron-secret': 'guess' }))
    expect(res.status).toBe(403)
    expect(runSuggestionDigest).not.toHaveBeenCalled()
  })

  it('runs for the scheduler and hands back the whole summary', async () => {
    const res = await POST(post({ 'x-cron-secret': 'shhh' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(SUMMARY)
    expect(runSuggestionDigest).toHaveBeenCalledWith(expect.anything(), { force: false, dryRun: false })
  })

  it('runs for a signed-in Tahi admin firing it by hand', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi' } as never)
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(runSuggestionDigest).toHaveBeenCalledTimes(1)
  })

  it('passes ?force=1 and ?dry_run=1 through to the run', async () => {
    await POST(post({ 'x-cron-secret': 'shhh' }, '?force=1'))
    expect(runSuggestionDigest).toHaveBeenLastCalledWith(expect.anything(), { force: true, dryRun: false })

    await POST(post({ 'x-cron-secret': 'shhh' }, '?dry_run=1'))
    expect(runSuggestionDigest).toHaveBeenLastCalledWith(expect.anything(), { force: false, dryRun: true })

    await POST(post({ 'x-cron-secret': 'shhh' }, '?dry_run=true&force=1'))
    expect(runSuggestionDigest).toHaveBeenLastCalledWith(expect.anything(), { force: true, dryRun: true })
  })

  it('reads anything else as off', async () => {
    await POST(post({ 'x-cron-secret': 'shhh' }, '?force=0&dry_run=maybe'))
    expect(runSuggestionDigest).toHaveBeenLastCalledWith(expect.anything(), { force: false, dryRun: false })
  })
})

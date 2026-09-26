/**
 * POST /api/admin/cron/suggestion-digest: the wiring only.
 *
 * What the digest says and to whom is lib/slack/__tests__/digest.test.ts's
 * job. What matters here is that nobody but the scheduler or an admin can
 * fire it, that the two knobs reach the run exactly as the query spelled
 * them, and that the run's summary comes back intact, because that summary
 * is what a dry run through the MCP tool reads.
 *
 * And the cron_runs line (contract sections 4 and 5): a run that stopped
 * early is logged as skipped with its reason, and a dry run, whose summary
 * carries every recipient's message, writes nothing at all.
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

/** Every cron_runs row the route wrote, as inserted. */
const cronRuns: Array<{ cron: string; status: string; summary: string | null; error: string | null }> = []

beforeEach(() => {
  cronRuns.length = 0
  vi.mocked(db).mockResolvedValue({
    insert: () => ({
      values: async (row: { cron: string; status: string; summary: string | null; error: string | null }) => {
        cronRuns.push(row)
        return {}
      },
    }),
  } as never)
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

describe('the cron_runs line', () => {
  it('logs a run without Slack as skipped, with the reason in the summary', async () => {
    await POST(post({ 'x-cron-secret': 'shhh' }))
    expect(cronRuns).toHaveLength(1)
    expect(cronRuns[0]).toMatchObject({ cron: 'suggestion-digest', status: 'skipped', error: null })
    expect(JSON.parse(cronRuns[0].summary ?? '{}')).toMatchObject({ ran: false, reason: 'slack_not_configured' })
  })

  it('logs the other early stops as skipped too', async () => {
    vi.mocked(runSuggestionDigest).mockResolvedValueOnce({ ...SUMMARY, reason: 'outside_window' })
    vi.mocked(runSuggestionDigest).mockResolvedValueOnce({ ...SUMMARY, reason: 'disabled' })
    await POST(post({ 'x-cron-secret': 'shhh' }))
    await POST(post({ 'x-cron-secret': 'shhh' }))
    expect(cronRuns.map(row => row.status)).toEqual(['skipped', 'skipped'])
  })

  it('logs a run that reached the recipients as success', async () => {
    vi.mocked(runSuggestionDigest).mockResolvedValueOnce({
      ...SUMMARY, ran: true, reason: undefined, recipients: 3, sent: 2, nothingToSay: 1,
    })
    await POST(post({ 'x-cron-secret': 'shhh' }))
    expect(cronRuns).toHaveLength(1)
    expect(cronRuns[0].status).toBe('success')
  })

  it('writes nothing for a dry run, whose summary names every client and message', async () => {
    vi.mocked(runSuggestionDigest).mockResolvedValueOnce({
      ...SUMMARY, reason: 'dry_run', preview: null, payloads: [],
    })
    const res = await POST(post({ 'x-cron-secret': 'shhh' }, '?dry_run=1'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ reason: 'dry_run', payloads: [] })
    expect(cronRuns).toHaveLength(0)
  })

  it('logs a run that threw as an error and answers 500', async () => {
    vi.mocked(runSuggestionDigest).mockRejectedValueOnce(new Error('D1_ERROR: no such table'))
    const res = await POST(post({ 'x-cron-secret': 'shhh' }))
    expect(res.status).toBe(500)
    expect(cronRuns).toHaveLength(1)
    expect(cronRuns[0]).toMatchObject({ status: 'error', error: 'D1_ERROR: no such table' })
  })
})

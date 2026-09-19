/**
 * POST /api/admin/crons/suggest-from-transcripts: the wiring only.
 *
 * What the sweep DOES is lib/task-suggester.test.ts's job. What matters here
 * is that this endpoint cannot be fired by anyone who is not the scheduler or
 * an admin, and that the summary the sweep returns reaches the caller intact,
 * because the GitHub Actions job prints that body and it is the only place a
 * failing run is visible before somebody opens /settings/automations.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/task-suggester', () => ({ runSuggestionSweep: vi.fn() }))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { runSuggestionSweep } from '@/lib/task-suggester'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/admin/crons/suggest-from-transcripts/route'

const SUMMARY = {
  looked: 2,
  eligible: 1,
  skipped: [{ transcriptId: 'ct-2', reason: 'no_client_org' }],
  inserted: 3,
  duplicates: 1,
  dropped: 2,
  resurfaced: 0,
  costCents: 4,
}

function post(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/admin/crons/suggest-from-transcripts', {
    method: 'POST',
    headers,
  })
}

beforeEach(() => {
  vi.mocked(db).mockResolvedValue({ insert: () => ({ values: async () => ({}) }) } as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null } as never)
  vi.mocked(runSuggestionSweep).mockResolvedValue(SUMMARY)
  vi.stubEnv('TAHI_CRON_SECRET', 'shhh')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('POST /api/admin/crons/suggest-from-transcripts', () => {
  it('refuses a caller who is neither the scheduler nor an admin', async () => {
    const res = await POST(post())
    expect(res.status).toBe(403)
    expect(runSuggestionSweep).not.toHaveBeenCalled()
  })

  it('runs the sweep for the scheduler and hands back the whole summary', async () => {
    const res = await POST(post({ 'x-cron-secret': 'shhh' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(SUMMARY)
    expect(runSuggestionSweep).toHaveBeenCalledTimes(1)
  })

  it('runs for a signed-in Tahi admin firing it by hand', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_1', orgId: 'org_tahi' } as never)
    const res = await POST(post())
    expect(res.status).toBe(200)
    expect(runSuggestionSweep).toHaveBeenCalledTimes(1)
  })
})

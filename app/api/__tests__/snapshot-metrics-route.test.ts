/**
 * POST /api/admin/cron/snapshot-metrics, the daily financial snapshot, which
 * also carries the Slack retry guard sweep as its own step.
 *
 * The snapshot itself is tested in lib/__tests__/financial-snapshots.test.ts
 * and the sweep in lib/slack/__tests__/events-seen.test.ts. What is pinned
 * here is the wiring between them: the sweep runs every day as its own step,
 * after the snapshot, and a sweep that fails is a red step and nothing more.
 * It never turns the snapshot's run into an error, never costs the response
 * its 200, and a failed snapshot does not stop the sweep either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/cron-runs', () => ({ logCronRun: vi.fn() }))

vi.mock('@/lib/financial-snapshots', () => ({
  writeCurrentSnapshot: vi.fn(),
  backfillCashFromLedger: vi.fn(),
}))

vi.mock('@/lib/slack/events-seen', () => ({ sweepSlackEventsSeen: vi.fn() }))

import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { logCronRun } from '@/lib/cron-runs'
import { writeCurrentSnapshot } from '@/lib/financial-snapshots'
import { sweepSlackEventsSeen } from '@/lib/slack/events-seen'

import { POST as snapshotMetrics } from '@/app/api/admin/cron/snapshot-metrics/route'

function req() {
  return new NextRequest('http://localhost:3000/api/admin/cron/snapshot-metrics', { method: 'POST' })
}

interface Step { name: string; ok: boolean; error?: string; detail?: unknown }

const SWEPT = { deleted: 12, cutoff: '2026-09-19T18:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' } as never)
  vi.mocked(writeCurrentSnapshot).mockResolvedValue({ month: '2026-09' } as never)
  vi.mocked(sweepSlackEventsSeen).mockResolvedValue(SWEPT)
  vi.mocked(logCronRun).mockResolvedValue(undefined as never)
})

describe('POST /api/admin/cron/snapshot-metrics, the Slack sweep step', () => {
  it('runs the sweep as its own step, after the snapshot', async () => {
    const res = await snapshotMetrics(req())
    const body = await res.json() as { steps: Step[] }

    expect(res.status).toBe(200)
    expect(body.steps.map((step) => step.name)).toEqual(['write-current', 'sweep-slack-events'])
    expect(body.steps[1]).toEqual({ name: 'sweep-slack-events', ok: true, detail: SWEPT })
    expect(vi.mocked(logCronRun).mock.calls[0][2]).toBe('success')
  })

  it('reports a failed sweep on its own step and still logs the snapshot as a success', async () => {
    vi.mocked(sweepSlackEventsSeen).mockRejectedValue(new Error('D1_ERROR: no such table: slack_events_seen'))

    const res = await snapshotMetrics(req())
    const body = await res.json() as { steps: Step[] }

    expect(res.status).toBe(200)
    expect(body.steps).toContainEqual({ name: 'write-current', ok: true, detail: { month: '2026-09' } })
    expect(body.steps).toContainEqual({
      name: 'sweep-slack-events',
      ok: false,
      error: 'D1_ERROR: no such table: slack_events_seen',
    })
    const [, cron, status, , , error] = vi.mocked(logCronRun).mock.calls[0]
    expect(cron).toBe('snapshot-metrics')
    expect(status).toBe('success')
    expect(error).toBeNull()
  })

  it('still sweeps when the snapshot itself fails', async () => {
    vi.mocked(writeCurrentSnapshot).mockRejectedValue(new Error('Airwallex balances missing'))

    const res = await snapshotMetrics(req())
    const body = await res.json() as { steps: Step[] }

    expect(res.status).toBe(200)
    expect(vi.mocked(sweepSlackEventsSeen)).toHaveBeenCalledTimes(1)
    expect(body.steps.find((step) => step.name === 'sweep-slack-events')?.ok).toBe(true)
    // The snapshot is still the step that decides the run.
    expect(vi.mocked(logCronRun).mock.calls[0][2]).toBe('error')
  })
})

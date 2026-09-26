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
 *
 * Also pinned: ?fill=YYYY-MM runs the one-month fill and NOTHING else (no
 * current-month write, no backfill, no sweep), answers a refusal with its
 * own status and logs nothing for it, and the backfill only refreshes
 * existing rows when refresh=1 is passed alongside it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/cron-runs', () => ({ logCronRun: vi.fn() }))

// The real SnapshotFillRefusal class, so the route's instanceof check is the
// one production runs; only the three writers are stubbed.
vi.mock('@/lib/financial-snapshots', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/financial-snapshots')>()),
  writeCurrentSnapshot: vi.fn(),
  backfillCashFromLedger: vi.fn(),
  fillMonthSnapshot: vi.fn(),
}))

vi.mock('@/lib/slack/events-seen', () => ({ sweepSlackEventsSeen: vi.fn() }))

import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { logCronRun } from '@/lib/cron-runs'
import {
  writeCurrentSnapshot,
  backfillCashFromLedger,
  fillMonthSnapshot,
  SnapshotFillRefusal,
} from '@/lib/financial-snapshots'
import { sweepSlackEventsSeen } from '@/lib/slack/events-seen'

import { POST as snapshotMetrics } from '@/app/api/admin/cron/snapshot-metrics/route'

function req(query = '') {
  return new NextRequest(`http://localhost:3000/api/admin/cron/snapshot-metrics${query}`, { method: 'POST' })
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

describe('POST /api/admin/cron/snapshot-metrics?fill=YYYY-MM', () => {
  const FILLED = { monthKey: '2026-08', filled: ['cashNzd', 'burnNzd', 'runwayMonths'], leftNull: ['owedNzd', 'mrrNzd', 'activeClients'] }

  it('runs the fill for that month and nothing else', async () => {
    vi.mocked(fillMonthSnapshot).mockResolvedValue(FILLED as never)

    const res = await snapshotMetrics(req('?fill=2026-08'))
    const body = await res.json() as { mode: string; steps: Step[] }

    expect(res.status).toBe(200)
    expect(vi.mocked(fillMonthSnapshot)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fillMonthSnapshot).mock.calls[0][1]).toBe('2026-08')
    // No other month is written: not the current one, not a backfill.
    expect(vi.mocked(writeCurrentSnapshot)).not.toHaveBeenCalled()
    expect(vi.mocked(backfillCashFromLedger)).not.toHaveBeenCalled()
    expect(vi.mocked(sweepSlackEventsSeen)).not.toHaveBeenCalled()
    expect(body).toEqual({ mode: 'fill', steps: [{ name: 'fill-month', ok: true, detail: FILLED }] })

    const [, cron, status, , summary, error] = vi.mocked(logCronRun).mock.calls[0]
    expect(cron).toBe('snapshot-metrics')
    expect(status).toBe('success')
    expect(summary).toMatchObject({ mode: 'fill', monthKey: '2026-08' })
    expect(error).toBeNull()
  })

  it('logs at most ten blocking invoices, with the full count, and answers with all of them', async () => {
    const ambiguous = Array.from({ length: 12 }, (_, i) => ({ id: `inv-${i}`, number: null, status: 'written_off', amountNzd: 100, reason: 'rewritten since' }))
    vi.mocked(fillMonthSnapshot).mockResolvedValue({ ...FILLED, owed: { owedNzd: null, ambiguous } } as never)

    const res = await snapshotMetrics(req('?fill=2026-08'))
    const body = await res.json() as { steps: Array<{ detail: { owed: { ambiguous: unknown[] } } }> }
    expect(body.steps[0].detail.owed.ambiguous).toHaveLength(12)

    const summary = vi.mocked(logCronRun).mock.calls[0][4] as { steps: Array<{ detail: { owed: { ambiguous: unknown[]; ambiguousCount: number } } }> }
    expect(summary.steps[0].detail.owed.ambiguous).toHaveLength(10)
    expect(summary.steps[0].detail.owed.ambiguousCount).toBe(12)
  })

  it('answers a refusal with its own status and message, and logs nothing', async () => {
    vi.mocked(fillMonthSnapshot).mockRejectedValue(
      new SnapshotFillRefusal('exists', 409, '2026-07 already has a snapshot (source cron, captured 2026-07-10T18:00:00.000Z). A fill never overwrites; nothing was written.', { source: 'cron', capturedAt: '2026-07-10T18:00:00.000Z' }),
    )

    const res = await snapshotMetrics(req('?fill=2026-07'))
    const body = await res.json() as { error: string; code: string; monthKey: string; existing: unknown }

    expect(res.status).toBe(409)
    expect(body.code).toBe('exists')
    expect(body.monthKey).toBe('2026-07')
    expect(body.error).toContain('never overwrites')
    expect(body.existing).toEqual({ source: 'cron', capturedAt: '2026-07-10T18:00:00.000Z' })
    expect(vi.mocked(logCronRun)).not.toHaveBeenCalled()
    expect(vi.mocked(writeCurrentSnapshot)).not.toHaveBeenCalled()
  })

  it('logs a fill whose write failed as an error run and answers 500', async () => {
    vi.mocked(fillMonthSnapshot).mockRejectedValue(new Error('D1_ERROR: disk I/O error'))

    const res = await snapshotMetrics(req('?fill=2026-08'))
    const body = await res.json() as { mode: string; steps: Step[] }

    expect(res.status).toBe(500)
    expect(body.steps).toEqual([{ name: 'fill-month', ok: false, error: 'D1_ERROR: disk I/O error' }])
    expect(vi.mocked(logCronRun).mock.calls[0][2]).toBe('error')
    expect(vi.mocked(writeCurrentSnapshot)).not.toHaveBeenCalled()
  })

  it('refuses a fill combined with backfill or refresh before touching anything', async () => {
    for (const query of ['?fill=2026-08&backfill=1', '?fill=2026-08&refresh=1']) {
      const res = await snapshotMetrics(req(query))
      expect(res.status).toBe(400)
    }
    expect(vi.mocked(fillMonthSnapshot)).not.toHaveBeenCalled()
    expect(vi.mocked(backfillCashFromLedger)).not.toHaveBeenCalled()
    expect(vi.mocked(writeCurrentSnapshot)).not.toHaveBeenCalled()
    expect(vi.mocked(logCronRun)).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/cron/snapshot-metrics?backfill=1', () => {
  const BACKFILLED = { refresh: false, monthsWritten: 1, monthsRefreshed: 0, writtenMonths: ['2026-08'] }

  it('asks the backfill for no refresh unless refresh=1 is passed', async () => {
    vi.mocked(backfillCashFromLedger).mockResolvedValue(BACKFILLED as never)

    await snapshotMetrics(req('?backfill=1'))
    expect(vi.mocked(backfillCashFromLedger).mock.calls[0][2]).toEqual({ refresh: false })

    await snapshotMetrics(req('?backfill=1&refresh=1'))
    expect(vi.mocked(backfillCashFromLedger).mock.calls[1][2]).toEqual({ refresh: true })
  })

  it('refuses refresh=1 on its own', async () => {
    const res = await snapshotMetrics(req('?refresh=1'))
    expect(res.status).toBe(400)
    expect(vi.mocked(backfillCashFromLedger)).not.toHaveBeenCalled()
    expect(vi.mocked(writeCurrentSnapshot)).not.toHaveBeenCalled()
  })
})

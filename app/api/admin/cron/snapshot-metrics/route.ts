/**
 * POST /api/admin/cron/snapshot-metrics
 *
 * Freezes this month's point-in-time financial metrics (cash / owed / MRR /
 * active clients / burn / runway) into financial_snapshots so the overview
 * can show real trends and honest month-over-month deltas. Fired daily after
 * the bank syncs (Airwallex runs 18:00 UTC), so the captured cash reflects
 * the freshest balances. Each run upserts the current month's row.
 *
 * ?backfill=1 additionally reconstructs past month-end cash from the
 * Airwallex ledger for months that have no snapshot yet, a one-time seed so
 * the cash trend has history rather than starting empty.
 *
 * It also carries one piece of daily housekeeping that has nothing to do with
 * money: the sweep of the Slack app's retry guard table (slack_events_seen,
 * see lib/slack/events-seen.ts). It rides here because this is a daily route
 * that always reaches its steps (no connection check or quiet-day return in
 * front of them) and already reports each step on its own. The sweep runs
 * after the snapshot and never decides the run's status, so a failed sweep
 * shows as a failed step and the snapshot still logs as a success.
 *
 * Response: { steps: [{ name, ok, error?, detail? }] }, always HTTP 200.
 *
 * Auth: admin session (financial_reports feature) OR Bearer/x-cron-secret.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logCronRun } from '@/lib/cron-runs'
import { writeCurrentSnapshot, backfillCashFromLedger } from '@/lib/financial-snapshots'
import { sweepSlackEventsSeen } from '@/lib/slack/events-seen'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface StepResult {
  name: string
  ok: boolean
  error?: string
  detail?: unknown
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  // Auth: admin session OR cron secret (GH Action sends x-cron-secret).
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const auth = await getRequestAuth(req)
    if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const denied = await requireFeature(auth, 'financial_reports')
    if (denied) return denied
  }

  const database = (await db()) as unknown as D1
  const steps: StepResult[] = []

  // Optional one-time backfill of past month-end cash from the Airwallex
  // ledger. Runs first so a fresh current-month write is never blocked by it.
  const wantBackfill = new URL(req.url).searchParams.get('backfill') === '1'
  if (wantBackfill) {
    try {
      const detail = await backfillCashFromLedger(database)
      steps.push({ name: 'backfill-cash', ok: true, detail })
    } catch (err) {
      steps.push({ name: 'backfill-cash', ok: false, error: err instanceof Error ? err.message : 'Backfill failed' })
    }
  }

  // Always: upsert the current month's snapshot from live metrics.
  try {
    const detail = await writeCurrentSnapshot(database)
    steps.push({ name: 'write-current', ok: true, detail })
  } catch (err) {
    steps.push({ name: 'write-current', ok: false, error: err instanceof Error ? err.message : 'Write failed' })
  }

  // Housekeeping, after the snapshot so it can never hold the snapshot up:
  // drop Slack delivery ids older than a week. Its own try, so a failure is
  // this step's red mark and nothing more.
  try {
    const detail = await sweepSlackEventsSeen(database)
    steps.push({ name: 'sweep-slack-events', ok: true, detail })
  } catch (err) {
    steps.push({ name: 'sweep-slack-events', ok: false, error: err instanceof Error ? err.message : 'Sweep failed' })
  }

  // 'write-current' is the load-bearing step; only log 'error' if it failed.
  const currentOk = steps.find(s => s.name === 'write-current')?.ok ?? false
  const status = currentOk ? 'success' : 'error'
  await logCronRun(database, 'snapshot-metrics', status, Date.now() - t0, { steps }, currentOk ? null : 'Current-month snapshot write failed')

  return NextResponse.json({ steps })
}

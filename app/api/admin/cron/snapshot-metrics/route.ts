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
 * Airwallex ledger for months that have NO row yet. It never overwrites an
 * existing row: a re-run would otherwise restate settled months from
 * today's FX and today's P&L. It writes no month that ended after Airwallex
 * yield was first held (finance.yieldFirstHeldAt, which the Airwallex sync
 * writes and nothing clears; nothing at all while it says 'unknown'),
 * because the yield held at a past month end is not stored and the Cash
 * card counts it.
 *
 * ?backfill=1&refresh=1 is the explicit opt-in to recompute the rows an
 * earlier backfill wrote (source 'backfill'). A 'cron' row is never
 * overwritten, refresh or not. refresh=1 without backfill=1 is refused (400).
 *
 * ?fill=YYYY-MM writes ONE missing past month and does nothing else: no
 * current-month write, no backfill, no Slack sweep. Insert only, never an
 * upsert; it touches no other month. Cash, burn and runway are rebuilt the
 * way the backfill rebuilds them (no cash or runway for a month that ended
 * after yield was first held),
 * money owed only when the invoice dates prove it and the invoice ledger
 * reaches back to the month, MRR and active clients never (no history of
 * them is kept). The response names every field's value and basis, or why
 * it was left null. See fillMonthSnapshot in lib/financial-snapshots.ts.
 * Outcomes:
 *   200 written, and logged to cron_runs as a snapshot-metrics run.
 *   400 not YYYY-MM from 2000 on, the current month, a future month, a
 *       month that ended before any data we hold (code before_data), or
 *       combined with backfill / refresh.
 *   409 the month already has a row. Nothing written.
 *   422 the Airwallex balances were read before the month ended (code
 *       balances_stale: run the Airwallex sync, then fill), or neither cash
 *       nor money owed can be rebuilt (code nothing_derivable; burn alone is
 *       not written). Nothing written.
 *   500 a read or the write failed, logged to cron_runs as an error.
 * Refusals write nothing and log nothing.
 *
 * It also carries one piece of daily housekeeping that has nothing to do with
 * money: the sweep of the Slack app's retry guard table (slack_events_seen,
 * see lib/slack/events-seen.ts). It rides here because this is a daily route
 * that always reaches its steps (no connection check or quiet-day return in
 * front of them) and already reports each step on its own. The sweep runs
 * after the snapshot and never decides the run's status, so a failed sweep
 * shows as a failed step and the snapshot still logs as a success.
 *
 * Response (daily and backfill): { steps: [{ name, ok, error?, detail? }] },
 * always HTTP 200. Fill: { mode: 'fill', steps } or { error, code }, with the
 * statuses above.
 *
 * Auth: admin session (financial_reports feature) OR Bearer/x-cron-secret.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logCronRun } from '@/lib/cron-runs'
import {
  writeCurrentSnapshot,
  backfillCashFromLedger,
  fillMonthSnapshot,
  SnapshotFillRefusal,
  type FillMonthResult,
} from '@/lib/financial-snapshots'
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

  const params = new URL(req.url).searchParams
  const fillMonth = params.get('fill')
  const wantBackfill = params.get('backfill') === '1'
  const wantRefresh = params.get('refresh') === '1'

  // The fill is a one-month insert and nothing else, so it does not combine
  // with the backfill flags.
  if (fillMonth !== null && (wantBackfill || wantRefresh)) {
    return NextResponse.json(
      { error: 'fill runs on its own: drop backfill and refresh. A fill only ever inserts one missing month.', code: 'invalid_combination' },
      { status: 400 },
    )
  }
  if (wantRefresh && !wantBackfill) {
    return NextResponse.json(
      { error: 'refresh=1 only applies together with backfill=1.', code: 'invalid_combination' },
      { status: 400 },
    )
  }

  const database = (await db()) as unknown as D1

  if (fillMonth !== null) return runFill(database, fillMonth, t0)

  const steps: StepResult[] = []

  // Optional backfill of past month-end cash from the Airwallex ledger, for
  // months with no row (or, with refresh, the rows a backfill wrote). Runs
  // first so a fresh current-month write is never blocked by it.
  if (wantBackfill) {
    try {
      const detail = await backfillCashFromLedger(database, new Date(), { refresh: wantRefresh })
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

/** How many blocking invoices a logged fill keeps; the response keeps them all. */
const LOGGED_AMBIGUOUS = 10

/**
 * A fill's result as cron_runs keeps it: everything but the long tail of
 * owed.ambiguous, which is capped with its full count beside it, so a month
 * with many rows in doubt does not bloat the run log.
 */
function fillLogDetail(detail: FillMonthResult): unknown {
  const owed = detail.owed as FillMonthResult['owed'] | undefined
  if (!owed || owed.ambiguous.length <= LOGGED_AMBIGUOUS) return detail
  return {
    ...detail,
    owed: { ...owed, ambiguous: owed.ambiguous.slice(0, LOGGED_AMBIGUOUS), ambiguousCount: owed.ambiguous.length },
  }
}

/**
 * The ?fill=YYYY-MM branch. A refusal is the caller's answer and writes
 * nothing, so it is not logged; a write, or a write that failed, is logged
 * under snapshot-metrics so it shows beside the daily runs.
 */
async function runFill(database: D1, monthKey: string, t0: number): Promise<NextResponse> {
  try {
    const detail = await fillMonthSnapshot(database, monthKey)
    const steps: StepResult[] = [{ name: 'fill-month', ok: true, detail }]
    const logged: StepResult[] = [{ name: 'fill-month', ok: true, detail: fillLogDetail(detail) }]
    await logCronRun(database, 'snapshot-metrics', 'success', Date.now() - t0, { mode: 'fill', monthKey, steps: logged }, null)
    return NextResponse.json({ mode: 'fill', steps })
  } catch (err) {
    if (err instanceof SnapshotFillRefusal) {
      return NextResponse.json(
        { error: err.message, code: err.code, monthKey, existing: err.existing },
        { status: err.status },
      )
    }
    const message = err instanceof Error ? err.message : 'Fill failed'
    const steps: StepResult[] = [{ name: 'fill-month', ok: false, error: message }]
    await logCronRun(database, 'snapshot-metrics', 'error', Date.now() - t0, { mode: 'fill', monthKey, steps }, `Fill of ${monthKey} failed`)
    return NextResponse.json({ mode: 'fill', steps }, { status: 500 })
  }
}

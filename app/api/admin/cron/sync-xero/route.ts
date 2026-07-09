/**
 * POST /api/admin/cron/sync-xero
 *
 * Daily orchestrator that refreshes all Xero finance data in one call so the
 * GitHub Actions cron doesn't have to fire four separate endpoints. Runs, in
 * order: bank balances, invoice payment statuses, P&L snapshots, ACCREC
 * invoice import.
 *
 * Each sub-sync is isolated: a failure in one (e.g. a single P&L month, or a
 * transient Xero error) is captured and reported but never stops the others.
 * If Xero isn't connected (no valid token), every step is reported as not-run
 * and the run is logged 'skipped' — a disconnected integration is not a cron
 * failure.
 *
 * Response: { steps: [{ name, ok, error?, count? }] }, always HTTP 200.
 *
 * Auth: admin session OR Bearer/x-cron-secret cron secret.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getValidXeroToken } from '@/lib/xero'
import { logCronRun } from '@/lib/cron-runs'
import { syncXeroBalances, syncXeroPayments, syncXeroPnl, importXeroInvoices } from '@/lib/xero-sync'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface StepResult {
  name: string
  ok: boolean
  error?: string
  count?: number
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
    const denied = await requireFeature(auth, 'settings.integrations')
    if (denied) return denied
  }

  // P&L window. Keep the daily run cheap: older months rarely change, so we
  // only refresh the last few. Pass { pnlMonths } (clamped 1..24) to widen,
  // or run the standalone sync-pnl route with months=12 for a full backfill.
  const bodyIn = (await req.json().catch(() => ({}))) as { pnlMonths?: number }
  const pnlMonths = Math.max(1, Math.min(24, bodyIn.pnlMonths ?? 3))

  const database = (await db()) as unknown as D1
  const steps: StepResult[] = []

  // If Xero has no valid token, it isn't connected. Not a cron failure —
  // report each step as not-run and log 'skipped'.
  const token = await getValidXeroToken()
  if (!token) {
    const reason = 'Xero not connected (no valid token — check XERO_CLIENT_ID/SECRET and tenant)'
    for (const name of ['balances', 'payments', 'pnl', 'import-invoices']) {
      steps.push({ name, ok: false, error: reason })
    }
    await logCronRun(database, 'sync-xero', 'skipped', Date.now() - t0, { steps, reason }, null)
    return NextResponse.json({ steps })
  }

  const balances = await syncXeroBalances(database)
  steps.push({ name: 'balances', ok: balances.ok, error: balances.ok ? undefined : balances.error, count: balances.count })

  const payments = await syncXeroPayments(database)
  steps.push({ name: 'payments', ok: payments.ok, error: payments.ok ? undefined : payments.error, count: payments.count })

  const pnl = await syncXeroPnl(database, pnlMonths)
  steps.push({ name: 'pnl', ok: pnl.ok, error: pnl.ok ? undefined : pnl.error, count: pnl.count })

  const invoices = await importXeroInvoices(database, 1)
  steps.push({ name: 'import-invoices', ok: invoices.ok, error: invoices.ok ? undefined : invoices.error, count: invoices.count })

  // Any successful step => the run did useful work. Only when every step
  // failed do we log 'error' (which pings the operator via cron-runs).
  const okCount = steps.filter(s => s.ok).length
  const status = okCount > 0 ? 'success' : 'error'
  await logCronRun(database, 'sync-xero', status, Date.now() - t0, { steps }, okCount > 0 ? null : 'All Xero sub-syncs failed')

  return NextResponse.json({ steps })
}

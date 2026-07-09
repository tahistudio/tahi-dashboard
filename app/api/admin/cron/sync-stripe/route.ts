/**
 * POST /api/admin/cron/sync-stripe
 *
 * Daily orchestrator that refreshes Stripe finance data in one call so the
 * GitHub Actions cron doesn't have to fire two separate endpoints. Runs, in
 * order: one-off payment import (charges without invoices), then invoice
 * import.
 *
 * Each sub-sync is isolated: a failure in one is captured and reported but
 * never stops the other. If Stripe isn't configured (no STRIPE_SECRET_KEY),
 * both steps are reported as not-run and the run is logged 'skipped' — an
 * unconfigured integration is not a cron failure.
 *
 * Response: { steps: [{ name, ok, error?, count? }] }, always HTTP 200.
 *
 * Auth: admin session OR Bearer/x-cron-secret cron secret.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logCronRun } from '@/lib/cron-runs'
import { importStripePayments, importStripeInvoices } from '@/lib/stripe-sync'

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

  const database = (await db()) as unknown as D1
  const steps: StepResult[] = []

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    const reason = 'Stripe not configured (STRIPE_SECRET_KEY missing)'
    steps.push({ name: 'import-payments', ok: false, error: reason })
    steps.push({ name: 'import-invoices', ok: false, error: reason })
    await logCronRun(database, 'sync-stripe', 'skipped', Date.now() - t0, { steps, reason }, null)
    return NextResponse.json({ steps })
  }

  const payments = await importStripePayments(database, stripeKey)
  steps.push({ name: 'import-payments', ok: payments.ok, error: payments.ok ? undefined : payments.error, count: payments.count })

  const invoices = await importStripeInvoices(database, stripeKey)
  steps.push({ name: 'import-invoices', ok: invoices.ok, error: invoices.ok ? undefined : invoices.error, count: invoices.count })

  // Any successful step => the run did useful work. Only when every step
  // failed do we log 'error' (which pings the operator via cron-runs).
  const okCount = steps.filter(s => s.ok).length
  const status = okCount > 0 ? 'success' : 'error'
  await logCronRun(database, 'sync-stripe', status, Date.now() - t0, { steps }, okCount > 0 ? null : 'All Stripe sub-syncs failed')

  return NextResponse.json({ steps })
}

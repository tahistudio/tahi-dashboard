import { requireStudioAdmin } from '@/lib/internal-route-access'
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
import { stripeSecretKey } from '@/lib/stripe-key'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logCronRun, hasCronSecretAuth } from '@/lib/cron-runs'
import { importStripePayments, importStripeInvoices } from '@/lib/stripe-sync'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface StepResult {
  name: string
  ok: boolean
  error?: string
  count?: number
  /** Stripe customers whose money was skipped because no client is linked to them. */
  unlinked?: string[]
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  // Auth: admin session OR cron secret (GH Action sends x-cron-secret).
  const hasCronAuth = hasCronSecretAuth(req)
  if (!hasCronAuth) {
    const auth = await getRequestAuth(req)
    if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const roleDenied = await requireStudioAdmin(auth, 'settings')
    if (roleDenied) return roleDenied
    const denied = await requireFeature(auth, 'settings.integrations')
    if (denied) return denied
  }

  const database = (await db()) as unknown as D1
  const steps: StepResult[] = []

  const stripeKey = stripeSecretKey()
  if (!stripeKey) {
    const reason = 'Stripe not configured (STRIPE_SECRET_KEY missing)'
    steps.push({ name: 'import-payments', ok: false, error: reason })
    steps.push({ name: 'import-invoices', ok: false, error: reason })
    await logCronRun(database, 'sync-stripe', 'skipped', Date.now() - t0, { steps, reason }, null)
    return NextResponse.json({ steps })
  }

  const payments = await importStripePayments(database, stripeKey)
  steps.push({ name: 'import-payments', ok: payments.ok, error: payments.ok ? undefined : payments.error, count: payments.count, unlinked: unlinkedCustomers(payments.body) })

  const invoices = await importStripeInvoices(database, stripeKey)
  steps.push({ name: 'import-invoices', ok: invoices.ok, error: invoices.ok ? undefined : invoices.error, count: invoices.count, unlinked: unlinkedCustomers(invoices.body) })

  // Any successful step => the run did useful work. Only when every step
  // failed do we log 'error' (which pings the operator via cron-runs).
  const okCount = steps.filter(s => s.ok).length
  const status = okCount > 0 ? 'success' : 'error'
  await logCronRun(database, 'sync-stripe', status, Date.now() - t0, { steps }, okCount > 0 ? null : 'All Stripe sub-syncs failed')

  return NextResponse.json({ steps })
}

/**
 * Money the sync skipped because its Stripe customer is not linked to a
 * client. Logged on every run so a nightly "0 imported" cannot hide real
 * payments waiting to be linked.
 */
function unlinkedCustomers(body: unknown): string[] | undefined {
  const results = (body as { results?: Array<{ status?: string; orgMatch?: string }> } | null)?.results
  if (!Array.isArray(results)) return undefined
  const lines = results.filter(r => r.status === 'no_client_linked' && r.orgMatch).map(r => String(r.orgMatch))
  return lines.length > 0 ? Array.from(new Set(lines)).slice(0, 50) : undefined
}

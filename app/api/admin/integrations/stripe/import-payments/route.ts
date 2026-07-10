import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { stripeSecretKey } from '@/lib/stripe-key'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { importStripePayments } from '@/lib/stripe-sync'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/integrations/stripe/import-payments
 * Import one-off Stripe payments (charges without invoices) as paid invoices.
 *
 * Core logic lives in lib/stripe-sync.ts so the daily orchestrator cron
 * (POST /api/admin/cron/sync-stripe) can reuse it without an HTTP self-call.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const database = (await db()) as D1
  const outcome = await importStripePayments(database, stripeSecretKey())
  return NextResponse.json(outcome.body, { status: outcome.status })
}

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { importStripeInvoice, type StripeInvoiceLike } from '@/lib/stripe-import'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/integrations/stripe/import-invoices
 * Import invoices from Stripe using fetch (no SDK, CF Workers compatible).
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const database = await db() as unknown as D1

  try {
    // Fetch invoices from Stripe via REST API
    const stripeRes = await fetch('https://api.stripe.com/v1/invoices?limit=100&expand[]=data.lines', {
      headers: { Authorization: `Bearer ${stripeKey}` },
    })

    if (!stripeRes.ok) {
      const errText = await stripeRes.text()
      return NextResponse.json({ error: 'Stripe API error', message: errText }, { status: 502 })
    }

    const stripeData = await stripeRes.json() as { data: StripeInvoiceLike[] }

    let imported = 0
    let updated = 0
    let skipped = 0
    const results: Array<{ number: string | null | undefined; status: string; orgMatch?: string }> = []

    for (const inv of stripeData.data) {
      const res = await importStripeInvoice(database, inv, { autoCreateOrg: true })
      if ('skipped' in res) {
        skipped++
        results.push({ number: inv.number, status: 'error', orgMatch: res.reason })
      } else if (res.created) {
        imported++
        results.push({ number: inv.number, status: 'imported', orgMatch: inv.customer_name ?? undefined })
      } else {
        updated++
        results.push({ number: inv.number, status: 'updated' })
      }
    }

    return NextResponse.json({ success: true, imported, updated, skipped, total: stripeData.data.length, results })
  } catch (err) {
    return NextResponse.json({
      error: 'Stripe import failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}

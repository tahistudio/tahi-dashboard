import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { importStripeInvoice, type StripeInvoiceLike } from '@/lib/stripe-import'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/integrations/stripe/import-invoices
 * Import invoices from Stripe using fetch (no SDK, CF Workers compatible).
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const database = await db() as unknown as D1

  try {
    // Fetch ALL invoices from Stripe, paging past the 100-per-request cap
    // via the `starting_after` cursor. MAX_PAGES bounds the worst case so a
    // huge account can't run the Worker past its CPU budget; the response
    // reports `truncated` if we stopped early.
    const MAX_PAGES = 25
    const allInvoices: StripeInvoiceLike[] = []
    let startingAfter: string | null = null
    let hasMore = true
    let pages = 0

    while (hasMore && pages < MAX_PAGES) {
      let url = 'https://api.stripe.com/v1/invoices?limit=100&expand[]=data.lines'
      if (startingAfter) url += `&starting_after=${startingAfter}`

      const stripeRes = await fetch(url, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      })

      if (!stripeRes.ok) {
        // First page failing is a hard error; a later page failing just stops
        // paging and we import what we already pulled.
        if (pages === 0) {
          const errText = await stripeRes.text()
          return NextResponse.json({ error: 'Stripe API error', message: errText }, { status: 502 })
        }
        break
      }

      const page = await stripeRes.json() as { data: StripeInvoiceLike[]; has_more?: boolean }
      allInvoices.push(...page.data)
      startingAfter = page.data.length ? page.data[page.data.length - 1].id : null
      hasMore = !!page.has_more && page.data.length > 0
      pages++
    }

    const truncated = hasMore

    let imported = 0
    let updated = 0
    let skipped = 0
    const results: Array<{ number: string | null | undefined; status: string; orgMatch?: string }> = []

    for (const inv of allInvoices) {
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

    return NextResponse.json({ success: true, imported, updated, skipped, total: allInvoices.length, truncated, results })
  } catch (err) {
    return NextResponse.json({
      error: 'Stripe import failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}

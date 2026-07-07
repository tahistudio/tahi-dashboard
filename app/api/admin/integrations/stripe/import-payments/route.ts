import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface StripeCharge {
  id: string
  amount: number
  currency: string
  status: string
  description: string | null
  invoice: string | null
  payment_intent: string | null
  customer: string | null
  receipt_email: string | null
  billing_details: { email: string | null; name: string | null } | null
  created: number
  paid: boolean
  refunded: boolean
  statement_descriptor: string | null
  metadata: Record<string, string>
}

/**
 * POST /api/admin/integrations/stripe/import-payments
 * Import one-off Stripe payments (charges without invoices) as paid invoices.
 * These are Checkout Session payments, direct charges, etc.
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
    // Fetch charges from Stripe, paging past the 100-per-request cap via the
    // `starting_after` cursor. Stripe lists newest-first. PAGE_SIZE * MAX_PAGES
    // is the hard ceiling per run so a huge account can't burn the Worker's CPU
    // budget; `truncated` is reported if we stopped on the ceiling with more to
    // pull, and `pagesWalked` reports how many pages we actually fetched.
    const PAGE_SIZE = 100
    const MAX_PAGES = 10 // hard ceiling: 1000 charges per run
    const allCharges: StripeCharge[] = []
    let startingAfter: string | null = null
    let hasMore = true
    let pagesWalked = 0

    while (hasMore && pagesWalked < MAX_PAGES) {
      let url = `https://api.stripe.com/v1/charges?limit=${PAGE_SIZE}`
      if (startingAfter) url += `&starting_after=${startingAfter}`

      const chargesRes = await fetch(url, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      })

      if (!chargesRes.ok) {
        if (pagesWalked === 0) return NextResponse.json({ error: 'Stripe API error' }, { status: 502 })
        break
      }

      const page = await chargesRes.json() as { data: StripeCharge[]; has_more?: boolean }
      allCharges.push(...page.data)
      startingAfter = page.data.length ? page.data[page.data.length - 1].id : null
      hasMore = !!page.has_more && page.data.length > 0
      pagesWalked++
    }

    const truncated = hasMore

    // Get existing stripeInvoiceIds to avoid duplicates (we use charge ID as stripeInvoiceId for these)
    const existing = await database
      .select({ stripeInvoiceId: schema.invoices.stripeInvoiceId })
      .from(schema.invoices)
      .where(sql`${schema.invoices.stripeInvoiceId} IS NOT NULL`)
    const existingIds = new Set(existing.map(e => e.stripeInvoiceId))

    // Get all orgs with stripeCustomerId
    const orgs = await database
      .select({ id: schema.organisations.id, name: schema.organisations.name, stripeCustomerId: schema.organisations.stripeCustomerId })
      .from(schema.organisations)
    const orgByCustomerId = new Map(orgs.filter(o => o.stripeCustomerId).map(o => [o.stripeCustomerId, o]))

    const now = new Date().toISOString()
    let imported = 0
    let skipped = 0
    const results: Array<{ chargeId: string; status: string; amount?: number; orgMatch?: string }> = []

    // In-run dedupe of payment_intents. Stripe can emit more than one charge
    // object for a single payment (e.g. a retried/updated PaymentIntent); we
    // only want one local row per payment. Seeded so we never race the DB set.
    const seenPaymentIntents = new Set<string>()

    for (const charge of allCharges) {
      // Prefer the invoice-linked record: any charge tied to an invoice is
      // owned by the invoice import (in_* row), so skip the bare ch_* here.
      // Also skip when that invoice was already imported as a local row.
      if (charge.invoice) {
        skipped++
        continue
      }

      // Skip refunded or non-succeeded charges outright.
      if (charge.status !== 'succeeded' || charge.refunded) {
        skipped++
        continue
      }

      // Idempotency: this charge was already imported on a previous run (we
      // store the charge id as stripeInvoiceId), so re-running never dupes.
      if (existingIds.has(charge.id)) {
        skipped++
        results.push({ chargeId: charge.id, status: 'already_exists' })
        continue
      }

      // Dedupe two charges that share one PaymentIntent within this run.
      if (charge.payment_intent) {
        if (seenPaymentIntents.has(charge.payment_intent)) {
          skipped++
          results.push({ chargeId: charge.id, status: 'duplicate_payment' })
          continue
        }
        seenPaymentIntents.add(charge.payment_intent)
      }

      // Match customer
      let matchedOrgId: string | null = null
      if (charge.customer) {
        const org = orgByCustomerId.get(charge.customer)
        if (org) matchedOrgId = org.id
      }

      // Auto-create org from billing details if no match
      const customerName = charge.billing_details?.name ?? charge.receipt_email ?? charge.description ?? 'Unknown'
      if (!matchedOrgId) {
        const newOrgId = crypto.randomUUID()
        try {
          await database.insert(schema.organisations).values({
            id: newOrgId,
            name: customerName,
            status: 'active',
            healthStatus: 'green',
            stripeCustomerId: charge.customer,
            onboardingState: '{}',
            brands: '[]',
            customFields: '{}',
            preferredCurrency: charge.currency.toUpperCase(),
            createdAt: now,
            updatedAt: now,
          })
          matchedOrgId = newOrgId
          if (charge.customer) orgByCustomerId.set(charge.customer, { id: newOrgId, name: customerName, stripeCustomerId: charge.customer })
        } catch {
          results.push({ chargeId: charge.id, status: 'error', orgMatch: 'Failed to create org' })
          continue
        }
      }

      const amount = charge.amount / 100
      const currency = charge.currency.toUpperCase()
      const invoiceId = crypto.randomUUID()
      const desc = charge.description ?? charge.statement_descriptor ?? 'Stripe payment'

      try {
        await database.insert(schema.invoices).values({
          id: invoiceId,
          orgId: matchedOrgId,
          stripeInvoiceId: charge.id, // Use charge ID to prevent re-import
          source: 'stripe',
          status: 'paid',
          amountUsd: amount,
          totalUsd: amount,
          currency,
          paidAt: new Date(charge.created * 1000).toISOString(),
          notes: `Stripe payment: ${desc}`,
          createdAt: new Date(charge.created * 1000).toISOString(),
          updatedAt: now,
        })

        await database.insert(schema.invoiceItems).values({
          id: crypto.randomUUID(),
          invoiceId,
          description: desc,
          quantity: 1,
          unitPriceUsd: amount,
          totalUsd: amount,
        })

        existingIds.add(charge.id) // guard against a repeated id inside one run
        imported++
        results.push({
          chargeId: charge.id,
          status: 'imported',
          amount,
          orgMatch: customerName,
        })
      } catch (err) {
        results.push({
          chargeId: charge.id,
          status: 'error',
          orgMatch: err instanceof Error ? err.message : 'Insert failed',
        })
      }
    }

    return NextResponse.json({ success: true, imported, skipped, total: allCharges.length, pagesWalked, truncated, results })
  } catch (err) {
    return NextResponse.json({
      error: 'Stripe payments import failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}

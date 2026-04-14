import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
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
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const database = await db() as unknown as D1

  try {
    // Fetch charges from Stripe (one-off payments)
    const chargesRes = await fetch('https://api.stripe.com/v1/charges?limit=100', {
      headers: { Authorization: `Bearer ${stripeKey}` },
    })

    if (!chargesRes.ok) {
      return NextResponse.json({ error: 'Stripe API error' }, { status: 502 })
    }

    const chargesData = await chargesRes.json() as { data: StripeCharge[] }

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

    for (const charge of chargesData.data) {
      // Skip charges that are linked to invoices (already imported via invoice import)
      if (charge.invoice) {
        skipped++
        continue
      }

      // Skip refunded, failed, or already imported
      if (charge.status !== 'succeeded' || charge.refunded) {
        skipped++
        continue
      }

      if (existingIds.has(charge.id)) {
        skipped++
        results.push({ chargeId: charge.id, status: 'already_exists' })
        continue
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

    return NextResponse.json({ success: true, imported, skipped, total: chargesData.data.length, results })
  } catch (err) {
    return NextResponse.json({
      error: 'Stripe payments import failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}

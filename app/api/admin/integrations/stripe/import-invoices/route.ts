import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'
import Stripe from 'stripe'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion })
}

function mapStripeStatus(status: string): string {
  switch (status) {
    case 'draft': return 'draft'
    case 'open': return 'sent'
    case 'paid': return 'paid'
    case 'void': return 'written_off'
    case 'uncollectible': return 'written_off'
    default: return 'draft'
  }
}

/**
 * POST /api/admin/integrations/stripe/import-invoices
 * Import invoices from Stripe into the dashboard.
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const database = await db() as unknown as D1

  try {
    // Get existing stripeInvoiceIds to skip duplicates
    const existing = await database
      .select({ stripeInvoiceId: schema.invoices.stripeInvoiceId })
      .from(schema.invoices)
      .where(sql`${schema.invoices.stripeInvoiceId} IS NOT NULL`)
    const existingIds = new Set(existing.map(e => e.stripeInvoiceId))

    // Get all orgs with stripeCustomerId for matching
    const orgs = await database
      .select({ id: schema.organisations.id, name: schema.organisations.name, stripeCustomerId: schema.organisations.stripeCustomerId })
      .from(schema.organisations)
    const orgByCustomerId = new Map(orgs.filter(o => o.stripeCustomerId).map(o => [o.stripeCustomerId, o]))

    // Fetch invoices from Stripe
    const stripeInvoices = await stripe.invoices.list({ limit: 100, expand: ['data.lines'] })

    const now = new Date().toISOString()
    let imported = 0
    let skipped = 0
    const results: Array<{ number: string | null; status: string; orgMatch?: string }> = []

    for (const inv of stripeInvoices.data) {
      if (existingIds.has(inv.id)) {
        skipped++
        results.push({ number: inv.number, status: 'already_exists' })
        continue
      }

      // Match to org by stripeCustomerId
      let matchedOrgId: string | null = null
      if (inv.customer && typeof inv.customer === 'string') {
        const org = orgByCustomerId.get(inv.customer)
        if (org) matchedOrgId = org.id
      }

      // If no org match, try to create from customer name
      if (!matchedOrgId && inv.customer_name) {
        const newOrgId = crypto.randomUUID()
        try {
          await database.insert(schema.organisations).values({
            id: newOrgId,
            name: inv.customer_name,
            status: 'active',
            healthStatus: 'green',
            stripeCustomerId: typeof inv.customer === 'string' ? inv.customer : null,
            onboardingState: '{}',
            brands: '[]',
            customFields: '{}',
            preferredCurrency: (inv.currency ?? 'nzd').toUpperCase(),
            createdAt: now,
            updatedAt: now,
          })
          matchedOrgId = newOrgId
          orgByCustomerId.set(typeof inv.customer === 'string' ? inv.customer : '', { id: newOrgId, name: inv.customer_name, stripeCustomerId: typeof inv.customer === 'string' ? inv.customer : null })
        } catch {
          results.push({ number: inv.number, status: 'error', orgMatch: 'Failed to create org' })
          continue
        }
      }

      if (!matchedOrgId) {
        results.push({ number: inv.number, status: 'error', orgMatch: 'No matching customer' })
        continue
      }

      const invoiceId = crypto.randomUUID()
      const localStatus = mapStripeStatus(inv.status ?? 'draft')

      try {
        await database.insert(schema.invoices).values({
          id: invoiceId,
          orgId: matchedOrgId,
          stripeInvoiceId: inv.id,
          source: 'stripe',
          status: localStatus,
          amountUsd: (inv.subtotal ?? 0) / 100,
          totalUsd: (inv.total ?? 0) / 100,
          currency: (inv.currency ?? 'nzd').toUpperCase(),
          dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString().split('T')[0] : null,
          paidAt: inv.status === 'paid' && inv.status_transitions?.paid_at
            ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
            : null,
          notes: `Imported from Stripe: ${inv.number ?? inv.id}`,
          createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : now,
          updatedAt: now,
        })

        // Import line items
        if (inv.lines?.data) {
          for (const line of inv.lines.data) {
            await database.insert(schema.invoiceItems).values({
              id: crypto.randomUUID(),
              invoiceId,
              description: line.description ?? 'Line item',
              quantity: line.quantity ?? 1,
              unitPriceUsd: (line.amount ?? 0) / 100 / (line.quantity ?? 1),
              totalUsd: (line.amount ?? 0) / 100,
            })
          }
        }

        imported++
        results.push({
          number: inv.number,
          status: 'imported',
          orgMatch: orgs.find(o => o.id === matchedOrgId)?.name,
        })
      } catch (insertErr) {
        results.push({
          number: inv.number,
          status: 'error',
          orgMatch: insertErr instanceof Error ? insertErr.message : 'Insert failed',
        })
      }
    }

    return NextResponse.json({ success: true, imported, skipped, total: stripeInvoices.data.length, results })
  } catch (err) {
    return NextResponse.json({
      error: 'Stripe import failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}

/**
 * lib/stripe-sync.ts
 *
 * Shared, reusable core for the two Stripe finance imports. Extracted from
 * the per-integration route handlers so BOTH the standalone routes
 * (POST /api/admin/integrations/stripe/{import-payments,import-invoices})
 * and the daily orchestrator cron (POST /api/admin/cron/sync-stripe) call
 * the same logic without an internal HTTP self-call.
 *
 * Each function returns a SyncOutcome (see lib/xero-sync.ts) rather than a
 * NextResponse, and catches its own errors so one failing import never
 * throws into the orchestrator and stops the other.
 */

import { schema } from '@/db/d1'
import { sql } from 'drizzle-orm'
import { importStripeInvoice, type StripeInvoiceLike } from '@/lib/stripe-import'
import type { SyncOutcome } from '@/lib/xero-sync'

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
 * Import one-off Stripe payments (charges without invoices) as paid
 * invoices. Idempotent: the charge id is stored as stripeInvoiceId so a
 * re-run skips anything already imported.
 */
export async function importStripePayments(database: D1, stripeKey: string | undefined): Promise<SyncOutcome> {
  if (!stripeKey) {
    return { ok: false, status: 503, body: { error: 'Stripe not configured' }, error: 'Stripe not configured' }
  }

  try {
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
        if (pagesWalked === 0) return { ok: false, status: 502, body: { error: 'Stripe API error' }, error: 'Stripe API error' }
        break
      }

      const pageData = await chargesRes.json() as { data: StripeCharge[]; has_more?: boolean }
      allCharges.push(...pageData.data)
      startingAfter = pageData.data.length ? pageData.data[pageData.data.length - 1].id : null
      hasMore = !!pageData.has_more && pageData.data.length > 0
      pagesWalked++
    }

    const truncated = hasMore

    const existing = await database
      .select({ stripeInvoiceId: schema.invoices.stripeInvoiceId })
      .from(schema.invoices)
      .where(sql`${schema.invoices.stripeInvoiceId} IS NOT NULL`)
    const existingIds = new Set(existing.map(e => e.stripeInvoiceId))

    const orgs = await database
      .select({ id: schema.organisations.id, name: schema.organisations.name, stripeCustomerId: schema.organisations.stripeCustomerId })
      .from(schema.organisations)
    const orgByCustomerId = new Map(orgs.filter(o => o.stripeCustomerId).map(o => [o.stripeCustomerId, o]))

    const now = new Date().toISOString()
    let imported = 0
    let skipped = 0
    const results: Array<{ chargeId: string; status: string; amount?: number; orgMatch?: string }> = []

    const seenPaymentIntents = new Set<string>()

    for (const charge of allCharges) {
      if (charge.invoice) {
        skipped++
        continue
      }

      if (charge.status !== 'succeeded' || charge.refunded) {
        skipped++
        continue
      }

      if (existingIds.has(charge.id)) {
        skipped++
        results.push({ chargeId: charge.id, status: 'already_exists' })
        continue
      }

      if (charge.payment_intent) {
        if (seenPaymentIntents.has(charge.payment_intent)) {
          skipped++
          results.push({ chargeId: charge.id, status: 'duplicate_payment' })
          continue
        }
        seenPaymentIntents.add(charge.payment_intent)
      }

      let matchedOrgId: string | null = null
      if (charge.customer) {
        const org = orgByCustomerId.get(charge.customer)
        if (org) matchedOrgId = org.id
      }

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
          stripeInvoiceId: charge.id,
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

        existingIds.add(charge.id)
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

    const body = { success: true, imported, skipped, total: allCharges.length, pagesWalked, truncated, results }
    return { ok: true, status: 200, body, count: imported }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, status: 500, body: { error: 'Stripe payments import failed', message: msg }, error: msg }
  }
}

/**
 * Import invoices from Stripe (paged) using the shared importStripeInvoice
 * upsert. Idempotent: existing local rows are updated in place, new ones
 * created and matched (or auto-created) to an org.
 */
export async function importStripeInvoices(database: D1, stripeKey: string | undefined): Promise<SyncOutcome> {
  if (!stripeKey) {
    return { ok: false, status: 503, body: { error: 'Stripe not configured' }, error: 'Stripe not configured' }
  }

  try {
    const PAGE_SIZE = 100
    const MAX_PAGES = 10 // hard ceiling: 1000 invoices per run
    const allInvoices: StripeInvoiceLike[] = []
    let startingAfter: string | null = null
    let hasMore = true
    let pagesWalked = 0

    while (hasMore && pagesWalked < MAX_PAGES) {
      let url = `https://api.stripe.com/v1/invoices?limit=${PAGE_SIZE}&expand[]=data.lines`
      if (startingAfter) url += `&starting_after=${startingAfter}`

      const stripeRes = await fetch(url, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      })

      if (!stripeRes.ok) {
        if (pagesWalked === 0) {
          const errText = await stripeRes.text()
          return { ok: false, status: 502, body: { error: 'Stripe API error', message: errText }, error: 'Stripe API error' }
        }
        break
      }

      const pageData = await stripeRes.json() as { data: StripeInvoiceLike[]; has_more?: boolean }
      allInvoices.push(...pageData.data)
      startingAfter = pageData.data.length ? pageData.data[pageData.data.length - 1].id : null
      hasMore = !!pageData.has_more && pageData.data.length > 0
      pagesWalked++
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

    const body = { success: true, imported, updated, skipped, total: allInvoices.length, pagesWalked, truncated, results }
    return { ok: true, status: 200, body, count: imported }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, status: 500, body: { error: 'Stripe import failed', message: msg }, error: msg }
  }
}

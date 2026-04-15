/**
 * lib/stripe-import.ts
 *
 * Shared logic for importing a single Stripe invoice into the local DB.
 * Used by:
 *   - POST /api/admin/integrations/stripe/import-invoices  (bulk pull)
 *   - POST /api/webhooks/stripe (invoice.paid self-heal — creates the local
 *     row if it didn't exist when the payment fires)
 */

import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Shape of Stripe invoice fields we actually use. Loose typing on purpose
 *  since Stripe types differ between our REST-fetched JSON and the Stripe
 *  SDK types used in the webhook handler. */
export interface StripeInvoiceLike {
  id: string
  number?: string | null
  status?: string | null
  customer?: string | null
  customer_name?: string | null
  currency?: string | null
  subtotal?: number
  total?: number
  amount_paid?: number
  due_date?: number | null
  created?: number
  status_transitions?: { paid_at?: number | null } | null
  lines?: { data?: Array<{ description?: string | null; quantity?: number | null; amount?: number }> }
}

export function mapStripeStatus(status: string | null | undefined): string {
  switch (status) {
    case 'draft': return 'draft'
    case 'open': return 'sent'
    case 'paid': return 'paid'
    case 'void': return 'written_off'
    case 'uncollectible': return 'written_off'
    default: return 'draft'
  }
}

export interface ImportResult {
  localInvoiceId: string
  created: boolean    // true if a new local row was inserted, false if updated
  orgId: string
}

/**
 * Import one Stripe invoice into the local DB.
 *
 * - If a local row already exists (matched by stripeInvoiceId), it's updated
 *   in place (status + paidAt refreshed).
 * - Otherwise a new row is created, and we try to match the org by
 *   stripeCustomerId. Only as a last resort do we auto-create an org
 *   from the Stripe customer name to avoid the "Evan Kwan duplicate orgs"
 *   pattern. Callers can pass { autoCreateOrg: false } to skip that
 *   behaviour (webhook caller sets false — if we can't match, the payment
 *   just waits for a manual import to create the org).
 */
export async function importStripeInvoice(
  database: D1,
  inv: StripeInvoiceLike,
  opts: { autoCreateOrg?: boolean } = {},
): Promise<ImportResult | { skipped: true; reason: string }> {
  const now = new Date().toISOString()

  if (!inv.id) return { skipped: true, reason: 'No Stripe invoice id' }

  // 1. Existing local row? Update in place.
  const existing = await database
    .select({ id: schema.invoices.id, orgId: schema.invoices.orgId })
    .from(schema.invoices)
    .where(eq(schema.invoices.stripeInvoiceId, inv.id))
    .limit(1)

  if (existing.length > 0) {
    const localStatus = mapStripeStatus(inv.status)
    const paidAt = inv.status === 'paid' && inv.status_transitions?.paid_at
      ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
      : undefined
    await database
      .update(schema.invoices)
      .set({
        status: localStatus,
        ...(paidAt ? { paidAt } : {}),
        updatedAt: now,
      })
      .where(eq(schema.invoices.id, existing[0].id))
    return { localInvoiceId: existing[0].id, created: false, orgId: existing[0].orgId }
  }

  // 2. No local row — need to import. Find org by stripeCustomerId.
  let matchedOrgId: string | null = null
  if (inv.customer) {
    const orgs = await database
      .select({ id: schema.organisations.id, stripeCustomerId: schema.organisations.stripeCustomerId })
      .from(schema.organisations)
      .where(eq(schema.organisations.stripeCustomerId, inv.customer))
      .limit(1)
    if (orgs[0]) matchedOrgId = orgs[0].id
  }

  // 3. No match — optionally auto-create. Webhook callers pass autoCreateOrg=false
  //    so we don't make duplicate orgs from webhook events for unknown customers.
  if (!matchedOrgId && opts.autoCreateOrg && inv.customer_name) {
    const newOrgId = crypto.randomUUID()
    try {
      await database.insert(schema.organisations).values({
        id: newOrgId,
        name: inv.customer_name,
        status: 'active',
        healthStatus: 'green',
        stripeCustomerId: inv.customer ?? null,
        onboardingState: '{}',
        brands: '[]',
        customFields: '{}',
        preferredCurrency: (inv.currency ?? 'nzd').toUpperCase(),
        createdAt: now,
        updatedAt: now,
      })
      matchedOrgId = newOrgId
    } catch {
      return { skipped: true, reason: 'Failed to auto-create org' }
    }
  }

  if (!matchedOrgId) {
    return { skipped: true, reason: `No matching org for Stripe customer ${inv.customer ?? '(none)'}` }
  }

  // 4. Create the local invoice row + line items.
  const invoiceId = crypto.randomUUID()
  const subtotal = inv.subtotal ?? 0
  const total = inv.total ?? 0

  await database.insert(schema.invoices).values({
    id: invoiceId,
    orgId: matchedOrgId,
    stripeInvoiceId: inv.id,
    source: 'stripe',
    status: mapStripeStatus(inv.status),
    amountUsd: subtotal / 100,
    totalUsd: total / 100,
    currency: (inv.currency ?? 'nzd').toUpperCase(),
    dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString().split('T')[0] : null,
    paidAt: inv.status === 'paid' && inv.status_transitions?.paid_at
      ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
      : null,
    notes: `Imported from Stripe: ${inv.number ?? inv.id}`,
    createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : now,
    updatedAt: now,
  })

  if (inv.lines?.data) {
    for (const line of inv.lines.data) {
      await database.insert(schema.invoiceItems).values({
        id: crypto.randomUUID(),
        invoiceId,
        description: line.description ?? 'Line item',
        quantity: line.quantity ?? 1,
        unitPriceUsd: ((line.amount ?? 0) / 100) / (line.quantity ?? 1),
        totalUsd: (line.amount ?? 0) / 100,
      })
    }
  }

  return { localInvoiceId: invoiceId, created: true, orgId: matchedOrgId }
}

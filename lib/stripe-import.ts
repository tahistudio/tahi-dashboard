/**
 * lib/stripe-import.ts
 *
 * Shared logic for importing a single Stripe invoice into the local DB.
 * Used by:
 *   - POST /api/admin/integrations/stripe/import-invoices  (bulk pull)
 *   - POST /api/webhooks/stripe (invoice.paid self-heal, creates the local
 *     row if it didn't exist when the payment fires)
 */

import { schema } from '@/db/d1'
import { and, eq, sql } from 'drizzle-orm'
import { importedInvoiceNumber } from '@/lib/invoice-number'
import { mapStripeStatus, decideStripeStatus } from '@/lib/stripe-status'

export { mapStripeStatus } from '@/lib/stripe-status'

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
  /** Stripe's hosted invoice page. Persisted so the client gets a Pay now CTA
   *  in the portal and in the invoice email. Present on any finalised invoice;
   *  null while it is still a draft in Stripe. */
  hosted_invoice_url?: string | null
  subtotal?: number
  total?: number
  amount_paid?: number
  due_date?: number | null
  created?: number
  status_transitions?: { paid_at?: number | null } | null
  lines?: { has_more?: boolean; data?: Array<{ id?: string; description?: string | null; quantity?: number | null; amount?: number }> }
}

export interface ImportResult {
  localInvoiceId: string
  created: boolean    // true if a new local row was inserted, false if updated
  orgId: string
}

type SkippedImport = { skipped: true; reason: string }
type ImportOptions = { autoCreateOrg?: boolean; expectedOrgId?: string }

/**
 * Import one Stripe invoice into the local DB.
 *
 * - If a local row already exists (matched by stripeInvoiceId), it's updated
 *   in place (status + paidAt refreshed).
 * - Otherwise a new row is created, and we try to match the org by
 *   stripeCustomerId. Only as a last resort do we auto-create an org
 *   from the Stripe customer name to avoid the "Evan Kwan duplicate orgs"
 *   pattern. Callers can pass { autoCreateOrg: false } to skip that
 *   behaviour (webhook caller sets false, if we can't match, the payment
 *   just waits for a manual import to create the org).
 */
export async function importStripeInvoice(
  database: D1,
  inv: StripeInvoiceLike,
  opts: ImportOptions = {},
): Promise<ImportResult | SkippedImport> {
  // An insert conflict can race a delete, leaving no row for reconciliation.
  // Permit one fresh attempt, then defer to a later sync instead of recursing.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await importStripeInvoiceAttempt(database, inv, opts)
    if (!('retry' in result)) return result
  }
  return { skipped: true, reason: 'Stripe invoice changed during import. Retry on the next sync.' }
}

async function importStripeInvoiceAttempt(
  database: D1,
  inv: StripeInvoiceLike,
  opts: ImportOptions,
): Promise<ImportResult | SkippedImport | { retry: true }> {
  const now = new Date().toISOString()

  if (!inv.id) return { skipped: true, reason: 'No Stripe invoice id' }

  // 1. Existing local row? Update in place.
  const existing = await database
    .select({ id: schema.invoices.id, orgId: schema.invoices.orgId, status: schema.invoices.status })
    .from(schema.invoices)
    .where(eq(schema.invoices.stripeInvoiceId, inv.id))
    .limit(1)

  if (existing.length > 0) {
    if (opts.expectedOrgId && existing[0].orgId !== opts.expectedOrgId) {
      return { skipped: true, reason: 'This invoice is attached to another client. Preview the recovery again.' }
    }
    // A local 'written_off' or 'paid' row is never demoted by this read: see
    // lib/stripe-status.ts. Null means "leave invoices.status alone", which
    // still lets the paid date and the pay link below refresh on the same row.
    const nextStatus = decideStripeStatus(existing[0].status, inv.status)
    const paidAt = inv.status === 'paid' && inv.status_transitions?.paid_at
      ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
      : undefined
    const update = database
      .update(schema.invoices)
      .set({
        ...(nextStatus ? { status: nextStatus === 'paid' ? nextStatus : sql`CASE
          WHEN ${schema.invoices.status} = 'paid' THEN ${schema.invoices.status}
          WHEN ${nextStatus} IN ('draft', 'sent') AND ${schema.invoices.status} IN ('written_off', 'viewed', 'overdue', 'pending', 'sent') THEN ${schema.invoices.status}
          ELSE ${nextStatus} END` } : {}),
        ...(paidAt ? { paidAt } : {}),
        // Refresh the client's pay link, but never clobber a stored one with a
        // null (a webhook payload for a paid invoice may omit it).
        ...(inv.hosted_invoice_url ? { stripeHostedInvoiceUrl: inv.hosted_invoice_url } : {}),
        updatedAt: now,
      })
      .where(and(
        eq(schema.invoices.id, existing[0].id),
        ...(opts.expectedOrgId ? [eq(schema.invoices.orgId, opts.expectedOrgId)] : []),
      ))
    if (opts.expectedOrgId) {
      const updated = await update.returning({ id: schema.invoices.id })
      if (!updated.length) {
        return { skipped: true, reason: 'This invoice changed client during import. Preview the recovery again.' }
      }
    } else {
      await update
    }
    return { localInvoiceId: existing[0].id, created: false, orgId: existing[0].orgId }
  }

  // 2. No local row, need to import. Find org by stripeCustomerId.
  let matchedOrgId: string | null = null
  if (inv.customer) {
    const orgs = await database
      .select({ id: schema.organisations.id, stripeCustomerId: schema.organisations.stripeCustomerId })
      .from(schema.organisations)
      .where(eq(schema.organisations.stripeCustomerId, inv.customer))
      .limit(1)
    if (orgs[0]) matchedOrgId = orgs[0].id
  }

  if (opts.expectedOrgId && matchedOrgId !== opts.expectedOrgId) {
    return { skipped: true, reason: 'The Stripe customer is no longer linked to the chosen client. Preview the recovery again.' }
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
  // Stable primary keys make concurrent webhook/import retries converge.
  // Existing historical UUIDs are still found by stripeInvoiceId above.
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`stripe-invoice:${inv.id}`)))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('')
  const invoiceId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  const subtotal = inv.subtotal ?? 0
  const total = inv.total ?? 0

  const invoiceInsert = database.insert(schema.invoices).values({
    id: invoiceId,
    orgId: matchedOrgId,
    stripeInvoiceId: inv.id,
    // The pay link travels with the invoice. A retainer client's recurring
    // Stripe invoice arrives through this path as status 'sent', and without
    // this it would land in the portal with no Pay now CTA anywhere.
    stripeHostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    source: 'stripe',
    status: mapStripeStatus(inv.status),
    // Stripe's own invoice number when it has finalised one, kept as-is
    // (migration 0096). A Stripe DRAFT has no number, so those rows stay NULL
    // and fall back to the short id, the same as every pre-0096 row. The
    // studio sequence numbers what the studio raises; it never renumbers an
    // import, because the client has already been shown Stripe's number on
    // Stripe's own hosted page.
    number: importedInvoiceNumber(inv.number),
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
  }).onConflictDoNothing({ target: schema.invoices.id }).returning({ id: schema.invoices.id })

  const lineInserts = (inv.lines?.data ?? []).map((line, index) =>
      database.insert(schema.invoiceItems).values({
        id: `${invoiceId}:${index}`,
        invoiceId,
        description: line.description ?? 'Line item',
        quantity: line.quantity ?? 1,
        unitPriceUsd: ((line.amount ?? 0) / 100) / (line.quantity || 1),
        totalUsd: (line.amount ?? 0) / 100,
      }).onConflictDoNothing({ target: schema.invoiceItems.id }),
  )
  // D1 batch is transactional. A failed line must not leave a paid invoice
  // whose items disappeared; a second click must not insert another invoice.
  const results = await database.batch([invoiceInsert, ...lineInserts])
  if (!results[0].length) {
    // Another import won the insert. Reconcile this payload against that
    // row, so a concurrent paid event cannot be lost behind an older open one.
    return { retry: true }
  }

  return { localInvoiceId: invoiceId, created: results[0].length > 0, orgId: matchedOrgId }
}

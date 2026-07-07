import { headers } from 'next/headers'
import Stripe from 'stripe'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { importStripeInvoice, type StripeInvoiceLike } from '@/lib/stripe-import'
import { applyBillingDerivation } from '@/lib/billing-derivation'
import { dispatchDomainEvent } from '@/lib/events'

type EventsDb = ReturnType<typeof import('drizzle-orm/d1').drizzle>

type BillingDb = Parameters<typeof applyBillingDerivation>[0]

/**
 * Re-derive billing model + retainer dates for an org. Wrapped to never
 * throw — a derivation failure must not bounce the Stripe webhook (Stripe
 * will retry the event and we don't want repeat side-effects on the
 * invoice / subscription state).
 */
async function tryDerive(database: unknown, orgId: string | null | undefined) {
  if (!orgId) return
  try {
    await applyBillingDerivation(database as BillingDb, orgId)
  } catch (err) {
    console.warn('[stripe-webhook] billing derivation failed for org', orgId, err instanceof Error ? err.message : err)
  }
}

// Convert Stripe SDK Invoice into the loose shape importStripeInvoice wants.
function toImportable(inv: Stripe.Invoice): StripeInvoiceLike {
  return {
    id: inv.id ?? '',
    number: inv.number ?? null,
    status: inv.status ?? null,
    customer: typeof inv.customer === 'string' ? inv.customer : inv.customer?.id ?? null,
    customer_name: inv.customer_name ?? null,
    currency: inv.currency ?? null,
    subtotal: inv.subtotal ?? 0,
    total: inv.total ?? 0,
    amount_paid: inv.amount_paid ?? 0,
    due_date: inv.due_date ?? null,
    created: inv.created ?? Math.floor(Date.now() / 1000),
    status_transitions: inv.status_transitions
      ? { paid_at: inv.status_transitions.paid_at ?? null }
      : null,
    lines: inv.lines
      ? {
          data: inv.lines.data.map(l => ({
            description: l.description ?? null,
            quantity: l.quantity ?? null,
            amount: l.amount ?? 0,
          })),
        }
      : undefined,
  }
}

// Force dynamic : prevents Next.js from trying to statically analyse this
// route at build time (when env vars are unavailable on Webflow Cloud).
export const dynamic = 'force-dynamic'

// Lazy singleton : only instantiated on first real request, not at build time.
let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set')
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    })
  }
  return _stripe
}

export async function POST(req: Request) {
  const body = await req.text()
  const headersList = await headers()
  const sig = headersList.get('stripe-signature')

  if (!sig) {
    return new Response('Missing stripe-signature header', { status: 400 })
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return new Response('Webhook secret not configured', { status: 500 })
  }

  let event: Stripe.Event

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err)
    return new Response('Webhook signature verification failed', { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()

  switch (event.type) {
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.id) {
        // Self-heal: if no local row exists for this Stripe invoice yet
        // (e.g. it was created in Stripe directly and never imported),
        // import it now. Otherwise just mark paid.
        // autoCreateOrg=false so an unknown customer doesn't spawn a
        // duplicate org silently — payment sits until the next manual
        // Import Stripe Invoices sync resolves the org mapping.
        await importStripeInvoice(database, toImportable(invoice), { autoCreateOrg: false })

        // Re-check and force status=paid (import may have used the
        // status on the event, which should already be 'paid' here).
        const existing = await database
          .select({ id: schema.invoices.id })
          .from(schema.invoices)
          .where(eq(schema.invoices.stripeInvoiceId, invoice.id))
          .limit(1)

        if (existing.length > 0) {
          await database
            .update(schema.invoices)
            .set({ status: 'paid', paidAt: now, updatedAt: now })
            .where(eq(schema.invoices.id, existing[0].id))

          // Auto-derive: a paid invoice can flip an org from project to
          // retainer or extend the retainerStartDate when it's the first
          // financial activity we've seen. Cheap idempotent write.
          const orgRow = await database
            .select({ orgId: schema.invoices.orgId })
            .from(schema.invoices)
            .where(eq(schema.invoices.id, existing[0].id))
            .limit(1)
          await tryDerive(database, orgRow[0]?.orgId)

          // Fire the domain event (automations + outgoing webhooks). Non-blocking.
          await dispatchDomainEvent(database as EventsDb, {
            type: 'invoice_paid',
            entityId: existing[0].id,
            entityType: 'invoice',
            orgId: orgRow[0]?.orgId ?? null,
            data: { status: 'paid', source: 'stripe' },
          })
        }
      }
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      if (invoice.id) {
        const existing = await database
          .select({ id: schema.invoices.id })
          .from(schema.invoices)
          .where(eq(schema.invoices.stripeInvoiceId, invoice.id))
          .limit(1)

        if (existing.length > 0) {
          await database
            .update(schema.invoices)
            .set({ status: 'overdue', updatedAt: now })
            .where(eq(schema.invoices.id, existing[0].id))
        }
      }
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      if (sub.id) {
        const statusMap: Record<string, string> = {
          active: 'active',
          past_due: 'past_due',
          canceled: 'cancelled',
          paused: 'paused',
          trialing: 'trialing',
        }
        const mappedStatus = statusMap[sub.status] ?? sub.status
        const existing = await database
          .select({ id: schema.subscriptions.id })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.stripeSubscriptionId, sub.id))
          .limit(1)

        if (existing.length > 0) {
          await database
            .update(schema.subscriptions)
            .set({
              status: mappedStatus,
              currentPeriodStart: sub.current_period_start
                ? new Date(sub.current_period_start * 1000).toISOString()
                : undefined,
              currentPeriodEnd: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toISOString()
                : undefined,
              updatedAt: now,
            })
            .where(eq(schema.subscriptions.id, existing[0].id))

          const orgRow = await database
            .select({ orgId: schema.subscriptions.orgId })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, existing[0].id))
            .limit(1)
          await tryDerive(database, orgRow[0]?.orgId)
        }
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      if (sub.id) {
        const existing = await database
          .select({ id: schema.subscriptions.id })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.stripeSubscriptionId, sub.id))
          .limit(1)

        if (existing.length > 0) {
          await database
            .update(schema.subscriptions)
            .set({
              status: 'cancelled',
              cancelledAt: now,
              updatedAt: now,
            })
            .where(eq(schema.subscriptions.id, existing[0].id))

          const orgRow = await database
            .select({ orgId: schema.subscriptions.orgId })
            .from(schema.subscriptions)
            .where(eq(schema.subscriptions.id, existing[0].id))
            .limit(1)
          await tryDerive(database, orgRow[0]?.orgId)
        }
      }
      break
    }

    case 'customer.subscription.created': {
      // Full provisioning still requires the manual customer-to-org match, but
      // if a sub was created for an already-known stripeCustomerId we can fire
      // a derivation for that org so the retainer state catches up immediately.
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id
      if (customerId) {
        const orgRow = await database
          .select({ id: schema.organisations.id })
          .from(schema.organisations)
          .where(eq(schema.organisations.stripeCustomerId, customerId))
          .limit(1)
        await tryDerive(database, orgRow[0]?.id)
      }
      break
    }

    default:
      break
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

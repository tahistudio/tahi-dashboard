import { headers } from 'next/headers'
import Stripe from 'stripe'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

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
        // Update local invoice status to paid
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
        }
      }
      break
    }

    case 'customer.subscription.created': {
      // For now, just log. Full provisioning requires matching the customer to an org.
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

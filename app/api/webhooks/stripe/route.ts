import { headers } from 'next/headers'
import Stripe from 'stripe'

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

  switch (event.type) {
    case 'invoice.paid': {
      // TODO: Update invoice status in DB, notify admin
      break
    }

    case 'invoice.payment_failed': {
      // TODO: Update invoice status, notify admin via Slack
      break
    }

    case 'customer.subscription.updated': {
      // TODO: Update subscription status in DB
      break
    }

    case 'customer.subscription.deleted': {
      // TODO: Mark subscription as cancelled in DB
      break
    }

    case 'customer.subscription.created': {
      // TODO: Create subscription record in DB
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

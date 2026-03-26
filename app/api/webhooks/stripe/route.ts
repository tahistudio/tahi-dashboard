import { headers } from 'next/headers'
import Stripe from 'stripe'

// Force dynamic — prevents Next.js from trying to statically analyse this
// route at build time (when env vars are unavailable on Webflow Cloud).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Lazy singleton — only instantiated on first real request, not at build time.
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
      const invoice = event.data.object as Stripe.Invoice
      // TODO: Update invoice status in DB, notify admin
      console.log('Invoice paid:', invoice.id)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      // TODO: Update invoice status, notify admin via Slack
      console.log('Invoice payment failed:', invoice.id)
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      // TODO: Update subscription status in DB
      console.log('Subscription updated:', subscription.id)
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      // TODO: Mark subscription as cancelled in DB
      console.log('Subscription deleted:', subscription.id)
      break
    }

    case 'customer.subscription.created': {
      const subscription = event.data.object as Stripe.Subscription
      // TODO: Create subscription record in DB
      console.log('Subscription created:', subscription.id)
      break
    }

    default:
      console.log(`Unhandled Stripe event type: ${event.type}`)
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

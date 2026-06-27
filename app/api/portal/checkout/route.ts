import { getPortalAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { getStripe, STRIPE_PLANS, isPlanId } from '@/lib/stripe-plans'

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/checkout
 * Start a retainer subscription for the authenticated client's org and return
 * the PaymentElement client secret. Body: { plan: 'maintain'|'scale', addon }.
 *
 * Creates the subscription with payment_behavior=default_incomplete so the
 * client confirms the first payment inline; the Stripe webhook
 * (customer.subscription.updated) flips our row to active on success.
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as { plan?: string; addon?: boolean }
  if (!body.plan || !isPlanId(body.plan)) {
    return NextResponse.json({ error: 'Valid plan is required' }, { status: 400 })
  }
  const planCfg = STRIPE_PLANS[body.plan]
  const addon = !!body.addon

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json({ error: 'Stripe is not configured' }, { status: 503 })
  }

  const database = await db()
  const [org] = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      stripeCustomerId: schema.organisations.stripeCustomerId,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  // Resolve the recurring prices by lookup key.
  const lookups = [planCfg.baseLookup, ...(addon ? [planCfg.trackLookup] : [])]
  const priceList = await stripe.prices.list({ lookup_keys: lookups, active: true, limit: 10 })
  const byLookup = new Map(priceList.data.map(p => [p.lookup_key ?? '', p.id]))
  const basePrice = byLookup.get(planCfg.baseLookup)
  if (!basePrice) {
    return NextResponse.json(
      { error: 'Plan prices not set up in Stripe. Run setup-plans first.' },
      { status: 503 },
    )
  }
  const items: Stripe.SubscriptionCreateParams.Item[] = [{ price: basePrice }]
  if (addon) {
    const trackPrice = byLookup.get(planCfg.trackLookup)
    if (trackPrice) items.push({ price: trackPrice })
  }

  // Ensure a Stripe customer for the org.
  let customerId = org.stripeCustomerId
  if (!customerId) {
    let email: string | undefined
    if (userId) {
      try {
        const clerk = await clerkClient()
        const user = await clerk.users.getUser(userId)
        email = user.emailAddresses[0]?.emailAddress
      } catch {
        // non-fatal
      }
    }
    const customer = await stripe.customers.create({
      name: org.name,
      email,
      metadata: { orgId },
    })
    customerId = customer.id
    await database
      .update(schema.organisations)
      .set({ stripeCustomerId: customerId, updatedAt: new Date().toISOString() })
      .where(eq(schema.organisations.id, orgId))
  }

  // Create the incomplete subscription and pull the first-payment client secret.
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items,
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: { orgId, plan: planCfg.id, addon: addon ? '1' : '0' },
  })

  const invoice = subscription.latest_invoice as Stripe.Invoice | null
  const intent = invoice?.payment_intent as Stripe.PaymentIntent | null
  const clientSecret = intent?.client_secret ?? null

  // Record / refresh our subscription row so the webhook can flip it active.
  const now = new Date().toISOString()
  const [existing] = await database
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, orgId))
    .limit(1)

  if (existing) {
    await database
      .update(schema.subscriptions)
      .set({
        planType: planCfg.id,
        stripeSubscriptionId: subscription.id,
        status: 'incomplete',
        hasPrioritySupport: addon,
        billingCountry: 'NZ',
        updatedAt: now,
      })
      .where(eq(schema.subscriptions.id, existing.id))
  } else {
    await database.insert(schema.subscriptions).values({
      orgId,
      planType: planCfg.id,
      stripeSubscriptionId: subscription.id,
      status: 'incomplete',
      hasPrioritySupport: addon,
      billingCountry: 'NZ',
    })
  }

  await database
    .update(schema.organisations)
    .set({ planType: planCfg.id, updatedAt: now })
    .where(eq(schema.organisations.id, orgId))

  return NextResponse.json({ clientSecret, subscriptionId: subscription.id })
}

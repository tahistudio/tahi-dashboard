import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'

/**
 * GET /api/portal/billing/session
 * Generate a Stripe customer portal session URL for the current org.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }

  const database = await db()

  // Find the org and its Stripe customer ID
  const org = await database.query.organisations.findFirst({
    where: eq(schema.organisations.id, orgId),
  })

  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  if (!org.stripeCustomerId) {
    return NextResponse.json({ error: 'No Stripe customer linked to this organisation' }, { status: 404 })
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${appUrl}/billing`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[billing/session] Stripe error:', err)
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 })
  }
}

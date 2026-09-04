import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { isOrgAdmin } from '@/lib/portal-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { stripeSecretKey } from '@/lib/stripe-key'

/**
 * GET /api/portal/billing/session
 * Generate a Stripe customer portal session URL for the current org.
 * getPortalAuth resolves the caller's Clerk org -> the D1 organisations.id so
 * the lookup works for clerkOrgId-provisioned clients (and an admin previewing
 * Client view sees the impersonated org, read-only). Reject the Tahi admin org.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId, impersonating, clerkOrgId } = await getPortalAuth(req)
  if (!userId || !orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'invoices')
  if (featureDenied) return featureDenied

  const stripeKey = stripeSecretKey()
  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
  }

  const database = await db()

  // The Stripe customer portal exposes invoices and payment methods:
  // workspace admins of the org only, never plain member seats. Impersonation
  // (admin Client view) has no contact row, so it stays allowed as before.
  if (
    !impersonating &&
    !(await isOrgAdmin(database as ReturnType<typeof import('drizzle-orm/d1').drizzle>, orgId, userId))
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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
    const stripe = new Stripe(stripeKey, {
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

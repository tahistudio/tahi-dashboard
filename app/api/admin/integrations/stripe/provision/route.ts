import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/admin/integrations/stripe/provision
 * T133: Auto-create Stripe subscription when client is provisioned with a paid plan.
 * Stub: in production this would use the Stripe SDK to create a customer and subscription.
 *
 * Body: { orgId, planType, contactEmail, contactName }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    orgId?: string
    planType?: string
    contactEmail?: string
    contactName?: string
  }

  if (!body.orgId || !body.planType) {
    return NextResponse.json(
      { error: 'orgId and planType are required' },
      { status: 400 },
    )
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({
      success: true,
      message: 'Stripe provisioning stub: STRIPE_SECRET_KEY not configured',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    })
  }

  // Stub: In production this would:
  // 1. Create a Stripe Customer (or look up existing)
  // 2. Create a Stripe Subscription with the correct price ID for planType
  // 3. Update the org with stripeCustomerId
  // 4. Update the subscription with stripeSubscriptionId

  return NextResponse.json({
    success: true,
    message: 'Stripe subscription provisioning stub',
    orgId: body.orgId,
    planType: body.planType,
  })
}

/**
 * GET /api/admin/integrations/stripe/provision
 * T134: Get Stripe hosted invoice pay-now URL for a specific invoice.
 * Query: ?invoiceId=xxx
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const invoiceId = url.searchParams.get('invoiceId')

  if (!invoiceId) {
    return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
  }

  // Stub: In production, look up the Stripe invoice ID from local invoices table
  // and return the hosted_invoice_url from Stripe
  return NextResponse.json({
    payUrl: null,
    message: 'Stripe pay-now URL stub: would fetch hosted_invoice_url in production',
  })
}

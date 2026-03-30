import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

let _stripe: Stripe | null = null
function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
    })
  }
  return _stripe
}

/**
 * POST /api/admin/integrations/stripe/provision
 * Create a Stripe Customer for a client org.
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

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json({
      success: false,
      error: 'STRIPE_SECRET_KEY not configured',
    }, { status: 503 })
  }

  const database = await db()

  // Check if org already has a Stripe customer
  const [org] = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      stripeCustomerId: schema.organisations.stripeCustomerId,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, body.orgId))
    .limit(1)

  if (!org) {
    return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })
  }

  if (org.stripeCustomerId) {
    return NextResponse.json({
      success: true,
      message: 'Customer already exists in Stripe',
      stripeCustomerId: org.stripeCustomerId,
    })
  }

  // Create Stripe Customer
  const customer = await stripe.customers.create({
    name: org.name,
    email: body.contactEmail ?? undefined,
    metadata: {
      orgId: body.orgId,
      planType: body.planType,
      dashboardUrl: 'https://dashboard.tahi.studio',
    },
  })

  // Save stripeCustomerId to organisation
  await database
    .update(schema.organisations)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date().toISOString() })
    .where(eq(schema.organisations.id, body.orgId))

  return NextResponse.json({
    success: true,
    stripeCustomerId: customer.id,
    orgId: body.orgId,
    planType: body.planType,
  })
}

/**
 * GET /api/admin/integrations/stripe/provision
 * Get Stripe hosted invoice URL for a specific invoice.
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

  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json({ payUrl: null, error: 'Stripe not configured' }, { status: 503 })
  }

  const database = await db()
  const [invoice] = await database
    .select({ stripeInvoiceId: schema.invoices.stripeInvoiceId })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId))
    .limit(1)

  if (!invoice?.stripeInvoiceId) {
    return NextResponse.json({ payUrl: null, message: 'No Stripe invoice linked' })
  }

  const stripeInvoice = await stripe.invoices.retrieve(invoice.stripeInvoiceId)

  return NextResponse.json({
    payUrl: stripeInvoice.hosted_invoice_url ?? null,
  })
}

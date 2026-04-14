import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion })
}

/**
 * POST /api/admin/invoices/stripe-create
 * Creates a Stripe invoice from a local invoice, adds line items, finalizes it,
 * and returns the hosted payment URL.
 *
 * Body: { invoiceId: string }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { invoiceId: string }
  if (!body.invoiceId) return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })

  const stripe = getStripe()
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const database = await db() as unknown as D1

  // Get local invoice
  const [invoice] = await database
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      currency: schema.invoices.currency,
      notes: schema.invoices.notes,
      dueDate: schema.invoices.dueDate,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, body.invoiceId))
    .limit(1)

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  if (invoice.stripeInvoiceId) {
    // Already has Stripe invoice - just retrieve the URL
    try {
      const existing = await stripe.invoices.retrieve(invoice.stripeInvoiceId)
      return NextResponse.json({
        stripeInvoiceId: invoice.stripeInvoiceId,
        payUrl: existing.hosted_invoice_url,
        status: 'already_exists',
      })
    } catch {
      // Stripe invoice may have been deleted, recreate below
    }
  }

  // Get org for Stripe customer
  const [org] = await database
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      stripeCustomerId: schema.organisations.stripeCustomerId,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, invoice.orgId))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Organisation not found' }, { status: 404 })

  // Create Stripe customer if needed
  let customerId = org.stripeCustomerId
  if (!customerId) {
    // Get contact email
    const [contact] = await database
      .select({ email: schema.contacts.email })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, org.id))
      .limit(1)

    const customer = await stripe.customers.create({
      name: org.name,
      email: contact?.email ?? undefined,
      metadata: { orgId: org.id },
    })
    customerId = customer.id

    await database.update(schema.organisations).set({
      stripeCustomerId: customerId,
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.organisations.id, org.id))
  }

  // Get line items
  const items = await database
    .select()
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, invoice.id))

  if (items.length === 0) {
    return NextResponse.json({ error: 'Invoice has no line items' }, { status: 400 })
  }

  const currency = (invoice.currency ?? 'nzd').toLowerCase()

  try {
    // Create Stripe draft invoice
    const stripeInvoice = await stripe.invoices.create({
      customer: customerId,
      currency,
      collection_method: 'send_invoice',
      days_until_due: invoice.dueDate
        ? Math.max(1, Math.ceil((new Date(invoice.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 30,
      metadata: { dashboardInvoiceId: invoice.id },
    })

    // Add line items
    for (const item of items) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: stripeInvoice.id,
        description: item.description,
        quantity: item.quantity ?? 1,
        unit_amount: Math.round(item.unitPriceUsd * 100), // Stripe uses cents
        currency,
      })
    }

    // Finalize to get hosted URL
    const finalized = await stripe.invoices.finalizeInvoice(stripeInvoice.id)

    // Update local invoice
    const now = new Date().toISOString()
    await database.update(schema.invoices).set({
      stripeInvoiceId: finalized.id,
      source: 'stripe',
      status: 'sent',
      sentAt: now,
      updatedAt: now,
    }).where(eq(schema.invoices.id, invoice.id))

    return NextResponse.json({
      success: true,
      stripeInvoiceId: finalized.id,
      payUrl: finalized.hosted_invoice_url,
      status: 'created',
    })
  } catch (err) {
    return NextResponse.json({
      error: 'Stripe invoice creation failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }, { status: 500 })
  }
}

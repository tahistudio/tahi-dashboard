import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

async function stripePost(path: string, body: Record<string, string>, key: string) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? `Stripe ${path} failed`)
  return data
}

/**
 * POST /api/admin/invoices/stripe-create
 * Creates a Stripe invoice from a local invoice using fetch (no SDK).
 * Auto-creates Stripe customer if needed. Adds line items, finalizes,
 * returns hosted payment URL.
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as { invoiceId: string }
  if (!body.invoiceId) return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const database = await db() as unknown as D1

  // Get local invoice
  const [invoice] = await database
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      currency: schema.invoices.currency,
      dueDate: schema.invoices.dueDate,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, body.invoiceId))
    .limit(1)

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  if (invoice.stripeInvoiceId) {
    // Already has Stripe invoice, try to get URL
    try {
      const existing = await fetch(`https://api.stripe.com/v1/invoices/${invoice.stripeInvoiceId}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      })
      if (existing.ok) {
        const data = await existing.json() as { hosted_invoice_url?: string }
        return NextResponse.json({
          stripeInvoiceId: invoice.stripeInvoiceId,
          payUrl: data.hosted_invoice_url,
          status: 'already_exists',
        })
      }
    } catch { /* recreate below */ }
  }

  // Get org
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

  try {
    // Create Stripe customer if needed
    let customerId = org.stripeCustomerId
    if (!customerId) {
      const [contact] = await database
        .select({ email: schema.contacts.email })
        .from(schema.contacts)
        .where(eq(schema.contacts.orgId, org.id))
        .limit(1)

      const customer = await stripePost('/customers', {
        name: org.name,
        ...(contact?.email ? { email: contact.email } : {}),
        'metadata[orgId]': org.id,
      }, stripeKey) as { id: string }

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
    const daysUntilDue = invoice.dueDate
      ? Math.max(1, Math.ceil((new Date(invoice.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 30

    // Create Stripe invoice
    const stripeInvoice = await stripePost('/invoices', {
      customer: customerId,
      currency,
      collection_method: 'send_invoice',
      days_until_due: String(daysUntilDue),
      'metadata[dashboardInvoiceId]': invoice.id,
    }, stripeKey) as { id: string }

    // Add line items
    for (const item of items) {
      await stripePost('/invoiceitems', {
        customer: customerId,
        invoice: stripeInvoice.id,
        description: item.description,
        quantity: String(item.quantity ?? 1),
        unit_amount: String(Math.round(item.unitPriceUsd * 100)),
        currency,
      }, stripeKey)
    }

    // Finalize
    const finalized = await stripePost(`/invoices/${stripeInvoice.id}/finalize`, {}, stripeKey) as {
      id: string
      hosted_invoice_url: string | null
    }

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

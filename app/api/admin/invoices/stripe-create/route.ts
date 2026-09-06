import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { stripeSecretKey } from '@/lib/stripe-key'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { createNotifications, type NotificationRecipient } from '@/lib/notifications'
import { invoiceReference, selectBillingContacts } from '@/lib/invoice-billing'
import {
  partitionRecipients,
  recordEmailSuppressions,
  resolveDeliveryPolicy,
  resolveOrgRecipientScope,
} from '@/lib/email-delivery'

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
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'invoices')
  if (featureDenied) return featureDenied

  // Money route: the Tahi org alone is not enough, the seat must be able to
  // see Invoices (CLAUDE.md rule 11 + the role contract in lib/require-feature).
  const deniedFeature = await requireFeature({ userId, orgId }, 'invoices')
  if (deniedFeature) return deniedFeature

  const body = await req.json() as { invoiceId: string }
  if (!body.invoiceId) return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })

  const stripeKey = stripeSecretKey()
  if (!stripeKey) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const database = await db() as unknown as D1

  // Get local invoice
  const [invoice] = await database
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      // Our invoice number, for the suppression record and the client's bell
      // row, so both name the bill the same way the invoice email does.
      number: schema.invoices.number,
      currency: schema.invoices.currency,
      dueDate: schema.invoices.dueDate,
      sentAt: schema.invoices.sentAt,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, body.invoiceId))
    .limit(1)

  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  // Access scoping: a team member may only bill the clients they can see.
  const denied = await requireAccessToOrg(database, userId, invoice.orgId)
  if (denied) return denied

  if (invoice.stripeInvoiceId) {
    // Already has Stripe invoice, try to get URL
    try {
      const existing = await fetch(`https://api.stripe.com/v1/invoices/${invoice.stripeInvoiceId}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      })
      if (existing.ok) {
        const data = await existing.json() as { hosted_invoice_url?: string }
        // Backfill the column for invoices finalised before it existed, so the
        // client's Pay now CTA works without another admin round trip.
        if (data.hosted_invoice_url) {
          await database.update(schema.invoices).set({
            stripeHostedInvoiceUrl: data.hosted_invoice_url,
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.invoices.id, invoice.id))
        }
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

  // The client's people, read once: the gate below needs them, and so does the
  // bell at the end of a successful finalise.
  const contacts = await database
    .select({
      id: schema.contacts.id,
      email: schema.contacts.email,
      name: schema.contacts.name,
      portalRole: schema.contacts.portalRole,
      isPrimary: schema.contacts.isPrimary,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, org.id))

  // STRIPE IS A SECOND MAIL TRANSPORT, and this route is where it is armed.
  // The invoice is created with collection_method 'send_invoice' and then
  // finalised, and a finalised send_invoice invoice is EMAILED TO THE CUSTOMER
  // BY STRIPE whenever the account has "email finalised invoices" on. No code
  // here is involved and lib/email-delivery.ts never sees an address, so the
  // Xero hole was closed while the identical Stripe one stayed open, reachable
  // from the invoice detail page, the list's bulk action and the
  // create_stripe_invoice MCP tool.
  //
  // Refused rather than half-done. Creating the invoice with auto_advance
  // false and skipping the finalize would leave a draft in Stripe with no
  // hosted URL, which is a half state somebody has to clean up; answering 409
  // before anything is created leaves Stripe exactly as it was. A suppression
  // row per withheld billing contact is written first, so the hold is provable.
  //
  // ALL OR NOTHING, unlike our own template. Stripe mails the CUSTOMER, one
  // address we do not choose per send, so "some contacts passed" is not a
  // state it can honour. A client with no contact at all is refused too: we
  // cannot show that whatever address Stripe holds is allowed.
  const billingRecipients = selectBillingContacts(contacts)
  const deliveryPolicy = await resolveDeliveryPolicy()
  const deliveryScope = await resolveOrgRecipientScope(org.id, deliveryPolicy)
  const billingPartition = partitionRecipients(
    billingRecipients.map(c => c.email),
    deliveryPolicy,
    deliveryScope,
  )
  if (billingPartition.suppressed.length > 0 || billingRecipients.length === 0) {
    await recordEmailSuppressions(
      billingPartition.suppressed,
      {
        template: 'stripe-invoice',
        subject: `Stripe would email invoice ${invoiceReference(invoice.id, invoice.number)} on finalise`,
        orgId: invoice.orgId,
      },
      deliveryPolicy,
    )
    return NextResponse.json({
      error: 'Held back by the email allowlist',
      message: billingRecipients.length === 0
        ? 'This client has no billing contact, so there is no address to check against the email delivery allowlist. Stripe emails a finalised invoice itself.'
        : 'Stripe emails a finalised invoice itself, and this client is not on the email delivery allowlist. Settings > Studio details > Email delivery.',
      suppressed: billingPartition.suppressed,
    }, { status: 409 })
  }

  try {
    // Create Stripe customer if needed
    let customerId = org.stripeCustomerId
    if (!customerId) {
      const contact = contacts[0]

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

    // Update local invoice. The hosted invoice URL is PERSISTED, not just
    // returned: it is the client's pay link, so it has to survive this request
    // for the portal CTA and the invoice email to exist at all.
    const now = new Date().toISOString()
    const alreadySent = !!invoice.sentAt
    await database.update(schema.invoices).set({
      stripeInvoiceId: finalized.id,
      stripeHostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
      source: 'stripe',
      status: 'sent',
      // sentAt means FIRST send. If the invoice was already emailed, keep it.
      ...(alreadySent ? {} : { sentAt: now }),
      updatedAt: now,
    }).where(eq(schema.invoices.id, invoice.id))

    // Finalising in Stripe puts a real, payable bill in front of the client,
    // so this is a send. Notifying happens here rather than at draft creation,
    // once per invoice (send-email skips its own bell when this already ran),
    // and only to the billing contacts: the portal denies a plain member seat
    // the invoice, so a bell row for them is a dead click.
    if (!alreadySent) {
      const notifyRecipients: NotificationRecipient[] = billingRecipients
        .map(c => ({ contactId: c.id }))
      await createNotifications(database, notifyRecipients, {
        type: 'invoice_created',
        title: 'Invoice ready to pay',
        body: `Invoice ${invoiceReference(invoice.id, invoice.number)} is ready. You can pay it from your portal.`,
        entityType: 'invoice',
        entityId: invoice.id,
      })
    }

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

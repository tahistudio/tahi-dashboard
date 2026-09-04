import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { createElement } from 'react'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { publicUrl } from '@/lib/app-url'
import { sendEmail } from '@/lib/email'
import { InvoiceSentEmail } from '@/emails/invoice-sent'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { notifyOrgContacts } from '@/lib/notifications'
import { invoiceReference, selectInvoiceRecipients } from '@/lib/invoice-billing'
import { stripeSecretKey } from '@/lib/stripe-key'

type Params = { params: Promise<{ id: string }> }

/**
 * Resolve the client's pay link.
 *
 * Prefers the persisted column (written when the Stripe invoice is finalised).
 * For invoices finalised before that column existed, ask Stripe once and
 * backfill, so an old invoice still emails with a working Pay button.
 * Returns null when the invoice was never pushed to Stripe.
 */
async function resolvePayUrl(
  drizzle: ReturnType<typeof import('drizzle-orm/d1').drizzle>,
  invoice: { id: string; stripeInvoiceId: string | null; stripeHostedInvoiceUrl: string | null },
): Promise<string | null> {
  if (invoice.stripeHostedInvoiceUrl) return invoice.stripeHostedInvoiceUrl
  if (!invoice.stripeInvoiceId) return null

  const key = stripeSecretKey()
  if (!key) return null

  try {
    const res = await fetch(`https://api.stripe.com/v1/invoices/${invoice.stripeInvoiceId}`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return null
    const data = await res.json() as { hosted_invoice_url?: string | null }
    const url = data.hosted_invoice_url ?? null
    if (url) {
      await drizzle
        .update(schema.invoices)
        .set({ stripeHostedInvoiceUrl: url, updatedAt: new Date().toISOString() })
        .where(eq(schema.invoices.id, invoice.id))
    }
    return url
  } catch {
    // Non-fatal: the email still goes out with the portal link.
    return null
  }
}

// ── POST /api/admin/invoices/[id]/send-email ─────────────────────────────────
// Sends the invoice to the client, then marks it sent.
//
// This is the "send" motion for an invoice, so it does three things the old
// one-contact, inline-HTML version did not:
//   - it reaches every billing contact, not whichever row ORDER BY returned;
//   - it uses the real React Email template with a Stripe pay link and a
//     PORTAL deep link (the old CTA pointed at the admin page, which 403s a
//     client);
//   - it raises the client's in-app notification here rather than at draft
//     creation, so a client is only ever told about a bill they can open.
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const deniedFeature = await requireFeature({ userId, orgId }, 'invoices')
  if (deniedFeature) return deniedFeature

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [invoiceRow] = await drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      status: schema.invoices.status,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      notes: schema.invoices.notes,
      dueDate: schema.invoices.dueDate,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      stripeHostedInvoiceUrl: schema.invoices.stripeHostedInvoiceUrl,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1)

  if (!invoiceRow) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const denied = await requireAccessToOrg(drizzle, userId, invoiceRow.orgId)
  if (denied) return denied

  // Every billing contact at the org: the people who can also open the invoice
  // once it lands (see lib/invoice-billing.selectInvoiceRecipients).
  const contacts = await drizzle
    .select({
      email: schema.contacts.email,
      name: schema.contacts.name,
      portalRole: schema.contacts.portalRole,
      isPrimary: schema.contacts.isPrimary,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, invoiceRow.orgId))

  const recipients = selectInvoiceRecipients(contacts)
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'No contact with an email address on this client' },
      { status: 400 },
    )
  }

  // Category: TRANSACTIONAL. This is the invoice delivery itself (it flips the
  // invoice status to 'sent'), not a courtesy alert, so it is never gated by
  // per-event notification preferences. Preferences apply only to
  // notification-style pings such as the in-app bell row.

  const currency = invoiceRow.currency ?? 'NZD'
  const amountFormatted = new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency,
  }).format(invoiceRow.totalUsd)
  const dueDateDisplay = invoiceRow.dueDate
    ? new Date(invoiceRow.dueDate.includes('T') ? invoiceRow.dueDate : `${invoiceRow.dueDate}T00:00:00`)
        .toLocaleDateString('en-NZ', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'On receipt'

  const reference = invoiceReference(invoiceRow.id)
  // Client-openable deep link. /invoices/[id] renders from the portal API for
  // a client audience, so this no longer lands them on a 403.
  const invoiceUrl = publicUrl(`/invoices/${invoiceRow.id}`)
  const payUrl = await resolvePayUrl(drizzle, invoiceRow)

  // One email per recipient (no shared To header), so a colleague's bad
  // address never blocks the rest and each greeting is addressed properly.
  const subject = `Invoice ${reference} from Tahi Studio`
  const outcomes = await Promise.all(recipients.map(async (r) => {
    const res = await sendEmail(
      r.email,
      subject,
      createElement(InvoiceSentEmail, {
        clientName: r.name,
        invoiceId: invoiceRow.id,
        amountFormatted,
        currency,
        dueDate: dueDateDisplay,
        notes: invoiceRow.notes ?? undefined,
        invoiceUrl,
        paymentUrl: payUrl ?? undefined,
      }),
    )
    return { email: r.email, ok: res.success, error: res.error }
  }))

  const sentTo = outcomes.filter(o => o.ok).map(o => o.email)
  const failed = outcomes.filter(o => !o.ok)

  if (sentTo.length === 0) {
    return NextResponse.json(
      { error: 'Failed to send email', message: failed[0]?.error ?? 'Unknown error' },
      { status: 502 },
    )
  }

  const now = new Date().toISOString()
  await drizzle
    .update(schema.invoices)
    .set({
      status: invoiceRow.status === 'paid' ? invoiceRow.status : 'sent',
      sentAt: now,
      updatedAt: now,
    })
    .where(eq(schema.invoices.id, id))

  // Bell row for the client, on SEND (not on draft creation). The invoice
  // entity deep-links to /invoices/<id>, which both audiences can now open.
  await notifyOrgContacts(drizzle, invoiceRow.orgId, {
    type: 'invoice_created',
    title: payUrl ? 'Invoice ready to pay' : 'New invoice',
    body: `Invoice ${reference} for ${amountFormatted} ${currency} is due ${dueDateDisplay}.`,
    entityType: 'invoice',
    entityId: invoiceRow.id,
  })

  return NextResponse.json({
    success: true,
    sentTo,
    failedTo: failed.map(f => f.email),
    payLink: !!payUrl,
  })
}

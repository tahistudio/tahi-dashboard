import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { createElement } from 'react'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { publicUrl } from '@/lib/app-url'
import { sendEmail } from '@/lib/email'
import {
  partitionRecipients,
  resolveDeliveryPolicy,
  resolveOrgRecipientScope,
} from '@/lib/email-delivery'
import { InvoiceSentEmail } from '@/emails/invoice-sent'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { createNotifications, type NotificationRecipient } from '@/lib/notifications'
import { invoiceReference, selectBillingContacts, selectInvoiceRecipients } from '@/lib/invoice-billing'
import { stripeSecretKey } from '@/lib/stripe-key'
import {
  buildHowToPay,
  hasBankDestination,
  readInvoicePayContext,
  resolveInvoicePayUrl,
} from '@/lib/invoice-how-to-pay'
import { emailInvoiceFromXero, type XeroEmailOutcome } from '@/lib/xero-invoice-email'

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
//
// The bell row goes to the SAME billing audience as the email, never to every
// contact at the org: the portal denies a plain member seat both the invoice
// list and the invoice detail, so a bell row carrying the amount would be a
// disclosure followed by a 403 on the click.
//
// Idempotent on a resend, on every side that can be: sentAt is stamped once
// (it means FIRST send, which is what receivables aging reads), the status is
// only promoted out of 'draft', a second send raises no second bell row, and
// the Xero send below refuses when Xero's own SentToContact flag says it has
// already mailed an invoice we have already sent. OUR OWN template is the one
// thing a resend does re-send, because re-sending it is what the button is for.
//
// ── The Xero rail ───────────────────────────────────────────────────────────
//
// A client on the Xero rail gets one of three treatments, chosen by the studio
// setting invoicing.xeroEmailMode (Liam, 2026-09-06: "Xero-rail email: both,
// behind a studio toggle"):
//
//   dashboard  our template only. The default, and the only one that can carry
//              a portal deep link.
//   xero       Xero sends its own PDF and we stay out of the way.
//   both       both copies, for a client who wants the formal Xero one on file.
//
// The fallback is the part that matters. Xero refuses to email a DRAFT, and
// the push route holds every dashboard-raised invoice at DRAFT on purpose, so
// "Xero will not send it" is the ORDINARY state of a freshly pushed bill. In
// 'xero' mode a refusal therefore falls back to our own email rather than
// leaving the client with nothing, and the response says which happened so the
// admin detail can tell the studio.
//
// What the client is handed also depends on the rail: a pay page when either
// rail has issued one (Stripe's hosted invoice, or Xero's online invoice once
// it is approved), and otherwise a How to pay block with the studio's bank
// details and the invoice reference.
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
      sentAt: schema.invoices.sentAt,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      stripeHostedInvoiceUrl: schema.invoices.stripeHostedInvoiceUrl,
      // The Xero half of the pay path: the id Xero is asked to email, and the
      // online invoice URL the syncs capture once the bill is approved there.
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      xeroOnlineInvoiceUrl: schema.invoices.xeroOnlineInvoiceUrl,
      // Which rail this client bills on. Joined rather than read separately:
      // the answer decides both what the client is shown and who sends.
      orgInvoiceChannel: schema.organisations.invoiceChannel,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .where(eq(schema.invoices.id, id))
    .limit(1)

  if (!invoiceRow) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const denied = await requireAccessToOrg(drizzle, userId, invoiceRow.orgId)
  if (denied) return denied

  // Nothing left to chase. The admin UI hides the button for these, but MCP
  // send_invoice_email and a direct POST reach the same handler, so the rule
  // lives here rather than in the button.
  if (invoiceRow.status === 'paid' || invoiceRow.status === 'written_off') {
    return NextResponse.json(
      { error: `This invoice is ${invoiceRow.status === 'paid' ? 'already paid' : 'written off'}, so it cannot be sent again` },
      { status: 409 },
    )
  }

  // Every billing contact at the org: the people who can also open the invoice
  // once it lands (see lib/invoice-billing.selectBillingContacts). The id and
  // the Clerk link come back too, because the bell row goes to this same set.
  const contacts = await drizzle
    .select({
      id: schema.contacts.id,
      email: schema.contacts.email,
      name: schema.contacts.name,
      portalRole: schema.contacts.portalRole,
      isPrimary: schema.contacts.isPrimary,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, invoiceRow.orgId))

  const billingContacts = selectBillingContacts(contacts)
  const recipients = selectInvoiceRecipients(billingContacts)
  if (recipients.length === 0) {
    // Two different operator problems, two different messages: nobody is
    // designated to receive bills, or the designated people have no email.
    return NextResponse.json(
      {
        error: billingContacts.length === 0
          ? 'No billing contact designated for this client. Mark someone primary, or give them the admin portal role.'
          : 'No contact with an email address on this client',
      },
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
  // Stripe's hosted page first (backfilled from Stripe for invoices finalised
  // before the column existed), then Xero's own online invoice.
  const payUrl = resolveInvoicePayUrl(
    await resolvePayUrl(drizzle, invoiceRow),
    invoiceRow.xeroOnlineInvoiceUrl,
  )

  // The rail, the bank details and who sends, all out of the settings K/V
  // table in one read. It is a handful of studio rows.
  const settingRows = await drizzle
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
  const payContext = readInvoicePayContext(settingRows, invoiceRow.orgInvoiceChannel)

  // Bank details, the reference and the amount, for a Xero-rail invoice that
  // has no pay page yet. Null on the Stripe rail and null once a link exists.
  const howToPay = buildHowToPay({
    channel: payContext.channel,
    payUrl,
    invoice: {
      id: invoiceRow.id,
      // Never settled by the time we get here (the 409 above turns a paid or
      // written-off invoice away), but the block refuses to build for one, and
      // saying so here is what makes that guarantee readable.
      status: invoiceRow.status,
      totalUsd: invoiceRow.totalUsd,
      currency: invoiceRow.currency,
      dueDate: invoiceRow.dueDate,
    },
    bankDetails: payContext.bankDetails,
  })

  // Has this invoice been sent before? Read once, used twice: it guards the
  // Xero send against a resend below, and it decides the sentAt stamp and the
  // bell row further down.
  const alreadySent = !!invoiceRow.sentAt

  // Let Xero send its own copy, when the rail and the setting both say so.
  // Attempted BEFORE our own send because its outcome decides whether ours
  // goes at all: in 'xero' mode we stand down, unless Xero refuses (a draft
  // invoice, which is where every pushed bill starts), in which case our
  // template is the fallback rather than the client receiving nothing.
  //
  // `alreadySent` is passed so the Xero half is self-guarding: Xero's Email
  // endpoint has no idempotency key, and this call happens before the D1 write
  // and the notification write, so a retry after an apparent failure would mail
  // the client a second PDF. emailInvoiceFromXero refuses when Xero's own
  // SentToContact flag and our sentAt BOTH say it has gone already.
  //
  // THE DELIVERY ALLOWLIST REACHES THIS PATH TOO, and it has to be asked
  // separately. Xero's Email endpoint takes no address: Xero holds the contact
  // and mails it itself, so lib/email-delivery.ts never sees it and cannot
  // filter it. Asking the same pure rule here is what stops "no client gets
  // mail until Liam says so" being true of our template and false of Xero's.
  const deliveryPolicy = await resolveDeliveryPolicy()
  const deliveryScope = await resolveOrgRecipientScope(invoiceRow.orgId, deliveryPolicy)
  const anyRecipientAllowed = partitionRecipients(
    recipients.map(r => r.email),
    deliveryPolicy,
    deliveryScope,
  ).allowed.length > 0

  // XERO IS AUTHORISED PER CLIENT, NOT PER ADDRESS, and that is the whole
  // difference. This used to fire whenever ONE billing contact passed the
  // gate, which is exactly what happens when Liam adds himself to a real
  // client's billing contacts to test the template: our own send correctly
  // reached only him, and Xero then mailed its PDF to the client's own stored
  // address, the address the gate had just withheld us from. Since we cannot
  // see or filter Xero's recipient, the only honest question is whether the
  // policy authorises this CLIENT at all: mode 'all', or their org id on
  // `email.allowedOrgIds`. Anything less and Xero stands down.
  const orgAuthorisedForBlindTransports =
    deliveryPolicy.mode === 'all'
    || deliveryPolicy.allowedOrgIds.includes(invoiceRow.orgId.trim().toLowerCase())

  const onXeroRail = payContext.channel === 'xero'
  const wantsXeroEmail = onXeroRail
    && payContext.xeroEmailMode !== 'dashboard'
    && orgAuthorisedForBlindTransports
  const xeroOutcome: XeroEmailOutcome | null = wantsXeroEmail
    ? await emailInvoiceFromXero(invoiceRow.xeroInvoiceId, { alreadySent })
    : null

  // Ours goes unless the setting handed the job to Xero AND Xero took it.
  const sendOurs = !(payContext.xeroEmailMode === 'xero' && xeroOutcome?.status === 'sent')

  // One email per recipient (no shared To header), so a colleague's bad
  // address never blocks the rest and each greeting is addressed properly.
  const subject = `Invoice ${reference} from Tahi Studio`
  const outcomes = sendOurs
    ? await Promise.all(recipients.map(async (r) => {
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
          howToPay: howToPay ?? undefined,
        }),
        undefined,
        { template: 'invoice-sent', orgId: invoiceRow.orgId },
      )
      return { email: r.email, ok: res.success, error: res.error }
    }))
    : []

  const sentTo = outcomes.filter(o => o.ok).map(o => o.email)
  const failed = outcomes.filter(o => !o.ok)

  // Nothing reached the client: neither our send nor Xero's. `sendOurs` false
  // with a clean Xero send is the one case where an empty sentTo is a success,
  // so the check is "did anybody get it", not "did we send it".
  if (sentTo.length === 0 && xeroOutcome?.status !== 'sent') {
    // 409, not 502, when the delivery allowlist is the reason. Nothing is
    // broken and there is nothing to retry: the studio has not opened delivery
    // to this client yet, and a 502 would send someone hunting an outage.
    if (!anyRecipientAllowed) {
      return NextResponse.json({
        error: 'Held back by the email allowlist',
        message: 'No billing contact for this client is on the email delivery allowlist. Settings > Studio details > Email delivery.',
      }, { status: 409 })
    }
    return NextResponse.json(
      { error: 'Failed to send email', message: failed[0]?.error ?? 'Unknown error' },
      { status: 502 },
    )
  }

  // A resend must not rewrite history. sentAt means FIRST send (receivables
  // aging and any future dunning read it), and 'viewed' / 'overdue' are states
  // this invoice has already earned, so only a draft is promoted.
  const now = new Date().toISOString()
  await drizzle
    .update(schema.invoices)
    .set({
      ...(invoiceRow.status === 'draft' ? { status: 'sent' as const } : {}),
      ...(alreadySent ? {} : { sentAt: now }),
      updatedAt: now,
    })
    .where(eq(schema.invoices.id, id))

  // Bell row for the client, on the FIRST send (not on draft creation, and not
  // again on a resend or after stripe-create already announced it). It goes to
  // the billing audience only: the portal denies a member seat this invoice,
  // so a row they cannot open, carrying the amount, is a dead end and a leak.
  if (!alreadySent) {
    const notifyRecipients: NotificationRecipient[] = billingContacts.map(c => ({ contactId: c.id }))
    await createNotifications(drizzle, notifyRecipients, {
      type: 'invoice_created',
      title: payUrl ? 'Invoice ready to pay' : 'New invoice',
      body: `Invoice ${reference} for ${amountFormatted} ${currency} is due ${dueDateDisplay}.`,
      entityType: 'invoice',
      entityId: invoiceRow.id,
    })
  }

  return NextResponse.json({
    success: true,
    sentTo,
    failedTo: failed.map(f => f.email),
    payLink: !!payUrl,
    // The client was given bank details instead of a button. Reported off the
    // SAME test the email renders on (hasBankDestination), not off "a block was
    // built": until the studio fills in invoicing.bankDetails the block names
    // nowhere to send the money, the email falls back to the plain portal CTA,
    // and answering true here would tell the studio (and MCP send_invoice_email)
    // that a client got account details they never saw.
    bankDetails: hasBankDestination(howToPay),
    notified: !alreadySent,
    // Only on the Xero rail, and only what actually happened: 'sent' means
    // Xero emailed its own copy, 'skipped' means it would not (and ours went
    // instead), 'failed' means the call broke (and ours went instead).
    ...(xeroOutcome
      ? { xeroEmail: xeroOutcome.status, ...(xeroOutcome.reason ? { reason: xeroOutcome.reason } : {}) }
      : {}),
  })
}

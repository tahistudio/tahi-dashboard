import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { stripeSecretKey } from '@/lib/stripe-key'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'
import { requireAccessToOrg } from '@/lib/require-access'
import { dispatchDomainEvent } from '@/lib/events'
import {
  XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY,
  resolveXeroPaymentAccountCode,
} from '@/lib/invoice-pay-settings'

type Params = { params: Promise<{ id: string }> }
type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Statuses that mean the payment did not happen, or has been undone. A
// write-off is deliberately not one of them: on a written-off invoice the
// money may well have landed, and /financial-reports keys YTD revenue,
// 90-day collected, the tax-year totals and the monthly series off paid_at
// rather than status, so nulling the date there would erase real revenue.
const UNWINDS_PAYMENT = new Set(['draft', 'sent', 'viewed', 'overdue'])

// ── Push-back ────────────────────────────────────────────────────────────────
//
// A hand mark-paid here is usually a bank transfer that landed, and the rail
// has no way of knowing (Liam, 2026-09-06: "a hand mark-paid from the
// dashboard pushes the payment back to the rail"). Without this, a Xero
// invoice stays open in Xero forever and a Stripe invoice keeps chasing the
// client for money they have already sent.
//
// Three rules the implementation below never breaks:
//
//   1. It runs AFTER the local write and can never block it. The dashboard is
//      the source of truth for the paid date; the rail is a copy. A Xero
//      outage must not stop Liam recording revenue.
//   2. It only fires on an actual TRANSITION into paid. Re-PATCHing an
//      already-paid invoice would post a SECOND payment against the same Xero
//      invoice, which is an over-payment to unpick by hand.
//   3. It is skippable with `{ pushback: false }`, for a caller reconciling a
//      payment the rail already knows about. The syncs never come through this
//      route, but MCP does.
//
// The outcome is reported rather than thrown: `{ rail, status, reason? }` in
// the response body, and on the invoice_paid domain event so automations and
// outgoing webhooks can see a rail that did not take the payment.
type PushbackRail = 'xero' | 'stripe'

interface PushbackOutcome {
  rail: PushbackRail
  status: 'done' | 'skipped' | 'failed'
  reason?: string
}

/** The invoice columns push-back needs, read in the same pre-read as the rest. */
interface PushbackInvoice {
  source: string | null
  xeroInvoiceId: string | null
  stripeInvoiceId: string | null
  totalUsd: number | null
}

/**
 * Record the payment against the invoice's Xero bank account.
 *
 * The account code is a studio setting with NO default on purpose. Posting a
 * payment to a guessed account is worse than not posting it: it lands in the
 * ledger, reconciles against nothing, and has to be found and reversed. So an
 * unset code is reported as a clean skip with the reason, which is what the
 * settings UI (next slice) turns into a prompt.
 */
async function pushPaidToXero(
  drizzle: D1,
  xeroInvoiceId: string,
  amount: number | null,
  paidOn: string,
): Promise<PushbackOutcome> {
  const [row] = await drizzle
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY))
    .limit(1)

  const accountCode = resolveXeroPaymentAccountCode(row?.value)
  if (!accountCode) {
    return { rail: 'xero', status: 'skipped', reason: 'No Xero payment account code in settings' }
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return { rail: 'xero', status: 'skipped', reason: 'Invoice has no positive total to record' }
  }

  const res = await callXeroAPI('PUT', '/Payments', {
    Invoice: { InvoiceID: xeroInvoiceId },
    Account: { Code: accountCode },
    // Xero wants a plain date here, not a timestamp.
    Date: paidOn.slice(0, 10),
    Amount: amount,
  })

  if (!res) {
    // callXeroAPI swallows the error into a null and logs it. Common causes:
    // the invoice is still a DRAFT in Xero (a payment needs an AUTHORISED
    // invoice), the account code is not a bank account, or the amount exceeds
    // what is due.
    return { rail: 'xero', status: 'failed', reason: 'Xero did not accept the payment' }
  }

  return { rail: 'xero', status: 'done' }
}

/**
 * Mark the Stripe invoice paid without charging anyone: the money arrived
 * somewhere else (a transfer, a cheque, a card taken by hand), which is
 * exactly what Stripe's paid_out_of_band means. Voiding instead would lose the
 * revenue from Stripe's own reporting.
 */
async function pushPaidToStripe(stripeInvoiceId: string): Promise<PushbackOutcome> {
  const key = stripeSecretKey()
  if (!key) {
    return { rail: 'stripe', status: 'skipped', reason: 'Stripe is not configured' }
  }

  const res = await fetch(`https://api.stripe.com/v1/invoices/${stripeInvoiceId}/pay`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ paid_out_of_band: 'true' }).toString(),
  })

  if (!res.ok) {
    let message = `Stripe answered ${res.status}`
    try {
      const data = await res.json() as { error?: { message?: string } }
      if (data?.error?.message) message = data.error.message
    } catch { /* keep the status line */ }
    return { rail: 'stripe', status: 'failed', reason: message }
  }

  return { rail: 'stripe', status: 'done' }
}

/**
 * Tell the rail this invoice was paid. Returns undefined when there is no rail
 * to tell (a manual invoice, or one that never reached Stripe or Xero), which
 * is not a failure and is reported as no `pushback` key at all.
 *
 * Never throws: the local write has already happened and must stand.
 */
async function pushPaymentToRail(
  drizzle: D1,
  invoice: PushbackInvoice,
  paidOn: string,
): Promise<PushbackOutcome | undefined> {
  try {
    if (invoice.source === 'xero' && invoice.xeroInvoiceId) {
      return await pushPaidToXero(drizzle, invoice.xeroInvoiceId, invoice.totalUsd, paidOn)
    }
    if (invoice.source === 'stripe' && invoice.stripeInvoiceId) {
      return await pushPaidToStripe(invoice.stripeInvoiceId)
    }
    return undefined
  } catch (err) {
    const rail: PushbackRail = invoice.source === 'xero' ? 'xero' : 'stripe'
    return { rail, status: 'failed', reason: err instanceof Error ? err.message : 'Push-back failed' }
  }
}

// ── GET /api/admin/invoices/[id] ─────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'invoices')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping: look up the invoice's orgId before returning details
  const [ownerRow] = await drizzle
    .select({ orgId: schema.invoices.orgId })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1)
  const denied = await requireAccessToOrg(drizzle, userId, ownerRow?.orgId)
  if (denied) return denied

  const [invoiceRow] = await drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      orgName: schema.organisations.name,
      projectId: schema.invoices.projectId,
      subscriptionId: schema.invoices.subscriptionId,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      // The studio's copy of the client pay page. Without it the detail page
      // could only offer "Copy Payment Link", a round trip to Stripe, while
      // the link we already persisted at finalise time sat unread.
      stripeHostedInvoiceUrl: schema.invoices.stripeHostedInvoiceUrl,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      // Which channel raised this bill. Omitting it made every invoice read
      // "Source: Manual" on the detail page while the list badged it right.
      source: schema.invoices.source,
      status: schema.invoices.status,
      amountUsd: schema.invoices.amountUsd,
      taxAmountUsd: schema.invoices.taxAmountUsd,
      discountAmountUsd: schema.invoices.discountAmountUsd,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      notes: schema.invoices.notes,
      dueDate: schema.invoices.dueDate,
      sentAt: schema.invoices.sentAt,
      viewedAt: schema.invoices.viewedAt,
      paidAt: schema.invoices.paidAt,
      createdAt: schema.invoices.createdAt,
      updatedAt: schema.invoices.updatedAt,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .where(eq(schema.invoices.id, id))
    .limit(1)

  if (!invoiceRow) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const items = await drizzle
    .select()
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, id))

  return NextResponse.json({ invoice: invoiceRow, items })
}

// ── PATCH /api/admin/invoices/[id] ───────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'invoices')
  if (featureDenied) return featureDenied

  const { id } = await params
  const body = await req.json() as {
    status?: string
    dueDate?: string | null
    notes?: string | null
    orgId?: string
    paidAt?: string | null
    sentAt?: string | null
    // Opt OUT of telling the rail. Not one of FIELDS: it is a modifier on a
    // status change, never a change on its own.
    pushback?: boolean
  }

  const FIELDS = ['status', 'dueDate', 'notes', 'orgId', 'paidAt', 'sentAt'] as const
  if (!FIELDS.some(field => field in body)) {
    return NextResponse.json({ error: 'At least one field is required' }, { status: 400 })
  }

  // paidAt / sentAt are money-report inputs (/financial-reports reads paid_at,
  // not status, for YTD revenue and 90-day collected), so a malformed stamp
  // must be refused rather than written and silently dropped from the totals.
  // The date part is required as well as parseable: Date.parse alone accepts
  // "42" (year 2042) and other shapes that would land in the wrong year.
  // Everything that passes the shape check is normalised to a full ISO stamp
  // before it is written. Every reader compares paid_at as a raw string
  // against a `new Date(...).toISOString()` boundary (financial-reports
  // summary, the finance anomaly scan), and "2026-01-01" sorts BELOW
  // "2026-01-01T00:00:00.000Z", so a date-only or space-separated stamp would
  // drop out of the very year, quarter or month it belongs to.
  const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}([T ]|$)/
  const stamps: Partial<Record<'paidAt' | 'sentAt', string | null>> = {}
  for (const field of ['paidAt', 'sentAt'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (value === undefined || value === null) {
      stamps[field] = null
      continue
    }
    if (typeof value !== 'string' || !ISO_PREFIX.test(value) || Number.isNaN(Date.parse(value))) {
      return NextResponse.json({ error: `${field} must be an ISO date string or null` }, { status: 400 })
    }
    stamps[field] = new Date(value).toISOString()
  }

  // Paid with no paid date is the exact state this route exists to prevent, so
  // the self-contradicting pair is refused rather than half-honoured. Clearing
  // the date on its own is still allowed: that is a correction, not a claim
  // that the invoice is paid.
  if (body.status === 'paid' && stamps.paidAt === null) {
    return NextResponse.json({ error: 'paidAt cannot be null when status is paid' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }

  if (body.status !== undefined) patch.status = body.status
  if ('dueDate' in body) patch.dueDate = body.dueDate ?? null
  if ('notes' in body) patch.notes = body.notes ?? null
  if (body.orgId !== undefined) patch.orgId = body.orgId
  if ('paidAt' in body) patch.paidAt = stamps.paidAt ?? null
  if ('sentAt' in body) patch.sentAt = stamps.sentAt ?? null

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping: must have access to both the current owner and (if reassigning) the new owner
  const [currentOwner] = await drizzle
    .select({
      orgId: schema.invoices.orgId,
      status: schema.invoices.status,
      paidAt: schema.invoices.paidAt,
      sentAt: schema.invoices.sentAt,
      // Push-back inputs, read in this same query rather than a second one:
      // which rail owns the bill, its id there, and the amount to record.
      source: schema.invoices.source,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      totalUsd: schema.invoices.totalUsd,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1)
  const denied = await requireAccessToOrg(drizzle, userId, currentOwner?.orgId)
  if (denied) return denied

  if (body.orgId !== undefined) {
    const deniedNew = await requireAccessToOrg(drizzle, userId, body.orgId)
    if (deniedNew) return deniedNew
  }

  // A status flip has to carry its date, or a hand mark-paid (bank transfer,
  // the whole reason this route exists) leaves paid_at NULL and the invoice
  // vanishes from every revenue figure Liam reads. An explicit stamp in the
  // body always wins; this only fills the gap.
  if (body.status !== undefined) {
    if (body.status === 'paid') {
      if (!('paidAt' in body) && !currentOwner?.paidAt) patch.paidAt = now
    } else if (
      currentOwner?.status === 'paid'
      && !('paidAt' in body)
      && UNWINDS_PAYMENT.has(body.status)
    ) {
      // Moving back to an unpaid status (revert to draft, back to sent): the
      // paid date is no longer true, and leaving it would keep counting the
      // invoice as revenue. A write-off is excluded on purpose, see the set.
      patch.paidAt = null
    }
    if (body.status === 'sent' && !('sentAt' in body) && !currentOwner?.sentAt) {
      patch.sentAt = now
    }
  }

  await drizzle
    .update(schema.invoices)
    .set(patch)
    .where(eq(schema.invoices.id, id))

  // If voided/written_off and has xeroInvoiceId, void in Xero too
  if (body.status === 'written_off') {
    const [inv] = await drizzle
      .select({ xeroInvoiceId: schema.invoices.xeroInvoiceId })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, id))
      .limit(1)

    if (inv?.xeroInvoiceId) {
      try {
        await callXeroAPI('POST', `/Invoices/${inv.xeroInvoiceId}`, {
          InvoiceID: inv.xeroInvoiceId,
          Status: 'VOIDED',
        })
      } catch {
        // Xero void failed silently, local status already updated
      }
    }
  }

  // Tell the rail. Strictly after the local write (the dashboard is the source
  // of truth for the paid date and a rail outage must not stop Liam recording
  // revenue), only on a real transition INTO paid (a repeat PATCH would post a
  // second Xero payment against the same invoice), and skippable with
  // `{ pushback: false }` for a caller reconciling a payment the rail already
  // knows about.
  let pushback: PushbackOutcome | undefined
  if (
    body.status === 'paid'
    && currentOwner?.status !== 'paid'
    && body.pushback !== false
  ) {
    const paidOn = (typeof patch.paidAt === 'string' ? patch.paidAt : null)
      ?? currentOwner?.paidAt
      ?? now
    pushback = await pushPaymentToRail(
      drizzle,
      {
        source: currentOwner?.source ?? null,
        xeroInvoiceId: currentOwner?.xeroInvoiceId ?? null,
        stripeInvoiceId: currentOwner?.stripeInvoiceId ?? null,
        totalUsd: currentOwner?.totalUsd ?? null,
      },
      paidOn,
    )
  }

  // Fire lifecycle events on a paid / overdue transition (automations +
  // outgoing webhooks). Non-blocking. Other status changes are not lifecycle
  // events, so they emit nothing. The push-back outcome rides along: this
  // route keeps no audit log of its own, and the event stream is where an
  // automation or a webhook can see that a rail refused the payment.
  const lifecycleType =
    body.status === 'paid' ? 'invoice_paid' as const
    : body.status === 'overdue' ? 'invoice_overdue' as const
    : null
  if (lifecycleType) {
    await dispatchDomainEvent(drizzle, {
      type: lifecycleType,
      entityId: id,
      entityType: 'invoice',
      orgId: currentOwner?.orgId ?? null,
      data: { status: body.status, ...(pushback ? { pushback } : {}) },
    })
  }

  return NextResponse.json({ success: true, ...(pushback ? { pushback } : {}) })
}

// ── DELETE /api/admin/invoices/[id] ─────────────────────────────────────────
// Only draft invoices can be deleted
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'invoices')
  if (featureDenied) return featureDenied

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [invoice] = await drizzle
    .select({
      status: schema.invoices.status,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      orgId: schema.invoices.orgId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1)

  if (!invoice) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const denied = await requireAccessToOrg(drizzle, userId, invoice.orgId)
  if (denied) return denied

  // Void in Stripe if linked (draft = delete, finalized = void)
  const stripeKey = stripeSecretKey()
  if (invoice.stripeInvoiceId && stripeKey) {
    try {
      // Try to void first (for finalized invoices)
      const voidRes = await fetch(`https://api.stripe.com/v1/invoices/${invoice.stripeInvoiceId}/void`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${stripeKey}` },
      })
      if (!voidRes.ok) {
        // If void fails (e.g. draft), try delete
        await fetch(`https://api.stripe.com/v1/invoices/${invoice.stripeInvoiceId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${stripeKey}` },
        })
      }
    } catch { /* Stripe cleanup failed silently */ }
  }

  // Void in Xero if linked
  if (invoice.xeroInvoiceId) {
    try {
      await callXeroAPI('POST', `/Invoices/${invoice.xeroInvoiceId}`, {
        InvoiceID: invoice.xeroInvoiceId,
        Status: 'VOIDED',
      })
    } catch { /* Xero cleanup failed silently */ }
  }

  await drizzle.delete(schema.invoiceItems).where(eq(schema.invoiceItems.invoiceId, id))
  await drizzle.delete(schema.invoices).where(eq(schema.invoices.id, id))

  return NextResponse.json({ success: true })
}

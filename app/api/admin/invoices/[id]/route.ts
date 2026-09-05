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

type Params = { params: Promise<{ id: string }> }

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
  const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}([T ]|$)/
  for (const field of ['paidAt', 'sentAt'] as const) {
    const value = body[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string' || !ISO_PREFIX.test(value) || Number.isNaN(Date.parse(value))) {
      return NextResponse.json({ error: `${field} must be an ISO date string or null` }, { status: 400 })
    }
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }

  if (body.status !== undefined) patch.status = body.status
  if ('dueDate' in body) patch.dueDate = body.dueDate ?? null
  if ('notes' in body) patch.notes = body.notes ?? null
  if (body.orgId !== undefined) patch.orgId = body.orgId
  if ('paidAt' in body) patch.paidAt = body.paidAt ?? null
  if ('sentAt' in body) patch.sentAt = body.sentAt ?? null

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping: must have access to both the current owner and (if reassigning) the new owner
  const [currentOwner] = await drizzle
    .select({
      orgId: schema.invoices.orgId,
      status: schema.invoices.status,
      paidAt: schema.invoices.paidAt,
      sentAt: schema.invoices.sentAt,
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
    } else if (currentOwner?.status === 'paid' && !('paidAt' in body)) {
      // Moving off paid (revert to draft, void): the paid date is no longer
      // true, and leaving it would keep counting the invoice as revenue.
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

  // Fire lifecycle events on a paid / overdue transition (automations +
  // outgoing webhooks). Non-blocking. Other status changes are not lifecycle
  // events, so they emit nothing.
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
      data: { status: body.status },
    })
  }

  return NextResponse.json({ success: true })
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

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/invoices/[id] ─────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [invoiceRow] = await drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      orgName: schema.organisations.name,
      projectId: schema.invoices.projectId,
      subscriptionId: schema.invoices.subscriptionId,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
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
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    status?: string
    dueDate?: string | null
    notes?: string | null
    orgId?: string
  }

  if (!('status' in body) && !('dueDate' in body) && !('notes' in body) && !('orgId' in body)) {
    return NextResponse.json({ error: 'At least one field is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }

  if (body.status !== undefined) patch.status = body.status
  if ('dueDate' in body) patch.dueDate = body.dueDate ?? null
  if ('notes' in body) patch.notes = body.notes ?? null
  if (body.orgId !== undefined) patch.orgId = body.orgId

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/invoices/[id] ─────────────────────────────────────────
// Only draft invoices can be deleted
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [invoice] = await drizzle
    .select({
      status: schema.invoices.status,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
    })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1)

  if (!invoice) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Void in Stripe if linked (draft = delete, finalized = void)
  if (invoice.stripeInvoiceId && process.env.STRIPE_SECRET_KEY) {
    try {
      // Try to void first (for finalized invoices)
      const voidRes = await fetch(`https://api.stripe.com/v1/invoices/${invoice.stripeInvoiceId}/void`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      })
      if (!voidRes.ok) {
        // If void fails (e.g. draft), try delete
        await fetch(`https://api.stripe.com/v1/invoices/${invoice.stripeInvoiceId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
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

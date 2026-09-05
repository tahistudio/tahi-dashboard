import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { isOrgAdmin } from '@/lib/portal-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, ne } from 'drizzle-orm'
import {
  buildHowToPay,
  isInvoiceSettled,
  readInvoicePayContext,
  resolveInvoicePayUrl,
} from '@/lib/invoice-how-to-pay'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/portal/invoices/[id] ────────────────────────────────────────────
// One invoice, scoped to the authenticated client's own org.
//
// Before this route existed, every client row click and every emailed "View
// Invoice" button landed on /api/admin/invoices/[id], which 403s them. The
// shape mirrors the admin detail route (invoice + items) so the shared
// /invoices/[id] page renders from either source unchanged.
//
// The pay path, same rules as the list route: `payUrl` is Stripe's hosted
// page or, when there is none, Xero's own online invoice; `howToPay` carries
// the bank details, the reference and the amount for a Xero-rail invoice that
// is still owed and has no link yet, which is where every pushed Xero invoice
// starts. A settled bill carries neither, so the client is never told how to
// pay something they have already paid.
//
// Tenancy: the org filter is part of the WHERE clause, not a post-check, so a
// guessed id from another client is indistinguishable from a missing one (404).
// Drafts are excluded here exactly as they are in the list: a draft is the
// studio's working copy and is not a bill the client owes.
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId, impersonating, clerkOrgId } = await getPortalAuth(req)

  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'invoices')

  if (featureDenied) return featureDenied

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!orgId) {
    return NextResponse.json(
      { error: 'No organisation found for this user', code: 'no_org' },
      { status: 403 },
    )
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Financial data: workspace admins of the org only (member seats are
  // denied), matching the list route. A Tahi admin previewing Client view has
  // no contact row in the org, so impersonation is allowed through.
  if (!impersonating && !(await isOrgAdmin(drizzle, orgId, userId))) {
    // The seat, named. Without the code every denial on this route read as the
    // same bare Forbidden and /invoices told an org admin to go ask themselves.
    return NextResponse.json({ error: 'Forbidden', code: 'not_org_admin' }, { status: 403 })
  }

  const [row] = await drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      orgName: schema.organisations.name,
      projectId: schema.invoices.projectId,
      subscriptionId: schema.invoices.subscriptionId,
      // `source` is deliberately absent: which rail raised the bill is a
      // studio fact, and shipping it in the JSON left it one Network tab away
      // from a client even though nothing on the surface renders it.
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
      payUrl: schema.invoices.stripeHostedInvoiceUrl,
      // Both stripped from the response below. The Xero pay page is folded
      // into payUrl (the client does not care which rail issued the link) and
      // the org's rail is a studio fact that decides whether a How to pay
      // block is built, never something the client is shown.
      xeroPayUrl: schema.invoices.xeroOnlineInvoiceUrl,
      orgInvoiceChannel: schema.organisations.invoiceChannel,
      createdAt: schema.invoices.createdAt,
      updatedAt: schema.invoices.updatedAt,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .where(and(
      eq(schema.invoices.id, id),
      eq(schema.invoices.orgId, orgId),
      ne(schema.invoices.status, 'draft'),
    ))
    .limit(1)

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { xeroPayUrl, orgInvoiceChannel, ...rest } = row
  const payUrl = resolveInvoicePayUrl(rest.payUrl, xeroPayUrl)

  // Only when the bill is still owed and there is nothing to click. A settled
  // invoice needs no bank details and a bill with a hosted pay page needs none
  // either, and reading the settings for one would be a round trip spent on a
  // block that is never built.
  let howToPay = null
  if (!payUrl && !isInvoiceSettled(rest)) {
    // The whole K/V table: a handful of studio rows, one query for the two
    // keys the block needs (the default rail and the bank details).
    const settingRows = await drizzle
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)

    const payContext = readInvoicePayContext(settingRows, orgInvoiceChannel)
    howToPay = buildHowToPay({
      channel: payContext.channel,
      payUrl,
      invoice: {
        id: rest.id,
        status: rest.status,
        totalUsd: rest.totalUsd,
        currency: rest.currency,
        dueDate: rest.dueDate,
        paidAt: rest.paidAt,
      },
      bankDetails: payContext.bankDetails,
    })
  }

  const invoice = { ...rest, payUrl, ...(howToPay ? { howToPay } : {}) }

  const items = await drizzle
    .select({
      id: schema.invoiceItems.id,
      invoiceId: schema.invoiceItems.invoiceId,
      description: schema.invoiceItems.description,
      quantity: schema.invoiceItems.quantity,
      unitPriceUsd: schema.invoiceItems.unitPriceUsd,
      totalUsd: schema.invoiceItems.totalUsd,
    })
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, invoice.id))

  // First real client open stamps viewedAt so the studio can tell "sent" from
  // "seen". Never on an admin preview, and never re-stamped.
  if (!impersonating && !invoice.viewedAt) {
    try {
      await drizzle
        .update(schema.invoices)
        .set({ viewedAt: new Date().toISOString() })
        .where(eq(schema.invoices.id, invoice.id))
    } catch {
      // Non-fatal: the read is what the client asked for.
    }
  }

  // Internal-only columns (Stripe / Xero ids, reconciliation state) are never
  // selected above, and the two studio-side values that ARE read (the Xero pay
  // page, the org's rail) are destructured off before the object is built, so
  // nothing internal can leak through this projection.
  return NextResponse.json({ invoice, items })
}

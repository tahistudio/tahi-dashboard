import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { isOrgAdmin } from '@/lib/portal-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc, ne } from 'drizzle-orm'
import {
  buildHowToPay,
  readInvoicePayContext,
  resolveInvoicePayUrl,
} from '@/lib/invoice-how-to-pay'

// ── GET /api/portal/invoices ──────────────────────────────────────────────────
// Returns invoices scoped to the authenticated client's org.
// Query params: status (draft|sent|overdue|paid|all, default all), page (default 1)
//
// Two pay-path fields, and both are things the CLIENT needs in order to act:
//
//   payUrl     Stripe's hosted page, or Xero's own online invoice when there
//              is no Stripe one. A link is a link; the client does not care
//              which rail issued it, and gating the Xero page on the org's
//              nominal channel would leave a payable bill unpayable.
//   howToPay   bank details, the reference and the amount, for a Xero-rail
//              invoice with no link yet. That is the ORDINARY state of a
//              pushed Xero invoice (it sits at DRAFT until Liam approves it),
//              and without this block the client holds a real bill with
//              nothing on the page to act on.
//
// Nothing studio-side rides along: no rail label, no Stripe or Xero id, no
// reconciliation state. See lib/invoice-how-to-pay.ts.
export async function GET(req: NextRequest) {
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

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') ?? 'all'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Financial data: workspace admins of the org only (member seats are
  // denied). A Tahi admin previewing Client view has no contact row in the
  // org, so impersonation is allowed through for this read.
  if (!impersonating && !(await isOrgAdmin(drizzle, orgId, userId))) {
    // The seat, named. Without the code every denial on this route read as the
    // same bare Forbidden and /invoices told an org admin to go ask themselves.
    return NextResponse.json({ error: 'Forbidden', code: 'not_org_admin' }, { status: 403 })
  }

  let items
  if (statusParam !== 'all') {
    items = await drizzle
      .select({
        id: schema.invoices.id,
        orgId: schema.invoices.orgId,
        status: schema.invoices.status,
        totalAmount: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
        dueDate: schema.invoices.dueDate,
        sentAt: schema.invoices.sentAt,
        paidAt: schema.invoices.paidAt,
        // Stripe's hosted invoice page, persisted at finalise time. Drives the
        // client's Pay now CTA straight from the list row.
        payUrl: schema.invoices.stripeHostedInvoiceUrl,
        // Xero's own client-facing pay page, captured by the syncs once Liam
        // approves the invoice in Xero. Folded into payUrl below and never
        // returned under its own name.
        xeroPayUrl: schema.invoices.xeroOnlineInvoiceUrl,
        createdAt: schema.invoices.createdAt,
        updatedAt: schema.invoices.updatedAt,
      })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.orgId, orgId),
        eq(schema.invoices.status, statusParam),
        ne(schema.invoices.status, 'draft'),
      ))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(limit)
      .offset(offset)
  } else {
    items = await drizzle
      .select({
        id: schema.invoices.id,
        orgId: schema.invoices.orgId,
        status: schema.invoices.status,
        totalAmount: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
        dueDate: schema.invoices.dueDate,
        sentAt: schema.invoices.sentAt,
        paidAt: schema.invoices.paidAt,
        // Stripe's hosted invoice page, persisted at finalise time. Drives the
        // client's Pay now CTA straight from the list row.
        payUrl: schema.invoices.stripeHostedInvoiceUrl,
        // Xero's own client-facing pay page, captured by the syncs once Liam
        // approves the invoice in Xero. Folded into payUrl below and never
        // returned under its own name.
        xeroPayUrl: schema.invoices.xeroOnlineInvoiceUrl,
        createdAt: schema.invoices.createdAt,
        updatedAt: schema.invoices.updatedAt,
      })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), ne(schema.invoices.status, 'draft')))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(limit)
      .offset(offset)
  }

  // The pay-path reads are only worth making when at least one bill on this
  // page has nothing to click. A client whose invoices all carry a hosted page
  // pays no extra D1 round trips for a block they will never see.
  const needsPayPath = items.some(row => !resolveInvoicePayUrl(row.payUrl, row.xeroPayUrl))

  let payContext: ReturnType<typeof readInvoicePayContext> | null = null
  if (needsPayPath) {
    const [org] = await drizzle
      .select({ invoiceChannel: schema.organisations.invoiceChannel })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)

    // The whole K/V table: it is a handful of studio rows, and reading it
    // whole keeps this to one query for the two keys the block needs (the
    // default rail and the bank details).
    const settingRows = await drizzle
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)

    payContext = readInvoicePayContext(settingRows, org?.invoiceChannel)
  }

  // `xeroPayUrl` is dropped here rather than returned: the client is handed
  // one `payUrl` and never has to know which rail issued it.
  const projected = items.map(({ xeroPayUrl, ...row }) => {
    const payUrl = resolveInvoicePayUrl(row.payUrl, xeroPayUrl)
    const howToPay = payContext
      ? buildHowToPay({
        channel: payContext.channel,
        payUrl,
        invoice: {
          id: row.id,
          totalUsd: row.totalAmount,
          currency: row.currency,
          dueDate: row.dueDate,
        },
        bankDetails: payContext.bankDetails,
      })
      : null
    return { ...row, payUrl, ...(howToPay ? { howToPay } : {}) }
  })

  return NextResponse.json({ items: projected, page, limit })
}

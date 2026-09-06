import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { getOrgScope, requireAccessToOrg } from '@/lib/require-access'
import { requireFeature } from '@/lib/require-feature'
import { dispatchDomainEvent } from '@/lib/events'
import { withInvoiceNumber } from '@/lib/invoice-number'

// ── GET /api/admin/invoices ───────────────────────────────────────────────────
// Returns paginated invoices with org name joined.
// Query params: status (draft|sent|overdue|paid|all, default all), page (default 1)
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Money route: the Tahi org alone is not enough, the seat must be able to
  // see Invoices (CLAUDE.md rule 11 + the role contract in lib/require-feature).
  const deniedFeature = await requireFeature({ userId, orgId }, 'invoices')
  if (deniedFeature) return deniedFeature

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') ?? 'all'
  const orgIdFilter = url.searchParams.get('orgId')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping: restrict to the team member's allowed orgs
  const scope = await getOrgScope(drizzle, userId)
  if (scope !== null && scope.length === 0) {
    return NextResponse.json({ items: [], page, limit })
  }

  // Build conditions
  const conditions = []
  if (statusParam !== 'all') {
    conditions.push(eq(schema.invoices.status, statusParam))
  }
  if (orgIdFilter) {
    conditions.push(eq(schema.invoices.orgId, orgIdFilter))
  }
  if (scope !== null) {
    conditions.push(inArray(schema.invoices.orgId, scope))
  }

  const query = drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      orgName: schema.organisations.name,
      status: schema.invoices.status,
      // The real invoice number (migration 0096). NULL on every row raised
      // before it existed and on every import with nothing to carry over, so
      // the list falls back to the short id through invoiceReference.
      number: schema.invoices.number,
      source: schema.invoices.source,
      stripeInvoiceId: schema.invoices.stripeInvoiceId,
      xeroInvoiceId: schema.invoices.xeroInvoiceId,
      totalAmount: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      dueDate: schema.invoices.dueDate,
      createdAt: schema.invoices.createdAt,
      updatedAt: schema.invoices.updatedAt,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .orderBy(desc(schema.invoices.createdAt))
    .limit(limit)
    .offset(offset)

  const items = conditions.length > 0
    ? await query.where(and(...conditions))
    : await query

  return NextResponse.json({ items, page, limit })
}

// ── POST /api/admin/invoices ──────────────────────────────────────────────────
// Creates a new invoice with line items.
// Body: { orgId, subscriptionId?, lineItems: [{ description, quantity, unitAmount, currency }], dueDate?, notes? }
export async function POST(req: NextRequest) {
  const { orgId: authOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(authOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const deniedFeature = await requireFeature({ userId, orgId: authOrgId }, 'invoices')
  if (deniedFeature) return deniedFeature

  const body = await req.json() as {
    orgId?: string
    subscriptionId?: string
    currency?: string
    lineItems?: Array<{
      description: string
      quantity: number
      unitAmount: number
      currency?: string
    }>
    dueDate?: string
    notes?: string
    // Source captures the user's intent at creation time. Even if the
    // downstream Stripe/Xero call fails, source remembers what they
    // were trying to do so the FE can show "Stripe link failed — retry".
    source?: 'manual' | 'stripe' | 'xero'
  }

  if (!body.orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

  const drizzleForAccess = (await db()) as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const deniedAccess = await requireAccessToOrg(drizzleForAccess, userId, body.orgId)
  if (deniedAccess) return deniedAccess

  if (!Array.isArray(body.lineItems) || body.lineItems.length === 0) {
    return NextResponse.json({ error: 'lineItems must be a non-empty array' }, { status: 400 })
  }

  for (const item of body.lineItems) {
    if (typeof item.description !== 'string' || !item.description) {
      return NextResponse.json({ error: 'Each lineItem must have a description string' }, { status: 400 })
    }
    if (typeof item.quantity !== 'number') {
      return NextResponse.json({ error: 'Each lineItem must have a numeric quantity' }, { status: 400 })
    }
    if (typeof item.unitAmount !== 'number') {
      return NextResponse.json({ error: 'Each lineItem must have a numeric unitAmount' }, { status: 400 })
    }
  }

  const VALID_CURRENCIES = ['NZD', 'USD', 'AUD', 'GBP', 'EUR']
  const rawCurrency = body.currency ?? body.lineItems[0]?.currency ?? 'NZD'
  const currency = VALID_CURRENCIES.includes(rawCurrency) ? rawCurrency : 'NZD'
  const totalAmount = body.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0,
  )

  const now = new Date().toISOString()
  const invoiceId = crypto.randomUUID()

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const requestedSource = body.source ?? 'manual'

  // This is the studio raising a bill, so the studio's own sequence numbers it
  // (Liam, 2026-09-06). The insert runs inside withInvoiceNumber so a unique
  // conflict on invoices.number mints a fresh one and retries rather than
  // failing the invoice; a counter that cannot be reached at all writes the row
  // unnumbered instead of refusing to bill. The line items are written after,
  // on purpose: only the invoice row can collide, and a retry must not insert
  // them twice.
  const number = await withInvoiceNumber(drizzle, async (minted) => {
    await drizzle.insert(schema.invoices).values({
      id: invoiceId,
      orgId: body.orgId as string,
      subscriptionId: body.subscriptionId ?? null,
      source: requestedSource,
      status: 'draft',
      number: minted,
      amountUsd: totalAmount,
      totalUsd: totalAmount,
      currency,
      dueDate: body.dueDate ?? null,
      notes: body.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
  })

  const itemRows = body.lineItems.map(item => ({
    id: crypto.randomUUID(),
    invoiceId,
    description: item.description,
    quantity: item.quantity,
    unitPriceUsd: item.unitAmount,
    totalUsd: item.quantity * item.unitAmount,
  }))

  await drizzle.insert(schema.invoiceItems).values(itemRows)

  // Deliberately NO client notification here. This route only ever creates a
  // DRAFT, the portal filters drafts out of both the list and the detail
  // route, and a draft is the studio's working copy rather than a bill the
  // client owes. Telling them about it pointed at something they could not
  // open. The client is notified when the invoice is actually sent, in
  // invoices/[id]/send-email and invoices/stripe-create.

  // Fire the domain event (automations + outgoing webhooks). Non-blocking.
  await dispatchDomainEvent(drizzle, {
    type: 'invoice_created',
    entityId: invoiceId,
    entityType: 'invoice',
    orgId: body.orgId,
    data: {
      status: 'draft',
      currency,
      totalAmount,
      source: requestedSource,
      number,
    },
  })

  // `number` comes back so the caller (the New Invoice slide-over, MCP
  // create_invoice) can show what the bill is actually called without a second
  // round trip. Null means the counter could not be reached and the row is
  // unnumbered, which every reader handles by falling back to the short id.
  return NextResponse.json({ id: invoiceId, number })
}

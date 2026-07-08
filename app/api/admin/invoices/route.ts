import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray } from 'drizzle-orm'
import { notifyOrgContacts } from '@/lib/notifications'
import { getOrgScope, requireAccessToOrg } from '@/lib/require-access'
import { dispatchDomainEvent } from '@/lib/events'

// ── GET /api/admin/invoices ───────────────────────────────────────────────────
// Returns paginated invoices with org name joined.
// Query params: status (draft|sent|overdue|paid|all, default all), page (default 1)
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  await drizzle.insert(schema.invoices).values({
    id: invoiceId,
    orgId: body.orgId,
    subscriptionId: body.subscriptionId ?? null,
    source: requestedSource,
    status: 'draft',
    amountUsd: totalAmount,
    totalUsd: totalAmount,
    currency,
    dueDate: body.dueDate ?? null,
    notes: body.notes ?? null,
    createdAt: now,
    updatedAt: now,
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

  // Notify client contacts about the new invoice. notifyOrgContacts keys the
  // rows on each contact's Clerk user id (the id the bell queries and the
  // preferences filter on) and skips contacts without a linked login.
  // totalAmount is already a dollar amount in the invoice's currency, not
  // cents. (We don't store amounts in minor units anywhere.)
  const formattedAmount = `${currency} ${totalAmount.toFixed(2)}`
  await notifyOrgContacts(drizzle, body.orgId, {
    type: 'invoice_created',
    title: 'New invoice created',
    body: `An invoice for ${formattedAmount} has been created for your account`,
    entityType: 'invoice',
    entityId: invoiceId,
  })

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
    },
  })

  return NextResponse.json({ id: invoiceId })
}

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'
import { createNotifications } from '@/lib/notifications'

// ── GET /api/admin/invoices ───────────────────────────────────────────────────
// Returns paginated invoices with org name joined.
// Query params: status (draft|sent|overdue|paid|all, default all), page (default 1)
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
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

  // Build conditions
  const conditions = []
  if (statusParam !== 'all') {
    conditions.push(eq(schema.invoices.status, statusParam))
  }
  if (orgIdFilter) {
    conditions.push(eq(schema.invoices.orgId, orgIdFilter))
  }

  const query = drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      orgName: schema.organisations.name,
      status: schema.invoices.status,
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
  const { orgId: authOrgId } = await getRequestAuth(req)
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
  }

  if (!body.orgId) {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }

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

  await drizzle.insert(schema.invoices).values({
    id: invoiceId,
    orgId: body.orgId,
    subscriptionId: body.subscriptionId ?? null,
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

  // Notify client contacts about the new invoice
  const contacts = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, body.orgId))
    .limit(10)

  const recipients = contacts.map((c) => ({
    userId: c.id,
    userType: 'contact' as const,
  }))

  if (recipients.length > 0) {
    const formattedAmount = `${currency} ${(totalAmount / 100).toFixed(2)}`
    await createNotifications(drizzle, recipients, {
      type: 'invoice_created',
      title: 'New invoice created',
      body: `An invoice for ${formattedAmount} has been created for your account`,
      entityType: 'invoice',
      entityId: invoiceId,
    })
  }

  return NextResponse.json({ id: invoiceId })
}

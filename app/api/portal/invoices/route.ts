import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc, ne } from 'drizzle-orm'

// ── GET /api/portal/invoices ──────────────────────────────────────────────────
// Returns invoices scoped to the authenticated client's org.
// Query params: status (draft|sent|overdue|paid|all, default all), page (default 1)
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!orgId) {
    return NextResponse.json({ error: 'No organisation found for this user' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusParam = url.searchParams.get('status') ?? 'all'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
        createdAt: schema.invoices.createdAt,
        updatedAt: schema.invoices.updatedAt,
      })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.orgId, orgId), ne(schema.invoices.status, 'draft')))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(limit)
      .offset(offset)
  }

  return NextResponse.json({ items, page, limit })
}

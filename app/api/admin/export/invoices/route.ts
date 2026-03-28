import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lte, desc } from 'drizzle-orm'

// -- GET /api/admin/export/invoices --
// Returns invoices as CSV.
// Query params: status, dateFrom, dateTo
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (statusFilter && statusFilter !== 'all') {
    conditions.push(eq(schema.invoices.status, statusFilter))
  }
  if (dateFrom) conditions.push(gte(schema.invoices.createdAt, dateFrom))
  if (dateTo) conditions.push(lte(schema.invoices.createdAt, dateTo))

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const items = await drizzle
    .select({
      id: schema.invoices.id,
      orgName: schema.organisations.name,
      status: schema.invoices.status,
      totalAmount: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      dueDate: schema.invoices.dueDate,
      createdAt: schema.invoices.createdAt,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .where(whereClause)
    .orderBy(desc(schema.invoices.createdAt))

  const header = 'Invoice ID,Client,Status,Amount,Currency,Due Date,Created'
  const rows = items.map((item) => {
    return [
      item.id,
      csvEscape(item.orgName ?? ''),
      item.status,
      item.totalAmount,
      item.currency ?? 'NZD',
      item.dueDate ?? '',
      item.createdAt,
    ].join(',')
  })

  const csv = [header, ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="invoices.csv"',
    },
  })
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

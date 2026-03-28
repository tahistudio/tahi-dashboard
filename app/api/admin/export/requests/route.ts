import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'

// -- GET /api/admin/export/requests --
// Returns requests as CSV.
// Query params: status, orgId
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')
  const orgIdFilter = url.searchParams.get('orgId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (statusFilter && statusFilter !== 'all') {
    conditions.push(eq(schema.requests.status, statusFilter))
  }
  if (orgIdFilter) {
    conditions.push(eq(schema.requests.orgId, orgIdFilter))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const items = await drizzle
    .select({
      title: schema.requests.title,
      orgName: schema.organisations.name,
      status: schema.requests.status,
      priority: schema.requests.priority,
      category: schema.requests.category,
      type: schema.requests.type,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .where(whereClause)
    .orderBy(desc(schema.requests.createdAt))

  const header = 'Title,Client,Status,Priority,Category,Type,Created,Updated'
  const rows = items.map((item) => {
    return [
      csvEscape(item.title),
      csvEscape(item.orgName ?? ''),
      item.status,
      item.priority,
      item.category ?? '',
      item.type,
      item.createdAt,
      item.updatedAt,
    ].join(',')
  })

  const csv = [header, ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="requests.csv"',
    },
  })
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

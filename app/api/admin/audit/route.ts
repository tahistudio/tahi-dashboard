import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq, and, gte, lte } from 'drizzle-orm'

// ── GET /api/admin/audit ─────────────────────────────────────────────────────
// Paginated audit log with optional filters:
//   ?action=created&userId=xxx&entityType=request&dateFrom=2026-01-01&dateTo=2026-12-31&page=1
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const userId = url.searchParams.get('userId')
  const entityType = url.searchParams.get('entityType')
  const dateFrom = url.searchParams.get('dateFrom')
  const dateTo = url.searchParams.get('dateTo')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  const database = await db()

  const conditions = []
  if (action) conditions.push(eq(schema.auditLog.action, action))
  if (userId) conditions.push(eq(schema.auditLog.actorId, userId))
  if (entityType) conditions.push(eq(schema.auditLog.entityType, entityType))
  if (dateFrom) conditions.push(gte(schema.auditLog.createdAt, dateFrom))
  if (dateTo) conditions.push(lte(schema.auditLog.createdAt, dateTo))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const items = await database
    .select()
    .from(schema.auditLog)
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ items, page, limit })
}

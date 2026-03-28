import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, ne, count, and, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// ── GET /api/admin/overview ───────────────────────────────────────────────────
// Returns all KPIs needed for the admin dashboard home page in one request.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [
    activeClientsResult,
    openRequestsResult,
    inProgressResult,
    recentRequests,
  ] = await Promise.all([
    // Active client orgs
    drizzle
      .select({ count: count() })
      .from(schema.organisations)
      .where(eq(schema.organisations.status, 'active')),

    // Open requests (not delivered/archived)
    drizzle
      .select({ count: count() })
      .from(schema.requests)
      .where(and(
        ne(schema.requests.status, 'delivered'),
        ne(schema.requests.status, 'archived'),
        ne(schema.requests.status, 'draft'),
      )),

    // In progress right now
    drizzle
      .select({ count: count() })
      .from(schema.requests)
      .where(inArray(schema.requests.status, ['in_progress', 'in_review', 'client_review'])),

    // Recent 8 requests for activity feed
    drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        priority: schema.requests.priority,
        type: schema.requests.type,
        orgName: schema.organisations.name,
        orgId: schema.requests.orgId,
        updatedAt: schema.requests.updatedAt,
        createdAt: schema.requests.createdAt,
        scopeFlagged: schema.requests.scopeFlagged,
      })
      .from(schema.requests)
      .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
      .where(and(
        ne(schema.requests.status, 'archived'),
      ))
      .orderBy(schema.requests.updatedAt)
      .limit(8),
  ])

  return NextResponse.json({
    kpis: {
      activeClients: activeClientsResult[0]?.count ?? 0,
      openRequests: openRequestsResult[0]?.count ?? 0,
      inProgress: inProgressResult[0]?.count ?? 0,
      outstandingInvoicesUsd: 0, // invoices module not yet implemented
    },
    recentRequests,
  })
}

/**
 * /api/portal/requests/[id]/sub-requests
 *
 *   GET → list the client-visible children of one of the caller's own
 *         requests, ordered by subPosition ASC.
 *
 * The org-scoped mirror of GET /api/admin/requests/[id]/sub-requests, added
 * so the portal's expandable request rows can open the same way the admin
 * list does. Read-only: clients create sub-requests through the team, so
 * there is deliberately no POST here.
 *
 * Two tenancy gates, both required:
 *   1. The parent must belong to the caller's org and not be internal, so a
 *      guessed id from another tenant returns 404 rather than a child list.
 *   2. The children are filtered the same way, so an internal child never
 *      leaks through a client-visible parent.
 *
 * The projection deliberately omits assigneeId and every other internal
 * routing column, matching the client-safe projection in
 * /api/portal/requests/[id].
 */

import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [parent] = await drizzle
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.id, id),
      eq(schema.requests.orgId, orgId),
      eq(schema.requests.isInternal, false),
    ))
    .limit(1)

  if (!parent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const subRequests = await drizzle
    .select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      size: schema.requests.size,
      category: schema.requests.category,
      dueDate: schema.requests.dueDate,
      subPosition: schema.requests.subPosition,
      requestNumber: schema.requests.requestNumber,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.parentRequestId, id),
      eq(schema.requests.orgId, orgId),
      eq(schema.requests.isInternal, false),
    ))
    .orderBy(asc(schema.requests.subPosition), asc(schema.requests.createdAt))

  return NextResponse.json({ subRequests })
}

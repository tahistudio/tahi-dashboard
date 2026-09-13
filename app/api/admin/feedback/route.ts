/**
 * GET /api/admin/feedback
 *
 * Admin-only read of the beta feedback comments POST /api/feedback writes.
 * No inbox UI yet: this is read through this route and the MCP tool
 * list_feedback_comments only. Newest first.
 *
 * Filters (all optional, all ANDed together):
 *   org_id, one client's comments (Tahi-caller rows have a NULL org_id and
 *           never match this filter)
 *   route,  exact route match
 *   since,  ISO instant, rows at or after it
 *   limit,  page size, 1 to 200, default 100
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, gte, type SQL } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const orgFilter = url.searchParams.get('org_id')
  const routeFilter = url.searchParams.get('route')
  const since = url.searchParams.get('since')
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), MAX_LIMIT)
    : DEFAULT_LIMIT

  const database = (await db()) as D1

  const conditions: SQL[] = []
  if (orgFilter) conditions.push(eq(schema.feedbackComments.orgId, orgFilter))
  if (routeFilter) conditions.push(eq(schema.feedbackComments.route, routeFilter))
  if (since) conditions.push(gte(schema.feedbackComments.createdAt, since))

  const rows = await database
    .select()
    .from(schema.feedbackComments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.feedbackComments.createdAt))
    .limit(limit)

  return NextResponse.json({ items: rows })
}

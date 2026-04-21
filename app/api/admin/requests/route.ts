import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne, inArray, isNull, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'

// ── GET /api/admin/requests ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status  = url.searchParams.get('status') ?? 'active'
  const clientId = url.searchParams.get('clientId')
  const page    = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit   = 50
  const offset  = (page - 1) * limit

  const database = await db()

  // Apply team member access scoping
  const scopedOrgIds = await resolveAccessScoping(database, userId)

  const conditions = []

  // If scoping returned a specific set of org IDs, filter to those
  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      return NextResponse.json({ requests: [], page, limit })
    }
    conditions.push(inArray(schema.requests.orgId, scopedOrgIds))
  }
  if (clientId) conditions.push(eq(schema.requests.orgId, clientId))

  if (status === 'active') {
    // "Active" = not archived, not delivered
    conditions.push(ne(schema.requests.status, 'archived'))
    conditions.push(ne(schema.requests.status, 'delivered'))
  } else if (status === 'unassigned') {
    // Unassigned = no assignee, not archived or delivered
    conditions.push(isNull(schema.requests.assigneeId))
    conditions.push(ne(schema.requests.status, 'archived'))
    conditions.push(ne(schema.requests.status, 'delivered'))
  } else if (status !== 'all') {
    if (status === 'in_progress') {
      conditions.push(inArray(schema.requests.status, ['submitted', 'in_review', 'in_progress', 'client_review']))
    } else {
      conditions.push(eq(schema.requests.status, status))
    }
  }

  const requests = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      status: schema.requests.status,
      priority: schema.requests.priority,
      assigneeId: schema.requests.assigneeId,
      estimatedHours: schema.requests.estimatedHours,
      startDate: schema.requests.startDate,
      dueDate: schema.requests.dueDate,
      revisionCount: schema.requests.revisionCount,
      scopeFlagged: schema.requests.scopeFlagged,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
      deliveredAt: schema.requests.deliveredAt,
      requestNumber: schema.requests.requestNumber,
      parentRequestId: schema.requests.parentRequestId,
      // Join org name
      orgName: schema.organisations.name,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.requests.updatedAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ requests, page, limit })
}

// ── POST /api/admin/requests ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    clientOrgId?: string; title?: string; type?: string
    category?: string; description?: string; priority?: string
    isInternal?: boolean | number
    startDate?: string | null; dueDate?: string | null; estimatedHours?: number | null
  }
  const { clientOrgId, title, type, category, description, priority, startDate, dueDate, estimatedHours } = body

  if (!clientOrgId || !title?.trim()) {
    return NextResponse.json({ error: 'clientOrgId and title are required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Atomically assign the next request number via a subquery in the INSERT
  // to avoid race conditions between concurrent request creations.
  await drizzle.run(sql`
    INSERT INTO requests (
      id, org_id, title, type, category, description, status, priority,
      start_date, due_date, estimated_hours, submitted_by_id, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${id},
      ${clientOrgId},
      ${title.trim()},
      ${type ?? 'small_task'},
      ${category ?? 'development'},
      ${description ?? null},
      'submitted',
      ${priority ?? 'standard'},
      ${startDate ?? null},
      ${dueDate ?? null},
      ${estimatedHours ?? null},
      ${userId ?? null},
      ${body.isInternal ? 1 : 0},
      0,
      3,
      COALESCE((SELECT MAX(request_number) FROM requests), 0) + 1,
      ${now},
      ${now}
    )
  `)

  return NextResponse.json({ id }, { status: 201 })
}

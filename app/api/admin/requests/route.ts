import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne, inArray, isNull, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { requireAccessToOrg } from '@/lib/require-access'
import { dispatchDomainEvent } from '@/lib/events'
import { loadRequestParticipants } from '@/lib/request-participants'
import { CREATABLE_STATUSES, isCreatableStatus } from '@/lib/request-vocabulary'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

// ── GET /api/admin/requests ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status  = url.searchParams.get('status') ?? 'active'
  // `orgId` alias: the MCP list_requests tool sends orgId; the tasks list GET
  // also filters by orgId. Accept both so the org filter works everywhere.
  const clientId = url.searchParams.get('clientId') ?? url.searchParams.get('orgId')
  const page    = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  // Optional page size. Defaults to 50 as before; callers that resolve their
  // own views client-side (the requests rail, the MCP list_requests tool) can
  // ask for up to 500 in one go. `page` still walks whatever size was chosen.
  const askedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit   = Number.isFinite(askedLimit) ? Math.min(500, Math.max(1, askedLimit)) : 50
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
      // How many children hang off this request. Drives the list view's
      // expand chevron, so the table knows which rows open without having
      // to fetch every child up front. Correlated subquery rather than a
      // GROUP BY join so the row set and its ordering stay untouched.
      subRequestCount: sql<number>`(
        SELECT COUNT(*) FROM requests AS sub
        WHERE sub.parent_request_id = ${schema.requests.id}
      )`.as('sub_request_count'),
      // How many of those children are done. The kanban card's subtask bar
      // is "done of total", and without this half it read 0 of N forever.
      subRequestDoneCount: sql<number>`(
        SELECT COUNT(*) FROM requests AS sub
        WHERE sub.parent_request_id = ${schema.requests.id}
          AND sub.status = 'delivered'
      )`.as('sub_request_done_count'),
      // Join org name + tags (tags is a JSON array string of free-form labels)
      orgName: schema.organisations.name,
      // Drives the client avatar on the kanban card and the timeline label.
      orgLogoUrl: schema.organisations.logoUrl,
      orgTags: schema.organisations.tags,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.requests.updatedAt))
    .limit(limit)
    .offset(offset)

  // People row on the card. One extra query over the ids just returned.
  const participantsByRequest = await loadRequestParticipants(
    database as ReturnType<typeof import('drizzle-orm/d1').drizzle>,
    requests.map((r) => r.id),
  )

  return NextResponse.json({
    requests: requests.map((r) => ({
      ...r,
      participants: participantsByRequest.get(r.id) ?? [],
    })),
    page,
    limit,
  })
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
    status?: string
    isInternal?: boolean | number
    brandId?: string | null
    startDate?: string | null; dueDate?: string | null; estimatedHours?: number | null
  }
  const { clientOrgId, title, type, category, description, priority, startDate, dueDate, estimatedHours } = body

  if (!clientOrgId || !title?.trim()) {
    return NextResponse.json({ error: 'clientOrgId and title are required' }, { status: 400 })
  }

  // A request may be created straight into a column other than intake (the
  // kanban's quick-add drops one into whichever column it was typed in).
  // Only the open half of the vocabulary: nothing should be born delivered
  // or cancelled, and those two carry side effects this route does not run.
  const status = body.status ?? 'submitted'
  if (!isCreatableStatus(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${CREATABLE_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // The client org has to exist (a typo used to write an orphan row that
  // joins to a null org name and no client detail page can reach) and the
  // caller has to be allowed to file work against it. Without this a team
  // member scoped to one client could create work under any org id, and it
  // landed client-visible.
  const [targetOrg] = await drizzle
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, clientOrgId))
    .limit(1)
  if (!targetOrg) {
    return NextResponse.json({ error: 'Unknown client org' }, { status: 404 })
  }
  const denied = await requireAccessToOrg(drizzle, userId, clientOrgId)
  if (denied) return denied

  // Brand, when the client has brands. A contact linked to specific brands
  // only ever sees requests carrying one of their brand ids (the portal list
  // filters on it), so a request filed with the column left null never
  // reaches them. The brand has to belong to the client being filed against.
  let brandId: string | null = null
  if (body.brandId) {
    const [brand] = await drizzle
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(and(eq(schema.brands.id, body.brandId), eq(schema.brands.orgId, clientOrgId)))
      .limit(1)
    if (!brand) {
      return NextResponse.json({ error: 'brandId does not belong to this client' }, { status: 400 })
    }
    brandId = brand.id
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Atomically assign the next request number via a subquery in the INSERT
  // to avoid race conditions between concurrent request creations. The MAX is
  // scoped to this org, matching the portal create, so each client sees a
  // private 1, 2, 3 sequence and never learns the studio's total cross-client
  // request volume through the number on their own request.
  await drizzle.run(sql`
    INSERT INTO requests (
      id, org_id, brand_id, title, type, category, description, status, priority,
      start_date, due_date, estimated_hours, submitted_by_id, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${id},
      ${clientOrgId},
      ${brandId},
      ${title.trim()},
      ${type ?? 'small_task'},
      ${category ?? 'development'},
      ${description ? sanitizeRichText(description) : null},
      ${status},
      ${priority ?? 'standard'},
      ${startDate ?? null},
      ${dueDate ?? null},
      ${estimatedHours ?? null},
      ${userId ?? null},
      ${body.isInternal ? 1 : 0},
      0,
      3,
      COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ${clientOrgId}), 0) + 1,
      ${now},
      ${now}
    )
  `)

  // Fire the domain event (automations + outgoing webhooks). Non-blocking.
  await dispatchDomainEvent(drizzle, {
    type: 'request_created',
    entityId: id,
    entityType: 'request',
    orgId: clientOrgId,
    data: {
      title: title.trim(),
      type: type ?? 'small_task',
      category: category ?? 'development',
      priority: priority ?? 'standard',
      status,
      isInternal: body.isInternal ? 1 : 0,
      source: 'admin',
    },
  })

  return NextResponse.json({ id }, { status: 201 })
}

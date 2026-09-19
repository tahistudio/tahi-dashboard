import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne, inArray, isNull, isNotNull, lte, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { loadRequestParticipants } from '@/lib/request-participants'
import { openBlockerCounts } from '@/lib/blockers-server'
import { loadWaitingOn } from '@/lib/request-handoff'
import { createRequestRecord, validateRequestCreate, type RequestCreateInput } from '@/lib/request-writes'

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

  // `?waitingOn=client`: only requests currently handed to somebody at the
  // client (migration 0104). This is what the rail's "Waiting on clients"
  // saved view and the MCP's list_requests_waiting_on_clients both ask, and it
  // is a WHERE rather than a client-side filter because the answer is usually
  // a handful of rows out of hundreds.
  //
  // `?waitingOlderThanDays=N` narrows that to the ones that have gone quiet.
  // Compared against an ISO cutoff rather than SQLite date arithmetic because
  // waiting_since is a stored ISO string, which sorts and compares correctly
  // as text.
  if (url.searchParams.get('waitingOn') === 'client') {
    conditions.push(isNotNull(schema.requests.waitingOnContactId))
    const olderThan = Number.parseInt(url.searchParams.get('waitingOlderThanDays') ?? '', 10)
    if (Number.isFinite(olderThan) && olderThan > 0) {
      const cutoff = new Date(Date.now() - olderThan * 86_400_000).toISOString()
      conditions.push(lte(schema.requests.waitingSince, cutoff))
    }
  }

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

  // Open blockers, which can be a task or another request. Not a correlated
  // subquery like the two above it: the closed vocabulary differs per blocker
  // type, and neither list belongs in SQL. This is admin-only data and the
  // portal route has no equivalent, deliberately.
  const blockedByCounts = await openBlockerCounts(
    database as ReturnType<typeof import('drizzle-orm/d1').drizzle>,
    'request',
    requests.map((r) => r.id),
  )

  // Who each request is currently sitting with at the client, if anyone.
  // Its own query rather than six more columns on the select above: the
  // pointer ships behind migration 0104 and a bare select of a column that
  // does not exist yet would 500 the whole list. Here a missing column costs
  // the chip and nothing else (lib/request-handoff.ts).
  const waitingByRequest = await loadWaitingOn(
    database as ReturnType<typeof import('drizzle-orm/d1').drizzle>,
    requests.map((r) => r.id),
  )

  return NextResponse.json({
    requests: requests.map((r) => ({
      ...r,
      participants: participantsByRequest.get(r.id) ?? [],
      blockedByCount: blockedByCounts[r.id] ?? 0,
      waitingOn: waitingByRequest.get(r.id) ?? null,
    })),
    page,
    limit,
  })
}

// ── POST /api/admin/requests ────────────────────────────────────────────────
//
// Thin over lib/request-writes.ts#createRequestRecord, which is the one code
// path that files a request. Applying an approved call suggestion
// (lib/task-suggestions.ts) calls the same function with a system actor, so
// an automated create and a hand-typed one obey one set of rules rather than
// two that drift.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as RequestCreateInput

  // The shape checks that need no database run before one is opened: a probe
  // posting `status: 'delivered'` should cost nothing. createRequestRecord
  // runs them again, so this is a fast path, never the only gate.
  const invalid = validateRequestCreate(body)
  if (invalid) return NextResponse.json({ error: invalid.error }, { status: invalid.status })

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const result = await createRequestRecord(drizzle, body, {
    actorType: 'team_member',
    actorId: userId ?? null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.failure.error }, { status: result.failure.status })
  }

  return NextResponse.json({ id: result.request.id }, { status: 201 })
}

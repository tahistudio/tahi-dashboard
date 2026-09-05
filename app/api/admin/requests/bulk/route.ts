/**
 * /api/admin/requests/bulk
 *
 *   POST  -> create one request per client org (cross-client bulk create)
 *   PATCH -> apply the same status / assignee / archive change to many
 *            requests at once (the list's bulk action bar)
 *
 * Both halves are held to the same three guard rails the single-request
 * routes already had, which this route shipped without:
 *
 *   1. Team member access scoping. Every target org is resolved and checked
 *      against the caller's scope before anything is written, and a batch
 *      that reaches outside it is refused whole, naming what was refused,
 *      rather than half-applied. Super admins and all_clients rules resolve
 *      to an unrestricted scope inside the helper and are unaffected.
 *   2. Vocabulary. A bulk status is validated against the same list the
 *      single PATCH accepts, so a typo can no longer store a status no board
 *      column, filter or status config knows about.
 *   3. Effects. A bulk status change notifies the assignee and the client's
 *      contacts and fires request_status_changed, exactly as the single
 *      PATCH does, through the shared lib/request-status-effects helper. A
 *      bulk create fires request_created the same way. An archive is the one
 *      status the helper keeps from the client's bell (housekeeping, not a
 *      delivery event); the assignee and the automations still hear it.
 *
 * Both halves are also bounded: ids are resolved in chunks small enough to
 * bind in one D1 statement, and a batch larger than the biggest selection the
 * UI can make is refused rather than run row by row until the Worker gives up.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray, sql } from 'drizzle-orm'
import { getOrgScope } from '@/lib/require-access'
import { isPatchableStatus, PATCHABLE_STATUSES } from '@/lib/request-vocabulary'
import { emitRequestStatusChanged, emitRequestCreated } from '@/lib/request-status-effects'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * D1 caps bound parameters at 100 per statement, so an `IN (...)` over a
 * selection has to be sliced. Matches lib/delivery-aggregate's ID_CHUNK: the
 * repo already learned this the hard way there.
 */
const ID_CHUNK = 90

/**
 * The largest batch either half will accept. The requests rail fetches at most
 * 500 rows (`limit=500`) and the table's header checkbox selects that page, so
 * this is the biggest selection a person can actually make; anything larger is
 * a script. It matters because every row costs a sequential UPDATE plus a full
 * round of status effects (a contacts query, N notification inserts, an
 * automation pass and outgoing webhook fetches) inside one Worker invocation.
 */
const MAX_BATCH = 500

/** Slice a list into chunks small enough to bind in one D1 statement. */
function chunkIds<T>(ids: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK))
  return out
}

/** The row fields both the scope check and the status effects need. */
type BulkRow = { id: string; orgId: string; title: string; assigneeId: string | null
  isInternal: boolean | null
  /** requests.brand_id, so the client fan-out is narrowed the way the portal
   *  list is. Without it a brand-scoped contact hears about a row they would
   *  be refused if they clicked it. */
  brandId: string | null
}

/** Load the given requests in chunks D1 will accept. */
async function loadRequestRows(drizzle: Drizzle, ids: readonly string[]): Promise<BulkRow[]> {
  const rows: BulkRow[] = []
  for (const chunk of chunkIds(ids)) {
    const part = await drizzle
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        assigneeId: schema.requests.assigneeId,
        isInternal: schema.requests.isInternal,
        brandId: schema.requests.brandId,
      })
      .from(schema.requests)
      .where(inArray(schema.requests.id, chunk))
    rows.push(...part)
  }
  return rows
}

/** Org ids in `targets` the caller may not touch. Empty for an unrestricted
 *  scope; everything for a caller with no scope at all (deny by default). */
function outsideScope(scope: string[] | null, targets: string[]): string[] {
  if (scope === null) return []
  return targets.filter((orgId) => !scope.includes(orgId))
}

// ── POST /api/admin/requests/bulk ──────────────────────────────────────────
// Create one request per org.
// Body: { orgIds: string[], title, category?, type?, description?, isInternal? }
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as {
    orgIds?: string[]
    title?: string
    category?: string
    type?: string
    description?: string
    isInternal?: boolean
  } | null

  if (!body || !Array.isArray(body.orgIds) || body.orgIds.length === 0) {
    return NextResponse.json({ error: 'orgIds is required and must not be empty' }, { status: 400 })
  }
  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const orgIds = Array.from(new Set(body.orgIds.filter((id): id is string => !!id)))
  if (orgIds.length === 0) {
    return NextResponse.json({ error: 'orgIds is required and must not be empty' }, { status: 400 })
  }
  if (orgIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `orgIds must hold at most ${MAX_BATCH} ids` }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  // Access scoping over the whole batch, before anything is read or written.
  // Scope first, existence second: with the lookup first a scoped caller got
  // 404 for an org id that does not exist and 403 for one that does, which
  // made this an existence oracle over every client id in the workspace. Now
  // an id outside the caller's scope answers 403 either way, and the itemised
  // 404 only reaches callers who may already see every org.
  const scope = await getOrgScope(drizzle, userId)
  const forbidden = outsideScope(scope, orgIds)
  if (forbidden.length > 0) {
    return NextResponse.json({ error: 'Forbidden', orgIds: forbidden }, { status: 403 })
  }

  // Every target org has to exist. A typo used to write an orphan row that
  // joins to a null org name and no client detail page can reach. Chunked:
  // one IN over a 200-client batch blows D1's 100 bind variable ceiling and
  // fails the whole call with a 500.
  const knownIds = new Set<string>()
  for (const chunk of chunkIds(orgIds)) {
    const known = await drizzle
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(inArray(schema.organisations.id, chunk))
    for (const o of known) knownIds.add(o.id)
  }
  const unknown = orgIds.filter((id) => !knownIds.has(id))
  if (unknown.length > 0) {
    return NextResponse.json({ error: 'Unknown client org', orgIds: unknown }, { status: 404 })
  }

  const now = new Date().toISOString()
  const ids: string[] = []
  const title = body.title.trim()
  const type = body.type ?? 'small_task'
  const category = body.category ?? null

  for (const targetOrgId of orgIds) {
    const id = crypto.randomUUID()
    ids.push(id)

    // Raw INSERT so the request number comes from the same atomic, per-org
    // subquery the single create and the portal create use. Rows created here
    // used to carry no number at all and rendered with no '#'.
    await drizzle.run(sql`
      INSERT INTO requests (
        id, org_id, title, type, category, description, status, priority,
        submitted_by_id, submitted_by_type, is_internal,
        revision_count, max_revisions, request_number, created_at, updated_at
      ) VALUES (
        ${id},
        ${targetOrgId},
        ${title},
        ${type},
        ${category},
        ${body.description ?? null},
        'submitted',
        'standard',
        ${userId},
        'team_member',
        ${body.isInternal ? 1 : 0},
        0,
        3,
        COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ${targetOrgId}), 0) + 1,
        ${now},
        ${now}
      )
    `)

    // Same domain event the single create fires, per row. Without it a
    // cross-client bulk create triggered no automation rule and no outgoing
    // webhook, while the same rows filed one at a time triggered both.
    await emitRequestCreated(drizzle, {
      id,
      orgId: targetOrgId,
      title,
      type,
      category: category ?? 'development',
      priority: 'standard',
      status: 'submitted',
      isInternal: !!body.isInternal,
      source: 'admin_bulk',
    })
  }

  return NextResponse.json({ created: ids.length, ids }, { status: 201 })
}

// ── PATCH /api/admin/requests/bulk ─────────────────────────────────────────
// Bulk update requests. Apply the same changes to multiple request IDs.
// Body: { ids: string[], status?, assigneeId?, archived? }
export async function PATCH(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null) as {
    ids?: string[]
    status?: string
    assigneeId?: string | null
    archived?: boolean
  } | null

  if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids is required and must not be empty' }, { status: 400 })
  }

  // The status vocabulary, checked before any row is read. Same list the
  // single PATCH accepts, so the two paths cannot disagree.
  if (body.status !== undefined && !isPatchableStatus(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${PATCHABLE_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const ids = Array.from(new Set(body.ids.filter((id): id is string => !!id)))
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids is required and must not be empty' }, { status: 400 })
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json({ error: `ids must hold at most ${MAX_BATCH} ids` }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  // Resolve the batch to its rows, chunked: D1 binds at most 100 parameters
  // per statement, and the rail's "select all" over a 500-row page hands this
  // far more than that. One IN over the lot threw before a single update ran
  // and failed the whole action with a 500.
  const rows = await loadRequestRows(drizzle, ids)

  // Access scoping over the whole batch. A batch that reaches outside the
  // caller's scope is refused whole, naming the ids, rather than partly
  // applied: a bulk archive that half-lands is worse than one that fails.
  const scope = await getOrgScope(drizzle, userId)
  const forbiddenOrgs = new Set(outsideScope(scope, rows.map((r) => r.orgId)))
  const forbiddenIds = rows.filter((r) => forbiddenOrgs.has(r.orgId)).map((r) => r.id)
  if (forbiddenIds.length > 0) {
    return NextResponse.json({ error: 'Forbidden', ids: forbiddenIds }, { status: 403 })
  }

  const foundIds = new Set(rows.map((r) => r.id))
  const notFound = ids.filter((id) => !foundIds.has(id))

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.status) {
    updates.status = body.status
    if (body.status === 'delivered') {
      updates.deliveredAt = now
    }
  }
  if (body.assigneeId !== undefined) {
    updates.assigneeId = body.assigneeId
  }
  if (body.archived === true) {
    updates.status = 'archived'
  }

  for (const row of rows) {
    await drizzle
      .update(schema.requests)
      .set(updates)
      .where(eq(schema.requests.id, row.id))
  }

  // Same notifications and domain event the single PATCH fires, once per row
  // that actually moved. Without this a bulk "Mark delivered" left every one
  // of those clients unnotified and fired no automation.
  //
  // Re-read after the write, exactly as the single PATCH does. Feeding the
  // pre-update rows in would notify the outgoing assignee on a body carrying
  // both status and assigneeId, and never the incoming one: precisely the
  // drift the shared helper exists to prevent.
  //
  // Bell entries per row, email suppressed. This loop runs once per selected
  // request, so a twenty row "Mark delivered" for a client with three contacts
  // is sixty separate messages to the same three people, sequentially, and
  // Resend's two a second ceiling refuses most of them. The bell rows are
  // cheap, carry their own title and deep link, and stay.
  const nextStatus = typeof updates.status === 'string' ? updates.status : null
  if (nextStatus) {
    const touched = await loadRequestRows(drizzle, rows.map((r) => r.id))
    for (const row of touched) {
      await emitRequestStatusChanged(drizzle, {
        id: row.id,
        title: row.title,
        orgId: row.orgId,
        assigneeId: row.assigneeId ?? null,
        isInternal: row.isInternal === true,
        brandId: row.brandId ?? null,
      }, nextStatus, { clientEmail: false })
    }
  }

  // The count of rows actually touched, not the count asked for: the bulk bar
  // reports "N failed" off the difference.
  return NextResponse.json({ updated: rows.length, notFound })
}

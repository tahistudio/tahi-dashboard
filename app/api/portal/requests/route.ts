import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, asc, and, ne, sql, inArray, notInArray } from 'drizzle-orm'
import { getPlanLabel, resolveTracksConfig } from '@/lib/plan-utils'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'
import { dispatchDomainEvent } from '@/lib/events'
import { notifyAllAdmins } from '@/lib/notifications'
import { studioNewRequestEmailPlan } from '@/lib/notification-email'
import { loadRequestParticipants, CLIENT_VISIBLE_TEAM_ROLES } from '@/lib/request-participants'
import {
  isRequestCategory,
  isRequestType,
  REQUEST_CATEGORIES,
  REQUEST_TYPES,
} from '@/lib/request-vocabulary'

// ── GET /api/portal/requests ─────────────────────────────────────────────────
// Returns requests scoped to the client's own org.
export async function GET(req: NextRequest) {
  const { orgId, userId, clerkOrgId } = await getPortalAuth(req)

  // Deny if not authenticated or if this is the Tahi admin org (admins use /api/admin/requests)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'active'
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  // Optional page size, matching the admin route: default 50, up to 500 for
  // callers that filter client-side.
  const askedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit  = Number.isFinite(askedLimit) ? Math.min(500, Math.max(1, askedLimit)) : 50
  const offset = (page - 1) * limit

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Brand portal scoping (T352): if the contact is linked to specific brands,
  // only show requests for those brands
  const [contact] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.clerkUserId, userId))
    .limit(1)

  let brandIds: string[] | null = null
  if (contact) {
    const brandLinks = await drizzle
      .select({ brandId: schema.brandContacts.brandId })
      .from(schema.brandContacts)
      .where(eq(schema.brandContacts.contactId, contact.id))

    if (brandLinks.length > 0) {
      brandIds = brandLinks.map(b => b.brandId)
    }
  }

  const conditions = [eq(schema.requests.orgId, orgId)]

  // If contact is linked to brands, scope requests to those brands
  if (brandIds !== null) {
    conditions.push(inArray(schema.requests.brandId, brandIds))
  }
  if (status === 'active') {
    conditions.push(ne(schema.requests.status, 'archived'))
  } else if (status !== 'all') {
    conditions.push(eq(schema.requests.status, status))
  }
  // Clients never see internal-only requests
  conditions.push(eq(schema.requests.isInternal, false))

  const requests = await drizzle
    .select({
      id: schema.requests.id,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      status: schema.requests.status,
      priority: schema.requests.priority,
      estimatedHours: schema.requests.estimatedHours,
      startDate: schema.requests.startDate,
      dueDate: schema.requests.dueDate,
      revisionCount: schema.requests.revisionCount,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
      deliveredAt: schema.requests.deliveredAt,
      requestNumber: schema.requests.requestNumber,
      // Client-visible child count, driving the list view's expand chevron.
      // Internal-only children are excluded so the count can never hint at
      // work the client is not allowed to see, matching the is_internal
      // filter this route already applies to the rows themselves.
      subRequestCount: sql<number>`(
        SELECT COUNT(*) FROM requests AS sub
        WHERE sub.parent_request_id = ${schema.requests.id}
          AND sub.is_internal = 0
      )`.as('sub_request_count'),
      // The done half of the card's subtask bar, held to the same
      // client-visible children the count above is.
      subRequestDoneCount: sql<number>`(
        SELECT COUNT(*) FROM requests AS sub
        WHERE sub.parent_request_id = ${schema.requests.id}
          AND sub.is_internal = 0
          AND sub.status = 'delivered'
      )`.as('sub_request_done_count'),
    })
    .from(schema.requests)
    .where(and(...conditions))
    .orderBy(desc(schema.requests.updatedAt))
    .limit(limit)
    .offset(offset)

  // People row on the card. Team members appear only as project manager or
  // assignee, so an internal follower never leaks into the portal, and
  // contacts are held to the caller's own org.
  const participantsByRequest = await loadRequestParticipants(
    drizzle,
    requests.map((r) => r.id),
    { teamRoles: CLIENT_VISIBLE_TEAM_ROLES, contactOrgId: orgId },
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

// ── Queue placement ──────────────────────────────────────────────────────────
//
// Clients never set priority. They say where the new request sits against the
// work already moving, and this route maps that onto the two columns the queue
// actually reads:
//
//   placement   priority    queue position
//   ---------   ---------   ----------------------------------------------
//   queue       standard    appended after everything already open
//   top         high        moved to the front (0), everything else bumped
//   replace     high        moved to the front (0), everything else bumped
//
// 'replace' does NOT pause the in-flight build or move a track: swapping what
// the studio is building is a studio decision, not a client one. It records the
// ask (high priority, front of the queue, `placement` on the domain event) and
// the confirmation screen tells the client the swap will be confirmed. Statuses
// that are finished or gone never take part in the ordering.
const PLACEMENTS = ['queue', 'top', 'replace'] as const
type Placement = (typeof PLACEMENTS)[number]

/** Statuses that no longer hold a place in the queue. */
const CLOSED_STATUSES = ['delivered', 'archived', 'cancelled']

function parsePlacement(value: unknown): Placement | null {
  return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value)
    ? value as Placement
    : null
}

/** The per-client tracks override columns, which land with migration 0079. */
type TracksOverrideRow = {
  tracksMode: string | null
  customSmallTracks: number | null
  customLargeTracks: number | null
}

/**
 * May this client file a multi-day (large_task) request?
 *
 * The size is not cosmetic: /api/portal/capacity reads `type` straight off the
 * row to decide which lane the request occupies, so a client on a plan with no
 * large track could post {"type":"large_task"} and take a capacity slot their
 * plan does not carry. The dialog's size control gates the large option, but
 * only in the browser.
 *
 * The explicit answers to the two cases the plan model leaves open:
 *
 *   no active subscription  -> allowed. A project client has no track model at
 *     all (resolveTracksConfig would report zero of both), so the size is only
 *     a hint on the card and refusing it would block their only large option.
 *   tracks_mode = 'off'     -> allowed. One unified board, no per-track split,
 *     nothing to overdraw.
 *
 * Everything else is the resolved config: auto follows the plan entitlements
 * (maintain has no large track, scale does), custom follows the explicit
 * per-client counts. This is the same rule the admin dialog applies when it
 * disables Multi-day for a maintain client.
 */
function largeTaskAllowed(
  sub: { planType: string | null; hasPrioritySupport: boolean | null } | undefined,
  org: TracksOverrideRow | undefined,
): boolean {
  if (!sub) return true
  const config = resolveTracksConfig(org, sub.planType, !!sub.hasPrioritySupport)
  if (config.mode === 'off') return true
  return config.largeTracks > 0
}

/**
 * The one brand this submitter can be filing under, or null when it is not
 * knowable.
 *
 * Read at most two links because the answer is only ever "exactly one" or
 * "cannot tell", and never throws: a brand lookup failure must cost the brand,
 * not the request.
 */
async function resolveSubmitterBrandId(
  drizzle: ReturnType<typeof import('drizzle-orm/d1').drizzle>,
  userId: string,
): Promise<string | null> {
  try {
    const [contact] = await drizzle
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.clerkUserId, userId))
      .limit(1)
    if (!contact?.id) return null

    const links = await drizzle
      .select({ brandId: schema.brandContacts.brandId })
      .from(schema.brandContacts)
      .where(eq(schema.brandContacts.contactId, contact.id))
      .limit(2)
    return links.length === 1 ? links[0].brandId ?? null : null
  } catch {
    return null
  }
}

// ── POST /api/portal/requests ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // getPortalAuth resolves the caller's Clerk org -> the D1 organisations.id, so
  // the row is written under the correct tenant id (getRequestAuth would store
  // the raw Clerk org id, which mismatches every clerkOrgId-provisioned client).
  const { orgId, userId, impersonating, clerkOrgId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const body = await req.json() as {
    title?: string; type?: string; category?: string; description?: string
    dueDate?: string | null; formResponses?: string; placement?: string
  }
  const { title, type, category, description, dueDate, formResponses } = body
  const placement = parsePlacement(body.placement)

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Request title is required' }, { status: 400 })
  }

  // Size and category are whitelisted here, not just in the dialog. The
  // category tiles are a fixed set, so anything else arriving on this route is
  // a probe or a stale client. Size gets a second, harder check further down
  // (largeTaskAllowed): the vocabulary says 'large_task' is a real size, and
  // the plan says whether this client may occupy a large capacity lane with
  // one. Both halves are needed; the whitelist alone accepts exactly the
  // payload that overdraws the client's own capacity view.
  if (type !== undefined && !isRequestType(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${REQUEST_TYPES.join(', ')}` },
      { status: 400 },
    )
  }
  if (category !== undefined && category !== null && !isRequestCategory(category)) {
    return NextResponse.json(
      { error: `category must be one of: ${REQUEST_CATEGORIES.join(', ')}` },
      { status: 400 },
    )
  }

  // form_responses is read back as JSON by the detail page, so a value that
  // cannot be parsed would land in a column nothing can render.
  if (formResponses !== undefined && formResponses !== null) {
    try {
      JSON.parse(formResponses)
    } catch {
      return NextResponse.json({ error: 'formResponses must be valid JSON' }, { status: 400 })
    }
  }

  // Client-submitted rich text is rendered to Tahi admins via
  // dangerouslySetInnerHTML, so sanitise it server-side at this untrusted
  // boundary (allowlist; strips scripts / event handlers / unsafe hrefs).
  const safeDescription = description ? sanitizeRichText(description) : null

  const database2 = await db()
  const drizzle2 = database2 as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Entitlement, not just vocabulary: 'large_task' is a legal size, but only
  // for a client whose plan carries a multi-day track. Resolved server-side
  // because the size gate was browser-only, and the row it writes decides how
  // much of the client's own capacity the request occupies.
  if (type === 'large_task') {
    const [sub] = await drizzle2
      .select({
        planType: schema.subscriptions.planType,
        hasPrioritySupport: schema.subscriptions.hasPrioritySupport,
      })
      .from(schema.subscriptions)
      .where(and(
        eq(schema.subscriptions.orgId, orgId),
        eq(schema.subscriptions.status, 'active'),
      ))
      .limit(1)

    // The per-client override columns land with migration 0079; wrapped so
    // this endpoint keeps working between deploy and migration, exactly as
    // /api/portal/capacity does.
    let override: TracksOverrideRow | undefined
    try {
      ;[override] = await drizzle2
        .select({
          tracksMode: schema.organisations.tracksMode,
          customSmallTracks: schema.organisations.customSmallTracks,
          customLargeTracks: schema.organisations.customLargeTracks,
        })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, orgId))
        .limit(1)
    } catch {
      override = undefined
    }

    if (!largeTaskAllowed(sub, override)) {
      return NextResponse.json(
        { error: 'Your plan does not include a multi-day track. Please submit this as a smaller request or talk to us about your plan.' },
        { status: 400 },
      )
    }
  }

  // Which brand the client is filing under.
  //
  // The portal list is brand scoped: a contact linked to brands only sees
  // requests whose brand is one of theirs. A request filed with no brand was
  // therefore invisible to the person who filed it, and (now that the client
  // email audience matches the portal exactly) so were the replies on it.
  //
  // One linked brand is unambiguous and is written. Nothing, or more than one,
  // needs the client to say which, and the dialog does not ask yet: those stay
  // null, which is the org-wide row every contact can see.
  const brandId = await resolveSubmitterBrandId(drizzle2, userId)

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Resolve the placement into a priority and a queue position before the
  // insert. Without a placement nothing changes: standard priority at the
  // column default, exactly as this route behaved before.
  let priority = 'standard'
  let queueOrder = 0
  if (placement) {
    priority = placement === 'queue' ? 'standard' : 'high'

    if (placement === 'queue') {
      const openRows = await drizzle2
        .select({ queueOrder: schema.requests.queueOrder })
        .from(schema.requests)
        .where(and(
          eq(schema.requests.orgId, orgId),
          eq(schema.requests.isInternal, false),
          notInArray(schema.requests.status, CLOSED_STATUSES),
        ))
      const highest = openRows.reduce((max, r) => Math.max(max, r.queueOrder ?? 0), -1)
      queueOrder = highest + 1
    } else {
      // Front of the queue. Bumping every other open row (rather than picking
      // a smaller number) keeps the ordering correct even where an older row
      // carries a null queue_order, which sorts first in SQLite. updated_at is
      // deliberately left alone: queue order is not a change to the work.
      await drizzle2.run(sql`
        UPDATE requests
        SET queue_order = COALESCE(queue_order, 0) + 1
        WHERE org_id = ${orgId}
          AND is_internal = 0
          AND status NOT IN ('delivered', 'archived', 'cancelled')
      `)
      queueOrder = 0
    }
  }

  // Atomically assign the next request number via a subquery in the INSERT
  // to avoid race conditions between concurrent request creations. The MAX is
  // scoped to this org so each client sees a private 1,2,3 sequence and never
  // learns the studio's total cross-client request volume (T-privacy).
  await drizzle2.run(sql`
    INSERT INTO requests (
      id, org_id, brand_id, title, type, category, description, due_date, form_responses,
      status, priority, queue_order, submitted_by_id, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${id},
      ${orgId},
      ${brandId},
      ${title.trim()},
      ${type ?? 'small_task'},
      ${category ?? 'development'},
      ${safeDescription},
      ${dueDate ?? null},
      ${formResponses ?? null},
      'submitted',
      ${priority},
      ${queueOrder},
      ${userId},
      0,
      0,
      3,
      COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ${orgId}), 0) + 1,
      ${now},
      ${now}
    )
  `)

  // Fire the domain event (automations + outgoing webhooks). Non-blocking.
  await dispatchDomainEvent(drizzle2, {
    type: 'request_created',
    entityId: id,
    entityType: 'request',
    orgId,
    data: {
      title: title.trim(),
      type: type ?? 'small_task',
      category: category ?? 'development',
      status: 'submitted',
      isInternal: 0,
      source: 'portal',
      // The client's own words about urgency, so an automation or a Slack
      // ping can say "they asked us to replace what is in progress".
      placement: placement ?? 'queue',
    },
  })

  // Tell the studio. A request emailed in already woke somebody up (the email
  // intake webhook calls notifyAllAdmins); one filed in the product we are
  // asking clients to move to notified nobody, and the only signal was a badge
  // on a board someone had to open. The number is the client's own per-org
  // sequence, so the client name goes with it or "REQ-3" means nothing.
  const [row] = await drizzle2
    .select({ requestNumber: schema.requests.requestNumber })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  const requestNumber = row?.requestNumber ?? null

  const [org] = await drizzle2
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)
  const clientName = org?.name ?? 'a client'

  const [submitter] = await drizzle2
    .select({ name: schema.contacts.name })
    .from(schema.contacts)
    .where(eq(schema.contacts.clerkUserId, userId))
    .limit(1)

  const cleanTitle = title.trim()
  await notifyAllAdmins(drizzle2, {
    type: 'request_created',
    title: requestNumber
      ? `New request REQ-${requestNumber}: ${cleanTitle}`
      : `New request: ${cleanTitle}`,
    body: submitter?.name ? `From ${clientName}, ${submitter.name}` : `From ${clientName}`,
    entityType: 'request',
    entityId: id,
    email: studioNewRequestEmailPlan({
      requestId: id,
      requestTitle: cleanTitle,
      requestNumber,
      clientName,
      category: category ?? 'development',
      priority,
      submittedBy: submitter?.name ?? null,
    }),
  })

  if (!placement) {
    return NextResponse.json({ id }, { status: 201 })
  }

  // With a placement the caller is the confirmation screen, which also needs
  // where the request landed in the queue and whether this client is on a
  // retainer at all.

  // Position among the requests still waiting to be picked up, in the order
  // the capacity view reads them. A null queue_order sorts as zero so an older
  // row cannot claim a place it does not hold.
  const waiting = await drizzle2
    .select({ id: schema.requests.id })
    .from(schema.requests)
    .where(and(
      eq(schema.requests.orgId, orgId),
      eq(schema.requests.isInternal, false),
      eq(schema.requests.status, 'submitted'),
    ))
    .orderBy(asc(sql`COALESCE(queue_order, 0)`), asc(schema.requests.createdAt))
  const index = waiting.findIndex(r => r.id === id)

  const [sub] = await drizzle2
    .select({ planType: schema.subscriptions.planType })
    .from(schema.subscriptions)
    .where(and(
      eq(schema.subscriptions.orgId, orgId),
      eq(schema.subscriptions.status, 'active'),
    ))
    .limit(1)

  return NextResponse.json({
    id,
    requestNumber,
    placement,
    queuePosition: index >= 0 ? index + 1 : null,
    planLabel: sub ? getPlanLabel(sub.planType) : null,
    retainer: !!sub,
  }, { status: 201 })
}

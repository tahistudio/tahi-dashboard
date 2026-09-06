import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { contactIdentityWhere } from '@/lib/portal-identity'
import {
  actingByline,
  actingIdentity,
  recordActingWrite,
  refusePreviewWrite,
} from '@/lib/acting-as'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
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
  const { orgId, userId, clerkOrgId, contactId: previewContactId } = await getPortalAuth(req)

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
  // only show requests for those brands.
  //
  // Held to the caller's org as well as their login: one person can be a
  // contact at two client orgs on the same Clerk account, and an unscoped
  // lookup would pick whichever row came back first and scope this org's list
  // by the other org's brands (CLAUDE.md rule 12).
  //
  // In Client view the login is the operator's, which matches nobody here, so
  // the preview saw every brand's requests where the person being previewed
  // sees only their own. `contactIdentityWhere` stands the read in that seat
  // (lib/portal-identity.ts).
  const [contact] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(contactIdentityWhere(orgId, userId, previewContactId))
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

  // If contact is linked to brands, scope requests to those brands.
  //
  // `IN` never matches NULL, so a request with no brand is invisible to a
  // contact who has links. That is deliberate and it is the same rule the
  // client notification audience applies (contactsForBrand in
  // lib/notifications.ts drops a linked contact when the row carries no
  // brand), so the list and the inbox cannot disagree about who a request
  // belongs to. The POST below therefore never files a brand-linked
  // submitter's request without a brand.
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

/** How many brand links are read for one submitter. Far past any real client. */
const BRAND_LINK_LIMIT = 50

/** The person filing, as this route needs them: for the brand, and for the
 *  studio notification body. */
interface Submitter {
  id: string
  name: string | null
}

/**
 * The submitter's contact row at the org the request is being filed under.
 *
 * Scoped to the org, not just the login: one person can hold a contacts row at
 * two client orgs on the same Clerk account, and an unscoped `.limit(1)` picks
 * whichever comes back first. That value is written to the row here (it decides
 * requests.brand_id), so an unscoped read would stamp the other org's brand on
 * this org's request (CLAUDE.md rule 12).
 *
 * Never throws: a contact lookup that fails costs the brand and the name in
 * the studio's notification body, not the client's request.
 */
async function loadSubmitter(
  drizzle: ReturnType<typeof import('drizzle-orm/d1').drizzle>,
  userId: string,
  orgId: string,
): Promise<Submitter | null> {
  try {
    const [contact] = await drizzle
      .select({ id: schema.contacts.id, name: schema.contacts.name })
      .from(schema.contacts)
      .where(and(
        eq(schema.contacts.clerkUserId, userId),
        eq(schema.contacts.orgId, orgId),
      ))
      .limit(1)
    return contact?.id ? { id: contact.id, name: contact.name ?? null } : null
  } catch {
    return null
  }
}

/**
 * Which brand this request is filed under.
 *
 * A brand-linked contact only ever sees requests whose brand is one of theirs
 * (the GET above), and the client notification audience applies the same rule,
 * so filing without a brand hides the request from the person who filed it and
 * takes their reply and delivery emails with it. A submitter who holds any
 * link therefore always gets one written.
 *
 * `asked` is the dialog's answer once it grows a picker, and is honoured only
 * when it is one of this submitter's own links: an arbitrary id on the body
 * must never stamp another client's brand onto this row. Otherwise the first
 * link wins, ordered so the same person filing twice lands on the same brand.
 *
 * Null means the submitter holds no links at all, which is the org-wide row:
 * visible to every contact at the org who is likewise unlinked, and invisible
 * to brand-scoped ones, in the list and in the inbox alike.
 *
 * Never throws: a brand lookup failure costs the brand, not the request.
 */
async function resolveSubmitterBrandId(
  drizzle: ReturnType<typeof import('drizzle-orm/d1').drizzle>,
  contactId: string,
  asked: string | null,
): Promise<string | null> {
  try {
    const links = await drizzle
      .select({ brandId: schema.brandContacts.brandId })
      .from(schema.brandContacts)
      .where(eq(schema.brandContacts.contactId, contactId))
      .orderBy(asc(schema.brandContacts.createdAt), asc(schema.brandContacts.brandId))
      .limit(BRAND_LINK_LIMIT)
    const ids = links.map((l) => l.brandId).filter((b): b is string => !!b)
    if (ids.length === 0) return null
    if (asked && ids.includes(asked)) return asked
    return ids[0]
  } catch {
    return null
  }
}

/**
 * The brand for a request the STUDIO files while acting as a client.
 *
 * resolveSubmitterBrandId above starts from the submitting contact's own brand
 * links, which an acting studio member does not have. Scope to the org instead,
 * and only honour a brand that is actually theirs: an unvalidated id from the
 * body would file a request under another tenant's brand.
 */
async function resolveOrgBrandId(
  drizzle: ReturnType<typeof import('drizzle-orm/d1').drizzle>,
  orgId: string,
  asked: string | null,
): Promise<string | null> {
  if (!asked) return null
  try {
    const [brand] = await drizzle
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(and(eq(schema.brands.id, asked), eq(schema.brands.orgId, orgId)))
      .limit(1)
    return brand?.id ?? null
  } catch {
    return null
  }
}

// ── POST /api/portal/requests ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // getPortalAuth resolves the caller's Clerk org -> the D1 organisations.id, so
  // the row is written under the correct tenant id (getRequestAuth would store
  // the raw Clerk org id, which mismatches every clerkOrgId-provisioned client).
  const auth = await getPortalAuth(req)
  const { orgId, userId, clerkOrgId } = auth

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
  if (featureDenied) return featureDenied
  // OPEN in act mode. Filing a request for a client on the phone with them is
  // the whole point of the mode, and the row it writes says the studio filed
  // it. Read-only Client view still gets the same 403 it always did.
  const previewDenied = refusePreviewWrite(auth, { allowActing: true })
  if (previewDenied) return previewDenied
  const acting = actingIdentity(auth)

  const body = await req.json() as {
    title?: string; type?: string; category?: string; description?: string
    dueDate?: string | null; formResponses?: string; placement?: string
    brandId?: string | null
  }
  const { title, type, category, description, dueDate, formResponses } = body
  const placement = parsePlacement(body.placement)
  // Only ever a hint: validated against the submitter's own links below, so an
  // id from anywhere else is ignored rather than trusted.
  const askedBrandId = typeof body.brandId === 'string' && body.brandId.trim()
    ? body.brandId.trim()
    : null

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

  // Who is filing, and which brand it belongs to. One read of the contacts row
  // serves both: the brand before the insert, the name in the studio's
  // notification body after it.
  // Acting for the client, the studio person has no contacts row at this org,
  // so there is no seat to read a brand off. Take the asked-for brand only if
  // it belongs to this org, and file without one otherwise: a request with no
  // brand is honest, a request under someone else's brand is not.
  const submitter = acting ? null : await loadSubmitter(drizzle2, userId, orgId)
  const brandId = acting
    ? await resolveOrgBrandId(drizzle2, orgId, askedBrandId)
    : submitter
      ? await resolveSubmitterBrandId(drizzle2, submitter.id, askedBrandId)
      : null

  // Who the row says filed it. A client files as themselves; the studio acting
  // for them files as the studio member, which is what db/schema.ts has always
  // meant by submitted_by_type 'team_member'. The non-acting branch also fixes
  // a pre-existing lie: this route wrote the raw Clerk user id and left the
  // type at its 'contact' default, so the column misdescribed the id it held
  // for every real client submission.
  const submittedById = acting ? acting.adminTeamMemberId : (submitter?.id ?? userId)
  const submittedByType = acting ? 'team_member' : 'contact'

  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Resolve the placement into a priority and a queue position before the
  // insert. Without a placement nothing changes: standard priority at the
  // column default, exactly as this route behaved before.
  //
  // Priority is settled here, ahead of the block that can touch other rows, so
  // the acting record below has everything it needs and nothing in the
  // client's workspace has moved yet when it is written.
  const priority = placement && placement !== 'queue' ? 'high' : 'standard'

  // The record FIRST, against the id the INSERT below is about to use, and
  // ahead of everything that can touch the client's workspace: the front-of-
  // queue branch below renumbers their other open requests, so this sits above
  // that too. Awaited and allowed to throw. Recorded afterwards, as it was, a
  // failed record returned a 500 on a request that HAD been created, which
  // invited a retry and a duplicate under the client's name.
  //
  // The per-org request number is deliberately absent from this row: the
  // INSERT assigns it atomically in a subquery, so it does not exist yet. The
  // entity id and title are the durable handles, and the number is one join
  // away in `requests`. No-op for an ordinary client submission.
  await recordActingWrite(drizzle2 as unknown as DB, acting, {
    verb: 'request.created',
    entityType: 'request',
    entityId: id,
    route: 'POST /api/portal/requests',
    extra: {
      title: title.trim(),
      category: category ?? 'development',
      priority,
      placement: placement ?? 'queue',
    },
  })

  let queueOrder = 0
  if (placement) {
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
      status, priority, queue_order, submitted_by_id, submitted_by_type, is_internal,
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
      ${submittedById},
      ${submittedByType},
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

  const cleanTitle = title.trim()

  await notifyAllAdmins(drizzle2, {
    type: 'request_created',
    title: requestNumber
      ? `New request REQ-${requestNumber}: ${cleanTitle}`
      : `New request: ${cleanTitle}`,
    // Never let the bell claim the client typed this. The byline is empty on
    // the ordinary client path, so that half of the string is unchanged.
    body: (submitter?.name ? `From ${clientName}, ${submitter.name}` : `From ${clientName}`)
      + actingByline(acting, 'filed'),
    entityType: 'request',
    entityId: id,
    email: studioNewRequestEmailPlan({
      requestId: id,
      requestTitle: cleanTitle,
      requestNumber,
      clientName,
      category: category ?? 'development',
      priority,
      submittedBy: acting ? `${acting.adminName} at Tahi Studio` : (submitter?.name ?? null),
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

/**
 * lib/request-writes.ts
 *
 * The one code path that creates a request, the one that updates it, and the
 * one that hands it to a client.
 *
 * The request twin of lib/task-writes.ts, and it exists for the same reason.
 * All three bodies used to live inline in their route handlers (POST
 * /api/admin/requests, PATCH /api/admin/requests/[id] and POST
 * /api/admin/requests/[id]/handoff), which meant the only way for anything
 * other than a browser to write a request exactly the way the dashboard does
 * was to call the HTTP route from inside the worker. Applying an approved
 * call suggestion (lib/task-suggestions.ts, CN.1b) needs those same rules
 * with no request, no session and no NextResponse, so the rules moved here
 * and the routes became thin.
 *
 * WHY THIS MATTERS MORE FOR REQUESTS THAN FOR TASKS. A request is the
 * client-facing surface: its number is per client, its status change fans out
 * to the client's inbox, and a hand-off mails a named person and may mint
 * them a seat. A second implementation of any of that, written so a
 * suggestion could be applied, would be a second set of rules about what a
 * client is told. There is one.
 *
 * What the routes keep: reading the body, `isTahiAdmin`, and for the hand-off
 * the JSON parse. What moved: the validation, the client access check, the
 * org and brand lookups, the insert or update, the notifications and the
 * domain events.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router routes
 * may only export HTTP methods and config.
 */

import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import type { NextResponse } from 'next/server'
import { schema, type DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { createNotification, notifyTeamMember, requestParticipantTitle } from '@/lib/notifications'
import { notificationEmailUrl, waitingOnYouEmailPlan } from '@/lib/notification-email'
import { ensureClientInvite } from '@/lib/onboarding-invites'
import { requireAccessToOrg } from '@/lib/require-access'
import { emitRequestCreated, emitRequestStatusChanged } from '@/lib/request-status-effects'
import {
  AUDIT_HANDED_OFF,
  HANDOFF_ACTION_VERB,
  HANDOFF_REASONS,
  HANDOFF_REASON_SENTENCE,
  buildWaitingOn,
  handoffParticipantRole,
  isHandoffReason,
  type HandoffReason,
  type WaitingOnPayload,
} from '@/lib/request-handoff'
import {
  CREATABLE_STATUSES,
  isCreatableStatus,
  isPatchableStatus,
  isRequestPriority,
} from '@/lib/request-vocabulary'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Who is writing.
 *
 * 'team_member' is a signed-in human: `actorId` is their Clerk user id, and
 * the client access rule (Rule 11) is applied against it.
 *
 * 'system' is an automation applying something a human already approved
 * elsewhere: the approval surface did the scoping, there is no session to
 * scope against here. `actorId` still carries whoever approved it, so the
 * trail and the "handed on by" line can name them without claiming they
 * typed it.
 *
 * The same two values, with the same meanings, as TaskWriteActor.
 */
export interface RequestWriteActor {
  actorType: 'team_member' | 'system'
  actorId: string | null
}

/** The body POST /api/admin/requests reads, field for field. */
export interface RequestCreateInput {
  clientOrgId?: string
  title?: string
  type?: string
  category?: string
  description?: string | null
  priority?: string
  status?: string
  isInternal?: boolean | number
  brandId?: string | null
  startDate?: string | null
  dueDate?: string | null
  estimatedHours?: number | null
  /** Mirrors PATCH's assigneeId (CN.2 contract section 5): a call
   *  suggestion resolved to exactly one team member can hand the request
   *  its owner at the moment it is created, the same column the PATCH
   *  route writes later. Absent or null leaves the request unassigned. */
  assigneeId?: string | null
}

/**
 * The body PATCH /api/admin/requests/[id] reads.
 *
 * Presence matters, not just the value: `assigneeId`, `estimatedHours`,
 * `startDate`, `dueDate`, `trackId` and `scheduleRowId` are read with `in`
 * so an explicit null clears the column and an absent key leaves it alone.
 * A caller building this object by hand must therefore omit a key it does
 * not mean to write rather than setting it to undefined.
 */
export interface RequestPatchInput {
  status?: string
  priority?: string
  category?: string
  assigneeId?: string | null
  estimatedHours?: number | null
  startDate?: string | null
  dueDate?: string | null
  scopeFlagged?: boolean
  isInternal?: boolean
  trackId?: string | null
  checklists?: string
  scheduleRowId?: string | null
}

/**
 * The request as it stands after the write.
 *
 * `requestNumber` is null on a create, deliberately: the number is assigned
 * inside the INSERT by a per-client MAX subquery (which is what makes two
 * concurrent creates safe), and reading it back would cost a second query on
 * every create for a value no caller has ever needed. On an update it is the
 * number the row already had.
 */
export interface RequestRecord {
  id: string
  orgId: string
  title: string
  status: string
  requestNumber: number | null
}

/**
 * A refusal, as a status and a message rather than as a Response, so this
 * module can be called from an apply function that has no request to answer.
 * The routes turn it back into the exact JSON they always sent.
 */
export interface RequestWriteFailure {
  status: number
  error: string
}

export type RequestWriteResult =
  | { ok: true; request: RequestRecord }
  | { ok: false; failure: RequestWriteFailure }

/**
 * Read a `requireAccessToOrg` denial back into a failure. The body is the one
 * the routes have always returned ('Forbidden' or 'Not found'), so turning it
 * back into a response downstream reproduces it exactly.
 */
async function failureFromDenial(denied: NextResponse): Promise<RequestWriteFailure> {
  let error = 'Forbidden'
  try {
    const body = await denied.json() as { error?: string }
    if (typeof body.error === 'string') error = body.error
  } catch {
    error = 'Forbidden'
  }
  return { status: denied.status, error }
}

/**
 * Rule 11 on the client the work is being filed against, for a human caller
 * only. A system apply is already past its own approval gate, which did the
 * scoping when the suggestion was listed.
 */
async function guardTargetOrg(
  drizzle: Drizzle,
  actor: RequestWriteActor,
  targetOrgId: string | null | undefined,
): Promise<RequestWriteFailure | null> {
  if (actor.actorType !== 'team_member') {
    // A system actor still needs the row to exist; requireAccessToOrg's 404
    // for a missing org is the answer the routes give, so keep it.
    return targetOrgId ? null : { status: 404, error: 'Not found' }
  }
  const denied = await requireAccessToOrg(drizzle, actor.actorId, targetOrgId)
  return denied ? failureFromDenial(denied) : null
}

// ── create ───────────────────────────────────────────────────────────────────

/**
 * The checks on a create body that need no database at all, as a pure
 * function, so a malformed body never opens a D1 handle.
 *
 * Exported because POST /api/admin/requests runs it BEFORE `db()`, which is
 * a property that route has always had and is worth keeping: a probe posting
 * `status: 'delivered'` should cost nothing. `createRequestRecord` runs it
 * again rather than trusting the caller to have done so, and running it twice
 * is free.
 */
export function validateRequestCreate(input: RequestCreateInput): RequestWriteFailure | null {
  if (!input.clientOrgId || !input.title?.trim()) {
    return { status: 400, error: 'clientOrgId and title are required' }
  }

  // A request may be created straight into a column other than intake (the
  // kanban's quick-add drops one into whichever column it was typed in).
  // Only the open half of the vocabulary: nothing should be born delivered
  // or cancelled, and those two carry side effects this path does not run.
  if (!isCreatableStatus(input.status ?? 'submitted')) {
    return { status: 400, error: `status must be one of: ${CREATABLE_STATUSES.join(', ')}` }
  }

  return null
}

/**
 * Create a request. Everything POST /api/admin/requests does once it knows
 * the caller is an admin, in the order it did it.
 */
export async function createRequestRecord(
  drizzle: Drizzle,
  input: RequestCreateInput,
  actor: RequestWriteActor,
): Promise<RequestWriteResult> {
  const invalid = validateRequestCreate(input)
  if (invalid) return { ok: false, failure: invalid }

  const { title, type, category, description, priority, startDate, dueDate, estimatedHours } = input
  // Narrowed by validateRequestCreate above; both are required there.
  const clientOrgId = input.clientOrgId as string
  const cleanTitle = (title as string).trim()
  const status = input.status ?? 'submitted'

  // Access first, existence second. The caller has to be allowed to file work
  // against this client (without this a team member scoped to one client could
  // create work under any org id, and it landed client-visible), and the org
  // has to exist (a typo used to write an orphan row that joins to a null org
  // name and no client detail page can reach).
  //
  // The order matters as much as the checks. With the lookup first, a scoped
  // caller got 404 for an org id that does not exist and 403 for one that
  // does, which turned this endpoint into an existence oracle over every
  // client id in the workspace. Scope first means an id outside the caller's
  // scope answers 403 whether or not it names a real client; the itemised 404
  // only reaches callers whose scope already lets them see every org.
  const denied = await guardTargetOrg(drizzle, actor, clientOrgId)
  if (denied) return { ok: false, failure: denied }

  const [targetOrg] = await drizzle
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, clientOrgId))
    .limit(1)
  if (!targetOrg) {
    return { ok: false, failure: { status: 404, error: 'Unknown client org' } }
  }

  // Brand, when the client has brands. A contact linked to specific brands
  // only ever sees requests carrying one of their brand ids (the portal list
  // filters on it), so a request filed with the column left null never
  // reaches them. The brand has to belong to the client being filed against.
  //
  // A brand id that does not is dropped, not refused. The dialog keeps the
  // previously selected brand in state when the client select changes, and
  // hides the Brand field entirely for a client with no brands, so a 400 here
  // would fail a routine "pick client A, look at brands, switch to client B,
  // submit" with a message pointing at a control that is not on screen. The
  // foreign brand never reaches the row either way; dropping it is the half
  // that does not break the primary create loop.
  let brandId: string | null = null
  if (input.brandId) {
    const [brand] = await drizzle
      .select({ id: schema.brands.id })
      .from(schema.brands)
      .where(and(eq(schema.brands.id, input.brandId), eq(schema.brands.orgId, clientOrgId)))
      .limit(1)
    brandId = brand?.id ?? null
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const resolvedType = type ?? 'small_task'
  const resolvedCategory = category ?? 'development'
  const resolvedPriority = priority ?? 'standard'

  // Atomically assign the next request number via a subquery in the INSERT
  // to avoid race conditions between concurrent request creations. The MAX is
  // scoped to this org, matching the portal create, so each client sees a
  // private 1, 2, 3 sequence and never learns the studio's total cross-client
  // request volume through the number on their own request.
  await drizzle.run(sql`
    INSERT INTO requests (
      id, org_id, brand_id, title, type, category, description, status, priority,
      start_date, due_date, estimated_hours, assignee_id, submitted_by_id, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${id},
      ${clientOrgId},
      ${brandId},
      ${cleanTitle},
      ${resolvedType},
      ${resolvedCategory},
      ${description ? sanitizeRichText(description) : null},
      ${status},
      ${resolvedPriority},
      ${startDate ?? null},
      ${dueDate ?? null},
      ${estimatedHours ?? null},
      ${input.assigneeId ?? null},
      ${actor.actorId ?? null},
      ${input.isInternal ? 1 : 0},
      0,
      3,
      COALESCE((SELECT MAX(request_number) FROM requests WHERE org_id = ${clientOrgId}), 0) + 1,
      ${now},
      ${now}
    )
  `)

  // Fire the domain event (automations + outgoing webhooks). Non-blocking.
  // Shared with the cross-client bulk create through lib/request-status-effects
  // so the two create paths cannot drift the way the two PATCH paths did.
  await emitRequestCreated(drizzle, {
    id,
    orgId: clientOrgId,
    title: cleanTitle,
    type: resolvedType,
    category: resolvedCategory,
    priority: resolvedPriority,
    status,
    isInternal: !!input.isInternal,
    source: 'admin',
  })

  return { ok: true, request: { id, orgId: clientOrgId, title: cleanTitle, status, requestNumber: null } }
}

// ── update ───────────────────────────────────────────────────────────────────

/**
 * Update a request. Everything PATCH /api/admin/requests/[id] does once the
 * caller is an admin, in the order it did it: build the patch, read the row
 * (which is also the before-state the assignment ping needs), apply the
 * client access rule, write, then the ping and the status fan-out.
 */
export async function updateRequestRecord(
  drizzle: Drizzle,
  requestId: string,
  body: RequestPatchInput,
  actor: RequestWriteActor,
): Promise<RequestWriteResult> {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }

  if (body.status !== undefined) {
    if (!isPatchableStatus(body.status)) {
      return { ok: false, failure: { status: 400, error: `Unknown status: ${body.status}` } }
    }
    patch.status = body.status
    if (body.status === 'delivered') patch.deliveredAt = now
  }
  if (body.priority !== undefined) {
    if (!isRequestPriority(body.priority)) {
      return { ok: false, failure: { status: 400, error: `Unknown priority: ${body.priority}` } }
    }
    patch.priority = body.priority
  }
  // Category is edited in place from the detail rail's Details card.
  if (body.category !== undefined) patch.category = body.category
  if ('assigneeId' in body) patch.assigneeId = body.assigneeId ?? null
  if ('estimatedHours' in body) patch.estimatedHours = body.estimatedHours ?? null
  if ('startDate' in body) patch.startDate = body.startDate ?? null
  if ('dueDate' in body) patch.dueDate = body.dueDate ?? null
  if (body.scopeFlagged !== undefined) patch.scopeFlagged = body.scopeFlagged
  // Client visibility. Both portal request routes filter on requests.isInternal,
  // so flipping this on removes the request from the client's portal entirely.
  // Studio-only by construction: this path is only reached past an admin gate.
  if (body.isInternal !== undefined) patch.isInternal = body.isInternal
  if ('trackId' in body) patch.trackId = body.trackId ?? null
  if (body.checklists !== undefined) patch.checklists = body.checklists
  // '' and null both mean unlink (the MCP tool cannot send null).
  if ('scheduleRowId' in body) patch.scheduleRowId = body.scheduleRowId || null

  // Access scoping. The same read carries the before-state the assignment
  // notification needs, so handing a request over costs no extra query, and
  // it is what the returned row is built from.
  const [ownerRow] = await drizzle
    .select({
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      status: schema.requests.status,
      assigneeId: schema.requests.assigneeId,
      requestNumber: schema.requests.requestNumber,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)
  const denied = await guardTargetOrg(drizzle, actor, ownerRow?.orgId)
  if (denied) return { ok: false, failure: denied }

  await drizzle
    .update(schema.requests)
    .set(patch)
    .where(eq(schema.requests.id, requestId))

  // Handing a request to someone wrote the column and told nobody, so the
  // person who now owns it found out by opening the board. Only a real change
  // pings, and never for assigning yourself.
  if (
    'assigneeId' in body &&
    body.assigneeId &&
    ownerRow &&
    body.assigneeId !== ownerRow.assigneeId
  ) {
    const [actorMember] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, actor.actorId ?? ''))
      .limit(1)

    if (body.assigneeId !== actorMember?.id) {
      await notifyTeamMember(drizzle, body.assigneeId, {
        type: 'request_assigned',
        // The shared helper, so this line and the bulk assign bar cannot drift.
        // This path is the sole owner of the assignment ping: both UI routes
        // (the detail header and the People panel) end up making it, and the
        // participants POST deliberately stays quiet for role 'assignee'.
        title: requestParticipantTitle('assignee', ownerRow.title),
        body: ownerRow.requestNumber ? `REQ-${ownerRow.requestNumber}` : null,
        entityType: 'request',
        entityId: requestId,
      })
    }
  }

  // Notifications + domain event on status change. Shared with the bulk PATCH
  // through lib/request-status-effects so the two paths cannot drift.
  if (body.status !== undefined) {
    // Re-read rather than reuse the row above: the assignee and the visibility
    // may have just changed in this very patch, and the fan-out audience is
    // read off the row as it now stands.
    const [updatedReq] = await drizzle
      .select({
        title: schema.requests.title,
        orgId: schema.requests.orgId,
        assigneeId: schema.requests.assigneeId,
        isInternal: schema.requests.isInternal,
        // Read so the client fan-out can be narrowed to the contacts the
        // brand-scoped portal list would show this row to. Unread, the bell
        // and the email both go org wide, which is wider than the portal.
        brandId: schema.requests.brandId,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1)

    if (updatedReq) {
      await emitRequestStatusChanged(drizzle, {
        id: requestId,
        title: updatedReq.title,
        orgId: updatedReq.orgId,
        assigneeId: updatedReq.assigneeId ?? null,
        isInternal: updatedReq.isInternal === true,
        brandId: updatedReq.brandId ?? null,
      }, body.status)
    }
  }

  return {
    ok: true,
    request: {
      id: requestId,
      orgId: ownerRow?.orgId ?? '',
      title: ownerRow?.title ?? '',
      status: body.status ?? ownerRow?.status ?? '',
      requestNumber: ownerRow?.requestNumber ?? null,
    },
  }
}

// ── hand off ─────────────────────────────────────────────────────────────────

/** Long enough for a real ask, short enough that nobody pastes a brief in. */
export const MAX_HANDOFF_NOTE_CHARS = 2000

export interface HandOffInput {
  contactId?: unknown
  reason?: unknown
  note?: unknown
  dueAt?: unknown
}

export interface HandOffRecord {
  requestId: string
  waitingOn: WaitingOnPayload & { contactEmail: string | null }
}

export type HandOffResult =
  | { ok: true; handOff: HandOffRecord }
  | { ok: false; failure: RequestWriteFailure }

/** Normalise a date the studio picked. Accepts YYYY-MM-DD or a full ISO. */
function parseDueAt(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const ms = Date.parse(value.length === 10 ? `${value}T00:00:00.000Z` : value)
  if (Number.isNaN(ms)) return { ok: false }
  return { ok: true, value: new Date(ms).toISOString() }
}

function readNote(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > MAX_HANDOFF_NOTE_CHARS) return { ok: false }
  return { ok: true, value: trimmed }
}

/** The acting studio member's display name, for "Liam has passed this to you". */
async function actorName(drizzle: Drizzle, userId: string | null): Promise<string> {
  if (!userId) return 'Tahi Studio'
  try {
    const [member] = await drizzle
      .select({ name: schema.teamMembers.name })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    return member?.name?.trim() || 'Tahi Studio'
  } catch {
    return 'Tahi Studio'
  }
}

/**
 * Hand one request to one named contact at the client. Everything POST
 * /api/admin/requests/[id]/handoff does once the caller is an admin: the
 * participant row, the pointer, the audit row, the seat if they have none,
 * and the bell and email.
 *
 * The four (and a half) things that happen are argued at length in the route
 * this came out of; nothing about them changed here except that an approved
 * call suggestion can now reach them too.
 */
export async function handOffRequest(
  drizzle: Drizzle,
  requestId: string,
  input: HandOffInput,
  actor: RequestWriteActor,
): Promise<HandOffResult> {
  const contactId = typeof input.contactId === 'string' ? input.contactId.trim() : ''
  if (!contactId) {
    return { ok: false, failure: { status: 400, error: 'contactId is required' } }
  }
  if (!isHandoffReason(input.reason)) {
    return {
      ok: false,
      failure: { status: 400, error: `reason must be one of: ${HANDOFF_REASONS.join(', ')}` },
    }
  }
  const reason: HandoffReason = input.reason
  const note = readNote(input.note)
  if (!note.ok) {
    return {
      ok: false,
      failure: { status: 400, error: `note must be a string of at most ${MAX_HANDOFF_NOTE_CHARS} characters` },
    }
  }
  const dueAt = parseDueAt(input.dueAt)
  if (!dueAt.ok) {
    return { ok: false, failure: { status: 400, error: 'dueAt must be an ISO date' } }
  }

  const [request] = await drizzle
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      requestNumber: schema.requests.requestNumber,
      assigneeId: schema.requests.assigneeId,
      waitingOnContactId: schema.requests.waitingOnContactId,
      waitingReason: schema.requests.waitingReason,
      waitingSince: schema.requests.waitingSince,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)
  if (!request) return { ok: false, failure: { status: 404, error: 'Not found' } }

  const denied = await guardTargetOrg(drizzle, actor, request.orgId)
  if (denied) return { ok: false, failure: denied }

  // The contact has to be one of THIS client's people. Without this check a
  // hand-off could point at a contact at another org, which would put another
  // client's request in their portal and mail them its title.
  const [contact] = await drizzle
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
      clerkUserId: schema.contacts.clerkUserId,
    })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.orgId, request.orgId)))
    .limit(1)
  if (!contact) {
    return { ok: false, failure: { status: 404, error: 'Contact not found for this client' } }
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const role = handoffParticipantRole(reason)

  // The participant row, upserted. A person already on the request under the
  // OTHER hand-off role is moved rather than duplicated: the role is supposed
  // to say what they are there for now, and leaving the old one active would
  // show one person twice in the cast with two different answers.
  await drizzle
    .update(schema.requestParticipants)
    .set({ removedAt: nowIso })
    .where(and(
      eq(schema.requestParticipants.requestId, requestId),
      eq(schema.requestParticipants.participantId, contact.id),
      eq(schema.requestParticipants.participantType, 'contact'),
      ne(schema.requestParticipants.role, role),
      isNull(schema.requestParticipants.removedAt),
    ))

  const [existingRow] = await drizzle
    .select({ id: schema.requestParticipants.id })
    .from(schema.requestParticipants)
    .where(and(
      eq(schema.requestParticipants.requestId, requestId),
      eq(schema.requestParticipants.participantId, contact.id),
      eq(schema.requestParticipants.participantType, 'contact'),
      eq(schema.requestParticipants.role, role),
      isNull(schema.requestParticipants.removedAt),
    ))
    .limit(1)

  if (!existingRow) {
    await drizzle.insert(schema.requestParticipants).values({
      id: crypto.randomUUID(),
      requestId,
      participantId: contact.id,
      participantType: 'contact',
      role,
      addedById: actor.actorId,
      addedByType: 'team_member',
      addedAt: nowIso,
      removedAt: null,
    })
  }

  // The pointer. waitingNudgedAt resets to null so a re-hand-off starts its
  // own nudge clock rather than inheriting the last one's.
  await drizzle
    .update(schema.requests)
    .set({
      waitingOnContactId: contact.id,
      waitingReason: reason,
      waitingSince: nowIso,
      waitingDueAt: dueAt.value,
      waitingNote: note.value,
      waitingNudgedAt: null,
      updatedAt: nowIso,
    })
    .where(eq(schema.requests.id, requestId))

  await logAudit(drizzle as unknown as DB, {
    action: AUDIT_HANDED_OFF,
    userId: actor.actorId,
    userType: 'team_member',
    entityType: 'request',
    entityId: requestId,
    metadata: {
      orgId: request.orgId,
      contactId: contact.id,
      contactEmail: contact.email ?? null,
      reason,
      role,
      dueAt: dueAt.value,
      note: note.value,
      // What it was doing before, so a re-hand-off is legible in the trail.
      previousContactId: request.waitingOnContactId ?? null,
    },
  })

  // A contact with no Clerk login cannot follow a link into the portal, so the
  // seat is minted BEFORE the email and the button points at the invite. Best
  // effort: a failure here costs the deep link, never the hand-off.
  let actionUrl = notificationEmailUrl(requestId, 'client')
  if (!contact.clerkUserId && contact.email) {
    try {
      const invite = await ensureClientInvite(drizzle, {
        flow: 'client',
        orgId: request.orgId,
        contactEmail: contact.email,
        contactName: contact.name ?? contact.email,
        createdById: actor.actorId,
      })
      actionUrl = invite.link
    } catch (err) {
      console.warn('[handoff] could not mint an invite for a seatless contact:', err)
    }
  }

  const from = await actorName(drizzle, actor.actorId)
  const reasonLabel = HANDOFF_REASON_SENTENCE[reason]

  // Bell and inbox off one call, the way every other wired event does it.
  // Never allowed to fail the hand-off: the pointer is already set and the
  // studio's chip is already right, so a Resend outage must not 500 this.
  try {
    await createNotification(drizzle, {
      recipient: { contactId: contact.id },
      type: 'request_waiting_on_you',
      title: `${reasonLabel}: "${request.title}"`,
      body: note.value ?? (request.requestNumber ? `REQ-${request.requestNumber}` : null),
      entityType: 'request',
      entityId: requestId,
      email: waitingOnYouEmailPlan({
        requestId,
        requestTitle: request.title,
        requestNumber: request.requestNumber,
        orgId: request.orgId,
        reasonLabel,
        actionVerb: HANDOFF_ACTION_VERB[reason],
        fromName: from,
        note: note.value,
        dueAt: dueAt.value,
        actionUrl,
      }),
    })
  } catch (err) {
    console.warn('[handoff] could not notify the contact:', err)
  }

  return {
    ok: true,
    handOff: {
      requestId,
      waitingOn: {
        // Never null here: buildWaitingOn only answers null for a row with no
        // waitingOnContactId, and contact.id is the value just written.
        ...buildWaitingOn({
          waitingOnContactId: contact.id,
          waitingReason: reason,
          waitingSince: nowIso,
          waitingDueAt: dueAt.value,
          waitingNote: note.value,
        }, contact.name, now)!,
        contactEmail: contact.email ?? null,
      },
    },
  }
}

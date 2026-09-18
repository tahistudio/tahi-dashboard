/**
 * /api/admin/requests/[id]/handoff
 *
 *   POST   -> hand this request to ONE named contact at the client.
 *             Body: { contactId, reason, note?, dueAt? }
 *   DELETE -> hand it back to the studio. Body: { note? }
 *
 * The studio half of the client hand-off (migration 0104,
 * lib/request-handoff.ts). A request keeps its Tahi owner throughout; this
 * sets a pointer saying it is currently sitting with a person at the client
 * and why, which is what puts it in that person's "Waiting on you" and puts a
 * chip on the studio's row.
 *
 * FOUR THINGS HAPPEN ON A HAND-OFF, and all four matter:
 *
 *   1. The participant row, so the person is part of the request's cast and
 *      not just a foreign key nothing renders. The role comes from the reason
 *      ('approver' for approval, 'contributor' otherwise).
 *   2. The pointer, which is the only place "who is this with right now" is
 *      stored. One person at a time, by construction.
 *   3. The audit row, which is where the HISTORY of who it sat with lives,
 *      because the pointer is overwritten on the next hand-off.
 *   4. The bell and the email. The email is the half that actually works: a
 *      client who lives in their inbox never sees a bell.
 *
 * And a fifth on the branch that is easy to forget: a contact with no seat.
 * Plenty of the people a request needs something from have a contacts row and
 * have never signed in, so the email's button would land them on a sign-in
 * wall for an account they do not have. This mints our own app invite exactly
 * the way POST /api/portal/people does (never a Clerk organization invitation,
 * which sends its own unallowlisted mail) and points the button at that link
 * instead.
 *
 * Admin auth plus requireAccessToOrg on the request's own org, so a scoped
 * team member cannot hand off work for a client they cannot see.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { logAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import { notificationEmailUrl, waitingOnYouEmailPlan } from '@/lib/notification-email'
import { ensureClientInvite } from '@/lib/onboarding-invites'
import {
  AUDIT_HANDED_BACK,
  AUDIT_HANDED_OFF,
  HANDOFF_ACTION_VERB,
  HANDOFF_CLEARED_COLUMNS,
  HANDOFF_REASONS,
  HANDOFF_REASON_SENTENCE,
  buildWaitingOn,
  daysWaiting,
  handoffParticipantRole,
  isHandoffReason,
} from '@/lib/request-handoff'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Long enough for a real ask, short enough that nobody pastes a brief in. */
const MAX_NOTE_CHARS = 2000

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
  if (trimmed.length > MAX_NOTE_CHARS) return { ok: false }
  return { ok: true, value: trimmed }
}

/** The request, plus everything both verbs need off it in one read. */
async function loadRequest(drizzle: Drizzle, id: string) {
  const [row] = await drizzle
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
    .where(eq(schema.requests.id, id))
    .limit(1)
  return row ?? null
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

// ── POST : hand off ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  let body: { contactId?: unknown; reason?: unknown; note?: unknown; dueAt?: unknown }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : ''
  if (!contactId) {
    return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
  }
  if (!isHandoffReason(body.reason)) {
    return NextResponse.json(
      { error: `reason must be one of: ${HANDOFF_REASONS.join(', ')}` },
      { status: 400 },
    )
  }
  const reason = body.reason
  const note = readNote(body.note)
  if (!note.ok) {
    return NextResponse.json(
      { error: `note must be a string of at most ${MAX_NOTE_CHARS} characters` },
      { status: 400 },
    )
  }
  const dueAt = parseDueAt(body.dueAt)
  if (!dueAt.ok) {
    return NextResponse.json({ error: 'dueAt must be an ISO date' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const request = await loadRequest(drizzle, id)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

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
    return NextResponse.json({ error: 'Contact not found for this client' }, { status: 404 })
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
      eq(schema.requestParticipants.requestId, id),
      eq(schema.requestParticipants.participantId, contact.id),
      eq(schema.requestParticipants.participantType, 'contact'),
      ne(schema.requestParticipants.role, role),
      isNull(schema.requestParticipants.removedAt),
    ))

  const [existingRow] = await drizzle
    .select({ id: schema.requestParticipants.id })
    .from(schema.requestParticipants)
    .where(and(
      eq(schema.requestParticipants.requestId, id),
      eq(schema.requestParticipants.participantId, contact.id),
      eq(schema.requestParticipants.participantType, 'contact'),
      eq(schema.requestParticipants.role, role),
      isNull(schema.requestParticipants.removedAt),
    ))
    .limit(1)

  if (!existingRow) {
    await drizzle.insert(schema.requestParticipants).values({
      id: crypto.randomUUID(),
      requestId: id,
      participantId: contact.id,
      participantType: 'contact',
      role,
      addedById: userId,
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
    .where(eq(schema.requests.id, id))

  await logAudit(drizzle as unknown as DB, {
    action: AUDIT_HANDED_OFF,
    userId,
    userType: 'team_member',
    entityType: 'request',
    entityId: id,
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
  let actionUrl = notificationEmailUrl(id, 'client')
  if (!contact.clerkUserId && contact.email) {
    try {
      const invite = await ensureClientInvite(drizzle, {
        flow: 'client',
        orgId: request.orgId,
        contactEmail: contact.email,
        contactName: contact.name ?? contact.email,
        createdById: userId,
      })
      actionUrl = invite.link
    } catch (err) {
      console.warn('[handoff] could not mint an invite for a seatless contact:', err)
    }
  }

  const from = await actorName(drizzle, userId)
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
      entityId: id,
      email: waitingOnYouEmailPlan({
        requestId: id,
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

  return NextResponse.json({
    request: {
      id,
      waitingOn: {
        ...buildWaitingOn({
          waitingOnContactId: contact.id,
          waitingReason: reason,
          waitingSince: nowIso,
          waitingDueAt: dueAt.value,
          waitingNote: note.value,
        }, contact.name, now),
        contactEmail: contact.email ?? null,
      },
    },
  })
}

// ── DELETE : hand back ───────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // A DELETE with no body is the ordinary case, so an unparseable one is not
  // an error: the note is the only thing in it.
  const body = await req.json().catch(() => ({})) as { note?: unknown }
  const note = readNote(body.note)
  if (!note.ok) {
    return NextResponse.json(
      { error: `note must be a string of at most ${MAX_NOTE_CHARS} characters` },
      { status: 400 },
    )
  }

  const database = await db()
  const drizzle = database as Drizzle

  const request = await loadRequest(drizzle, id)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  // Idempotent. Pressing "hand back" on a request the client already acted on
  // is a race, not a mistake, and it should read as a no-op rather than an
  // error the studio has to interpret.
  if (!request.waitingOnContactId) {
    return NextResponse.json({ request: { id, waitingOn: null } })
  }

  const nowIso = new Date().toISOString()

  await drizzle
    .update(schema.requests)
    .set({ ...HANDOFF_CLEARED_COLUMNS, updatedAt: nowIso })
    .where(eq(schema.requests.id, id))

  await logAudit(drizzle as unknown as DB, {
    action: AUDIT_HANDED_BACK,
    userId,
    userType: 'team_member',
    entityType: 'request',
    entityId: id,
    metadata: {
      orgId: request.orgId,
      reason: 'studio_took_it_back',
      contactId: request.waitingOnContactId,
      waitingReason: request.waitingReason ?? null,
      daysWaiting: daysWaiting(request.waitingSince),
      note: note.value,
    },
  })

  // The owner hears about it. The person who pressed the button is usually the
  // owner and will see their own row, which is the cheap price of the case
  // that matters: anyone else on the studio side taking a request back off a
  // client without telling its owner.
  await notifyRequestTeam(
    drizzle,
    { requestId: id, orgId: request.orgId, assigneeId: request.assigneeId ?? null },
    {
      type: 'request_status_changed',
      title: `Back with us: "${request.title}"`,
      body: note.value ?? 'The studio took this back off the client.',
      entityType: 'request',
      entityId: id,
    },
  )

  return NextResponse.json({ request: { id, waitingOn: null } })
}

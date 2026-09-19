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
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { logAudit } from '@/lib/audit'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import {
  AUDIT_HANDED_BACK,
  HANDOFF_CLEARED_COLUMNS,
  daysWaiting,
} from '@/lib/request-handoff'
// The hand-off itself (validation, participant row, pointer, audit, seat,
// bell and email) lives in the shared writer, so an approved call suggestion
// hands a request over exactly the way this route does.
import { handOffRequest, MAX_HANDOFF_NOTE_CHARS, type HandOffInput } from '@/lib/request-writes'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function readNote(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > MAX_HANDOFF_NOTE_CHARS) return { ok: false }
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

// ── POST : hand off ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  let body: HandOffInput
  try {
    body = await req.json() as HandOffInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const result = await handOffRequest(drizzle, id, body, {
    actorType: 'team_member',
    actorId: userId,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.failure.error }, { status: result.failure.status })
  }

  return NextResponse.json({
    request: { id, waitingOn: result.handOff.waitingOn },
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
      { error: `note must be a string of at most ${MAX_HANDOFF_NOTE_CHARS} characters` },
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

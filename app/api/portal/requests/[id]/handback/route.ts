/**
 * POST /api/portal/requests/[id]/handback
 *
 * Body: { note? }
 *
 * The client's own way out of a hand-off. A request that is sitting with one
 * named person can be pushed back to the studio by that person, or by a
 * workspace admin at the same client cleaning up after them, with an optional
 * note saying why.
 *
 * WHY THIS EXISTS AT ALL. Without it the only way off a hand-off is to do the
 * thing that was asked, and the commonest reason a hand-off stalls is that it
 * went to the wrong person: the ops manager cannot approve spend, the person
 * who has the logo files left in March. A request nobody can act on and nobody
 * can decline just sits there collecting nudges, and the studio reads the
 * silence as "they are busy" rather than "ask somebody else".
 *
 * WHO MAY PRESS IT. The named contact, or a workspace admin at that org. Not
 * any contact at the client: a request handed to the finance lead for a spend
 * decision is not a thing a colleague gets to wave away. Anyone else is 403,
 * and a request from another org is 404 through the ordinary org scoping.
 */

import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { contactIdentityWhere } from '@/lib/portal-identity'
import { isPortalAdminContact } from '@/lib/portal-access'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import {
  actingByline,
  actingIdentity,
  recordActingWrite,
  refusePreviewWrite,
} from '@/lib/acting-as'
import { logAudit } from '@/lib/audit'
import { notifyRequestTeam } from '@/lib/notify-request-team'
import {
  AUDIT_HANDED_BACK,
  HANDOFF_CLEARED_COLUMNS,
  daysWaiting,
} from '@/lib/request-handoff'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const MAX_NOTE_CHARS = 2000

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const auth = await getPortalAuth(req)
    const { orgId, userId, clerkOrgId, contactId: previewContactId } = auth

    const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId }, 'requests')
    if (featureDenied) return featureDenied

    if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    // OPEN in act mode, like review and the thread: the studio sitting in a
    // client's seat pushing a stuck request back to itself is a real support
    // action, and the acting record below says who actually did it.
    const previewDenied = refusePreviewWrite(auth, { allowActing: true })
    if (previewDenied) return previewDenied
    const acting = actingIdentity(auth)

    const { id } = await params

    const body = await req.json().catch(() => ({})) as { note?: unknown }
    if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
      return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
    }
    const rawNote = typeof body.note === 'string' ? body.note.trim() : ''
    if (rawNote.length > MAX_NOTE_CHARS) {
      return NextResponse.json(
        { error: `note must be at most ${MAX_NOTE_CHARS} characters` },
        { status: 400 },
      )
    }
    const note = rawNote || null

    const database = await db()
    const drizzle = database as Drizzle

    // Org scoped and non-internal, the same projection every portal request
    // route uses. A request at another client is Not found, never Forbidden:
    // the two answers together are an existence oracle over request ids.
    const [request] = await drizzle
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        title: schema.requests.title,
        assigneeId: schema.requests.assigneeId,
        waitingOnContactId: schema.requests.waitingOnContactId,
        waitingReason: schema.requests.waitingReason,
        waitingSince: schema.requests.waitingSince,
      })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.id, id),
        eq(schema.requests.orgId, orgId),
        eq(schema.requests.isInternal, false),
      ))
      .limit(1)

    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // The caller, in their own seat. contactIdentityWhere so Client view asks
    // the question about the person being previewed rather than the operator.
    const [self] = await drizzle
      .select({
        id: schema.contacts.id,
        name: schema.contacts.name,
        portalRole: schema.contacts.portalRole,
        isPrimary: schema.contacts.isPrimary,
      })
      .from(schema.contacts)
      .where(contactIdentityWhere(orgId, userId, previewContactId))
      .limit(1)

    const isNamed = !!self && self.id === request.waitingOnContactId
    const isAdmin = isPortalAdminContact(self)
    if (!isNamed && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Idempotent, for the same reason the studio's DELETE is: two people on
    // the same "Waiting on your team" list pressing this within a second of
    // each other is a race, not an error.
    if (!request.waitingOnContactId) {
      return NextResponse.json({ success: true, waitingOn: null })
    }

    const nowIso = new Date().toISOString()

    // The acting record FIRST, ahead of the write, matching review and the
    // thread: a change made from inside a client's own surface by the studio
    // must never exist without the row that says who made it.
    await recordActingWrite(drizzle as unknown as DB, acting, {
      verb: 'request.handed_back',
      entityType: 'request',
      entityId: id,
      route: 'POST /api/portal/requests/[id]/handback',
      extra: { note, waitingReason: request.waitingReason ?? null },
    })

    await drizzle
      .update(schema.requests)
      .set({ ...HANDOFF_CLEARED_COLUMNS, updatedAt: nowIso })
      .where(eq(schema.requests.id, id))

    await logAudit(drizzle as unknown as DB, {
      action: AUDIT_HANDED_BACK,
      userId: self?.id ?? userId,
      userType: 'contact',
      entityType: 'request',
      entityId: id,
      metadata: {
        orgId,
        reason: isNamed ? 'client_handed_back' : 'client_admin_handed_back',
        contactId: request.waitingOnContactId,
        waitingReason: request.waitingReason ?? null,
        daysWaiting: daysWaiting(request.waitingSince),
        note,
      },
    })

    // The studio side hears it: this is the one signal that a hand-off is not
    // going to resolve itself, and it is useless in a bell nobody watches if
    // the note is dropped.
    const who = self?.name?.trim() || 'The client'
    await notifyRequestTeam(
      drizzle,
      { requestId: id, orgId: request.orgId, assigneeId: request.assigneeId ?? null },
      {
        type: 'request_status_changed',
        title: `Handed back to us: "${request.title}"`,
        body: (note
          ? `${who}: ${note}`
          : `${who} handed this back without acting on it.`) + actingByline(acting, 'recorded'),
        entityType: 'request',
        entityId: id,
      },
    )

    return NextResponse.json({ success: true, waitingOn: null })
  } catch (err) {
    console.error('[POST /api/portal/requests/[id]/handback]', err)
    return NextResponse.json({ error: 'Failed to hand the request back' }, { status: 500 })
  }
}

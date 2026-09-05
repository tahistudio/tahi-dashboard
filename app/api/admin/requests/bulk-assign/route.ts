/**
 * POST /api/admin/requests/bulk-assign
 *
 * Add the same set of participants to multiple requests in one call.
 *
 * Body : {
 *   requestIds: string[],
 *   participants: Array<{ participantId: string; participantType: 'team_member' | 'contact'; role: 'pm' | 'assignee' | 'follower' }>,
 * }
 *
 * Behaviour :
 *   - For each (request × participant), de-dupes if an active row with the
 *     same (id, type, role) already exists.
 *   - For role='pm', soft-removes any existing PM on each request (only
 *     one PM per request).
 *   - Contacts can only be followers (same rule as single POST).
 *   - Returns summary counts : { added, skipped, invalid }.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { notifyTeamMember, requestParticipantTitle } from '@/lib/notifications'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** D1 binds at most 100 parameters per statement, so an IN over a selection
 *  has to be sliced. Same ceiling lib/delivery-aggregate works around. */
const ID_CHUNK = 90

function chunkIds<T>(ids: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK))
  return out
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null) as {
    requestIds?: string[]
    participants?: Array<{ participantId: string; participantType: 'team_member' | 'contact'; role: 'pm' | 'assignee' | 'follower' }>
  } | null

  if (!Array.isArray(body?.requestIds) || body!.requestIds!.length === 0) {
    return NextResponse.json({ error: 'requestIds required' }, { status: 400 })
  }
  if (!Array.isArray(body?.participants) || body!.participants!.length === 0) {
    return NextResponse.json({ error: 'participants required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  // Validate access on each request. Chunked: the participants bar hands this
  // whatever the table has selected, and one IN over more than 100 ids fails
  // the whole call on D1's bind variable ceiling.
  const requests: Array<{
    id: string
    orgId: string
    title: string
    requestNumber: number | null
  }> = []
  for (const chunk of chunkIds(body!.requestIds!)) {
    const part = await drizzle
      .select({
        id: schema.requests.id,
        orgId: schema.requests.orgId,
        // Carried for the notification below: naming the work is the whole
        // point of telling somebody they now own it.
        title: schema.requests.title,
        requestNumber: schema.requests.requestNumber,
      })
      .from(schema.requests)
      .where(inArray(schema.requests.id, chunk))
    requests.push(...part)
  }

  for (const r of requests) {
    const denied = await requireAccessToOrg(drizzle, userId, r.orgId)
    if (denied) return denied
  }
  const foundIds = new Set(requests.map(r => r.id))
  const notFound = body!.requestIds!.filter(id => !foundIds.has(id))

  let added = 0
  let skipped = 0
  let invalid = 0
  const now = new Date().toISOString()

  /**
   * What each team member was actually added to, so a forty row bulk assign
   * costs them one bell entry rather than forty. Keyed on teamMembers.id.
   */
  const addedByMember = new Map<
    string,
    Array<{ requestId: string; title: string; requestNumber: number | null; role: string }>
  >()

  for (const request of requests) {
    const requestId = request.id
    for (const p of body!.participants!) {
      if (!p.participantId || !p.participantType || !p.role) { invalid++; continue }
      if (p.participantType === 'contact' && p.role !== 'follower') { invalid++; continue }

      if (p.role === 'pm') {
        await drizzle
          .update(schema.requestParticipants)
          .set({ removedAt: now })
          .where(and(
            eq(schema.requestParticipants.requestId, requestId),
            eq(schema.requestParticipants.role, 'pm'),
            isNull(schema.requestParticipants.removedAt),
          ))
      }

      // Keep requests.assigneeId in sync with the assignee participant. The
      // "Unassigned" filter and the workload capacity bar both read
      // assigneeId, so without this a bulk assign added a participant row but
      // drained nothing and moved no capacity. Only a team member can own the
      // assignee slot; runs even when the participant row already exists so a
      // re-assign always lands.
      if (p.role === 'assignee' && p.participantType === 'team_member') {
        await drizzle
          .update(schema.requests)
          .set({ assigneeId: p.participantId, updatedAt: now })
          .where(eq(schema.requests.id, requestId))
      }

      const [existing] = await drizzle
        .select({ id: schema.requestParticipants.id })
        .from(schema.requestParticipants)
        .where(and(
          eq(schema.requestParticipants.requestId, requestId),
          eq(schema.requestParticipants.participantId, p.participantId),
          eq(schema.requestParticipants.participantType, p.participantType),
          eq(schema.requestParticipants.role, p.role),
          isNull(schema.requestParticipants.removedAt),
        ))
        .limit(1)

      if (existing) { skipped++; continue }

      await drizzle.insert(schema.requestParticipants).values({
        id: crypto.randomUUID(),
        requestId,
        participantId: p.participantId,
        participantType: p.participantType,
        role: p.role,
        addedById: userId,
        addedByType: 'team_member',
        addedAt: now,
        removedAt: null,
      })
      added++

      // Contacts are the client's own people: their channel is the request
      // thread, not a bell row about studio staffing.
      if (p.participantType === 'team_member') {
        const bucket = addedByMember.get(p.participantId) ?? []
        bucket.push({
          requestId,
          title: request.title,
          requestNumber: request.requestNumber,
          role: p.role,
        })
        addedByMember.set(p.participantId, bucket)
      }
    }
  }

  // Tell the people who now own work. The bulk bar wrote participant rows and
  // assignee columns and notified nobody, so a batch hand-off was invisible
  // until someone opened the board.
  if (addedByMember.size > 0) {
    const [actor] = await drizzle
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId ?? ''))
      .limit(1)

    for (const [memberId, items] of addedByMember) {
      if (memberId === actor?.id) continue
      const single = items.length === 1
      const first = items[0]
      await notifyTeamMember(drizzle, memberId, {
        type: 'task_assigned',
        title: single
          ? requestParticipantTitle(first.role, first.title)
          : `You were added to ${items.length} requests`,
        body: single
          ? (first.requestNumber ? `REQ-${first.requestNumber}` : null)
          : items.slice(0, 3).map((i) => i.title).join(', ') +
            (items.length > 3 ? ` and ${items.length - 3} more` : ''),
        entityType: 'request',
        entityId: single ? first.requestId : null,
      })
    }
  }

  return NextResponse.json({ ok: true, added, skipped, invalid, notFound })
}

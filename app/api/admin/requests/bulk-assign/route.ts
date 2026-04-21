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

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

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

  // Validate access on each request.
  const requests = await drizzle
    .select({ id: schema.requests.id, orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(inArray(schema.requests.id, body!.requestIds!))

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

  for (const requestId of requests.map(r => r.id)) {
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
    }
  }

  return NextResponse.json({ ok: true, added, skipped, invalid, notFound })
}

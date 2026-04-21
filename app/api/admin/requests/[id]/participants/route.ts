/**
 * /api/admin/requests/[id]/participants
 *
 *   GET    → list active participants (excludes soft-deleted rows)
 *   POST   → add a participant. Body: { participantId, participantType, role }
 *            - role: 'pm' | 'assignee' | 'follower'
 *            - participantType: 'team_member' | 'contact'
 *            - Clients (contacts) can only be followers.
 *            - Only one 'pm' per request (replaces any existing PM).
 *            - De-dupes : if the same (id, type, role) already exists and
 *              isn't soft-deleted, returns the existing row.
 *   DELETE is not defined here — use the nested [participantId] route.
 *
 * All scoped to Tahi admin. Access-scoping to the request's org is
 * enforced so a scoped team member can't add participants to a request
 * outside their scope.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, isNull, desc, inArray as inList } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const VALID_ROLES = ['pm', 'assignee', 'follower'] as const
const VALID_TYPES = ['team_member', 'contact'] as const

export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const database = await db()
  const drizzle = database as Drizzle

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  const rows = await drizzle
    .select()
    .from(schema.requestParticipants)
    .where(and(eq(schema.requestParticipants.requestId, id), isNull(schema.requestParticipants.removedAt)))
    .orderBy(desc(schema.requestParticipants.addedAt))

  // Attach display names by type.
  const memberIds = rows.filter(r => r.participantType === 'team_member').map(r => r.participantId)
  const contactIds = rows.filter(r => r.participantType === 'contact').map(r => r.participantId)

  const members = memberIds.length
    ? await drizzle.select({ id: schema.teamMembers.id, name: schema.teamMembers.name, avatar: schema.teamMembers.avatarUrl }).from(schema.teamMembers).where(inList(schema.teamMembers.id, memberIds))
    : []
  const contacts = contactIds.length
    ? await drizzle.select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email }).from(schema.contacts).where(inList(schema.contacts.id, contactIds))
    : []

  const memberMap = new Map(members.map(m => [m.id, m]))
  const contactMap = new Map(contacts.map(c => [c.id, c]))

  return NextResponse.json({
    participants: rows.map(r => ({
      id: r.id,
      participantId: r.participantId,
      participantType: r.participantType,
      role: r.role,
      addedAt: r.addedAt,
      name: r.participantType === 'team_member'
        ? memberMap.get(r.participantId)?.name ?? null
        : contactMap.get(r.participantId)?.name ?? null,
      avatar: r.participantType === 'team_member' ? memberMap.get(r.participantId)?.avatar ?? null : null,
      email: r.participantType === 'contact' ? contactMap.get(r.participantId)?.email ?? null : null,
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => null) as {
    participantId?: string
    participantType?: string
    role?: string
  } | null

  if (!body?.participantId || !body.participantType || !body.role) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (!VALID_ROLES.includes(body.role as typeof VALID_ROLES[number])) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (!VALID_TYPES.includes(body.participantType as typeof VALID_TYPES[number])) {
    return NextResponse.json({ error: 'Invalid participant type' }, { status: 400 })
  }
  if (body.participantType === 'contact' && body.role !== 'follower') {
    return NextResponse.json({ error: 'Contacts can only be followers' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, id))
    .limit(1)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  // If role is 'pm', soft-delete any existing active PM for this request first.
  if (body.role === 'pm') {
    await drizzle
      .update(schema.requestParticipants)
      .set({ removedAt: new Date().toISOString() })
      .where(and(
        eq(schema.requestParticipants.requestId, id),
        eq(schema.requestParticipants.role, 'pm'),
        isNull(schema.requestParticipants.removedAt),
      ))
  }

  // De-dupe : if the same (id, type, role) is already active, return it.
  const [existing] = await drizzle
    .select()
    .from(schema.requestParticipants)
    .where(and(
      eq(schema.requestParticipants.requestId, id),
      eq(schema.requestParticipants.participantId, body.participantId),
      eq(schema.requestParticipants.participantType, body.participantType),
      eq(schema.requestParticipants.role, body.role),
      isNull(schema.requestParticipants.removedAt),
    ))
    .limit(1)
  if (existing) return NextResponse.json({ participant: existing })

  const newRow = {
    id: crypto.randomUUID(),
    requestId: id,
    participantId: body.participantId,
    participantType: body.participantType,
    role: body.role,
    addedById: userId,
    addedByType: 'team_member',
    addedAt: new Date().toISOString(),
    removedAt: null,
  }
  await drizzle.insert(schema.requestParticipants).values(newRow)

  return NextResponse.json({ participant: newRow }, { status: 201 })
}


import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, inArray, isNull } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface TeamItem {
  id: string
  name: string
  role: string
  avatarUrl: string | null
}

// ── GET /api/portal/team ─────────────────────────────────────────────────────
// The Tahi team assigned to this org — the client's "Your team" card. Derived
// from the org's external requests: the PM + assignees on request_participants
// plus each request's assigneeId. This is distinct from /api/portal/people,
// which lists the client's OWN contacts. Scoped to the caller's org; the Tahi
// admin org is rejected. Honest empty [] until anyone is assigned. Read-only.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1

  // The org's external (client-visible) requests define who is "on your work".
  let requestRows: Array<{ id: string; assigneeId: string | null }> = []
  try {
    requestRows = await drizzle
      .select({ id: schema.requests.id, assigneeId: schema.requests.assigneeId })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, orgId),
        eq(schema.requests.isInternal, false),
      ))
  } catch {
    requestRows = []
  }

  const requestIds = requestRows.map((r) => r.id)

  // memberId -> highest role seen. PM wins over assignee for the label.
  const roleByMember = new Map<string, 'pm' | 'assignee'>()

  // Direct assignees on the request row.
  for (const r of requestRows) {
    if (r.assigneeId && !roleByMember.has(r.assigneeId)) {
      roleByMember.set(r.assigneeId, 'assignee')
    }
  }

  // Participants (pm + assignee), which carry the richer PM signal.
  if (requestIds.length > 0) {
    try {
      const parts = await drizzle
        .select({
          participantId: schema.requestParticipants.participantId,
          role: schema.requestParticipants.role,
        })
        .from(schema.requestParticipants)
        .where(and(
          inArray(schema.requestParticipants.requestId, requestIds),
          eq(schema.requestParticipants.participantType, 'team_member'),
          isNull(schema.requestParticipants.removedAt),
        ))
      for (const p of parts) {
        if (p.role !== 'pm' && p.role !== 'assignee') continue
        const existing = roleByMember.get(p.participantId)
        if (p.role === 'pm' || !existing) roleByMember.set(p.participantId, p.role)
      }
    } catch {
      // request_participants unreadable — direct assignees still populate.
    }
  }

  if (roleByMember.size === 0) {
    return NextResponse.json({ items: [] })
  }

  const memberIds = [...roleByMember.keys()]
  let members: Array<{
    id: string
    name: string
    title: string | null
    department: string | null
    avatarUrl: string | null
  }> = []
  try {
    members = await drizzle
      .select({
        id: schema.teamMembers.id,
        name: schema.teamMembers.name,
        title: schema.teamMembers.title,
        department: schema.teamMembers.department,
        avatarUrl: schema.teamMembers.avatarUrl,
      })
      .from(schema.teamMembers)
      .where(inArray(schema.teamMembers.id, memberIds))
  } catch {
    members = []
  }

  const ranked = members
    .map((m) => {
      const isPm = roleByMember.get(m.id) === 'pm'
      const role = isPm ? 'Your lead' : (m.title?.trim() || m.department?.trim() || 'On your work')
      const item: TeamItem = { id: m.id, name: m.name, role, avatarUrl: m.avatarUrl ?? null }
      return { item, pm: isPm }
    })
    // Lead first, then alphabetical for a stable roster.
    .sort((a, b) => {
      if (a.pm !== b.pm) return a.pm ? -1 : 1
      return a.item.name.localeCompare(b.item.name)
    })

  const items: TeamItem[] = ranked.map((r) => r.item)

  return NextResponse.json({ items })
}

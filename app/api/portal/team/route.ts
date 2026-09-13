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

interface MemberRow {
  id: string
  name: string
  title: string | null
  department: string | null
  avatarUrl: string | null
}

const PM_LABEL = 'Your project manager'

// ── GET /api/portal/team ─────────────────────────────────────────────────────
// The Tahi team assigned to this org, the client's "Your team" card.
//
// First item, when there is one: the org's assigned project manager, read
// through the same team_member_access / team_member_access_orgs join that
// POST /api/admin/clients/[id]/pm writes (role='project_manager',
// scopeType='specific_clients'). This is the only "who owns this client"
// signal that does not depend on the org having any requests yet, so a
// freshly onboarded client with a PM but zero requests still sees a name
// instead of "being assigned".
//
// After the PM: everyone derived from the org's external requests (PM +
// assignees on request_participants, plus each request's assigneeId), same
// as before. The org PM is never duplicated into this second list.
//
// If nobody is assigned at all (no PM, no request activity), fall back to
// the studio's configured default owner - settings key
// leads.defaultLeadOwnerId, the same "default operator" convention already
// read by the delivery-watch / daily-summary / finance-anomaly-scan crons
// (see lib/notifications.ts resolveOwnerSetting). Never a hardcoded name or
// id. Only when that setting is also unset, or points at nobody real, does
// the card stay honestly empty.
//
// Distinct from /api/portal/people, which lists the client's OWN contacts.
// Scoped to the caller's org; the Tahi admin org is rejected. Read-only.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1

  // ── The org's assigned PM ──────────────────────────────────────────────────
  let pm: MemberRow | null = null
  try {
    const [row] = await drizzle
      .select({
        id: schema.teamMembers.id,
        name: schema.teamMembers.name,
        title: schema.teamMembers.title,
        department: schema.teamMembers.department,
        avatarUrl: schema.teamMembers.avatarUrl,
      })
      .from(schema.teamMemberAccess)
      .innerJoin(
        schema.teamMemberAccessOrgs,
        eq(schema.teamMemberAccessOrgs.accessId, schema.teamMemberAccess.id),
      )
      .innerJoin(
        schema.teamMembers,
        eq(schema.teamMembers.id, schema.teamMemberAccess.teamMemberId),
      )
      .where(and(
        eq(schema.teamMemberAccess.role, 'project_manager'),
        eq(schema.teamMemberAccessOrgs.orgId, orgId),
      ))
      .limit(1)
    pm = row ?? null
  } catch {
    pm = null
  }

  // ── Everyone else, derived from the org's external requests ───────────────
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
      // request_participants unreadable, direct assignees still populate.
    }
  }

  // The org's assigned PM is surfaced separately above; drop them here so
  // they never appear twice in the roster.
  if (pm) roleByMember.delete(pm.id)

  let members: MemberRow[] = []
  const memberIds = [...roleByMember.keys()]
  if (memberIds.length > 0) {
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
  }

  const ranked = members
    .map((m) => {
      const isPm = roleByMember.get(m.id) === 'pm'
      const role = isPm ? PM_LABEL : (m.title?.trim() || m.department?.trim() || 'On your work')
      const item: TeamItem = { id: m.id, name: m.name, role, avatarUrl: m.avatarUrl ?? null }
      return { item, pm: isPm }
    })
    // Lead first, then alphabetical for a stable roster.
    .sort((a, b) => {
      if (a.pm !== b.pm) return a.pm ? -1 : 1
      return a.item.name.localeCompare(b.item.name)
    })
    .map((r) => r.item)

  const items: TeamItem[] = pm
    ? [{ id: pm.id, name: pm.name, role: PM_LABEL, avatarUrl: pm.avatarUrl ?? null }, ...ranked]
    : ranked

  if (items.length > 0) {
    return NextResponse.json({ items })
  }

  // Truly nobody assigned or derived from a request: fall back to the
  // studio's configured default owner rather than showing an empty roster
  // for a client who does have a real point of contact, it is just not
  // recorded against this org yet.
  const fallback = await resolveDefaultOwner(drizzle)
  return NextResponse.json({ items: fallback ? [fallback] : [] })
}

// The same "default operator" setting read by the delivery-watch,
// daily-summary and finance-anomaly-scan crons (lib/notifications.ts
// resolveOwnerSetting) - never a hardcoded name or id. The stored value is
// either a teamMembers.id (the normal case) or a 'user_'-prefixed Clerk id
// (manual repoint); either way it must resolve to a real, still-existing
// team member or the fallback is skipped rather than showing a broken row.
async function resolveDefaultOwner(drizzle: D1): Promise<TeamItem | null> {
  try {
    const [setting] = await drizzle
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
      .limit(1)
    const raw = setting?.value?.trim()
    if (!raw) return null

    const memberSelect = {
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      avatarUrl: schema.teamMembers.avatarUrl,
    }
    const [member] = raw.startsWith('user_')
      ? await drizzle.select(memberSelect).from(schema.teamMembers).where(eq(schema.teamMembers.clerkUserId, raw)).limit(1)
      : await drizzle.select(memberSelect).from(schema.teamMembers).where(eq(schema.teamMembers.id, raw)).limit(1)

    if (!member) return null
    return { id: member.id, name: member.name, role: PM_LABEL, avatarUrl: member.avatarUrl ?? null }
  } catch {
    return null
  }
}

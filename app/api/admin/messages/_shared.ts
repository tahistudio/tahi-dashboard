/**
 * app/api/admin/messages/_shared.ts
 *
 * The gate every /api/admin/messages route runs, and the one place the studio
 * inbox decides which clients a caller may read.
 *
 * Three layers, in this order, none of them optional:
 *   1. getRequestAuth + isTahiAdmin      is this the studio at all
 *   2. requireFeature('messages')        granular permissions, the same
 *                                        FEATURE_TREE key the client side is
 *                                        gated on, so one switch governs both
 *   3. scopedOrgIds + isOrgInScope       WHICH clients, per team member
 *
 * Layer 3 is the one that matters for a hire. `scopedOrgIds` returns
 * { kind: 'all' } for the owner, super-admins, an explicit admin role and the
 * MCP service token, and { kind: 'some' | 'none' } for everybody else. A
 * scoped member reading the inbox sees threads for their own clients and
 * nothing else, and a thread they name by id is re-checked against the same
 * scope before a single message is read.
 */

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, ne } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { scopedOrgIds, type OrgScope } from '@/lib/access-scope'
import { isOrgInScope } from '../_scoping/org-scope'
import type { InboxViewer } from '@/lib/messages-store'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export const MESSAGES_FEATURE_KEY = 'messages'

/** How many clients the studio inbox spans in one read. */
export const STUDIO_ORG_CAP = 40

export interface AdminMessagesContext {
  database: DrizzleDB
  userId: string
  scope: OrgScope
  viewer: InboxViewer
}

export type AdminMessagesGate =
  | { ok: false; response: NextResponse }
  | { ok: true; ctx: AdminMessagesContext }

export async function gateAdminMessages(req: NextRequest): Promise<AdminMessagesGate> {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId) || !auth.userId) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const denied = await requireFeature(auth, MESSAGES_FEATURE_KEY)
  if (denied) return { ok: false, response: denied }

  const database = (await db()) as DrizzleDB
  const scope = await scopedOrgIds({ userId: auth.userId, orgId: auth.orgId })

  // Participants and message authors are stored by teamMembers.id, falling
  // back to the Clerk user id for a member with no row yet. Both ids are
  // carried so "my own message" is recognised either way.
  const [member] = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, auth.userId))
    .limit(1)

  return {
    ok: true,
    ctx: {
      database,
      userId: auth.userId,
      scope,
      viewer: {
        clerkUserId: auth.userId,
        domainId: member?.id ?? null,
        userType: 'team_member',
      },
    },
  }
}

/**
 * The clients this caller may read, newest activity first, capped.
 *
 * A restricted caller is narrowed in SQL rather than filtered afterwards, so
 * the cap is spent on clients they can actually see.
 */
export async function inboxOrgIds(
  database: DrizzleDB,
  scope: OrgScope,
  only: string | null,
): Promise<string[]> {
  if (scope.kind === 'none') return []
  if (only) return isOrgInScope(scope, only, 'deny') ? [only] : []

  const conditions = [ne(schema.organisations.status, 'archived')]
  if (scope.kind === 'some') {
    if (scope.orgIds.length === 0) return []
    conditions.push(inArray(schema.organisations.id, [...scope.orgIds]))
  }
  const rows = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(and(...conditions))
    .limit(STUDIO_ORG_CAP)

  // Re-tested against the scope after the read as well. The SQL narrowing
  // above is the fast path; this is the one that has to be right.
  return rows
    .map(r => r.id)
    .filter((id): id is string => !!id && isOrgInScope(scope, id, 'deny'))
}

/** Refuse a client the caller is not scoped to, in the standard shape. */
export function refuseOutOfScope(scope: OrgScope, orgId: string | null): NextResponse | null {
  if (isOrgInScope(scope, orgId, 'deny')) return null
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

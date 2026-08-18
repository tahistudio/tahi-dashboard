/**
 * lib/team-link-server.ts - D1 + Clerk wiring for lib/team-link.ts.
 *
 * Kept apart from the decision core so that core stays importable from a plain
 * Node test environment (@clerk/nextjs/server and next/headers are not, see
 * lib/__tests__/server-auth.test.ts).
 *
 * Called from app/(dashboard)/layout.tsx only. It is deliberately NOT wired
 * into any API route: the MCP service token and the crons must never trip a
 * link attempt, and a page layout is the one place we know a real human just
 * authenticated in a browser.
 */

import { clerkClient } from '@clerk/nextjs/server'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { resolveTeamLink, type TeamLinkResult } from '@/lib/team-link'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Link the signed-in Tahi user to their waiting team_members row, if there is
 * exactly one and it is unclaimed. Never throws and never creates a row, so a
 * Clerk or D1 hiccup degrades to "not linked yet" rather than a broken shell.
 */
export async function linkTeamMemberOnSignIn(
  userId: string | null,
  orgId: string | null,
): Promise<TeamLinkResult['outcome']> {
  try {
    const drizzle = (await db()) as unknown as Drizzle

    const res = await resolveTeamLink(
      {
        findLinkedMemberId: async (clerkUserId) => {
          const [row] = await drizzle
            .select({ id: schema.teamMembers.id })
            .from(schema.teamMembers)
            .where(eq(schema.teamMembers.clerkUserId, clerkUserId))
            .limit(1)
          return row?.id ?? null
        },

        loadVerifiedEmail: async () => {
          // Unreachable with a null userId: resolveTeamLink returns 'no_user'
          // before it ever calls this. Narrowed rather than cast.
          if (!userId) return { email: null, verified: false }
          const clerk = await clerkClient()
          const user = await clerk.users.getUser(userId)
          const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)
          return {
            email: primary?.emailAddress ?? null,
            verified: primary?.verification?.status === 'verified',
          }
        },

        // lower() on both sides: the roster is hand-entered, so casing between
        // the Clerk account and the row an admin typed will not always agree.
        findMembersByEmail: async (emailLower) => {
          const rows = await drizzle
            .select({
              id: schema.teamMembers.id,
              email: schema.teamMembers.email,
              clerkUserId: schema.teamMembers.clerkUserId,
            })
            .from(schema.teamMembers)
            .where(sql`lower(${schema.teamMembers.email}) = ${emailLower}`)
          return rows
        },

        // Compare-and-set: the WHERE clerk_user_id IS NULL is what makes this
        // safe under concurrent sign-ins and is why an existing link can never
        // be overwritten, whatever the caller decided.
        linkMember: async (teamMemberId, clerkUserId) => {
          const claimed = await drizzle
            .update(schema.teamMembers)
            .set({ clerkUserId, updatedAt: new Date().toISOString() })
            .where(and(
              eq(schema.teamMembers.id, teamMemberId),
              isNull(schema.teamMembers.clerkUserId),
            ))
            .returning({ id: schema.teamMembers.id })
          return claimed.length > 0
        },

        recordOutcome: async (outcome) => {
          if (outcome.outcome === 'linked') {
            await logAudit(drizzle as unknown as DB, {
              action: 'team_member.login_linked',
              userId,
              entityType: 'team_member',
              entityId: outcome.teamMemberId,
              metadata: { email: outcome.email, matchedBy: 'verified_email' },
            })
            return
          }
          // Operator-visible misconfiguration: a duplicate roster email, or a
          // row already claimed by someone else. Logged rather than written so
          // a repeated page load cannot flood the audit table.
          console.error(
            '[team-link] not linked:',
            outcome.outcome,
            JSON.stringify({ email: outcome.email, matchedIds: outcome.matchedIds }),
          )
        },
      },
      { userId, orgId, tahiOrgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID },
    )

    return res.outcome
  } catch (err) {
    console.error('[team-link] link attempt failed:', err)
    return 'no_match'
  }
}

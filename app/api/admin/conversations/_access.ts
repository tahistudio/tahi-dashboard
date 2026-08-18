/**
 * app/api/admin/conversations/_access.ts
 *
 * Access guard for a single conversation.
 *
 * INTERNAL-CONVERSATION RULE: participation is the primary gate and it is the
 * only gate for a Tahi-internal thread (orgId null), because being added to a
 * thread is itself the grant. A thread that carries an orgId is client data, so
 * it must additionally clear the member's org scope: a stale participant row
 * left over from before their scope was narrowed must not keep another client's
 * thread readable or postable.
 */

import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { scopedOrgIds } from '@/lib/access-scope'
import { isOrgInScope } from '../_scoping/org-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type Auth = { userId: string; orgId: string | null }
type ConversationRow = typeof schema.conversations.$inferSelect

export type ConversationAccess =
  | { ok: false; response: NextResponse }
  | { ok: true; participantId: string; conversation: ConversationRow }

export async function requireConversationAccess(
  database: D1,
  auth: Auth,
  conversationId: string,
): Promise<ConversationAccess> {
  // Participants are stored by teamMembers.id, falling back to the Clerk user
  // id for team members that have no row yet.
  const [teamMember] = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, auth.userId))
    .limit(1)
  const participantId = teamMember?.id ?? auth.userId

  const [participant] = await database
    .select({ id: schema.conversationParticipants.id })
    .from(schema.conversationParticipants)
    .where(and(
      eq(schema.conversationParticipants.conversationId, conversationId),
      eq(schema.conversationParticipants.participantId, participantId),
    ))
    .limit(1)

  if (!participant) {
    return { ok: false, response: NextResponse.json({ error: 'Not a participant' }, { status: 403 }) }
  }

  const [conversation] = await database
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1)

  if (!conversation) {
    return { ok: false, response: NextResponse.json({ error: 'Conversation not found' }, { status: 404 }) }
  }

  const scope = await scopedOrgIds(auth)
  if (!isOrgInScope(scope, conversation.orgId, 'allow')) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { ok: true, participantId, conversation }
}

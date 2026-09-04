/**
 * lib/notify-request-team.ts
 *
 * Fan a client-originated event on a request out to the whole studio side of
 * that request, not just its assignee.
 *
 * Why: a request has no assignee for the whole window between submission and
 * triage, which is exactly when a client's first message and their review
 * verdict arrive. Notifying only `requests.assigneeId` meant those landed in
 * silence (ship readiness audit, Tier 1 item 13).
 *
 * Audience, in order of specificity:
 *   1. the request's assignee (requests.assigneeId)
 *   2. every team_member participant on the request (pm / assignee / follower,
 *      not soft-removed)
 *   3. the client's project manager (a project_manager access rule linked to
 *      the org, the same join /api/admin/clients/[id]/pm reads)
 * and when none of those resolve, every Tahi team member with a linked login,
 * so an untriaged request still reaches a human.
 *
 * Never throws: notification failures must not fail the client's action.
 */

import { schema } from '@/db/d1'
import { and, eq, isNull } from 'drizzle-orm'
import {
  createNotifications,
  notifyAllAdmins,
  type NotificationEntityType,
  type NotificationEventType,
} from '@/lib/notifications'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface RequestTeamPayload {
  type: NotificationEventType
  title: string
  body?: string | null
  entityType?: NotificationEntityType | null
  entityId?: string | null
}

export interface RequestTeamTarget {
  requestId: string
  /** The client org the request belongs to. Used for the PM lookup. */
  orgId: string
  /** requests.assigneeId, when the request has been triaged. */
  assigneeId?: string | null
}

/**
 * Collect the teamMembers.id set that should hear about a request. Pure over
 * its two queries so it can be tested without the notification plumbing.
 * Returns an empty array (never throws) when both lookups fail.
 */
export async function resolveRequestTeamMemberIds(
  database: DrizzleDB,
  target: RequestTeamTarget,
): Promise<string[]> {
  const ids = new Set<string>()
  if (target.assigneeId) ids.add(target.assigneeId)

  try {
    const participants = await database
      .select({
        participantId: schema.requestParticipants.participantId,
        participantType: schema.requestParticipants.participantType,
      })
      .from(schema.requestParticipants)
      .where(and(
        eq(schema.requestParticipants.requestId, target.requestId),
        isNull(schema.requestParticipants.removedAt),
      ))
    for (const p of participants) {
      // Contacts on the thread are the client's own people: they must not be
      // told about their own message.
      if (p.participantType === 'team_member' && p.participantId) ids.add(p.participantId)
    }
  } catch {
    // participants unreadable: fall through to the PM / studio tiers.
  }

  try {
    const pms = await database
      .select({ pmId: schema.teamMemberAccess.teamMemberId })
      .from(schema.teamMemberAccess)
      .innerJoin(
        schema.teamMemberAccessOrgs,
        eq(schema.teamMemberAccessOrgs.accessId, schema.teamMemberAccess.id),
      )
      .where(and(
        eq(schema.teamMemberAccess.role, 'project_manager'),
        eq(schema.teamMemberAccessOrgs.orgId, target.orgId),
      ))
    for (const pm of pms) if (pm.pmId) ids.add(pm.pmId)
  } catch {
    // access rules unreadable: fall through to the studio fallback.
  }

  return [...ids]
}

/**
 * Notify the request's studio side. Falls back to every Tahi team member when
 * nobody specific resolves, or when every specific recipient turns out to have
 * no linked Clerk login (an assignee row that has never signed in would
 * otherwise swallow the ping).
 *
 * A recipient who muted this event's in-app channel is NOT a fallback trigger:
 * that is a deliberate preference, and blasting the whole studio would override
 * it. Only unresolvable identity (skipped === everyone) escalates.
 */
export async function notifyRequestTeam(
  database: DrizzleDB,
  target: RequestTeamTarget,
  payload: RequestTeamPayload,
): Promise<void> {
  try {
    const memberIds = await resolveRequestTeamMemberIds(database, target)
    if (memberIds.length > 0) {
      const result = await createNotifications(
        database,
        memberIds.map((teamMemberId) => ({ teamMemberId })),
        payload,
      )
      if (result.skipped < memberIds.length) return
    }
    await notifyAllAdmins(database, payload)
  } catch (err) {
    console.error('[notifyRequestTeam] failed:', err)
  }
}

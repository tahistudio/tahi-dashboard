/**
 * lib/request-participants.ts
 *
 * The people on a request. `request_participants` holds the pm / assignee /
 * follower cast that the kanban card's people row and the timeline label
 * both draw, and it points at two different identity tables depending on
 * whether the participant is one of the Tahi team or a contact at the
 * client. This resolves both in a single query over a page of request ids,
 * so a list route stays at a fixed number of round trips however many
 * requests came back.
 *
 * Admin callers take the default: every role, team and contacts alike.
 * The portal narrows it, matching the policy `/api/portal/team` already
 * follows: team members only in the pm and assignee roles, and contacts
 * only from the caller's own org.
 */

import { schema } from '@/db/d1'
import { and, eq, inArray, isNull } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export type RequestParticipantRole = 'pm' | 'assignee' | 'follower'

export interface RequestParticipant {
  id: string
  type: 'team_member' | 'contact'
  role: RequestParticipantRole
  name: string
  avatarUrl: string | null
}

/** PM first, then the assignee, then followers. A card shows three and folds
 *  the rest into a "+N", so this order decides who stays visible. */
const ROLE_ORDER: Record<RequestParticipantRole, number> = { pm: 0, assignee: 1, follower: 2 }

/** How many request ids go into one IN clause. Kept well under D1's cap on
 *  bound parameters per query. */
const ID_BATCH_SIZE = 80

export const ALL_PARTICIPANT_ROLES: readonly RequestParticipantRole[] = ['pm', 'assignee', 'follower']

/** What a client is allowed to see of the internal cast. Followers are held
 *  back, so an internal watcher never leaks into the portal. */
export const CLIENT_VISIBLE_TEAM_ROLES: readonly RequestParticipantRole[] = ['pm', 'assignee']

export interface LoadParticipantsOptions {
  /** Roles to return for team members. Defaults to all three. */
  teamRoles?: readonly RequestParticipantRole[]
  /** Roles to return for contacts. Defaults to all three. */
  contactRoles?: readonly RequestParticipantRole[]
  /** When set, only contacts belonging to this org are returned. The portal
   *  passes the caller's org so a request can never surface a person from
   *  another client. */
  contactOrgId?: string | null
}

function isParticipantRole(value: string): value is RequestParticipantRole {
  return value === 'pm' || value === 'assignee' || value === 'follower'
}

export async function loadRequestParticipants(
  drizzle: Drizzle,
  requestIds: readonly string[],
  options: LoadParticipantsOptions = {},
): Promise<Map<string, RequestParticipant[]>> {
  const byRequest = new Map<string, RequestParticipant[]>()
  if (requestIds.length === 0) return byRequest

  const teamRoles = options.teamRoles ?? ALL_PARTICIPANT_ROLES
  const contactRoles = options.contactRoles ?? ALL_PARTICIPANT_ROLES
  const contactOrgId = options.contactOrgId ?? null

  let rows: Array<{
    requestId: string
    participantId: string
    participantType: string
    role: string
    teamName: string | null
    teamAvatarUrl: string | null
    contactName: string | null
    contactOrgId: string | null
  }>
  try {
    // D1 caps bound parameters per query, and a list route can ask for up
    // to 500 requests at once, so the id set goes in batches that run
    // together rather than one query with 500 placeholders.
    const batches: string[][] = []
    for (let i = 0; i < requestIds.length; i += ID_BATCH_SIZE) {
      batches.push(requestIds.slice(i, i + ID_BATCH_SIZE))
    }
    const results = await Promise.all(batches.map(ids => drizzle
      .select({
        requestId: schema.requestParticipants.requestId,
        participantId: schema.requestParticipants.participantId,
        participantType: schema.requestParticipants.participantType,
        role: schema.requestParticipants.role,
        teamName: schema.teamMembers.name,
        teamAvatarUrl: schema.teamMembers.avatarUrl,
        contactName: schema.contacts.name,
        contactOrgId: schema.contacts.orgId,
      })
      .from(schema.requestParticipants)
      .leftJoin(schema.teamMembers, and(
        eq(schema.requestParticipants.participantType, 'team_member'),
        eq(schema.requestParticipants.participantId, schema.teamMembers.id),
      ))
      .leftJoin(schema.contacts, and(
        eq(schema.requestParticipants.participantType, 'contact'),
        eq(schema.requestParticipants.participantId, schema.contacts.id),
      ))
      .where(and(
        inArray(schema.requestParticipants.requestId, ids),
        isNull(schema.requestParticipants.removedAt),
      ))))
    rows = results.flat()
  } catch {
    // request_participants unreadable. Cards fall back to the assignee on
    // the request row, exactly as they did before this join existed.
    return byRequest
  }

  for (const row of rows) {
    if (!isParticipantRole(row.role)) continue
    const isTeam = row.participantType === 'team_member'
    if (isTeam ? !teamRoles.includes(row.role) : !contactRoles.includes(row.role)) continue
    if (!isTeam && contactOrgId !== null && row.contactOrgId !== contactOrgId) continue

    const name = (isTeam ? row.teamName : row.contactName)?.trim()
    // A participant whose identity row is gone would draw a blank bubble,
    // so it is dropped rather than shown as an anonymous avatar.
    if (!name) continue

    const list = byRequest.get(row.requestId) ?? []
    // One person holding two roles reads as a single avatar, labelled with
    // the more senior of the two.
    const existing = list.find(p => p.id === row.participantId)
    if (existing) {
      if (ROLE_ORDER[row.role] < ROLE_ORDER[existing.role]) existing.role = row.role
      continue
    }
    list.push({
      id: row.participantId,
      type: isTeam ? 'team_member' : 'contact',
      role: row.role,
      name,
      // Contacts carry no avatar column, so they render as initials.
      avatarUrl: isTeam ? row.teamAvatarUrl : null,
    })
    byRequest.set(row.requestId, list)
  }

  for (const list of byRequest.values()) {
    list.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name))
  }
  return byRequest
}

/** Human label for a role, used in the card and timeline tooltips. */
export const PARTICIPANT_ROLE_LABEL: Record<RequestParticipantRole, string> = {
  pm: 'Project manager',
  assignee: 'Assignee',
  follower: 'Follower',
}

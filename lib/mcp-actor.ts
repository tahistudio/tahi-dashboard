/**
 * lib/mcp-actor.ts - the RECORDED actor behind a worker MCP call.
 *
 * The MCP worker calls the dashboard with the shared TAHI_API_TOKEN, which
 * getRequestAuth maps to userId 'api-service'. When it also sends a verified
 * per-call actor envelope, `auth.mcpActor` names the real team member.
 *
 * INVARIANT: this is the recorded actor only (createdById, authorId, audit
 * userId, timer owner, read cursor). It is NEVER an authorisation input. Every
 * requireFeature / scopedOrgIds / resolvePermissions / isService check keeps
 * using `auth.userId`, which stays 'api-service' for these calls.
 */

import type { McpActor } from '@/lib/server-auth'

/**
 * The userId getRequestAuth mints for a verified TAHI_API_TOKEN. Kept as a
 * local literal (the same value as SERVICE_USER_ID in lib/team-identity.ts) so
 * this module imports nothing at runtime and survives tests that mock
 * team-identity.
 */
const SERVICE_USER_ID = 'api-service'

interface ActorBearingAuth {
  userId: string | null
  mcpActor?: McpActor | null
}

/** Clerk user id to record as the actor: the MCP person when present, else the caller. */
export function attributedUserId(auth: ActorBearingAuth): string | null {
  if (auth.userId === SERVICE_USER_ID && auth.mcpActor) return auth.mcpActor.clerkUserId
  return auth.userId
}

/** team_members.id of the MCP person, or null when there is no verified actor. */
export function attributedTeamMemberId(auth: ActorBearingAuth): string | null {
  if (auth.userId === SERVICE_USER_ID && auth.mcpActor) return auth.mcpActor.teamMemberId
  return null
}

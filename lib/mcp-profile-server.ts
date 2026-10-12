/**
 * lib/mcp-profile-server.ts - who may connect Claude, and as what.
 *
 * team_members.mcp_profile ('full' | 'designer' | NULL) is deliberately NOT in
 * db/schema.ts, so a deploy that lands before migration 0112 cannot break any
 * full-row select of team_members. It is read here through raw SQL, and a
 * missing column reads as "no profile": the connector fails closed.
 */

import { sql } from 'drizzle-orm'
import { createClerkClient } from '@clerk/backend'
import { isTahiAdmin } from '@/lib/server-auth'
import { SERVICE_USER_ID } from '@/lib/team-identity'
import { parseMcpProfile, type McpProfile } from '@/lib/mcp-identity'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface McpMember {
  teamMemberId: string
  name: string
  email: string
  clerkUserId: string | null
  profile: McpProfile | null
}

interface McpMemberRow {
  id: string
  name: string
  email: string
  clerk_user_id: string | null
  mcp_profile?: string | null
}

function isMissingColumnError(err: unknown): boolean {
  let current: unknown = err
  for (let depth = 0; depth < 4 && current; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (message.includes('no such column')) return true
    current = current instanceof Error ? (current as Error & { cause?: unknown }).cause : null
  }
  return false
}

function toMember(row: McpMemberRow | undefined): McpMember | null {
  if (!row) return null
  return {
    teamMemberId: row.id,
    name: row.name,
    email: row.email,
    clerkUserId: row.clerk_user_id ?? null,
    profile: parseMcpProfile(row.mcp_profile),
  }
}

async function readMember(
  database: DrizzleDB,
  column: 'id' | 'clerk_user_id',
  value: string,
): Promise<McpMember | null> {
  const where = column === 'id' ? sql`id = ${value}` : sql`clerk_user_id = ${value}`
  try {
    const rows = await database.all<McpMemberRow>(
      sql`SELECT id, name, email, clerk_user_id, mcp_profile FROM team_members WHERE ${where} LIMIT 1`,
    )
    return toMember(rows[0])
  } catch (err) {
    // Any other failure is thrown, not read as "no such person": the worker's
    // refresh check turns a 5xx into a retry, while a false "inactive" would
    // force the person through consent again over a transient D1 error.
    if (!isMissingColumnError(err)) throw err
    try {
      // Migration 0112 not applied yet: the person exists, no profile.
      const rows = await database.all<McpMemberRow>(
        sql`SELECT id, name, email, clerk_user_id FROM team_members WHERE ${where} LIMIT 1`,
      )
      return toMember(rows[0])
    } catch {
      return null
    }
  }
}

export function readMcpMemberByClerkUserId(database: DrizzleDB, clerkUserId: string): Promise<McpMember | null> {
  return readMember(database, 'clerk_user_id', clerkUserId)
}

/**
 * Whether this Clerk user still belongs to the Tahi Studio Clerk org. Throws on
 * any Clerk failure so callers can answer 5xx (retry) rather than treat an
 * outage as a revocation. The limit is generous so one page holds every
 * membership a person could realistically have.
 */
export async function isClerkUserInTahiOrg(clerkUserId: string): Promise<boolean> {
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!tahiOrgId) throw new Error('NEXT_PUBLIC_TAHI_ORG_ID is not configured')
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY!,
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  })
  const memberships = await clerk.users.getOrganizationMembershipList({ userId: clerkUserId, limit: 500 })
  return memberships.data.some((m) => m.organization.id === tahiOrgId)
}

export function readMcpMemberById(database: DrizzleDB, teamMemberId: string): Promise<McpMember | null> {
  return readMember(database, 'id', teamMemberId)
}

export type McpConsentIneligibleReason =
  | 'not_signed_in'
  | 'not_studio'
  | 'service_token'
  | 'no_team_member'
  | 'no_profile'

export type McpConsentEligibility =
  | { ok: true; member: McpMember; profile: McpProfile }
  | { ok: false; reason: McpConsentIneligibleReason }

export async function resolveMcpConsentEligibility(
  database: DrizzleDB,
  auth: { userId: string | null; orgId: string | null },
): Promise<McpConsentEligibility> {
  if (!auth.userId) return { ok: false, reason: 'not_signed_in' }
  if (auth.userId === SERVICE_USER_ID) return { ok: false, reason: 'service_token' }
  if (!isTahiAdmin(auth.orgId)) return { ok: false, reason: 'not_studio' }
  const member = await readMcpMemberByClerkUserId(database, auth.userId)
  if (!member) return { ok: false, reason: 'no_team_member' }
  if (!member.profile) return { ok: false, reason: 'no_profile' }
  return { ok: true, member, profile: member.profile }
}

/**
 * The worker callback URL from a verified consent request. https only, with
 * http allowed solely for localhost and 127.0.0.1 (local worker dev). Null for
 * anything else, including URLs carrying credentials.
 */
export function parseConsentCallback(cb: string): URL | null {
  let url: URL
  try {
    url = new URL(cb)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol === 'https:') return url
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url
  return null
}

/** `${cb}` with the given query params set (never string concatenation). */
export function buildConsentRedirect(cb: URL, params: Record<string, string>): string {
  const target = new URL(cb.toString())
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
  return target.toString()
}

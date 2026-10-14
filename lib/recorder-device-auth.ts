import { sql } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import type { DB } from '@/db/d1'
import type { RequestAuthResult } from '@/lib/server-auth'
import { resolvePermissions } from '@/lib/permissions'
import { isClerkUserInTahiOrg } from '@/lib/mcp-profile-server'
import { isRecorderDeviceBearer } from '@/lib/recorder-device-routes'

export const RECORDER_TOKEN_PREFIX = 'tahi_rec_'
const MEMBERSHIP_CACHE_MS = 15 * 60_000
const LAST_SEEN_INTERVAL_MS = 5 * 60_000
const IDLE_EXPIRY_MS = 30 * 24 * 60 * 60_000

export interface RecorderDeviceAuth extends RequestAuthResult {
  userId: string
  orgId: string
  sessionId: null
  recorderDevice: { id: string; teamMemberId: string }
}

/** A membership outage must retain the device and its local audio for retry. */
export class RecorderDeviceAuthError extends Error {
  readonly status = 503
  readonly retryAfter = 30
  constructor() { super('Device membership could not be checked. Retry shortly.') }
}

export function isRecorderDeviceRequest(req: Pick<NextRequest, 'headers'>): boolean {
  return isRecorderDeviceBearer(req.headers.get('authorization'))
}

/** SHA-256 is shared by pairing and auth; neither secret is stored in plaintext. */
export async function hashRecorderSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

interface DeviceRow {
  id: string
  team_member_id: string
  created_at: string
  last_seen_at: string | null
  membership_checked_at: string | null
  revoked_at: string | null
}

async function revoke(database: DB, id: string, now: string, reason: string): Promise<void> {
  await database.run(sql`UPDATE recorder_devices SET revoked_at = ${now}, revoked_reason = ${reason}
    WHERE id = ${id} AND revoked_at IS NULL`)
}

/** Called only by opted-in recording handlers after ordinary authentication failed. */
export async function getRecorderDeviceAuth(req: NextRequest): Promise<RecorderDeviceAuth | null> {
  if (!isRecorderDeviceRequest(req)) return null
  const token = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('authorization')!)?.[1] ?? ''
  if (!/^tahi_rec_[A-Za-z0-9_-]{43}$/.test(token)) return null
  const orgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!orgId) return null
  const database = await db()
  const [device] = await database.all<DeviceRow>(sql`SELECT id, team_member_id, created_at,
    last_seen_at, membership_checked_at, revoked_at FROM recorder_devices
    WHERE token_hash = ${await hashRecorderSecret(token)} LIMIT 1`)
  if (!device || device.revoked_at) return null

  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  const lastSeen = Date.parse(device.last_seen_at ?? device.created_at)
  if (!Number.isFinite(lastSeen) || nowMs - lastSeen >= IDLE_EXPIRY_MS) {
    await revoke(database, device.id, now, 'idle_expiry')
    return null
  }
  const [member] = await database.all<{ clerk_user_id: string | null }>(sql`SELECT clerk_user_id
    FROM team_members WHERE id = ${device.team_member_id} LIMIT 1`)
  if (!member?.clerk_user_id) return null
  const identity: RecorderDeviceAuth = {
    userId: member.clerk_user_id, orgId, sessionId: null,
    recorderDevice: { id: device.id, teamMemberId: device.team_member_id },
  }
  if (!(await resolvePermissions(database, identity)).isAdmin) return null

  const checkedAt = Date.parse(device.membership_checked_at ?? '')
  if (!Number.isFinite(checkedAt) || nowMs - checkedAt >= MEMBERSHIP_CACHE_MS) {
    let belongs: boolean
    try { belongs = await isClerkUserInTahiOrg(member.clerk_user_id) }
    catch { throw new RecorderDeviceAuthError() }
    if (!belongs) {
      await revoke(database, device.id, now, 'membership_removed')
      return null
    }
    await database.run(sql`UPDATE recorder_devices SET membership_checked_at = ${now}
      WHERE id = ${device.id} AND revoked_at IS NULL`)
  }
  // The SQL predicate also throttles concurrent requests using the same device.
  if (nowMs - lastSeen >= LAST_SEEN_INTERVAL_MS) {
    const cutoff = new Date(nowMs - LAST_SEEN_INTERVAL_MS).toISOString()
    await database.run(sql`UPDATE recorder_devices SET last_seen_at = ${now}
      WHERE id = ${device.id} AND revoked_at IS NULL
      AND (last_seen_at IS NULL OR last_seen_at <= ${cutoff})`)
  }
  return identity
}

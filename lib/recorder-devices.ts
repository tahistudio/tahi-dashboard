import { sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { DB } from '@/db/d1'
import { getRequestAuth, isTahiAdmin, type RequestAuthResult } from '@/lib/server-auth'
import { resolvePermissions } from '@/lib/permissions'
import { attributedTeamMemberId, attributedUserId } from '@/lib/mcp-actor'
import { hashRecorderSecret, isRecorderDeviceRequest, RECORDER_TOKEN_PREFIX, RecorderDeviceAuthError } from '@/lib/recorder-device-auth'
import { isClerkUserInTahiOrg } from '@/lib/mcp-profile-server'
import { logAudit } from '@/lib/audit'
import { hashRecorderPairingIp } from '@/lib/recorder-pairing-security'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LIFETIME_MS = 10 * 60_000
const ATTEMPT_WINDOW_MS = 15 * 60_000
const ATTEMPT_RETENTION_MS = 24 * 60 * 60_000

export class RecorderDevicesError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

interface DevicesContext { database: DB; auth: RequestAuthResult; teamMemberId: string }

/** Authorize the caller first. A verified MCP actor only scopes their own rows. */
export async function withRecorderDevicesContext(
  req: NextRequest,
  work: (context: DevicesContext) => Promise<NextResponse>,
  clerkSessionOnly = false,
): Promise<NextResponse> {
  return recorderDevicesResponse(async () => {
    if (isRecorderDeviceRequest(req)) throw new RecorderDevicesError('Unauthorised', 401)
    const auth = await getRequestAuth(req)
    if (!auth.userId) throw new RecorderDevicesError('Unauthorised', 401)
    if (auth.userId === 'api-service' && auth.mcpActor?.profile === 'designer') throw new RecorderDevicesError('Forbidden', 403)
    if (!isTahiAdmin(auth.orgId)) throw new RecorderDevicesError('Forbidden', 403)
    if (clerkSessionOnly && (auth.userId === 'api-service' || !auth.sessionId?.startsWith('sess_') || req.headers.has('authorization'))) {
      throw new RecorderDevicesError('Pairing requires your signed-in Clerk session.', 403)
    }
    const database = await db()
    if (!(await resolvePermissions(database, auth)).isAdmin) throw new RecorderDevicesError('Forbidden', 403)
    const actorMemberId = attributedTeamMemberId(auth)
    const [member] = actorMemberId
      ? await database.all<{ id: string }>(sql`SELECT id FROM team_members WHERE id = ${actorMemberId} LIMIT 1`)
      : await database.all<{ id: string }>(sql`SELECT id FROM team_members WHERE clerk_user_id = ${auth.userId} LIMIT 1`)
    if (!member) throw new RecorderDevicesError('A linked team member is required.', 403)
    return work({ database, auth, teamMemberId: member.id })
  })
}

export async function recorderDevicesResponse(work: () => Promise<NextResponse>): Promise<NextResponse> {
  try { return await work() }
  catch (error) {
    if (error instanceof RecorderDevicesError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof RecorderDeviceAuthError) return NextResponse.json({ error: error.message }, { status: 503, headers: { 'Retry-After': String(error.retryAfter) } })
    console.error('Recorder device operation failed:', error)
    return NextResponse.json({ error: 'The recorder device operation failed. Retry shortly.' }, { status: 503 })
  }
}

export async function listRecorderDevices({ database, teamMemberId }: DevicesContext) {
  return database.all<{ id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null; revokedReason: string | null }>(
    sql`SELECT id, name, created_at AS createdAt, last_seen_at AS lastSeenAt,
      revoked_at AS revokedAt, revoked_reason AS revokedReason FROM recorder_devices
      WHERE team_member_id = ${teamMemberId} ORDER BY created_at DESC`,
  )
}

export async function createRecorderPairingCode({ database, auth, teamMemberId }: DevicesContext) {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => CODE_ALPHABET[byte & 31]).join('')
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + CODE_LIFETIME_MS).toISOString()
  // A replacement expires every earlier unused code atomically with its insert.
  await database.$client.batch([
    database.$client.prepare(`UPDATE recorder_pairing_codes SET expires_at = ?
      WHERE team_member_id = ? AND used_at IS NULL`).bind(now, teamMemberId),
    database.$client.prepare(`INSERT INTO recorder_pairing_codes (code_hash, team_member_id, created_by_user_id, expires_at)
      VALUES (?, ?, ?, ?)`).bind(await hashRecorderSecret(code), teamMemberId, auth.userId, expiresAt),
  ])
  await logAudit(database, {
    userId: attributedUserId(auth), action: 'recorder_device.pairing_code_created', entityType: 'team_member', entityId: teamMemberId,
  })
  return { code, expiresAt }
}

export async function revokeRecorderDevice(context: DevicesContext, id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new RecorderDevicesError('Invalid device id.', 400)
  const rows = await context.database.all<{ id: string }>(sql`UPDATE recorder_devices
    SET revoked_at = COALESCE(revoked_at, ${new Date().toISOString()}), revoked_reason = COALESCE(revoked_reason, 'user_revoked')
    WHERE id = ${id} AND team_member_id = ${context.teamMemberId} RETURNING id`)
  if (!rows.length) throw new RecorderDevicesError('Recorder device not found.', 404)
  await logAudit(context.database, {
    userId: attributedUserId(context.auth), action: 'recorder_device.revoked', entityType: 'recorder_device', entityId: id,
  })
  return { success: true }
}

function tokenSecret(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function exchangeRecorderPairingCode(req: NextRequest): Promise<NextResponse> {
  const database = await db()
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString()
  // Cloudflare supplies this header. Forwarded-for is caller-controlled and is never used.
  const ipHash = await hashRecorderPairingIp(req.headers.get('cf-connecting-ip'))
  const attemptId = crypto.randomUUID()
  const cutoff = new Date(nowMs - ATTEMPT_WINDOW_MS).toISOString()
  await database.run(sql`DELETE FROM recorder_pairing_attempts WHERE attempted_at < ${new Date(nowMs - ATTEMPT_RETENTION_MS).toISOString()}`)
  // Reserve a failed attempt atomically before validating. Concurrent guesses cannot bypass the count.
  const attempts = await database.all<{ id: string }>(sql`INSERT INTO recorder_pairing_attempts (id, ip_hash, attempted_at, succeeded)
    SELECT ${attemptId}, ${ipHash}, ${now}, 0 WHERE
    (SELECT COUNT(*) FROM recorder_pairing_attempts WHERE ip_hash = ${ipHash} AND attempted_at > ${cutoff} AND succeeded = 0) < 5
    AND (SELECT COUNT(*) FROM recorder_pairing_attempts WHERE attempted_at > ${cutoff} AND succeeded = 0) < 50 RETURNING id`)
  if (!attempts.length) return NextResponse.json({ error: 'Too many pairing attempts. Try again in 15 minutes.' }, { status: 429, headers: { 'Retry-After': '900' } })
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new RecorderDevicesError('Enter a pairing code and device name.', 400)
  const values = body as Record<string, unknown>
  const code = typeof values.code === 'string' ? values.code.trim().toUpperCase() : ''
  const name = typeof values.deviceName === 'string' ? values.deviceName.trim() : ''
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new RecorderDevicesError('Device name must contain 1 to 100 characters.', 400)
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new RecorderDevicesError('The pairing code is invalid or expired.', 400)
  const codeHash = await hashRecorderSecret(code)
  const [owner] = await database.all<{ team_member_id: string; clerk_user_id: string | null }>(sql`SELECT c.team_member_id, m.clerk_user_id
    FROM recorder_pairing_codes c INNER JOIN team_members m ON m.id = c.team_member_id
    WHERE c.code_hash = ${codeHash} AND c.used_at IS NULL AND c.expires_at > ${now} LIMIT 1`)
  const orgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (!owner?.clerk_user_id || !orgId || !(await resolvePermissions(database, { userId: owner.clerk_user_id, orgId })).isAdmin) {
    throw new RecorderDevicesError('The pairing code is invalid or expired.', 400)
  }
  let belongs: boolean
  try { belongs = await isClerkUserInTahiOrg(owner.clerk_user_id) }
  catch { throw new RecorderDeviceAuthError() }
  if (!belongs) throw new RecorderDevicesError('The pairing code is invalid or expired.', 400)

  const id = crypto.randomUUID()
  const token = RECORDER_TOKEN_PREFIX + tokenSecret()
  const tokenHash = await hashRecorderSecret(token)
  // Clerk is an external call: re-evaluate expiry at consumption, not at request arrival.
  const consumeNow = new Date().toISOString()
  // D1 batches are transactional: a failed insert cannot consume the code without saving the token hash.
  const [consumed] = await database.$client.batch([
    database.$client.prepare(`UPDATE recorder_pairing_codes SET used_at = ?, used_by_device_id = ?
      WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING team_member_id`).bind(consumeNow, id, codeHash, consumeNow),
    database.$client.prepare(`INSERT INTO recorder_devices
      (id, team_member_id, name, token_hash, created_at, last_seen_at, membership_checked_at)
      SELECT ?, team_member_id, ?, ?, ?, ?, ? FROM recorder_pairing_codes
      WHERE code_hash = ? AND used_by_device_id = ? AND used_at = ?`).bind(id, name, tokenHash, consumeNow, consumeNow, consumeNow, codeHash, id, consumeNow),
    database.$client.prepare(`UPDATE recorder_pairing_attempts SET succeeded = 1 WHERE id = ?
      AND EXISTS (SELECT 1 FROM recorder_devices WHERE id = ?)`).bind(attemptId, id),
  ])
  if (!consumed.results.length) throw new RecorderDevicesError('The pairing code is invalid or expired.', 400)
  await logAudit(database, {
    userId: owner.clerk_user_id, action: 'recorder_device.paired', entityType: 'recorder_device', entityId: id,
  })
  return NextResponse.json({ token, device: { id, name } }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}

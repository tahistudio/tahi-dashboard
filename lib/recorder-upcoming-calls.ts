import { eq } from 'drizzle-orm'
import { schema, type DB } from '@/db/d1'
import type { RequestAuthResult } from '@/lib/server-auth'
import { resolveCallOrgId } from '@/lib/call-transcripts'
import { requireAccessToOrgOrPreClient } from '@/lib/require-access'

export interface RecorderUpcomingCall {
  id: string
  kind: 'discovery' | 'scheduled'
  title: string
  startMs: number
  endMs: number
  platform: 'zoom' | 'meet' | 'teams' | 'unknown'
}

interface CallCandidate {
  id: string
  title: string | null
  scheduledAt: string
  durationMinutes: number
  attendees: string
  status: string
  meetingUrl: string | null
}

function attends(attendees: string, email: string): boolean {
  try {
    const parsed: unknown = JSON.parse(attendees)
    return Array.isArray(parsed) && parsed.some(value => value && typeof value === 'object'
      && 'email' in value && typeof value.email === 'string' && value.email.trim().toLowerCase() === email)
  } catch { return false }
}

export function recorderMeetingPlatform(value: string | null): RecorderUpcomingCall['platform'] {
  if (!value) return 'unknown'
  try {
    const host = new URL(value).hostname.toLowerCase()
    if (host === 'zoom.us' || host.endsWith('.zoom.us') || host === 'zoom.com' || host.endsWith('.zoom.com')) return 'zoom'
    if (host === 'meet.google.com') return 'meet'
    if (host === 'teams.microsoft.com' || host === 'teams.live.com' || host === 'teams.cloud.microsoft') return 'teams'
  } catch { /* An unrecognised URL never becomes a platform hint. */ }
  return 'unknown'
}

/** Do not lexically compare calendar offsets against UTC timestamps. */
export function filterRecorderUpcomingCalls(
  rows: CallCandidate[], kind: RecorderUpcomingCall['kind'], memberEmail: string, nowMs = Date.now(),
): RecorderUpcomingCall[] {
  const email = memberEmail.trim().toLowerCase()
  if (!email) return []
  return rows.flatMap(row => {
    const startMs = Date.parse(row.scheduledAt)
    const endMs = startMs + row.durationMinutes * 60_000
    if (row.status !== 'scheduled' || !attends(row.attendees, email) || !Number.isFinite(startMs)
      || !Number.isFinite(endMs) || endMs <= startMs || startMs < nowMs - 120_000 || startMs > nowMs + 900_000) return []
    return [{ id: row.id, kind, title: row.title ?? 'Call', startMs, endMs, platform: recorderMeetingPlatform(row.meetingUrl) }]
  })
}

export async function recorderUpcomingCalls(database: DB, auth: RequestAuthResult, nowMs = Date.now()): Promise<RecorderUpcomingCall[]> {
  // Authorisation uses the authenticated Clerk user, never mcpActor.
  if (!auth.userId || auth.userId === 'api-service') return []
  const [member] = await database.select({ email: schema.teamMembers.email }).from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, auth.userId)).limit(1)
  if (!member?.email) return []
  const discovery = await database.select({
    id: schema.discoveryCalls.id, title: schema.discoveryCalls.title, scheduledAt: schema.discoveryCalls.scheduledAt,
    durationMinutes: schema.discoveryCalls.durationMinutes, attendees: schema.discoveryCalls.attendees,
    status: schema.discoveryCalls.status, meetingUrl: schema.discoveryCalls.googleMeetUrl,
  }).from(schema.discoveryCalls).where(eq(schema.discoveryCalls.status, 'scheduled'))
  const scheduled = await database.select({
    id: schema.scheduledCalls.id, title: schema.scheduledCalls.title, scheduledAt: schema.scheduledCalls.scheduledAt,
    durationMinutes: schema.scheduledCalls.durationMinutes, attendees: schema.scheduledCalls.attendees,
    status: schema.scheduledCalls.status, meetingUrl: schema.scheduledCalls.meetingUrl,
  }).from(schema.scheduledCalls).where(eq(schema.scheduledCalls.status, 'scheduled'))
  const candidates = [...filterRecorderUpcomingCalls(discovery, 'discovery', member.email, nowMs),
    ...filterRecorderUpcomingCalls(scheduled, 'scheduled', member.email, nowMs)]
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
  const allowed: RecorderUpcomingCall[] = []
  for (const candidate of candidates) {
    const target = await resolveCallOrgId(database, candidate.kind, candidate.id)
    if (target.found && !await requireAccessToOrgOrPreClient(database, auth.userId, target.orgId)) allowed.push(candidate)
  }
  return allowed
}

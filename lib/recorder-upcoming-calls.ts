import { and, eq, gte, lte } from 'drizzle-orm'
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
  createdById?: string | null
  googleCalendarEventId?: string | null
}

interface CallMemberIdentity {
  id: string
  clerkUserId: string
  googleAccountEmail: string | null
}

function attends(attendees: string, email: string): boolean {
  try {
    const parsed: unknown = JSON.parse(attendees)
    return Array.isArray(parsed) && parsed.some(value => value && typeof value === 'object'
      && 'email' in value && typeof value.email === 'string' && value.email.trim().toLowerCase() === email)
  } catch { return false }
}

function connectedGoogleAccountEmail(config: string | null): string | null {
  try {
    const parsed: unknown = JSON.parse(config ?? '{}')
    if (parsed && typeof parsed === 'object' && 'email' in parsed && typeof parsed.email === 'string') {
      return parsed.email.trim().toLowerCase() || null
    }
  } catch { /* Missing account metadata never grants a call match. */ }
  return null
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
  identity?: CallMemberIdentity,
): RecorderUpcomingCall[] {
  const email = memberEmail.trim().toLowerCase()
  return rows.flatMap(row => {
    const startMs = Date.parse(row.scheduledAt)
    const endMs = startMs + row.durationMinutes * 60_000
    const accountEmail = identity?.googleAccountEmail?.trim().toLowerCase()
    const ownAttendee = !!email && attends(row.attendees, email)
    // Google currently records its account email, but not the connecting member.
    const ownGoogleAccount = !!email && accountEmail === email && attends(row.attendees, accountEmail)
    // A synced call's creator may be its sync operator, not a participant.
    const ownCreator = row.googleCalendarEventId == null && !!identity
      && (row.createdById === identity.clerkUserId || row.createdById === identity.id)
    if (row.status !== 'scheduled' || !(ownAttendee || ownGoogleAccount || ownCreator) || !Number.isFinite(startMs)
      || !Number.isFinite(endMs) || endMs <= startMs || startMs - 120_000 > nowMs + 900_000 || endMs + 600_000 < nowMs) return []
    return [{ id: row.id, kind, title: row.title ?? 'Call', startMs, endMs, platform: recorderMeetingPlatform(row.meetingUrl) }]
  })
}

export async function recorderUpcomingCalls(database: DB, auth: RequestAuthResult, nowMs = Date.now()): Promise<RecorderUpcomingCall[]> {
  // Authorisation uses the authenticated Clerk user, never mcpActor.
  if (!auth.userId || auth.userId === 'api-service') return []
  const [member] = await database.select({
    id: schema.teamMembers.id, email: schema.teamMembers.email,
  }).from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, auth.userId)).limit(1)
  if (!member) return []
  const [integration] = await database.select({ config: schema.integrations.config }).from(schema.integrations)
    .where(and(eq(schema.integrations.service, 'google_workspace'), eq(schema.integrations.status, 'connected'))).limit(1)
  const identity = { id: member.id, clerkUserId: auth.userId, googleAccountEmail: connectedGoogleAccountEmail(integration?.config ?? null) }
  // A coarse indexed range bounds reads; parsed instants below handle offsets precisely.
  const since = new Date(nowMs - 86_400_000).toISOString()
  const until = new Date(nowMs + 86_400_000).toISOString()
  const discovery = await database.select({
    id: schema.discoveryCalls.id, title: schema.discoveryCalls.title, scheduledAt: schema.discoveryCalls.scheduledAt,
    durationMinutes: schema.discoveryCalls.durationMinutes, attendees: schema.discoveryCalls.attendees,
    status: schema.discoveryCalls.status, meetingUrl: schema.discoveryCalls.googleMeetUrl, createdById: schema.discoveryCalls.createdById,
    googleCalendarEventId: schema.discoveryCalls.googleCalendarEventId,
  }).from(schema.discoveryCalls).where(and(eq(schema.discoveryCalls.status, 'scheduled'),
    gte(schema.discoveryCalls.scheduledAt, since), lte(schema.discoveryCalls.scheduledAt, until)))
  const scheduled = await database.select({
    id: schema.scheduledCalls.id, title: schema.scheduledCalls.title, scheduledAt: schema.scheduledCalls.scheduledAt,
    durationMinutes: schema.scheduledCalls.durationMinutes, attendees: schema.scheduledCalls.attendees,
    status: schema.scheduledCalls.status, meetingUrl: schema.scheduledCalls.meetingUrl, createdById: schema.scheduledCalls.createdById,
  }).from(schema.scheduledCalls).where(and(eq(schema.scheduledCalls.status, 'scheduled'),
    gte(schema.scheduledCalls.scheduledAt, since), lte(schema.scheduledCalls.scheduledAt, until)))
  const candidates = [...filterRecorderUpcomingCalls(discovery, 'discovery', member.email, nowMs, identity),
    ...filterRecorderUpcomingCalls(scheduled, 'scheduled', member.email, nowMs, identity)]
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id))
  const allowed: RecorderUpcomingCall[] = []
  for (const candidate of candidates) {
    const target = await resolveCallOrgId(database, candidate.kind, candidate.id)
    if (target.found && !await requireAccessToOrgOrPreClient(database, auth.userId, target.orgId)) allowed.push(candidate)
  }
  return allowed
}

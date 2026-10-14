import { isWithinPreCallWindow } from '@/lib/pre-call-window'

export interface CallReminderIdentity {
  teamMemberId: string
  userId: string
  email: string
}

interface ReminderAttendee {
  id?: string
  type?: string
  name?: string
  email?: string
  role?: string
  responseStatus?: string
}

export interface ReminderCall {
  kind: 'scheduled' | 'discovery'
  id: string
  title: string
  scheduledAt: string
  status?: string
  createdById?: string | null
  attendees?: unknown
  orgName?: string | null
  withName?: string | null
}

const REMINDER_RETENTION_MS = 7 * 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function attendeesOf(value: unknown): ReminderAttendee[] {
  let parsed = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) as unknown } catch { return [] }
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is ReminderAttendee => typeof item === 'object' && item !== null)
}

function isMyAttendee(attendee: ReminderAttendee, identity: CallReminderIdentity): boolean {
  if (attendee.responseStatus === 'declined') return false
  const idMatch = (attendee.id === identity.teamMemberId || attendee.id === identity.userId)
    && attendee.type !== 'contact'
  const emailMatch = typeof attendee.email === 'string' && !!identity.email
    && attendee.email.trim().toLowerCase() === identity.email.trim().toLowerCase()
  return idMatch || emailMatch
}

/** Client scope is enforced by the existing call routes; this selects my calls. */
export function isMyReminderCall(call: ReminderCall, identity: CallReminderIdentity): boolean {
  const attendees = attendeesOf(call.attendees)
  if (attendees.length) return attendees.some(attendee => isMyAttendee(attendee, identity))
  return call.createdById === identity.userId || call.createdById === identity.teamMemberId
}

export function dueRecordingReminders(calls: readonly ReminderCall[], identity: CallReminderIdentity, nowMs: number): ReminderCall[] {
  return calls.filter(call => UUID.test(call.id)
    && (call.status === undefined || call.status === 'scheduled')
    && isWithinPreCallWindow(call.scheduledAt, nowMs, 0, 2)
    && isMyReminderCall(call, identity))
}

export function reminderWithName(call: ReminderCall, identity: CallReminderIdentity): string {
  const guests = attendeesOf(call.attendees).filter(attendee => !isMyAttendee(attendee, identity)
    && attendee.role !== 'host' && attendee.responseStatus !== 'declined')
  if (guests.length === 1) {
    const guest = guests[0]
    const name = typeof guest.name === 'string' ? guest.name.trim() : ''
    if (name) return name
  }
  return call.orgName?.trim() || call.withName?.trim() || call.title.trim() || 'your attendees'
}

export function recordingReminderHref(call: Pick<ReminderCall, 'kind' | 'id' | 'title'>): string {
  const query = new URLSearchParams({ title: call.title.slice(0, 200), callKind: call.kind, callId: call.id })
  return `/calls/record?${query.toString()}`
}

export function readRecordingPrefill(params: Pick<URLSearchParams, 'get'>): { title: string; callKey: string } | null {
  const kind = params.get('callKind')
  const id = params.get('callId')
  if ((kind !== 'scheduled' && kind !== 'discovery') || !id || !UUID.test(id)) return null
  return { title: (params.get('title') ?? '').trim().slice(0, 200), callKey: `${kind}:${id}` }
}

export function callReminderKey(call: ReminderCall, identity: CallReminderIdentity): string {
  // Manual calls also have a discovery mirror with a different id. Match their
  // shared instant/title/guest emails, excluding the caller's calendar host.
  const emails = attendeesOf(call.attendees)
    .filter(attendee => !isMyAttendee(attendee, identity))
    .map(attendee => typeof attendee.email === 'string' ? attendee.email.trim().toLowerCase() : '')
    .filter(Boolean)
    .sort()
  return `event:${new Date(call.scheduledAt).getTime()}:${call.title.trim().toLowerCase()}:${[...new Set(emails)].join(',')}`
}

/** Run under a Web Lock when available to claim once across app windows/tabs. */
export function claimCallReminder(storage: Pick<Storage, 'getItem' | 'setItem'>, userId: string, key: string, nowMs: number): boolean {
  const storageKey = `tahi:call-recording-reminders:${userId}`
  let stored: unknown = null
  try { stored = JSON.parse(storage.getItem(storageKey) ?? '{}') as unknown } catch { /* Repair bad local state. */ }
  const claims: Record<string, number> = {}
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    for (const [storedKey, claimedAt] of Object.entries(stored)) {
      if (typeof claimedAt === 'number' && nowMs - claimedAt < REMINDER_RETENTION_MS) claims[storedKey] = claimedAt
    }
  }
  if (claims[key] !== undefined) return false
  claims[key] = nowMs
  storage.setItem(storageKey, JSON.stringify(claims))
  return true
}

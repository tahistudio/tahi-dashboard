/**
 * Ship readiness Tier 1 item 19: the kickoff step writes a real call.
 *
 * POST /api/portal/calls is the client-side booking route. It must scope the
 * row to the caller's own org (never a body-supplied one), refuse the Tahi org
 * and client-view impersonation, refuse a past or unparseable time, move an
 * existing upcoming call instead of stacking duplicates, notify the studio and
 * email the client.
 *
 * The discovery_calls mirror is keyed to the same id and must move with a
 * re-book: the studio's /calls index reads that table exclusively, so a stale
 * mirror shows the studio a time the client already abandoned. The visitor's
 * timezone has to reach the email too, since this route runs on a UTC worker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

type SelectChain = Promise<Row[]> & {
  innerJoin: () => SelectChain
  leftJoin: () => SelectChain
  where: () => SelectChain
  orderBy: () => SelectChain
  limit: () => SelectChain
}

interface DbMockHandles {
  state: {
    queues: Record<string, Row[][]>
    inserts: Array<{ table: string; values: Row }>
    updates: Array<{ table: string; values: Row }>
  }
}

// ---------------------------------------------------------------------------
// Mocks - vi.mock factories cannot reference outer variables (hoisted)
// ---------------------------------------------------------------------------

vi.mock('@/lib/server-auth', () => ({
  getPortalAuth: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/app-url', () => ({
  publicUrl: (p: string) => `https://portal.tahi.studio${p}`,
  appOrigin: () => 'https://portal.tahi.studio',
}))

vi.mock('@/emails/kickoff-booked', () => ({
  default: function KickoffBookedEmail() { return null },
}))

// Google Calendar. The route imports this lazily and treats EVERY failure as
// "not connected", so the default below (a rejecting token read) is the
// ordinary production state: no integration, no event, booking unaffected.
vi.mock('@/lib/google', () => ({
  GoogleNotConnectedError: class GoogleNotConnectedError extends Error {},
  getGoogleAccessToken: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
}))

// The email allowlist, which decides who may be put on a calendar invite
// (Google mails attendees itself, outside our gate). Only the POLICY is mocked;
// partitionRecipients is the real rule from lib/email-allowlist.
vi.mock('@/lib/email-gate', () => ({
  resolveDeliveryPolicy: vi.fn(),
  resolveOrgRecipientScope: vi.fn(),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    scheduledCalls: {
      _table: 'scheduled_calls',
      id: 'id',
      orgId: 'org_id',
      title: 'title',
      status: 'status',
      scheduledAt: 'scheduled_at',
      durationMinutes: 'duration_minutes',
      meetingUrl: 'meeting_url',
      attendees: 'attendees',
    },
    discoveryCalls: {
      _table: 'discovery_calls',
      id: 'id',
      orgId: 'org_id',
      title: 'title',
      status: 'status',
      scheduledAt: 'scheduled_at',
      durationMinutes: 'duration_minutes',
      googleCalendarEventId: 'google_calendar_event_id',
      googleMeetUrl: 'google_meet_url',
      attendees: 'attendees',
    },
    contacts: { _table: 'contacts', id: 'id', name: 'name', email: 'email', orgId: 'org_id', clerkUserId: 'clerk_user_id' },
    organisations: { _table: 'organisations', id: 'id', name: 'name' },
    teamMembers: { _table: 'team_members', id: 'id', name: 'name', email: 'email', avatarUrl: 'avatar_url' },
    teamMemberAccess: { _table: 'team_member_access', id: 'id', teamMemberId: 'team_member_id', role: 'role' },
    teamMemberAccessOrgs: { _table: 'team_member_access_orgs', accessId: 'access_id', orgId: 'org_id' },
  },
}))

vi.mock('@/lib/db', () => {
  const state: DbMockHandles['state'] = { queues: {}, inserts: [], updates: [] }

  function chainFor(rows: Row[]): SelectChain {
    const chain = Promise.resolve(rows) as SelectChain
    chain.innerJoin = () => chain
    chain.leftJoin = () => chain
    chain.where = () => chain
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }

  const select = vi.fn(() => ({
    from: (table: { _table?: string } | undefined) => {
      const queue = state.queues[table?._table ?? ''] ?? []
      return chainFor(queue.length > 0 ? (queue.shift() as Row[]) : [])
    },
  }))

  const insert = vi.fn((table: { _table?: string } | undefined) => ({
    values: vi.fn(async (values: Row) => {
      state.inserts.push({ table: table?._table ?? '', values })
    }),
  }))

  const update = vi.fn((table: { _table?: string } | undefined) => ({
    set: vi.fn((values: Row) => ({
      where: vi.fn(async () => {
        state.updates.push({ table: table?._table ?? '', values })
      }),
    })),
  }))

  return {
    db: vi.fn().mockResolvedValue({ select, insert, update }),
    __mock: { state },
  }
})

// Import after mocks are set up
import type { ReactElement } from 'react'
import { POST } from '@/app/api/portal/calls/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'
import { notifyAllAdmins } from '@/lib/notifications'
import { sendEmail } from '@/lib/email'
import { formatSlotSummary, STUDIO_TIME_ZONE } from '@/lib/kickoff-slot'
import { getGoogleAccessToken, createCalendarEvent, updateCalendarEvent, type CalendarEvent } from '@/lib/google'
import { resolveDeliveryPolicy, resolveOrgRecipientScope } from '@/lib/email-gate'
import { closedPolicy, type DeliveryPolicy } from '@/lib/email-allowlist'
import type { KickoffBookedEmailProps } from '@/emails/kickoff-booked'

const dbMock = (dbModule as unknown as { __mock: DbMockHandles }).__mock

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  } as PortalAuth
}

function bookRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function inFuture(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

/** The happy-path lookup queue: contact, org, PM, then no existing call and no
 *  existing mirror row. */
function seedLookups(options: { existingCall?: Row[]; existingMirror?: Row[] } = {}) {
  dbMock.state.queues = {
    contacts: [[{ id: 'ct_1', name: 'Ava Reid', email: 'ava@acme.test' }]],
    organisations: [[{ name: 'Acme Co' }]],
    team_member_access: [[{ id: 'tm_pm', name: 'Liam Miller', email: 'liam@tahi.studio' }]],
    scheduled_calls: [options.existingCall ?? []],
    discovery_calls: [options.existingMirror ?? []],
  }
}

/** Props handed to <KickoffBookedEmail> on the most recent send. */
function emailProps(): KickoffBookedEmailProps {
  const element = vi.mocked(sendEmail).mock.calls[0][2] as ReactElement<KickoffBookedEmailProps>
  return element.props
}

/** Pretend Google Workspace is connected and hand back this event. */
function connectGoogle(event: CalendarEvent = { id: 'gcal_1', hangoutLink: 'https://meet.google.com/abc-defg-hij' }) {
  vi.mocked(getGoogleAccessToken).mockResolvedValue({
    accessToken: 'ya29.token', refreshToken: 'r', expiresAt: null, email: 'studio@tahi.studio', scopes: '',
  })
  vi.mocked(createCalendarEvent).mockResolvedValue(event)
  vi.mocked(updateCalendarEvent).mockResolvedValue(event)
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
  dbMock.state.inserts = []
  dbMock.state.updates = []
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
  vi.mocked(sendEmail).mockResolvedValue({ success: true })
  // Production's ordinary state: Google absent, allowlist closed.
  vi.mocked(getGoogleAccessToken).mockRejectedValue(new Error('Google Workspace is not connected.'))
  vi.mocked(resolveDeliveryPolicy).mockResolvedValue(closedPolicy())
  vi.mocked(resolveOrgRecipientScope).mockResolvedValue({ orgId: 'org_client' })
})

describe('POST /api/portal/calls - gates', () => {
  it('403s a session with no org', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: null }))
    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    expect(res.status).toBe(403)
  })

  it('403s the Tahi admin org', async () => {
    const prev = process.env.NEXT_PUBLIC_TAHI_ORG_ID
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ orgId: 'org_tahi' }))
    try {
      const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
      expect(res.status).toBe(403)
    } finally {
      process.env.NEXT_PUBLIC_TAHI_ORG_ID = prev
    }
  })

  it('403s a client-view impersonation (read-only)', async () => {
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth({ impersonating: true }))
    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    expect(res.status).toBe(403)
    expect(dbMock.state.inserts).toHaveLength(0)
  })
})

describe('POST /api/portal/calls - validation', () => {
  it('400s an unparseable timestamp', async () => {
    const res = await POST(bookRequest({ scheduledAt: 'next tuesday-ish' }))
    expect(res.status).toBe(400)
  })

  it('400s a missing timestamp', async () => {
    const res = await POST(bookRequest({}))
    expect(res.status).toBe(400)
  })

  it('400s a slot in the past', async () => {
    const res = await POST(bookRequest({ scheduledAt: inFuture(-48) }))
    expect(res.status).toBe(400)
    expect(dbMock.state.inserts).toHaveLength(0)
  })
})

describe('POST /api/portal/calls - booking', () => {
  it('writes a scheduled_calls row scoped to the session org, not the body', async () => {
    seedLookups()
    const when = inFuture(48)
    const res = await POST(bookRequest({ scheduledAt: when, orgId: 'org_someone_else' }))
    expect(res.status).toBe(201)

    const call = dbMock.state.inserts.find(i => i.table === 'scheduled_calls')
    expect(call).toBeDefined()
    expect(call!.values.orgId).toBe('org_client')
    expect(call!.values.status).toBe('scheduled')
    expect(call!.values.title).toBe('Kickoff call')
    expect(call!.values.durationMinutes).toBe(30)
    expect(call!.values.createdById).toBe('user_client')
    expect(new Date(call!.values.scheduledAt as string).getTime())
      .toBe(new Date(when).getTime())
  })

  it('records the client contact and the org PM as attendees', async () => {
    seedLookups()
    await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const call = dbMock.state.inserts.find(i => i.table === 'scheduled_calls')!
    const attendees = JSON.parse(call.values.attendees as string) as Array<Record<string, string>>
    expect(attendees).toHaveLength(2)
    expect(attendees[0]).toMatchObject({ type: 'contact', email: 'ava@acme.test', role: 'guest' })
    expect(attendees[1]).toMatchObject({ type: 'team_member', name: 'Liam Miller', role: 'host' })
  })

  it('mirrors the call into discovery_calls for the studio calls surfaces', async () => {
    seedLookups()
    await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const mirrored = dbMock.state.inserts.find(i => i.table === 'discovery_calls')
    expect(mirrored).toBeDefined()
    expect(mirrored!.values.orgId).toBe('org_client')
    expect(mirrored!.values.meetingType).toBe('client')
  })

  it('notifies the studio and emails the client their confirmation', async () => {
    seedLookups()
    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const json = await res.json() as { emailed: boolean }

    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[0]
    expect(payload.type).toBe('call_scheduled')
    expect(payload.entityType).toBe('call')

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toBe('ava@acme.test')
    expect(json.emailed).toBe(true)
  })

  it('still books when Resend is unconfigured, and says so', async () => {
    seedLookups()
    vi.mocked(sendEmail).mockResolvedValue({ success: false, error: 'RESEND_API_KEY not configured' })
    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    expect(res.status).toBe(201)
    const json = await res.json() as { emailed: boolean }
    expect(json.emailed).toBe(false)
    expect(dbMock.state.inserts.some(i => i.table === 'scheduled_calls')).toBe(true)
  })

  it('moves an existing upcoming call instead of stacking a duplicate', async () => {
    seedLookups({ existingCall: [{ id: 'call_existing' }], existingMirror: [{ id: 'call_existing' }] })
    const when = inFuture(72)
    const res = await POST(bookRequest({ scheduledAt: when }))
    expect(res.status).toBe(201)
    const json = await res.json() as { id: string }
    expect(json.id).toBe('call_existing')

    expect(dbMock.state.inserts.filter(i => i.table === 'scheduled_calls')).toHaveLength(0)
    expect(dbMock.state.inserts.filter(i => i.table === 'discovery_calls')).toHaveLength(0)
    const moved = dbMock.state.updates.find(u => u.table === 'scheduled_calls')
    expect(moved).toBeDefined()
    expect(new Date(moved!.values.scheduledAt as string).getTime()).toBe(new Date(when).getTime())
  })

  // The studio's /calls index reads discovery_calls exclusively, and GET
  // /api/portal/calls merges both tables. A mirror left behind at the old time
  // means the client and the studio are each told a different hour by the
  // feature whose whole job is agreeing on one.
  it('moves the discovery_calls mirror with it, not just the scheduled row', async () => {
    seedLookups({ existingCall: [{ id: 'call_existing' }], existingMirror: [{ id: 'call_existing' }] })
    const when = inFuture(72)
    await POST(bookRequest({ scheduledAt: when }))

    const mirror = dbMock.state.updates.find(u => u.table === 'discovery_calls')
    expect(mirror).toBeDefined()
    expect(new Date(mirror!.values.scheduledAt as string).getTime()).toBe(new Date(when).getTime())
    expect(mirror!.values.status).toBe('scheduled')
  })

  it('keys the mirror to the scheduled call id so one update covers both', async () => {
    seedLookups()
    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const json = await res.json() as { id: string }
    const mirrored = dbMock.state.inserts.find(i => i.table === 'discovery_calls')!
    expect(mirrored.values.id).toBe(json.id)
  })

  it('back-fills a missing mirror on a re-book rather than leaving the studio blind', async () => {
    seedLookups({ existingCall: [{ id: 'call_existing' }], existingMirror: [] })
    await POST(bookRequest({ scheduledAt: inFuture(72) }))
    const mirrored = dbMock.state.inserts.find(i => i.table === 'discovery_calls')
    expect(mirrored).toBeDefined()
    expect(mirrored!.values.id).toBe('call_existing')
  })
})

// The worker runs in UTC. Every artefact that outlives the picker has to quote
// the client's own clock, or the confirmation contradicts what they clicked.
describe('POST /api/portal/calls - timezone', () => {
  it('passes the picker zone through to the confirmation email', async () => {
    seedLookups()
    await POST(bookRequest({ scheduledAt: inFuture(24), timeZone: 'America/New_York' }))
    const props = emailProps()
    expect(props.timeZone).toBe('America/New_York')
  })

  it('falls back to the studio clock when the zone is missing or junk', async () => {
    seedLookups()
    await POST(bookRequest({ scheduledAt: inFuture(24) }))
    expect(emailProps().timeZone).toBe(STUDIO_TIME_ZONE)

    vi.clearAllMocks()
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
    vi.mocked(sendEmail).mockResolvedValue({ success: true })
    seedLookups()
    await POST(bookRequest({ scheduledAt: inFuture(24), timeZone: 'Middle/Earth' }))
    expect(emailProps().timeZone).toBe(STUDIO_TIME_ZONE)
  })

  it('gives the studio a human time in the bell row, never a raw ISO string', async () => {
    seedLookups()
    const when = inFuture(24)
    await POST(bookRequest({ scheduledAt: when, timeZone: 'Pacific/Auckland' }))
    const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[0]
    expect(payload.body).not.toContain(new Date(when).toISOString())
    expect(payload.body).toContain(formatSlotSummary(when, { timeZone: 'Pacific/Auckland', withZone: true }))
  })

  it('clamps a silly duration into a bookable range', async () => {
    seedLookups()
    await POST(bookRequest({ scheduledAt: inFuture(24), durationMinutes: 100000 }))
    const call = dbMock.state.inserts.find(i => i.table === 'scheduled_calls')!
    expect(call.values.durationMinutes).toBe(240)
  })
})

// T1.4 (b). The booking has always written a real scheduled_calls row; what it
// never did was put the meeting anywhere the studio looks, or carry a join
// link. Google Calendar is now pushed to when the integration is connected.
//
// The load-bearing property is that it stays OPTIONAL: a client picking a slot
// keeps it whether Google is connected, disconnected, or answering with an
// error, because the alternative is losing the slot they just chose on the last
// screen of onboarding.
describe('POST /api/portal/calls - Google Calendar', () => {
  it('books normally with no integration connected, and says so', async () => {
    seedLookups()
    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    expect(res.status).toBe(201)
    const json = await res.json() as { meetingUrl: string | null; calendarPushed: boolean }
    expect(json.calendarPushed).toBe(false)
    expect(json.meetingUrl).toBeNull()

    const call = dbMock.state.inserts.find(i => i.table === 'scheduled_calls')
    expect(call).toBeDefined()
    expect(call!.values.meetingUrl).toBeNull()
    expect(createCalendarEvent).not.toHaveBeenCalled()
  })

  it('still books when the calendar push throws, rather than losing the slot', async () => {
    seedLookups()
    connectGoogle()
    vi.mocked(createCalendarEvent).mockRejectedValue(new Error('Calendar create failed: 503'))

    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    expect(res.status).toBe(201)
    const json = await res.json() as { calendarPushed: boolean; meetingUrl: string | null }
    expect(json.calendarPushed).toBe(false)
    expect(json.meetingUrl).toBeNull()
    expect(dbMock.state.inserts.some(i => i.table === 'scheduled_calls')).toBe(true)
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('stores the Meet link on the call and carries it into the confirmation email', async () => {
    seedLookups()
    connectGoogle()

    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const json = await res.json() as { meetingUrl: string | null; calendarPushed: boolean }
    expect(json.calendarPushed).toBe(true)
    expect(json.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')

    const call = dbMock.state.inserts.find(i => i.table === 'scheduled_calls')!
    expect(call.values.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
    // Null here is the "Open your studio" layout; a link flips the CTA to
    // "Join the call" (emails/kickoff-booked.tsx).
    expect(emailProps().meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('reads the conference entry point when Google omits hangoutLink', async () => {
    seedLookups()
    connectGoogle({
      id: 'gcal_2',
      conferenceData: {
        entryPoints: [
          { entryPointType: 'phone', uri: 'tel:+64' },
          { entryPointType: 'video', uri: 'https://meet.google.com/xyz' },
        ],
      },
    })
    await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const call = dbMock.state.inserts.find(i => i.table === 'scheduled_calls')!
    expect(call.values.meetingUrl).toBe('https://meet.google.com/xyz')
  })

  it('writes the event id onto the mirror so the pull-sync does not duplicate it', async () => {
    seedLookups()
    connectGoogle()
    await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const mirror = dbMock.state.inserts.find(i => i.table === 'discovery_calls')!
    expect(mirror.values.googleCalendarEventId).toBe('gcal_1')
    expect(mirror.values.googleMeetUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  // Google emails every attendee ITSELF (sendUpdates=all), on a rail the
  // studio's allowlist cannot see or suppress. Putting the client on the event
  // while the gate is closed would mail a real client from Google.
  it('never puts a client on the invite while the allowlist is closed', async () => {
    seedLookups()
    connectGoogle()
    await POST(bookRequest({ scheduledAt: inFuture(24) }))

    expect(createCalendarEvent).toHaveBeenCalledTimes(1)
    const [, input] = vi.mocked(createCalendarEvent).mock.calls[0]
    // The contact (ava@acme.test) and the PM (liam@tahi.studio) are both
    // attendees on OUR row; neither passes the default gate, whose only
    // allowed address is business@tahi.studio.
    expect(input.attendeeEmails).toEqual([])
  })

  it('invites an address the gate would have delivered to anyway', async () => {
    seedLookups()
    connectGoogle()
    const openPolicy: DeliveryPolicy = { ...closedPolicy(), mode: 'all', blockedAddresses: [] }
    vi.mocked(resolveDeliveryPolicy).mockResolvedValue(openPolicy)

    await POST(bookRequest({ scheduledAt: inFuture(24) }))
    const [, input] = vi.mocked(createCalendarEvent).mock.calls[0]
    expect(input.attendeeEmails).toEqual(['ava@acme.test', 'liam@tahi.studio'])
  })

  it('withholds every address when the policy cannot be read', async () => {
    seedLookups()
    connectGoogle()
    vi.mocked(resolveDeliveryPolicy).mockRejectedValue(new Error('settings unreadable'))

    const res = await POST(bookRequest({ scheduledAt: inFuture(24) }))
    expect(res.status).toBe(201)
    const [, input] = vi.mocked(createCalendarEvent).mock.calls[0]
    expect(input.attendeeEmails).toEqual([])
  })

  // A re-book must MOVE the meeting. Creating a second event would leave the
  // studio's calendar showing a time the client already abandoned, which is the
  // same bug the discovery_calls mirror exists to prevent.
  it('moves the existing event on a re-book instead of creating a second one', async () => {
    seedLookups({
      existingCall: [{ id: 'call_existing' }],
      existingMirror: [{
        id: 'call_existing',
        googleCalendarEventId: 'gcal_1',
        googleMeetUrl: 'https://meet.google.com/abc-defg-hij',
      }],
    })
    connectGoogle()
    const when = inFuture(72)
    await POST(bookRequest({ scheduledAt: when }))

    expect(createCalendarEvent).not.toHaveBeenCalled()
    expect(updateCalendarEvent).toHaveBeenCalledTimes(1)
    const [, eventId, input] = vi.mocked(updateCalendarEvent).mock.calls[0]
    expect(eventId).toBe('gcal_1')
    expect(new Date(input.startIso).getTime()).toBe(new Date(when).getTime())

    const moved = dbMock.state.updates.find(u => u.table === 'scheduled_calls')!
    expect(moved.values.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
  })

  it('keeps a link it already holds when a later push fails', async () => {
    seedLookups({
      existingCall: [{ id: 'call_existing' }],
      existingMirror: [{
        id: 'call_existing',
        googleCalendarEventId: 'gcal_1',
        googleMeetUrl: 'https://meet.google.com/abc-defg-hij',
      }],
    })
    connectGoogle()
    vi.mocked(updateCalendarEvent).mockRejectedValue(new Error('Calendar update failed: 500'))

    const res = await POST(bookRequest({ scheduledAt: inFuture(72) }))
    expect(res.status).toBe(201)
    // The client may already have been emailed this URL, so a failed push must
    // not blank it.
    const json = await res.json() as { meetingUrl: string | null }
    expect(json.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
    const moved = dbMock.state.updates.find(u => u.table === 'scheduled_calls')!
    expect(moved.values.meetingUrl).toBe('https://meet.google.com/abc-defg-hij')
  })
})

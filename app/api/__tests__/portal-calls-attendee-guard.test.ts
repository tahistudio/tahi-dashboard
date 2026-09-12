/**
 * Giant Group readiness, BLOCKER 5 (S5): GET /api/portal/calls must not show
 * a client an auto-classified calendar event that has no client attendee and
 * no join link. discovery_calls is populated by the Google Calendar sync's
 * auto-classifier, not by a deliberate booking, so a row can carry this org's
 * id with nobody from the org actually on the call. A row survives the guard
 * when it has a join link (someone can act on it regardless of who is on it)
 * or when at least one attendee email matches a real contact at this org.
 * scheduled_calls rows are never filtered: those exist only because someone
 * at the studio deliberately booked them for this org.
 *
 * The db mock mirrors app/api/__tests__/portal-calls-book.test.ts: queues are
 * keyed by table name, not by call order, so adding the new contacts read
 * does not require re-pinning positional reads.
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
  const state: DbMockHandles['state'] = { queues: {} }

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

  const insert = vi.fn(() => ({ values: vi.fn(async () => undefined) }))
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }))

  return {
    db: vi.fn().mockResolvedValue({ select, insert, update }),
    __mock: { state },
  }
})

// Import after mocks are set up
import { GET } from '@/app/api/portal/calls/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'
import { getPortalAuth } from '@/lib/server-auth'

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

function callsRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/calls')
}

function inFuture(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

interface CallItem {
  id: string
  title: string
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMock.state.queues = {}
  vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
})

describe('GET /api/portal/calls - discovery_calls attendee guard', () => {
  it('drops a Giant-Group-shaped row: client meetingType, org id set, no join link, only tahi.studio attendees', async () => {
    dbMock.state.queues = {
      scheduled_calls: [[]],
      discovery_calls: [[{
        id: 'call-stray',
        title: 'N8N Content Engine',
        scheduledAt: inFuture(24),
        durationMinutes: 30,
        meetingUrl: null,
        attendees: JSON.stringify([
          { name: 'Liam Miller', email: 'liam@tahi.studio', role: 'host' },
          { name: 'Staci Bonnie', email: 'staci@tahi.studio', role: 'guest' },
        ]),
      }]],
      contacts: [[{ email: 'mickey.day@giantgroup.com' }]],
      team_members: [[]],
    }

    const res = await GET(callsRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: CallItem[] }
    expect(json.items.find((i) => i.title === 'N8N Content Engine')).toBeUndefined()
  })

  it('keeps the real "Giant group x Tahi" row because it has a join link', async () => {
    dbMock.state.queues = {
      scheduled_calls: [[]],
      discovery_calls: [[{
        id: 'call-real',
        title: 'Giant group x Tahi',
        scheduledAt: inFuture(48),
        durationMinutes: 30,
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        attendees: JSON.stringify([
          { name: 'Liam Miller', email: 'liam@tahi.studio', role: 'host' },
        ]),
      }]],
      contacts: [[{ email: 'mickey.day@giantgroup.com' }]],
      team_members: [[]],
    }

    const res = await GET(callsRequest())
    const json = await res.json() as { items: CallItem[] }
    const item = json.items.find((i) => i.title === 'Giant group x Tahi')
    expect(item).toBeDefined()
    expect(item?.id).toBe('discovery:call-real')
  })

  it('keeps a row with a matching client attendee even with no join link', async () => {
    dbMock.state.queues = {
      scheduled_calls: [[]],
      discovery_calls: [[{
        id: 'call-client-attendee',
        title: 'Quarterly check-in',
        scheduledAt: inFuture(72),
        durationMinutes: 30,
        meetingUrl: null,
        attendees: JSON.stringify([
          { name: 'Mickey Day', email: 'mickey.day@giantgroup.com', role: 'guest' },
        ]),
      }]],
      contacts: [[{ email: 'mickey.day@giantgroup.com' }]],
      team_members: [[]],
    }

    const res = await GET(callsRequest())
    const json = await res.json() as { items: CallItem[] }
    expect(json.items.find((i) => i.title === 'Quarterly check-in')).toBeDefined()
  })

  it('does not throw on malformed attendees JSON, and excludes that row', async () => {
    dbMock.state.queues = {
      scheduled_calls: [[]],
      discovery_calls: [[{
        id: 'call-malformed',
        title: 'Mystery event',
        scheduledAt: inFuture(96),
        durationMinutes: 30,
        meetingUrl: null,
        attendees: '{not valid json',
      }]],
      contacts: [[{ email: 'mickey.day@giantgroup.com' }]],
      team_members: [[]],
    }

    const res = await GET(callsRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as { items: CallItem[] }
    expect(json.items.find((i) => i.title === 'Mystery event')).toBeUndefined()
  })
})

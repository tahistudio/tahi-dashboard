/**
 * Unit tests for GET /api/admin/pipeline/capacity.
 *
 * "Booked" must read as work assigned for the week ahead (open tasks due
 * this week or overdue, plus open requests carrying an estimate), never as
 * hours already logged, and only active team members (not blocked on the
 * email gate, weeklyCapacityHours > 0) should reach the response.
 *
 * We mock auth, db and the email-allowlist settings read, then call the
 * route handler directly. Each mocked `.from(table)` resolves to a
 * pre-seeded row set for that table; the route's own WHERE/groupBy calls are
 * exercised for real (imported unmocked from drizzle-orm) but the mock does
 * not re-implement SQL filtering, so each test seeds only the rows a correct
 * query would already have matched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    teamMembers: { _table: 'team_members', id: 'id', name: 'name', avatarUrl: 'avatar_url', title: 'title', email: 'email', weeklyCapacityHours: 'weekly_capacity_hours' },
    settings: { _table: 'settings', key: 'key', value: 'value' },
    timeEntries: { _table: 'time_entries', teamMemberId: 'team_member_id', hours: 'hours', date: 'date' },
    tasks: { _table: 'tasks', assigneeId: 'assignee_id', estimatedHours: 'estimated_hours', status: 'status', dueDate: 'due_date' },
    requests: { _table: 'requests', assigneeId: 'assignee_id', estimatedHours: 'estimated_hours', status: 'status' },
  },
}))

interface StateShape {
  teamMembers: Array<{ id: string; name: string; avatarUrl: string | null; title: string | null; email: string; weeklyCapacityHours: number | null }>
  settings: Array<{ key: string; value: string | null }>
  timeEntries: Array<{ teamMemberId: string; totalHours: number }>
  tasks: Array<{ assigneeId: string | null; totalHours: number }>
  requests: Array<{ assigneeId: string | null; totalHours: number }>
}

function chainable<T>(resolve: () => Promise<T>) {
  const obj: Record<string, unknown> = {
    where: () => obj,
    groupBy: () => obj,
    limit: () => obj,
    orderBy: () => obj,
    then: (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected),
  }
  return obj
}

vi.mock('@/lib/db', () => {
  const state: StateShape = {
    teamMembers: [],
    settings: [],
    timeEntries: [],
    tasks: [],
    requests: [],
  }

  const select = vi.fn().mockImplementation(() => ({
    from: (table: { _table?: string } | undefined) => {
      switch (table?._table) {
        case 'team_members':
          return chainable(() => Promise.resolve(state.teamMembers))
        case 'settings':
          return chainable(() => Promise.resolve(state.settings.filter(s => s.key === 'email.blockedAddresses')))
        case 'time_entries':
          return chainable(() => Promise.resolve(state.timeEntries))
        case 'tasks':
          return chainable(() => Promise.resolve(state.tasks))
        case 'requests':
          return chainable(() => Promise.resolve(state.requests))
        default:
          return chainable(() => Promise.resolve([]))
      }
    },
  }))

  const database = { select }

  return {
    db: vi.fn().mockResolvedValue(database),
    __mock: { state },
  }
})

import { GET } from '@/app/api/admin/pipeline/capacity/route'
import { NextRequest } from 'next/server'
import * as dbModule from '@/lib/db'

const dbMock = (dbModule as unknown as { __mock: { state: StateShape } }).__mock

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/pipeline/capacity')
}

interface CapacityResponse {
  teamMembers: Array<{ id: string; name: string; weeklyCapacityHours: number; assignedHours: number; loggedHours: number; utilization: number }>
  totalCapacity: number
  totalAssignedHours: number
  totalLoggedHours: number
  availableCapacity: number
}

describe('GET /api/admin/pipeline/capacity', () => {
  beforeEach(() => {
    dbMock.state.teamMembers = []
    dbMock.state.settings = []
    dbMock.state.timeEntries = []
    dbMock.state.tasks = []
    dbMock.state.requests = []
  })

  it('books hours from open tasks due this week and overdue open requests with an estimate, not logged time', async () => {
    dbMock.state.teamMembers = [
      { id: 'liam', name: 'Liam', avatarUrl: null, title: null, email: 'liam@tahi.studio', weeklyCapacityHours: 40 },
    ]
    // No entries logged yet this week.
    dbMock.state.timeEntries = []
    dbMock.state.tasks = [{ assigneeId: 'liam', totalHours: 12 }]
    dbMock.state.requests = [{ assigneeId: 'liam', totalHours: 8 }]

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as CapacityResponse

    expect(json.totalAssignedHours).toBe(20)
    expect(json.totalLoggedHours).toBe(0)
    expect(json.teamMembers[0].assignedHours).toBe(20)
    expect(json.teamMembers[0].loggedHours).toBe(0)
    expect(json.teamMembers[0].utilization).toBe(50) // 20 / 40
  })

  it('keeps logged hours as a separate figure from booked hours', async () => {
    dbMock.state.teamMembers = [
      { id: 'liam', name: 'Liam', avatarUrl: null, title: null, email: 'liam@tahi.studio', weeklyCapacityHours: 40 },
    ]
    dbMock.state.timeEntries = [{ teamMemberId: 'liam', totalHours: 30 }]
    dbMock.state.tasks = []
    dbMock.state.requests = []

    const res = await GET(makeRequest())
    const json = await res.json() as CapacityResponse

    // 30 hours were logged this week but nothing is assigned for the week
    // ahead, so booked is 0%, not 75%.
    expect(json.totalAssignedHours).toBe(0)
    expect(json.totalLoggedHours).toBe(30)
    expect(json.teamMembers[0].utilization).toBe(0)
  })

  it('excludes a team member on email.blockedAddresses from the response entirely', async () => {
    dbMock.state.teamMembers = [
      { id: 'liam', name: 'Liam', avatarUrl: null, title: null, email: 'liam@tahi.studio', weeklyCapacityHours: 40 },
      { id: 'nathan', name: 'Nathan Day', avatarUrl: null, title: null, email: 'nathan@tahi.studio', weeklyCapacityHours: 40 },
    ]
    dbMock.state.settings = [{ key: 'email.blockedAddresses', value: JSON.stringify(['nathan@tahi.studio']) }]
    dbMock.state.tasks = [{ assigneeId: 'nathan', totalHours: 10 }]

    const res = await GET(makeRequest())
    const json = await res.json() as CapacityResponse

    expect(json.teamMembers.map(m => m.id)).toEqual(['liam'])
    expect(json.teamMembers.find(m => m.id === 'nathan')).toBeUndefined()
    // Nathan's hypothetical booked hours never enter the totals either.
    expect(json.totalAssignedHours).toBe(0)
  })

  it('excludes a team member with weeklyCapacityHours 0 or null', async () => {
    dbMock.state.teamMembers = [
      { id: 'liam', name: 'Liam', avatarUrl: null, title: null, email: 'liam@tahi.studio', weeklyCapacityHours: 40 },
      { id: 'zero', name: 'Zero Hours', avatarUrl: null, title: null, email: 'zero@tahi.studio', weeklyCapacityHours: 0 },
      { id: 'nullcap', name: 'Null Cap', avatarUrl: null, title: null, email: 'nullcap@tahi.studio', weeklyCapacityHours: null },
    ]

    const res = await GET(makeRequest())
    const json = await res.json() as CapacityResponse

    expect(json.teamMembers.map(m => m.id)).toEqual(['liam'])
  })

  it('returns an empty capacity shape when there are no active team members at all', async () => {
    dbMock.state.teamMembers = [
      { id: 'zero', name: 'Zero Hours', avatarUrl: null, title: null, email: 'zero@tahi.studio', weeklyCapacityHours: 0 },
    ]

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const json = await res.json() as CapacityResponse
    expect(json.teamMembers).toEqual([])
    expect(json.totalCapacity).toBe(0)
    expect(json.totalAssignedHours).toBe(0)
    expect(json.totalLoggedHours).toBe(0)
    expect(json.availableCapacity).toBe(0)
  })

  it('sums totals across every active member', async () => {
    // email.blockedAddresses is set explicitly here (rather than left to the
    // coded default) so this test is about summation, not the blocklist -
    // see the dedicated default-blocklist test below for that interaction.
    dbMock.state.settings = [{ key: 'email.blockedAddresses', value: JSON.stringify([]) }]
    dbMock.state.teamMembers = [
      { id: 'liam', name: 'Liam', avatarUrl: null, title: null, email: 'liam@tahi.studio', weeklyCapacityHours: 40 },
      { id: 'staci', name: 'Staci', avatarUrl: null, title: null, email: 'staci@tahi.studio', weeklyCapacityHours: 30 },
    ]
    dbMock.state.tasks = [
      { assigneeId: 'liam', totalHours: 10 },
      { assigneeId: 'staci', totalHours: 5 },
    ]
    dbMock.state.requests = [{ assigneeId: 'staci', totalHours: 5 }]

    const res = await GET(makeRequest())
    const json = await res.json() as CapacityResponse

    expect(json.totalCapacity).toBe(70)
    expect(json.totalAssignedHours).toBe(20)
    expect(json.availableCapacity).toBe(50)
  })

  it('falls back to the coded default blocklist (staci@tahi.studio, nathan@tahi.studio) when the setting row is unset', async () => {
    // Documents a real interaction this fix inherits from
    // lib/email-allowlist.ts's DEFAULT_BLOCKED_ADDRESSES, which this route
    // did not previously consult at all: with no email.blockedAddresses row
    // in the settings table, resolveBlockedAddresses falls back to BOTH
    // staci@tahi.studio and nathan@tahi.studio, so Staci drops out of this
    // card too, not only Nathan, until that setting is written explicitly.
    dbMock.state.settings = []
    dbMock.state.teamMembers = [
      { id: 'liam', name: 'Liam', avatarUrl: null, title: null, email: 'liam@tahi.studio', weeklyCapacityHours: 40 },
      { id: 'staci', name: 'Staci', avatarUrl: null, title: null, email: 'staci@tahi.studio', weeklyCapacityHours: 30 },
    ]

    const res = await GET(makeRequest())
    const json = await res.json() as CapacityResponse

    expect(json.teamMembers.map(m => m.id)).toEqual(['liam'])
  })

  it('never lets available capacity go negative when the studio is overbooked', async () => {
    dbMock.state.teamMembers = [
      { id: 'liam', name: 'Liam', avatarUrl: null, title: null, email: 'liam@tahi.studio', weeklyCapacityHours: 10 },
    ]
    dbMock.state.tasks = [{ assigneeId: 'liam', totalHours: 25 }]

    const res = await GET(makeRequest())
    const json = await res.json() as CapacityResponse

    expect(json.totalAssignedHours).toBe(25)
    expect(json.availableCapacity).toBe(0)
  })

  it('returns 403 for non-admin users', async () => {
    const { getRequestAuth } = await import('@/lib/server-auth')
    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      userId: 'user_client',
      orgId: 'org_other',
      sessionId: 'sess_2',
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })
})

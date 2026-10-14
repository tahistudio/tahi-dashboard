import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextResponse } from 'next/server'
import type { DB } from '@/db/d1'
import type { RequestAuthResult } from '@/lib/server-auth'

vi.mock('@/lib/call-transcripts', () => ({ resolveCallOrgId: vi.fn() }))
vi.mock('@/lib/require-access', () => ({ requireAccessToOrgOrPreClient: vi.fn() }))
import { resolveCallOrgId } from '@/lib/call-transcripts'
import { requireAccessToOrgOrPreClient } from '@/lib/require-access'
import { filterRecorderUpcomingCalls, recorderMeetingPlatform, recorderUpcomingCalls } from '@/lib/recorder-upcoming-calls'

const NOW = Date.parse('2026-10-14T00:00:00Z')
function candidate(changes = {}) {
  return { id: 'call', title: 'Planning', scheduledAt: '2026-10-14T13:00:00+13:00', durationMinutes: 30,
    status: 'scheduled', attendees: '[{"email":"business@tahi.studio"}]', meetingUrl: 'https://meet.google.com/secret-room', ...changes }
}

describe('tray upcoming calls', () => {
  it('compares parsed instants across timezone offsets and omits raw URLs and attendee details', () => {
    const items = filterRecorderUpcomingCalls([candidate()], 'discovery', ' BUSINESS@TAHI.STUDIO ', NOW)
    expect(items).toEqual([{ id: 'call', kind: 'discovery', title: 'Planning', startMs: NOW,
      endMs: NOW + 1_800_000, platform: 'meet' }])
    expect(JSON.stringify(items)).not.toContain('secret-room')
    expect(JSON.stringify(items)).not.toContain('business@')
  })

  it('includes windows overlapping the next fifteen minutes at both exact boundaries', () => {
    const rows = [
      candidate({ id: 'recently-ended', scheduledAt: new Date(NOW - 2_400_000).toISOString() }),
      candidate({ id: 'expired', scheduledAt: new Date(NOW - 2_400_001).toISOString() }),
      candidate({ id: 'opening-in-fifteen', scheduledAt: new Date(NOW + 1_020_000).toISOString() }),
      candidate({ id: 'too-far-away', scheduledAt: new Date(NOW + 1_020_001).toISOString() }),
    ]
    expect(filterRecorderUpcomingCalls(rows, 'scheduled', 'business@tahi.studio', NOW).map(row => row.id))
      .toEqual(['recently-ended', 'opening-in-fifteen'])
  })

  it('includes a sixty-minute call that started twenty minutes ago', () => {
    const rows = [candidate({ scheduledAt: new Date(NOW - 1_200_000).toISOString(), durationMinutes: 60 })]
    expect(filterRecorderUpcomingCalls(rows, 'scheduled', 'business@tahi.studio', NOW))
      .toMatchObject([{ id: 'call', startMs: NOW - 1_200_000, endMs: NOW + 2_400_000 }])
  })

  it('filters cancelled calls, invalid times, non-positive duration and other attendees', () => {
    const rows = [candidate({ status: 'cancelled' }), candidate({ scheduledAt: 'bad' }), candidate({ durationMinutes: 0 }),
      candidate({ attendees: '[{"email":"staci@tahi.studio"}]' }), candidate({ attendees: 'broken' }),
      candidate({ attendees: '{"email":"business@tahi.studio"}' }), candidate({ attendees: '["business@tahi.studio"]' })]
    expect(filterRecorderUpcomingCalls(rows, 'discovery', 'business@tahi.studio', NOW)).toEqual([])
    expect(filterRecorderUpcomingCalls([candidate()], 'scheduled', '', NOW)).toEqual([])
  })

  it('derives platforms from exact hostnames rather than substrings', () => {
    expect(recorderMeetingPlatform('https://company.zoom.us/j/123')).toBe('zoom')
    expect(recorderMeetingPlatform('https://teams.microsoft.com/l/meetup-join/secret')).toBe('teams')
    expect(recorderMeetingPlatform('https://meet.google.com.evil.example')).toBe('unknown')
    expect(recorderMeetingPlatform('https://evil.example/zoom.us')).toBe('unknown')
    expect(recorderMeetingPlatform(null)).toBe('unknown')
  })
})

describe('tray call membership and bounded database reads', () => {
  let sqlite: DatabaseSync
  let database: DB
  let queries: Array<{ query: string; params: SQLInputValue[] }>
  const liamAuth: RequestAuthResult = { userId: 'user-liam', orgId: 'tahi', sessionId: 'session-liam' }
  const staciAuth: RequestAuthResult = { userId: 'user-staci', orgId: 'tahi', sessionId: 'session-staci' }

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`CREATE TABLE team_members (id TEXT, email TEXT, clerk_user_id TEXT);
      CREATE TABLE integrations (service TEXT, status TEXT, config TEXT);
      CREATE TABLE discovery_calls (id TEXT, title TEXT, scheduled_at TEXT, duration_minutes INTEGER,
        attendees TEXT, status TEXT, google_meet_url TEXT, created_by_id TEXT);
      CREATE TABLE scheduled_calls (id TEXT, title TEXT, scheduled_at TEXT, duration_minutes INTEGER,
        attendees TEXT, status TEXT, meeting_url TEXT, created_by_id TEXT);
      INSERT INTO team_members VALUES ('member-liam', 'business@tahi.studio', 'user-liam');
      INSERT INTO team_members VALUES ('member-staci', 'staci@tahi.studio', 'user-staci');`)
    queries = []
    const prepare = (query: string) => {
      const bound = (...params: SQLInputValue[]) => ({
        bind: bound,
        raw: async () => {
          queries.push({ query, params })
          const statement = sqlite.prepare(query)
          statement.setReturnArrays(true)
          return statement.all(...params)
        },
      })
      return bound()
    }
    database = drizzle({ prepare } as unknown as AnyD1Database) as DB
    vi.mocked(resolveCallOrgId).mockReset().mockResolvedValue({ found: true, orgId: 'org-client' })
    vi.mocked(requireAccessToOrgOrPreClient).mockReset().mockResolvedValue(null)
  })
  afterEach(() => sqlite.close())

  function insertCall(kind: 'discovery' | 'scheduled', id: string, attendees: string[], createdById = 'user-other', scheduledAt = new Date(NOW).toISOString()) {
    const table = kind === 'discovery' ? 'discovery_calls' : 'scheduled_calls'
    sqlite.prepare(`INSERT INTO ${table} (id, title, scheduled_at, duration_minutes, attendees, status, created_by_id)
      VALUES (?, 'Planning', ?, 30, ?, 'scheduled', ?)`).run(id, scheduledAt, JSON.stringify(attendees.map(email => ({ email }))), createdById)
  }

  function googleAccount(email: string, status = 'connected') {
    sqlite.prepare('INSERT INTO integrations VALUES (?, ?, ?)').run('google_workspace', status, JSON.stringify({ email }))
  }

  it('matches only the member attending the call, without case sensitivity', async () => {
    insertCall('discovery', 'liam-call', [' BUSINESS@TAHI.STUDIO '])
    insertCall('scheduled', 'staci-call', ['STACI@TAHI.STUDIO'])
    expect((await recorderUpcomingCalls(database, liamAuth, NOW)).map(row => row.id)).toEqual(['liam-call'])
    expect((await recorderUpcomingCalls(database, staciAuth, NOW)).map(row => row.id)).toEqual(['staci-call'])
  })

  it('does not give other members the connected Google account calendar', async () => {
    googleAccount(' BUSINESS@TAHI.STUDIO ')
    insertCall('discovery', 'liam-calendar', ['business@tahi.studio', 'client@example.com'])
    insertCall('scheduled', 'staci-attending', ['staci@tahi.studio', 'client@example.com'])
    expect((await recorderUpcomingCalls(database, liamAuth, NOW)).map(row => row.id)).toEqual(['liam-calendar'])
    expect((await recorderUpcomingCalls(database, staciAuth, NOW)).map(row => row.id)).toEqual(['staci-attending'])
  })

  it('does not treat the connected calendar as proof of attendance when its account is absent', async () => {
    googleAccount('business@tahi.studio')
    insertCall('discovery', 'client-only', ['client@example.com'])
    expect(await recorderUpcomingCalls(database, liamAuth, NOW)).toEqual([])
  })

  it('matches calls created by the member using their stored Clerk or member identity', async () => {
    insertCall('discovery', 'clerk-created', ['client@example.com'], 'user-liam')
    insertCall('scheduled', 'member-created', [], 'member-liam')
    insertCall('scheduled', 'other-created', ['client@example.com'], 'user-staci')
    expect((await recorderUpcomingCalls(database, liamAuth, NOW)).map(row => row.id)).toEqual(['clerk-created', 'member-created'])
    expect((await recorderUpcomingCalls(database, staciAuth, NOW)).map(row => row.id)).toEqual(['other-created'])
  })

  it('ignores recorded actors for both member matching and access checks', async () => {
    insertCall('discovery', 'liam-call', ['business@tahi.studio'])
    insertCall('scheduled', 'staci-call', ['staci@tahi.studio'])
    const mcpActor: NonNullable<RequestAuthResult['mcpActor']> = { teamMemberId: 'member-liam', clerkUserId: 'user-liam', profile: 'full' }
    expect((await recorderUpcomingCalls(database, { ...staciAuth, mcpActor }, NOW)).map(row => row.id)).toEqual(['staci-call'])
    expect(requireAccessToOrgOrPreClient).toHaveBeenCalledWith(database, 'user-staci', 'org-client')
    queries.length = 0
    expect(await recorderUpcomingCalls(database, { ...liamAuth, userId: 'api-service', mcpActor }, NOW)).toEqual([])
    expect(queries).toEqual([])
  })

  it('still applies client access and call existence checks to member matches', async () => {
    insertCall('scheduled', 'owned-call', ['business@tahi.studio'])
    vi.mocked(requireAccessToOrgOrPreClient).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect(await recorderUpcomingCalls(database, liamAuth, NOW)).toEqual([])
    vi.mocked(requireAccessToOrgOrPreClient).mockResolvedValue(null)
    vi.mocked(resolveCallOrgId).mockResolvedValue({ found: false, orgId: null })
    expect(await recorderUpcomingCalls(database, liamAuth, NOW)).toEqual([])
  })

  it('adds a coarse scheduled_at SQL range in both tables before precise timezone filtering', async () => {
    insertCall('discovery', 'offset-now', ['business@tahi.studio'], 'user-other', '2026-10-14T13:00:00+13:00')
    insertCall('scheduled', 'precise-outside', ['business@tahi.studio'], 'user-other', '2026-10-14T00:18:00Z')
    insertCall('scheduled', 'long-ago', ['business@tahi.studio'], 'user-other', '2026-09-14T00:00:00Z')
    expect((await recorderUpcomingCalls(database, liamAuth, NOW)).map(row => row.id)).toEqual(['offset-now'])
    const reads = queries.filter(({ query }) => query.includes('from "discovery_calls"') || query.includes('from "scheduled_calls"'))
    expect(reads).toHaveLength(2)
    for (const { query, params } of reads) {
      expect(query).toContain('"scheduled_at" >= ?')
      expect(query).toContain('"scheduled_at" <= ?')
      expect(params).toEqual(['scheduled', '2026-10-13T00:00:00.000Z', '2026-10-15T00:00:00.000Z'])
    }
  })

  it('returns no calls for a missing member even if recorded actor identity exists', async () => {
    insertCall('scheduled', 'liam-call', ['business@tahi.studio'])
    expect(await recorderUpcomingCalls(database, { ...liamAuth, userId: 'user-unknown',
      mcpActor: { teamMemberId: 'member-liam', clerkUserId: 'user-liam', profile: 'full' } }, NOW)).toEqual([])
  })
})

import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org-tahi',
}))

let sqlite: DatabaseSync
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'))
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'owner', orgId: 'org-tahi', sessionId: null })
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE team_members (id TEXT, name TEXT, avatar_url TEXT, title TEXT, email TEXT, weekly_capacity_hours REAL);
    CREATE TABLE settings (key TEXT, value TEXT);
    CREATE TABLE time_entries (team_member_id TEXT, hours REAL, date TEXT);
    CREATE TABLE tasks (assignee_id TEXT, status TEXT, estimated_hours REAL, due_date TEXT);
    CREATE TABLE requests (assignee_id TEXT, status TEXT, estimated_hours REAL);
    INSERT INTO team_members VALUES
      ('liam', 'Liam', NULL, 'Founder', 'business@tahi.studio', 40),
      ('staci', 'Staci', NULL, 'Designer', 'staci@tahi.studio', 32),
      ('nathan', 'Nathan', NULL, 'Developer', 'nathan@tahi.studio', 40),
      ('zero', 'Zero', NULL, NULL, 'zero@tahi.studio', 0);
    INSERT INTO settings VALUES ('team.inactiveMemberEmails', '["nathan@tahi.studio"]');
    INSERT INTO time_entries VALUES ('liam', 3, '2026-10-14'), ('liam', 20, '2026-10-01'), ('nathan', 20, '2026-10-14');
    INSERT INTO tasks VALUES
      ('liam', 'open', 5, '2026-10-15'), ('liam', 'open', 2, '2026-10-01'),
      ('liam', 'done', 50, '2026-10-15'), ('liam', 'open', 50, '2026-10-22'),
      ('liam', 'open', 50, NULL), ('nathan', 'open', 100, '2026-10-15');
    INSERT INTO requests VALUES
      ('liam', 'in_progress', 4), ('liam', 'cancelled', 90),
      ('liam', 'delivered', 80), ('liam', 'archived', 70),
      ('liam', 'submitted', NULL), ('liam', 'submitted', 0),
      ('staci', 'client_review', 6), ('nathan', 'in_progress', 100);
  `)
  const database = drizzle(async (query: string, params: unknown[]) => {
    const statement = sqlite.prepare(query)
    statement.setReturnArrays(true)
    return { rows: statement.all(...params as SQLInputValue[]) }
  })
  vi.mocked(db).mockResolvedValue(database as unknown as Awaited<ReturnType<typeof db>>)
})
afterEach(() => { sqlite.close(); vi.useRealTimers() })

describe('GET pipeline capacity with real SQLite', () => {
  const request = () => new NextRequest('https://portal.tahi.studio/api/admin/pipeline/capacity')

  it('books open assigned work, excludes cancelled requests and inactive members, and keeps logged hours separate', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      teamMembers: [
        { id: 'liam', weeklyCapacityHours: 40, assignedHours: 11, loggedHours: 3, utilization: 28 },
        { id: 'staci', weeklyCapacityHours: 32, assignedHours: 6, loggedHours: 0, utilization: 19 },
      ],
      totalCapacity: 72, totalAssignedHours: 17, totalLoggedHours: 3, availableCapacity: 55,
      weekRange: { start: '2026-10-12', end: '2026-10-18' },
    })
  })

  it('refuses clients before reading capacity', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'client', orgId: 'org-client', sessionId: null })
    expect((await GET(request())).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
  })
})

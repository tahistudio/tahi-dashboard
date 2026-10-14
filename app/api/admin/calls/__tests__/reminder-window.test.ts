import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ database: null as unknown, admin: true, scope: { kind: 'all' } as { kind: string; orgIds?: string[] } }))
vi.mock('@/lib/db', () => ({ db: async () => h.database }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: async () => ({ userId: 'user-staci', orgId: 'tahi' }), isTahiAdmin: () => h.admin }))
vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: async () => h.scope }))
import { GET } from '../route'

let sqlite: DatabaseSync
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE scheduled_calls (id TEXT PRIMARY KEY, org_id TEXT, title TEXT, description TEXT,
    scheduled_at TEXT, duration_minutes INTEGER, meeting_url TEXT, attendees TEXT, status TEXT,
    notes TEXT, recording_url TEXT, created_at TEXT, created_by_id TEXT);
    INSERT INTO organisations VALUES ('org-acme', 'Acme');`)
  const prepare = (query: string) => {
    const bound = (...params: SQLInputValue[]) => ({
      bind: bound,
      all: async () => ({ results: sqlite.prepare(query).all(...params), success: true, meta: {} }),
      raw: async () => {
        const statement = sqlite.prepare(query)
        statement.setReturnArrays(true)
        return statement.all(...params)
      },
    })
    return bound()
  }
  h.database = drizzle({ prepare } as unknown as AnyD1Database)
  h.admin = true
  h.scope = { kind: 'all' }
})
afterEach(() => sqlite.close())

interface CallList { calls: { id: string; createdById: string; orgName: string }[] }

function call(id: string, instant: string, orgId = 'org-acme') {
  sqlite.prepare(`INSERT INTO scheduled_calls
    (id, org_id, title, scheduled_at, status, attendees, created_by_id)
    VALUES (?, ?, 'Check-in', ?, 'scheduled', '[]', 'user-staci')`).run(id, orgId, instant)
}
const windowQuery = 'status=scheduled&since=2026-10-14T21%3A00%3A00Z&until=2026-10-14T21%3A02%3A00Z'

describe('scheduled call reminder window', () => {
  it('filters before the cap and compares calendar offsets as real instants', async () => {
    for (let index = 0; index < 120; index += 1) call(`old-${index}`, '2026-10-10T21:00:00Z')
    call('later', '2026-10-14T21:01:30Z')
    call('first', '2026-10-15T10:01:00+13:00')
    call('outside', '2026-10-14T21:03:00Z')
    const response = await GET(new NextRequest(`http://localhost/api/admin/calls?${windowQuery}&limit=1`))
    expect(response.status).toBe(200)
    expect((await response.json() as CallList).calls).toMatchObject([{ id: 'first', createdById: 'user-staci', orgName: 'Acme' }])
  })

  it('keeps existing client scope while querying the window', async () => {
    call('allowed', '2026-10-14T21:01:00Z')
    call('denied', '2026-10-14T21:01:00Z', 'org-other')
    h.scope = { kind: 'some', orgIds: ['org-acme'] }
    const response = await GET(new NextRequest(`http://localhost/api/admin/calls?${windowQuery}`))
    expect((await response.json() as CallList).calls.map(row => row.id)).toEqual(['allowed'])
    h.scope = { kind: 'none' }
    expect((await (await GET(new NextRequest('http://localhost/api/admin/calls'))).json() as CallList).calls).toEqual([])
  })

  it('refuses invalid ranges and client audiences', async () => {
    expect((await GET(new NextRequest('http://localhost/api/admin/calls?since=invalid'))).status).toBe(400)
    expect((await GET(new NextRequest('http://localhost/api/admin/calls?since=2026-10-15T21:00:00Z&until=2026-10-14T21:00:00Z'))).status).toBe(400)
    h.admin = false
    expect((await GET(new NextRequest('http://localhost/api/admin/calls'))).status).toBe(403)
  })
})

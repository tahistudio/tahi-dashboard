import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scopedOrgIds } from '@/lib/access-scope'
import { requireFeature } from '@/lib/require-feature'
import { GET } from './route'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({ getRequestAuth: vi.fn().mockResolvedValue({ orgId: 'tahi', userId: 'owner' }), isTahiAdmin: () => true }))
vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn() }))

let sqlite: DatabaseSync
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'))
  vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'some', orgIds: ['org-a'] })
  vi.mocked(requireFeature).mockResolvedValue(null)
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE pipeline_stages (id TEXT, name TEXT, slug TEXT, probability INTEGER, position INTEGER, colour TEXT, is_default INTEGER, is_closed_won INTEGER, is_closed_lost INTEGER, created_at TEXT);
    INSERT INTO pipeline_stages VALUES ('open', 'Open', 'open', 50, 0, NULL, 0, 0, 0, ''), ('won', 'Won', 'won', 100, 1, NULL, 0, 1, 0, '');
    CREATE TABLE deals (id TEXT, org_id TEXT, stage_id TEXT, upfront_value_nzd REAL, monthly_value_nzd REAL, expected_close_date TEXT, close_reason TEXT);
    INSERT INTO deals VALUES ('hidden', 'org-b', 'open', 999999, 999999, '2026-10-16', NULL), ('archived', 'org-a', 'open', 999999, 999999, '2026-10-16', 'archived'), ('closed', 'org-a', 'won', 999999, 999999, '2026-10-16', NULL);
  `)
  const insert = sqlite.prepare('INSERT INTO deals VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (let index = 0; index < 230; index++) {
    insert.run(String(index), 'org-a', 'open', 100, 10, index < 150 ? '2026-10-16' : '2026-10-13', null)
  }
  const database = drizzle(async (query: string, params: unknown[]) => {
    const statement = sqlite.prepare(query)
    statement.setReturnArrays(true)
    return { rows: statement.all(...params as SQLInputValue[]) }
  })
  vi.mocked(db).mockResolvedValue(database as never)
})
afterEach(() => { sqlite.close(); vi.useRealTimers() })

describe('whole scoped pipeline closing counts', () => {
  const request = () => new NextRequest('https://portal.tahi.studio/api/admin/reports/pipeline-forecast')
  it('counts beyond one list page and excludes archived, closed and denied client deals', async () => {
    const response = await GET(request())
    const body = await response.json() as { closingSplit: { closingThisMonth: number; pastCloseDate: number }; weightedUpfrontNzd: number }
    expect(body.closingSplit).toEqual({ closingThisMonth: 150, pastCloseDate: 80 })
    expect(body.weightedUpfrontNzd).toBe(11500)
  })
  it('returns no closing counts for a denied organisation scope', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'none' })
    const response = await GET(request())
    expect((await response.json() as { closingSplit: unknown }).closingSplit).toEqual({ closingThisMonth: 0, pastCloseDate: 0 })
  })
  it('refuses feature access before reading money', async () => {
    vi.mocked(requireFeature).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await GET(request())).status).toBe(403)
  })
})

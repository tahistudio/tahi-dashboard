/**
 * Migration 0111 (CN.3, keeping in sync): the runner entry and the .sql mirror.
 *
 * Three slices code against this shape with raw SQL, so the statements are
 * pinned word for word: reject_reason on task_suggestions, the three indexes,
 * slack_work_posts and slack_digests. What is pinned besides:
 *
 *   ORDER. '0111' follows '0110' and is the last entry, so "all" applies it
 *   after the tables it indexes exist.
 *
 *   RE-RUN SAFETY. The ALTER is the one statement without IF NOT EXISTS; a
 *   second run hits "duplicate column name" and the runner counts it as
 *   already applied, the 0109 precedent.
 *
 *   THE MIRROR. drizzle/migrations/0111_cn3_sync.sql carries the same
 *   statements, so a wrangler apply and a runner apply leave the same database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'

const state = vi.hoisted(() => ({
  ran: [] as string[],
  failWith: null as string | null,
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: (orgId: string) => orgId === 'tahi-org',
}))

const dialect = new SQLiteSyncDialect()

vi.mock('@/lib/db', () => ({
  db: async () => ({
    run: async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql
      if (state.failWith && text.startsWith('ALTER TABLE')) throw new Error(state.failWith)
      state.ran.push(text)
      return { success: true }
    },
  }),
}))

const { GET, POST } = await import('../route')

const EXPECTED = [
  'ALTER TABLE task_suggestions ADD COLUMN reject_reason text',
  'CREATE INDEX IF NOT EXISTS idx_task_suggestions_applied_task ON task_suggestions(applied_task_id)',
  'CREATE INDEX IF NOT EXISTS idx_task_suggestions_applied_request ON task_suggestions(applied_request_id)',
  'CREATE INDEX IF NOT EXISTS idx_task_suggestions_org_status ON task_suggestions(org_id, status, decided_at)',
  'CREATE TABLE IF NOT EXISTS slack_work_posts (id text PRIMARY KEY, dedupe_key text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, suggestion_id text NOT NULL, channel_id text NOT NULL, thread_ts text NOT NULL, ts text, actor_key text NOT NULL, changes text NOT NULL, posted_at text NOT NULL, updated_at text NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_work_posts_dedupe ON slack_work_posts(dedupe_key)',
  'CREATE INDEX IF NOT EXISTS idx_slack_work_posts_thread ON slack_work_posts(channel_id, thread_ts, posted_at)',
  'CREATE TABLE IF NOT EXISTS slack_digests (id text PRIMARY KEY, week_key text NOT NULL, slack_user_id text NOT NULL, channel_id text, ts text, summary text, created_at text NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_digests_week_user ON slack_digests(week_key, slack_user_id)',
]

/** One statement as text, whatever its line breaks and indentation. */
function normalise(statement: string): string {
  return statement.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim()
}

function post(name: string): Request {
  return new Request('http://localhost/api/admin/db/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

type RunResult = { results: Array<{ name: string; status: string; statementCount?: number; skippedAlreadyExists?: number }> }

beforeEach(() => {
  state.ran.length = 0
  state.failWith = null
})

describe('migration 0111', () => {
  it('is listed straight after 0110, as the last migration', async () => {
    const res = await GET(new Request('http://localhost/api/admin/db/migrate') as never)
    const body = await res.json() as { migrations: Array<{ name: string; description: string; statementCount: number }> }
    const names = body.migrations.map(m => m.name)

    expect(names.indexOf('0111')).toBe(names.indexOf('0110') + 1)
    expect(names.at(-1)).toBe('0111')
    const entry = body.migrations.find(m => m.name === '0111')
    expect(entry?.statementCount).toBe(EXPECTED.length)
    expect(entry?.description).toContain('Apply BEFORE deploying: db/schema.ts names reject_reason, so every full-row select of task_suggestions reads it.')
  })

  it('runs exactly the statements the CN.3 contract names, in order', async () => {
    const res = await POST(post('0111') as never)
    const body = await res.json() as RunResult

    expect(body.results).toEqual([{ name: '0111', status: 'applied', statementCount: EXPECTED.length, skippedAlreadyExists: 0 }])
    expect(state.ran).toEqual(EXPECTED)
  })

  it('is safe to run twice: the ALTER that already ran counts as applied', async () => {
    state.failWith = 'D1_ERROR: duplicate column name: reject_reason: SQLITE_ERROR'
    const res = await POST(post('0111') as never)
    const body = await res.json() as RunResult

    expect(body.results[0]).toMatchObject({ name: '0111', status: 'applied', skippedAlreadyExists: 1 })
    expect(state.ran).toEqual(EXPECTED.slice(1))
  })

  it('has a .sql mirror carrying the same statements', () => {
    const file = readFileSync(join(process.cwd(), 'drizzle', 'migrations', '0111_cn3_sync.sql'), 'utf8')
    const statements = file
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(normalise)
      .filter(Boolean)

    expect(statements).toEqual(EXPECTED.map(normalise))
  })

  it('writes no dash of any kind into the description', async () => {
    const res = await GET(new Request('http://localhost/api/admin/db/migrate') as never)
    const body = await res.json() as { migrations: Array<{ name: string; description: string }> }
    const description = body.migrations.find(m => m.name === '0111')?.description ?? ''
    // Built from code points, so this file never holds the glyphs it checks for.
    for (const dash of [0x2013, 0x2014]) expect(description).not.toContain(String.fromCharCode(dash))
  })
})

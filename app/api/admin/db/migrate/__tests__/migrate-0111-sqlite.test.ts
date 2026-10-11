import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'

const state = vi.hoisted(() => ({ sqlite: null as DatabaseSync | null }))
const dialect = new SQLiteSyncDialect()

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'api-service' }),
  isTahiAdmin: (orgId: string | null) => orgId === 'tahi-org',
}))
vi.mock('@/lib/db', () => ({
  db: async () => ({
    run: async (query: SQL) => {
      if (!state.sqlite) throw new Error('Fixture database is unavailable')
      state.sqlite.exec(dialect.sqlToQuery(query).sql)
      return { success: true }
    },
  }),
}))

const { POST } = await import('../route')
const fileStatements = readFileSync(join(process.cwd(), 'drizzle/migrations/0111_cn3_sync.sql'), 'utf8')
  .split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
  .split(';').map(statement => statement.trim()).filter(Boolean)

beforeEach(() => {
  state.sqlite = new DatabaseSync(':memory:')
  state.sqlite.exec(`
    CREATE TABLE task_suggestions (
      id TEXT PRIMARY KEY, applied_task_id TEXT, applied_request_id TEXT,
      org_id TEXT, status TEXT NOT NULL, decided_at TEXT, proposal TEXT NOT NULL
    );
    CREATE INDEX old_suggestion_status ON task_suggestions(status);
    INSERT INTO task_suggestions VALUES
      ('pending', NULL, NULL, 'org-a', 'pending', NULL, '{"title":"Keep this"}'),
      ('applied', 'task-a', 'request-a', 'org-a', 'applied', '2026-09-25', '{"title":"Applied"}');
  `)
})
afterEach(() => {
  state.sqlite?.close()
  state.sqlite = null
})

function database() {
  if (!state.sqlite) throw new Error('Fixture database is unavailable')
  return state.sqlite
}
async function runMigration() {
  const response = await POST(new Request('http://localhost/api/admin/db/migrate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '0111' }),
  }) as never)
  return response.json() as Promise<{
    results: Array<{ status: string; statementCount: number; skippedAlreadyExists: number }>
  }>
}
function oldRows() {
  return database().prepare('SELECT id, applied_task_id, applied_request_id, org_id, status, decided_at, proposal FROM task_suggestions ORDER BY id').all()
}

describe('CN.3 migration against real SQLite', () => {
  it('preserves suggestion data and existing indexes while adding nullable reasons', async () => {
    const before = oldRows()
    expect((await runMigration()).results).toEqual([
      { name: '0111', status: 'applied', statementCount: 9, skippedAlreadyExists: 0 },
    ])
    expect(oldRows()).toEqual(before)
    expect(database().prepare('SELECT reject_reason FROM task_suggestions').all()).toEqual([
      { reject_reason: null }, { reject_reason: null },
    ])
    expect(database().prepare("SELECT name FROM sqlite_schema WHERE name = 'old_suggestion_status'").get()).toBeTruthy()
    expect(database().prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' })
  })

  it('enforces one work post per dedupe key and one digest per recipient per week', async () => {
    await runMigration()
    const post = database().prepare(`INSERT INTO slack_work_posts
      (id, dedupe_key, entity_type, entity_id, suggestion_id, channel_id, thread_ts, actor_key, changes, posted_at, updated_at)
      VALUES (?, ?, 'task', 'task-a', 'applied', 'dm-a', '1', 'tm:a', '[]', 'now', 'now')`)
    post.run('post-a', 'same-change')
    expect(() => post.run('post-b', 'same-change')).toThrow(/UNIQUE constraint failed/)
    const digest = database().prepare('INSERT INTO slack_digests (id, week_key, slack_user_id, created_at) VALUES (?, ?, ?, ?)')
    digest.run('digest-a', '2026-W41', 'user-a', 'now')
    expect(() => digest.run('digest-b', '2026-W41', 'user-a', 'now')).toThrow(/UNIQUE constraint failed/)
    digest.run('digest-c', '2026-W41', 'user-b', 'now')
    digest.run('digest-d', '2026-W42', 'user-a', 'now')
    expect(database().prepare('SELECT COUNT(*) AS count FROM slack_digests').get()).toEqual({ count: 3 })
  })

  it.each(['runner', 'raw file'])('rejects null IDs in both new tables created through the %s', async source => {
    if (source === 'runner') await runMigration()
    else for (const statement of fileStatements) database().exec(statement)
    expect(() => database().prepare(`INSERT INTO slack_work_posts
      (id, dedupe_key, entity_type, entity_id, suggestion_id, channel_id, thread_ts, actor_key, changes, posted_at, updated_at)
      VALUES (NULL, 'null-id', 'task', 'task-a', 'applied', 'dm-a', '1', 'tm:a', '[]', 'now', 'now')`).run())
      .toThrow(/NOT NULL constraint failed: slack_work_posts.id/)
    expect(() => database().prepare(`INSERT INTO slack_digests (id, week_key, slack_user_id, created_at)
      VALUES (NULL, '2026-W41', 'user-a', 'now')`).run())
      .toThrow(/NOT NULL constraint failed: slack_digests.id/)
    for (const table of ['slack_work_posts', 'slack_digests']) {
      expect(database().prepare(`PRAGMA table_info(${table})`).all().find(column => column.name === 'id'))
        .toMatchObject({ pk: 1, notnull: 1 })
      expect(database().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 })
    }
  })

  it('resumes partial application through the runner without losing recorded reasons', async () => {
    for (const statement of fileStatements.slice(0, 4)) database().exec(statement)
    database().exec("UPDATE task_suggestions SET reject_reason = 'Already filed' WHERE id = 'pending'")
    const before = oldRows()
    const result = await runMigration()
    expect(result.results[0]).toMatchObject({ status: 'applied', statementCount: 8, skippedAlreadyExists: 1 })
    expect(oldRows()).toEqual(before)
    expect(database().prepare("SELECT reject_reason FROM task_suggestions WHERE id = 'pending'").get()).toEqual({ reject_reason: 'Already filed' })
    expect(database().prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'slack_%' ORDER BY name").all()).toEqual([
      { name: 'slack_digests' }, { name: 'slack_work_posts' },
    ])
    expect((await runMigration()).results[0]).toMatchObject({ status: 'applied', statementCount: 8, skippedAlreadyExists: 1 })
  })

  it('keeps the raw file single-use while the deployed runner safely retries', async () => {
    for (const statement of fileStatements) database().exec(statement)
    expect(() => database().exec(fileStatements[0])).toThrow(/duplicate column name/)
    expect((await runMigration()).results[0]).toMatchObject({ status: 'applied', skippedAlreadyExists: 1 })
    expect(oldRows()).toHaveLength(2)
  })
})

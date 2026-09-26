/**
 * lib/slack/events-seen.ts, the daily sweep of the Slack retry guard table.
 *
 * What is pinned here, against a real SQLite database built from migration
 * 0110 itself (node:sqlite behind the D1 shape drizzle's d1 driver calls):
 *
 *   THE WINDOW. Rows older than seven days go, everything newer stays, in
 *   both timestamp shapes the table holds (rememberSlackEvent's toISOString
 *   and the column default's shape without milliseconds).
 *
 *   THE COUNT comes back from D1, so the cron step reports a real number.
 *
 *   THE INDEX. The delete is answered from idx_slack_events_seen_at, which is
 *   why the sweep needed no migration of its own.
 *
 *   A FAILURE THROWS, so the cron step reports it rather than a sweep that
 *   looks healthy forever.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { describe, it, expect } from 'vitest'
import { SLACK_EVENTS_SEEN_RETENTION_DAYS, sweepSlackEventsSeen } from '../events-seen'

interface BoundStatement {
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ success: boolean; meta: { changes: number } }>
  raw(): Promise<unknown[][]>
}

function d1Adapter(sqlite: DatabaseSync) {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query)
      const bind = (...params: unknown[]): BoundStatement => ({
        async all() {
          return { results: stmt.all(...(params as never[])) as unknown[] }
        },
        async run() {
          const info = stmt.run(...(params as never[]))
          return { success: true, meta: { changes: Number(info.changes) } }
        },
        async raw() {
          const rows = stmt.all(...(params as never[])) as Array<Record<string, unknown>>
          return rows.map((row) => Object.values(row))
        },
      })
      return { bind, ...bind() }
    },
  }
}

const MIGRATION_0110 = readFileSync(
  join(__dirname, '../../../drizzle/migrations/0110_slack_identities.sql'),
  'utf8',
)

function seed(rows: Array<[id: string, seenAt: string]>) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MIGRATION_0110)
  const insert = sqlite.prepare('INSERT INTO slack_events_seen (id, seen_at) VALUES (?, ?)')
  for (const [id, seenAt] of rows) insert.run(id, seenAt)
  return { sqlite, database: drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) }
}

function remainingIds(sqlite: DatabaseSync): string[] {
  const rows = sqlite.prepare('SELECT id FROM slack_events_seen ORDER BY id').all() as Array<{ id: string }>
  return rows.map((row) => row.id)
}

const NOW = new Date('2026-09-26T12:00:00.000Z')

const ROWS: Array<[string, string]> = [
  ['Ev_month_old', '2026-08-30T09:00:00.000Z'],
  ['Ev_default_shape_old', '2026-09-10T08:00:00Z'],
  ['Ev_just_over_a_week', '2026-09-19T11:59:59.000Z'],
  ['Ev_just_under_a_week', '2026-09-19T12:00:01.000Z'],
  ['Ev_yesterday', '2026-09-25T10:00:00.000Z'],
  ['trig_a_minute_ago', '2026-09-26T11:59:00Z'],
]

describe('sweepSlackEventsSeen', () => {
  it('keeps a week of delivery ids', () => {
    expect(SLACK_EVENTS_SEEN_RETENTION_DAYS).toBe(7)
  })

  it('deletes every row older than seven days and keeps everything newer', async () => {
    const { sqlite, database } = seed(ROWS)

    const result = await sweepSlackEventsSeen(database, { now: NOW })

    expect(result).toEqual({ deleted: 3, cutoff: '2026-09-19T12:00:00.000Z' })
    expect(remainingIds(sqlite)).toEqual(['Ev_just_under_a_week', 'Ev_yesterday', 'trig_a_minute_ago'])
  })

  it('deletes nothing on a second run the same day', async () => {
    const { sqlite, database } = seed(ROWS)
    await sweepSlackEventsSeen(database, { now: NOW })

    const again = await sweepSlackEventsSeen(database, { now: NOW })

    expect(again.deleted).toBe(0)
    expect(remainingIds(sqlite)).toHaveLength(3)
  })

  it('leaves a fresh claim alone, so a retry arriving mid sweep is still caught', async () => {
    const { sqlite, database } = seed([['Ev_now', NOW.toISOString()]])
    const result = await sweepSlackEventsSeen(database, { now: NOW })
    expect(result.deleted).toBe(0)
    expect(remainingIds(sqlite)).toEqual(['Ev_now'])
  })

  it('answers the delete from the seen_at index migration 0110 already created', () => {
    const { sqlite } = seed(ROWS)
    const plan = sqlite
      .prepare('EXPLAIN QUERY PLAN DELETE FROM slack_events_seen WHERE seen_at < ?')
      .all('2026-09-19T12:00:00.000Z') as Array<{ detail: string }>
    expect(plan.map((row) => row.detail).join(' ')).toContain('idx_slack_events_seen_at')
  })

  it('throws when the table is missing, so the cron step reports it', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const database = drizzle(d1Adapter(sqlite) as unknown as AnyD1Database)
    await expect(sweepSlackEventsSeen(database, { now: NOW })).rejects.toThrow(/slack_events_seen/)
  })
})

/**
 * lib/slack/work-sync.ts, dashboard changes told to the Slack card thread
 * they came from (CN.3 sections 1 to 4).
 *
 * The engine runs against a real SQLite database (node:sqlite behind the D1
 * shape drizzle's d1 driver calls, the lib/slack/__tests__/events-seen.test.ts
 * pattern), built from migrations 0107, 0109 and 0110 themselves plus the
 * slack_work_posts shape migration 0111 creates. Every raw SQL statement in
 * the module is therefore parsed and run by SQLite, not by a guess at it.
 *
 * What is pinned here:
 *
 *   NOTHING HAPPENS WITHOUT A TOKEN. Production has no SLACK_BOT_TOKEN yet, so
 *   the unarmed path must not read, write or defer anything at all. A
 *   database that throws on any touch proves it.
 *
 *   THE RIGHT THREAD. Per item and channel, the card with the highest ts,
 *   compared as a number; nothing for a suggestion applied more than 120
 *   days ago.
 *
 *   THE RIGHT AUDIENCE. Founders cards hear everything but their own change;
 *   a member's note card only while they are still a member and still scoped
 *   to the item's client; a client card never.
 *
 *   ONE LINE, NOT A STREAM. The ten-minute rewrite, the daily cap, the claim
 *   before the post, the batch cap.
 *
 *   NEVER A THROW, whatever the database or Slack does.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/slack/defer', () => ({
  deferSlackWork: vi.fn(async () => undefined),
}))

const {
  BATCH_POST_CAP,
  COALESCE_WINDOW_MS,
  THREAD_DAILY_CAP,
  THREAD_HORIZON_DAYS,
  diffWorkFields,
  queueWorkSync,
  renderWorkLine,
  syncWorkChanges,
  workSyncArmed,
} = await import('../work-sync')
const { deferSlackWork } = await import('../defer')
const { SERVICE_USER_ID } = await import('@/lib/team-identity')

type Drizzle = Parameters<typeof syncWorkChanges>[0]
type WorkChange = Parameters<typeof syncWorkChanges>[1][number]
type WorkLineInput = Parameters<typeof renderWorkLine>[0]

// ── The database ────────────────────────────────────────────────────────────

const migration = (name: string) => readFileSync(join(__dirname, '../../../drizzle/migrations', name), 'utf8')

/** The columns the engine reads from the core tables, nothing more. */
const CORE_TABLES = `
  CREATE TABLE settings (key text PRIMARY KEY, value text, updated_at text);
  CREATE TABLE organisations (id text PRIMARY KEY, name text NOT NULL);
  CREATE TABLE contacts (id text PRIMARY KEY, org_id text NOT NULL, name text NOT NULL, email text, clerk_user_id text);
  CREATE TABLE team_members (id text PRIMARY KEY, name text NOT NULL, clerk_user_id text);
  CREATE TABLE tasks (id text PRIMARY KEY, title text NOT NULL, org_id text, status text NOT NULL DEFAULT 'todo');
  CREATE TABLE requests (id text PRIMARY KEY, title text NOT NULL, org_id text NOT NULL, request_number integer);
`

/** The shape migration 0111 (slice N) creates, per contract section 9. */
const SLACK_WORK_POSTS = `
  CREATE TABLE IF NOT EXISTS slack_work_posts (
    id text PRIMARY KEY,
    dedupe_key text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    suggestion_id text NOT NULL,
    channel_id text NOT NULL,
    thread_ts text NOT NULL,
    ts text,
    actor_key text NOT NULL,
    changes text NOT NULL,
    posted_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_work_posts_dedupe ON slack_work_posts(dedupe_key);
  CREATE INDEX IF NOT EXISTS idx_slack_work_posts_thread ON slack_work_posts(channel_id, thread_ts, posted_at);
`

type QueryHook = (query: string, params: unknown[]) => unknown[] | undefined

function d1Adapter(sqlite: DatabaseSync, statements: string[], hook: { current: QueryHook | null }) {
  return {
    prepare(query: string) {
      statements.push(query)
      const stmt = sqlite.prepare(query)
      const bind = (...params: unknown[]) => ({
        async all() {
          const faked = hook.current?.(query, params)
          if (faked) return { results: faked }
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

// 14:02 in Auckland: NZDT started on 27 September 2026.
const NOW = new Date('2026-10-02T01:02:00.000Z')
const APPLIED = '2026-09-30T20:00:00Z'
const LINK_TASK = '<https://portal.tahi.studio/tasks/t1|Open task>'
const LINK_REQUEST = '<https://portal.tahi.studio/requests/r1|Open #231>'

interface World {
  sqlite: DatabaseSync
  database: Drizzle
  statements: string[]
  hook: { current: QueryHook | null }
}

function world(options: { workPosts?: boolean } = {}): World {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(migration('0107_task_suggestions.sql'))
  sqlite.exec(migration('0109_task_suggestions_requests.sql'))
  sqlite.exec(migration('0110_slack_identities.sql'))
  sqlite.exec(CORE_TABLES)
  if (options.workPosts !== false) sqlite.exec(SLACK_WORK_POSTS)

  sqlite.exec(`
    INSERT INTO organisations (id, name) VALUES ('o_ver', 'Verandela'), ('o_giant', 'Giant Group');
    INSERT INTO team_members (id, name, clerk_user_id) VALUES
      ('tm_liam', 'Liam Miller', 'user_liam'),
      ('tm_staci', 'Staci Bonnie', 'user_staci'),
      ('tm_nathan', 'Nathan Rowe', 'user_nathan');
    INSERT INTO slack_identities (id, slack_team_id, slack_user_id, level, team_member_id, dm_channel_id) VALUES
      ('si_liam', 'T1', 'U_LIAM', 'founder', 'tm_liam', 'D_LIAM'),
      ('si_staci', 'T1', 'U_STACI', 'founder', 'tm_staci', 'D_STACI'),
      ('si_nathan', 'T1', 'U_NATHAN', 'member', 'tm_nathan', 'D_NATHAN');
    INSERT INTO contacts (id, org_id, name, email, clerk_user_id) VALUES
      ('c_tim', 'o_ver', 'Tim Lyons', 'tim@verandela.test', 'user_tim');
    INSERT INTO tasks (id, title, org_id) VALUES ('t1', 'Footer LinkedIn tag', 'o_ver');
    INSERT INTO requests (id, title, org_id, request_number) VALUES ('r1', 'Footer LinkedIn tag', 'o_ver', 231);
  `)

  const statements: string[] = []
  const hook: { current: QueryHook | null } = { current: null }
  const database = drizzle(d1Adapter(sqlite, statements, hook) as unknown as AnyD1Database) as unknown as Drizzle
  return { sqlite, database, statements, hook }
}

let cardSeq = 0

/** An applied suggestion and the Slack copies of its card. */
function card(
  w: World,
  input: {
    taskId?: string
    requestId?: string
    approverType?: string
    approverId?: string | null
    appliedAt?: string
    status?: string
    copies: Array<[channel: string, ts: string]>
  },
): string {
  cardSeq += 1
  const id = `s${cardSeq}`
  w.sqlite.prepare(`
    INSERT INTO task_suggestions (
      id, source_kind, kind, proposal, quote, dedupe_key, status, approver_type, approver_id,
      applied_at, applied_task_id, applied_request_id
    ) VALUES (?, 'call', ?, '{}', 'a quote', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.requestId ? 'create_request' : 'create_task',
    `dedupe_${id}`,
    input.status ?? 'applied',
    input.approverType ?? 'founders',
    input.approverId ?? null,
    input.appliedAt ?? APPLIED,
    input.taskId ?? null,
    input.requestId ?? null,
  )
  for (const [channel, ts] of input.copies) {
    w.sqlite.prepare('INSERT INTO slack_suggestion_messages (id, suggestion_id, channel_id, ts) VALUES (?, ?, ?, ?)')
      .run(`m_${id}_${channel}_${ts}`, id, channel, ts)
  }
  return id
}

function workRows(w: World): Array<Record<string, unknown>> {
  return w.sqlite.prepare('SELECT * FROM slack_work_posts ORDER BY posted_at, id').all() as Array<Record<string, unknown>>
}

/** A database that fails the test the moment anything touches it. */
function tripwire(): { database: Drizzle; touched: string[] } {
  const touched: string[] = []
  const database = new Proxy({}, {
    get(_target, prop) {
      touched.push(String(prop))
      throw new Error(`database touched: ${String(prop)}`)
    },
  }) as unknown as Drizzle
  return { database, touched }
}

// ── Slack ───────────────────────────────────────────────────────────────────

interface Posted { channel: string; threadTs?: string; text: string }
interface Updated { channel: string; ts: string; text: string }

let posted: Posted[] = []
let updated: Updated[] = []
let postTs = 0
let postFails = false
let scopes: Record<string, string[] | null> = {}

function deps(now: Date = NOW) {
  return {
    now,
    postMessage: async (input: { channel: string; text: string; threadTs?: string }) => {
      if (postFails) throw new Error('Slack chat.postMessage failed: channel_not_found')
      posted.push({ channel: input.channel, threadTs: input.threadTs, text: input.text })
      postTs += 1
      return { channel: input.channel, ts: `1759370000.${String(postTs).padStart(6, '0')}` }
    },
    updateMessage: async (input: { channel: string; ts: string; text: string }) => {
      updated.push({ channel: input.channel, ts: input.ts, text: input.text })
      return { channel: input.channel, ts: input.ts }
    },
    resolveAccessScoping: async (_drizzle: unknown, clerkUserId: string | null) =>
      (clerkUserId && clerkUserId in scopes ? scopes[clerkUserId] : []),
  }
}

const studio = (clerkUserId: string | null) => ({ type: 'studio' as const, clerkUserId })

function taskDone(actor: WorkChange['actor'] = studio('user_staci'), entityId = 't1'): WorkChange {
  return { entityType: 'task', entityId, actor, changes: [{ field: 'status', from: 'todo', to: 'done' }] }
}

beforeEach(() => {
  posted = []
  updated = []
  postTs = 0
  postFails = false
  scopes = {}
  vi.mocked(deferSlackWork).mockClear()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.tahi.studio')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ── Not configured ──────────────────────────────────────────────────────────

describe('when Slack is not configured', () => {
  beforeEach(() => {
    vi.stubEnv('SLACK_BOT_TOKEN', '')
  })

  it('is not armed', () => {
    expect(workSyncArmed()).toBe(false)
  })

  it('returns slack_not_configured without touching the database', async () => {
    const { database, touched } = tripwire()
    const result = await syncWorkChanges(database, [taskDone(), taskDone(studio('user_liam'))], deps())
    expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 2, reason: 'slack_not_configured' })
    expect(touched).toEqual([])
    expect(posted).toEqual([])
  })

  it('queues nothing, so no background work is ever set up', async () => {
    const { database, touched } = tripwire()
    await queueWorkSync(database, [taskDone()])
    expect(vi.mocked(deferSlackWork)).not.toHaveBeenCalled()
    expect(touched).toEqual([])
  })
})

// ── Armed ───────────────────────────────────────────────────────────────────

describe('when Slack is configured', () => {
  beforeEach(() => {
    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test')
  })

  describe('queueWorkSync', () => {
    it('hands a real change to the background', async () => {
      const { database } = world()
      await queueWorkSync(database, [taskDone()])
      expect(vi.mocked(deferSlackWork)).toHaveBeenCalledTimes(1)
    })

    it('defers nothing for a system write or a change that did not move', async () => {
      const { database, touched } = tripwire()
      await queueWorkSync(database, [
        { ...taskDone(), actor: { type: 'system' } },
        { entityType: 'task', entityId: 't1', actor: studio('user_staci'), changes: [{ field: 'status', from: 'done', to: 'done' }] },
      ])
      await queueWorkSync(database, [])
      expect(vi.mocked(deferSlackWork)).not.toHaveBeenCalled()
      expect(touched).toEqual([])
    })

    it('never throws, even when the deferral does', async () => {
      vi.mocked(deferSlackWork).mockRejectedValueOnce(new Error('no context'))
      const { database } = world()
      await expect(queueWorkSync(database, [taskDone()])).resolves.toBeUndefined()
    })
  })

  describe('what is worth a line', () => {
    it('drops system writes and no-op diffs before reading anything', async () => {
      const { database, touched } = tripwire()
      const result = await syncWorkChanges(database, [
        { ...taskDone(), actor: { type: 'system' } },
        { entityType: 'request', entityId: 'r1', actor: studio('user_staci'), changes: [{ field: 'priority', from: 'high', to: 'high' }] },
      ], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 2, reason: 'nothing_to_sync' })
      expect(touched).toEqual([])
    })

    it('stops everything on the kill switch', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      w.sqlite.exec(`INSERT INTO settings (key, value) VALUES ('slack.workSync.enabled', 'false')`)
      const result = await syncWorkChanges(w.database, [taskDone()], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1, reason: 'disabled' })
      expect(posted).toEqual([])
    })

    it('reads a kill switch stored as JSON the same way', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      w.sqlite.exec(`INSERT INTO settings (key, value) VALUES ('slack.workSync.enabled', '"false"')`)
      const result = await syncWorkChanges(w.database, [taskDone()], deps())
      expect(result.reason).toBe('disabled')
    })

    it('counts a change with no card thread as skipped and posts nothing', async () => {
      const w = world()
      const result = await syncWorkChanges(w.database, [taskDone()], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
      expect(posted).toEqual([])
    })
  })

  describe('the thread', () => {
    it('posts one line under a founders card with the exact text', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      const result = await syncWorkChanges(w.database, [{
        entityType: 'task',
        entityId: 't1',
        actor: studio('user_staci'),
        changes: [
          { field: 'status', from: 'todo', to: 'done' },
          { field: 'dueDate', from: null, to: '2026-10-02' },
        ],
      }], deps())

      expect(result).toEqual({ posted: 1, rewritten: 0, skipped: 0 })
      expect(posted).toEqual([{
        channel: 'D_LIAM',
        threadTs: '1759300000.000100',
        text: `Staci marked it done and set the due date to Fri 2 Oct · 14:02 · ${LINK_TASK}`,
      }])
      const [row] = workRows(w)
      expect(row).toMatchObject({
        entity_type: 'task',
        entity_id: 't1',
        channel_id: 'D_LIAM',
        thread_ts: '1759300000.000100',
        ts: '1759370000.000001',
        actor_key: 'tm:tm_staci',
      })
      expect(String(row.dedupe_key)).toMatch(/^[0-9a-f]{64}$/)
    })

    it('uses the highest card ts per channel, compared as a number', async () => {
      const w = world()
      // A string compare would pick the nine-digit ts; the newer card is the
      // ten-digit one. The second suggestion also has a reposted copy.
      card(w, { taskId: 't1', copies: [['D_LIAM', '999999999.000900']] })
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000200'], ['D_LIAM', '1759300100.000100']] })
      await syncWorkChanges(w.database, [taskDone()], deps())
      expect(posted).toHaveLength(1)
      expect(posted[0].threadTs).toBe('1759300100.000100')
    })

    it('leaves a card applied more than 120 days ago alone', async () => {
      expect(THREAD_HORIZON_DAYS).toBe(120)
      const w = world()
      const longAgo = new Date(NOW.getTime() - 121 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
      card(w, { taskId: 't1', appliedAt: longAgo, copies: [['D_LIAM', '1749000000.000100']] })
      const result = await syncWorkChanges(w.database, [taskDone()], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
      expect(posted).toEqual([])
    })

    it('ignores a suggestion that was not applied', async () => {
      const w = world()
      card(w, { taskId: 't1', status: 'rejected', copies: [['D_LIAM', '1759300000.000100']] })
      await syncWorkChanges(w.database, [taskDone()], deps())
      expect(posted).toEqual([])
    })

    it('finds a request thread by applied_request_id and links its number', async () => {
      const w = world()
      card(w, { requestId: 'r1', copies: [['D_LIAM', '1759300000.000100']] })
      await syncWorkChanges(w.database, [{
        entityType: 'request',
        entityId: 'r1',
        actor: studio('user_staci'),
        changes: [{ field: 'status', from: 'in_progress', to: 'delivered' }],
      }], deps())
      expect(posted[0].text).toBe(`Staci marked it delivered · 14:02 · ${LINK_REQUEST}`)
    })

    it('still tells founders a task was deleted, with no link to a page that is gone', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      w.sqlite.exec(`DELETE FROM tasks WHERE id = 't1'`)
      await syncWorkChanges(w.database, [{
        entityType: 'task', entityId: 't1', actor: studio('user_staci'), changes: [{ field: 'deleted', to: null }],
      }], deps())
      expect(posted[0].text).toBe('Staci deleted it · 14:02')
    })
  })

  describe('who hears it', () => {
    it('skips the actor\'s own DM and posts to the other founder', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100'], ['D_STACI', '1759300000.000200']] })
      const result = await syncWorkChanges(w.database, [taskDone(studio('user_staci'))], deps())
      expect(result).toEqual({ posted: 1, rewritten: 0, skipped: 1 })
      expect(posted.map(p => p.channel)).toEqual(['D_LIAM'])
    })

    it('posts a change made through Claude to both founders', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100'], ['D_STACI', '1759300000.000200']] })
      await syncWorkChanges(w.database, [taskDone(studio(SERVICE_USER_ID))], deps())
      expect(posted.map(p => p.channel).sort()).toEqual(['D_LIAM', 'D_STACI'])
      expect(posted[0].text).toBe(`Claude marked it done · 14:02 · ${LINK_TASK}`)
      expect(workRows(w).map(row => row.actor_key)).toEqual(['service', 'service'])
    })

    it('posts when a channel cannot be tied to anyone', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_UNCACHED', '1759300000.000100']] })
      await syncWorkChanges(w.database, [taskDone(studio('user_staci'))], deps())
      expect(posted.map(p => p.channel)).toEqual(['D_UNCACHED'])
    })

    it('labels somebody the dashboard cannot place as Someone', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      await syncWorkChanges(w.database, [taskDone(studio('user_stranger'))], deps())
      expect(posted[0].text).toBe(`Someone marked it done · 14:02 · ${LINK_TASK}`)
      expect(workRows(w)[0].actor_key).toBe('unknown')
    })

    describe('a member\'s own note card', () => {
      function memberCard(w: World) {
        card(w, { taskId: 't1', approverType: 'member', approverId: 'tm_nathan', copies: [['D_NATHAN', '1759300000.000300']] })
      }

      it('hears it while they are a member scoped to the item\'s client', async () => {
        const w = world()
        memberCard(w)
        scopes = { user_nathan: ['o_ver'] }
        const result = await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps())
        expect(result.posted).toBe(1)
        expect(posted[0]).toMatchObject({ channel: 'D_NATHAN', threadTs: '1759300000.000300' })
        expect(posted[0].text).toBe(`Liam marked it done · 14:02 · ${LINK_TASK}`)
      })

      it('hears it with an unrestricted scope', async () => {
        const w = world()
        memberCard(w)
        scopes = { user_nathan: null }
        await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps())
        expect(posted).toHaveLength(1)
      })

      it('hears nothing once their access is revoked', async () => {
        const w = world()
        memberCard(w)
        scopes = { user_nathan: [] }
        const result = await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps())
        expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
        expect(posted).toEqual([])
      })

      it('hears nothing once their Slack level is no longer member', async () => {
        const w = world()
        memberCard(w)
        scopes = { user_nathan: ['o_ver'] }
        w.sqlite.exec(`UPDATE slack_identities SET level = 'unknown' WHERE team_member_id = 'tm_nathan'`)
        await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps())
        expect(posted).toEqual([])
      })

      it('hears nothing once the item moves to a client outside their scope', async () => {
        const w = world()
        memberCard(w)
        scopes = { user_nathan: ['o_ver'] }
        w.sqlite.exec(`UPDATE tasks SET org_id = 'o_giant' WHERE id = 't1'`)
        await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps())
        expect(posted).toEqual([])
      })

      it('needs some access for an item with no client, as the pre-client rule does', async () => {
        const w = world()
        memberCard(w)
        w.sqlite.exec(`UPDATE tasks SET org_id = NULL WHERE id = 't1'`)
        scopes = { user_nathan: [] }
        await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps())
        expect(posted).toEqual([])
        scopes = { user_nathan: ['o_giant'] }
        await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps(new Date(NOW.getTime() + 60_000)))
        expect(posted).toHaveLength(1)
      })

      it('hears nothing about a task that no longer exists', async () => {
        const w = world()
        memberCard(w)
        scopes = { user_nathan: null }
        w.sqlite.exec(`DELETE FROM tasks WHERE id = 't1'`)
        await syncWorkChanges(w.database, [{
          entityType: 'task', entityId: 't1', actor: studio('user_liam'), changes: [{ field: 'deleted', to: null }],
        }], deps())
        expect(posted).toEqual([])
      })

      it('never hears about their own change', async () => {
        const w = world()
        memberCard(w)
        scopes = { user_nathan: null }
        await syncWorkChanges(w.database, [taskDone(studio('user_nathan'))], deps())
        expect(posted).toEqual([])
      })
    })

    it('never posts into a client\'s card thread', async () => {
      const w = world()
      card(w, { requestId: 'r1', approverType: 'contact', approverId: 'c_tim', copies: [['D_TIM', '1759300000.000400']] })
      const result = await syncWorkChanges(w.database, [{
        entityType: 'request', entityId: 'r1', actor: studio('user_liam'), changes: [{ field: 'status', from: 'submitted', to: 'in_progress' }],
      }], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
      expect(posted).toEqual([])
    })
  })

  describe('client actors', () => {
    it('names a client by first name and company', async () => {
      const w = world()
      card(w, { requestId: 'r1', copies: [['D_LIAM', '1759300000.000100']] })
      await syncWorkChanges(w.database, [{
        entityType: 'request',
        entityId: 'r1',
        actor: { type: 'client', contactId: 'c_tim', clerkUserId: 'user_tim' },
        changes: [{ field: 'status', from: 'client_review', to: 'delivered', phrase: 'approved the delivery' }],
      }], deps())
      expect(posted[0].text).toBe(`Tim at Verandela approved the delivery · 14:02 · ${LINK_REQUEST}`)
      expect(workRows(w)[0].actor_key).toBe('contact:c_tim')
    })

    it('finds the client from their login when the route did not look them up', async () => {
      const w = world()
      card(w, { requestId: 'r1', copies: [['D_LIAM', '1759300000.000100']] })
      await syncWorkChanges(w.database, [{
        entityType: 'request',
        entityId: 'r1',
        actor: { type: 'client', contactId: null, clerkUserId: 'user_tim' },
        changes: [{ field: 'status', from: 'client_review', to: 'delivered', phrase: 'approved the delivery' }],
      }], deps())
      expect(posted[0].text).toBe(`Tim at Verandela approved the delivery · 14:02 · ${LINK_REQUEST}`)
    })

    it('names the studio acting as the client as itself, and skips its own DM', async () => {
      const w = world()
      card(w, { requestId: 'r1', copies: [['D_LIAM', '1759300000.000100'], ['D_STACI', '1759300000.000200']] })
      await syncWorkChanges(w.database, [{
        entityType: 'request',
        entityId: 'r1',
        actor: { type: 'client', contactId: 'c_tim', clerkUserId: 'user_liam', actingAsTeamMemberId: 'tm_liam' },
        changes: [{ field: 'status', from: 'client_review', to: 'delivered', phrase: 'approved it' }],
      }], deps())
      expect(posted).toEqual([{
        channel: 'D_STACI',
        threadTs: '1759300000.000200',
        text: `Liam as Tim approved it · 14:02 · ${LINK_REQUEST}`,
      }])
      expect(workRows(w)[0].actor_key).toBe('acting:tm_liam:c_tim')
    })

    it('never merges the studio acting as a client with the client themselves', async () => {
      const w = world()
      card(w, { requestId: 'r1', copies: [['D_STACI', '1759300000.000200']] })
      await syncWorkChanges(w.database, [{
        entityType: 'request',
        entityId: 'r1',
        actor: { type: 'client', contactId: 'c_tim', clerkUserId: 'user_liam', actingAsTeamMemberId: 'tm_liam' },
        changes: [{ field: 'status', from: 'client_review', to: 'delivered', phrase: 'approved it' }],
      }], deps())
      const second = await syncWorkChanges(w.database, [{
        entityType: 'request',
        entityId: 'r1',
        actor: { type: 'client', contactId: 'c_tim', clerkUserId: 'user_tim' },
        changes: [{ field: 'waitingOn', to: null, phrase: 'sent it back to the studio' }],
      }], deps(new Date(NOW.getTime() + 5 * 60_000)))

      expect(second).toEqual({ posted: 1, rewritten: 0, skipped: 0 })
      expect(updated).toEqual([])
      expect(posted.map(line => line.text)).toEqual([
        `Liam as Tim approved it · 14:02 · ${LINK_REQUEST}`,
        `Tim at Verandela sent it back to the studio · 14:07 · ${LINK_REQUEST}`,
      ])
    })
  })

  describe('one line, not a stream', () => {
    it('rewrites the same person\'s line within ten minutes instead of adding one', async () => {
      expect(COALESCE_WINDOW_MS).toBe(600_000)
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      await syncWorkChanges(w.database, [taskDone()], deps())
      const second = await syncWorkChanges(w.database, [{
        entityType: 'task', entityId: 't1', actor: studio('user_staci'), changes: [{ field: 'dueDate', from: null, to: '2026-10-02' }],
      }], deps(new Date(NOW.getTime() + 5 * 60_000)))

      expect(second).toEqual({ posted: 0, rewritten: 1, skipped: 0 })
      expect(posted).toHaveLength(1)
      expect(updated).toEqual([{
        channel: 'D_LIAM',
        ts: '1759370000.000001',
        text: `Staci marked it done and set the due date to Fri 2 Oct · 14:07 · ${LINK_TASK}`,
      }])
      const rows = workRows(w)
      expect(rows).toHaveLength(1)
      expect(JSON.parse(String(rows[0].changes))).toEqual([
        { field: 'status', from: 'todo', to: 'done' },
        { field: 'dueDate', from: null, to: '2026-10-02' },
      ])
    })

    it('keeps the earliest before and the latest after when a field moves twice', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      await syncWorkChanges(w.database, [taskDone()], deps())
      await syncWorkChanges(w.database, [{
        entityType: 'task', entityId: 't1', actor: studio('user_staci'), changes: [{ field: 'status', from: 'done', to: 'in_progress' }],
      }], deps(new Date(NOW.getTime() + 60_000)))
      // todo, then done, then in progress: one line saying where it ended.
      expect(updated[0].text).toBe(`Staci moved it to In Progress · 14:03 · ${LINK_TASK}`)
    })

    it('posts a fresh line once the window has passed, or for somebody else', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_STACI', '1759300000.000200']] })
      await syncWorkChanges(w.database, [taskDone(studio('user_liam'))], deps())
      await syncWorkChanges(w.database, [taskDone(studio(SERVICE_USER_ID))], deps(new Date(NOW.getTime() + 60_000)))
      await syncWorkChanges(w.database, [{
        entityType: 'task', entityId: 't1', actor: studio('user_liam'), changes: [{ field: 'priority', from: 'standard', to: 'high' }],
      }], deps(new Date(NOW.getTime() + 11 * 60_000)))
      expect(posted).toHaveLength(3)
      expect(updated).toEqual([])
    })

    it('uses the twelfth line of a day for the cap line, then goes quiet', async () => {
      expect(THREAD_DAILY_CAP).toBe(12)
      const w = world()
      const suggestionId = card(w, { requestId: 'r1', copies: [['D_LIAM', '1759300000.000100']] })
      const earlier = new Date(NOW.getTime() - 60 * 60_000).toISOString()
      const insert = w.sqlite.prepare(`
        INSERT INTO slack_work_posts (id, dedupe_key, entity_type, entity_id, suggestion_id, channel_id, thread_ts,
          ts, actor_key, changes, posted_at, updated_at)
        VALUES (?, ?, 'request', 'r1', ?, 'D_LIAM', '1759300000.000100', ?, ?, '[]', ?, ?)
      `)
      for (let i = 0; i < THREAD_DAILY_CAP - 1; i++) {
        insert.run(`old${i}`, `key${i}`, suggestionId, `1759360000.00000${i}`, `contact:other${i}`, earlier, earlier)
      }
      // A line from yesterday does not count against today.
      const yesterday = new Date(NOW.getTime() - 25 * 60 * 60_000).toISOString()
      insert.run('stale', 'key_stale', suggestionId, '1759200000.000001', 'contact:old', yesterday, yesterday)

      const change = (actor: string): WorkChange => ({
        entityType: 'request', entityId: 'r1', actor: studio(actor), changes: [{ field: 'priority', from: 'standard', to: 'high' }],
      })
      const capped = await syncWorkChanges(w.database, [change('user_staci')], deps())
      expect(capped).toEqual({ posted: 1, rewritten: 0, skipped: 0 })
      expect(posted[0].text).toBe(`More changes since then. The dashboard has the rest: ${LINK_REQUEST}`)
      expect(workRows(w).find(row => row.ts === '1759370000.000001')).toMatchObject({ actor_key: 'cap' })

      const quiet = await syncWorkChanges(w.database, [change(SERVICE_USER_ID)], deps(new Date(NOW.getTime() + 60_000)))
      expect(quiet).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
      expect(posted).toHaveLength(1)
    })

    it('posts at most twenty lines for one batch and counts the rest as skipped', async () => {
      expect(BATCH_POST_CAP).toBe(20)
      const w = world()
      const batch: WorkChange[] = []
      for (let i = 0; i < 25; i++) {
        w.sqlite.prepare('INSERT INTO tasks (id, title, org_id) VALUES (?, ?, ?)').run(`bulk${i}`, `Task ${i}`, 'o_ver')
        card(w, { taskId: `bulk${i}`, copies: [['D_LIAM', `17593${String(i).padStart(5, '0')}.000100`]] })
        batch.push(taskDone(studio('user_staci'), `bulk${i}`))
      }
      const result = await syncWorkChanges(w.database, batch, deps())
      expect(result).toEqual({ posted: 20, rewritten: 0, skipped: 5 })
      expect(posted).toHaveLength(20)
    })
  })

  describe('the claim', () => {
    it('posts nothing when another request holds the claim', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      w.hook.current = (query) => (query.includes('WHERE dedupe_key') ? [{ id: 'somebody-else' }] : undefined)
      const result = await syncWorkChanges(w.database, [taskDone()], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
      expect(posted).toEqual([])
    })

    it('posts once when two requests race on the same change', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      const [a, b] = await Promise.all([
        syncWorkChanges(w.database, [taskDone()], deps()),
        syncWorkChanges(w.database, [taskDone()], deps()),
      ])
      expect(posted).toHaveLength(1)
      expect(a.posted + b.posted).toBe(1)
    })

    it('gives the claim back when the post fails', async () => {
      const w = world()
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      postFails = true
      const result = await syncWorkChanges(w.database, [taskDone()], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
      expect(workRows(w)).toEqual([])

      postFails = false
      await syncWorkChanges(w.database, [taskDone()], deps())
      expect(posted).toHaveLength(1)
    })

    it('posts nothing and does not throw while slack_work_posts is not migrated', async () => {
      const w = world({ workPosts: false })
      card(w, { taskId: 't1', copies: [['D_LIAM', '1759300000.000100']] })
      const result = await syncWorkChanges(w.database, [taskDone()], deps())
      expect(result).toEqual({ posted: 0, rewritten: 0, skipped: 1 })
      expect(posted).toEqual([])
    })

    it('swallows any error inside and reports what it had done', async () => {
      const broken = {
        all: async () => { throw new Error('D1 unavailable') },
        run: async () => { throw new Error('D1 unavailable') },
      } as unknown as Drizzle
      await expect(syncWorkChanges(broken, [taskDone()], deps())).resolves.toEqual({ posted: 0, rewritten: 0, skipped: 0 })

      const w = world()
      w.sqlite.exec('DROP TABLE task_suggestions')
      await expect(syncWorkChanges(w.database, [taskDone()], deps())).resolves.toMatchObject({ posted: 0 })
    })
  })
})

// ── The line ────────────────────────────────────────────────────────────────

describe('diffWorkFields', () => {
  it('keeps only the keys that were written and actually moved', () => {
    expect(diffWorkFields(
      { status: 'todo', assignee: 'tm_liam', dueDate: null, priority: 'high' },
      { status: 'done', assignee: 'tm_liam', dueDate: '' },
    )).toEqual([{ field: 'status', from: 'todo', to: 'done' }])
  })

  it('marks a before it was not given as unread rather than empty', () => {
    expect(diffWorkFields({}, { priority: 'high' })).toEqual([{ field: 'priority', to: 'high' }])
  })

  it('reads an undefined after as not written', () => {
    expect(diffWorkFields({ status: 'todo' }, { status: undefined })).toEqual([])
  })
})

describe('renderWorkLine', () => {
  const outputs: string[] = []
  function line(input: Partial<WorkLineInput> & Pick<WorkLineInput, 'changes'>): string {
    const out = renderWorkLine({
      entityType: 'task',
      actor: 'Liam',
      time: '09:41',
      link: { url: 'https://portal.tahi.studio/tasks/t1', label: 'Open task' },
      ...input,
    })
    outputs.push(out)
    return out
  }
  /** The phrase alone, without the actor, time and link around it. */
  function phrase(input: Partial<WorkLineInput> & Pick<WorkLineInput, 'changes'>): string {
    return line({ ...input, time: null, link: null }).replace(/^\S+ /, '')
  }

  it('says what happened to a task\'s status', () => {
    expect(phrase({ changes: [{ field: 'status', from: 'todo', to: 'done' }] })).toBe('marked it done')
    expect(phrase({ changes: [{ field: 'status', from: 'done', to: 'in_progress' }] })).toBe('reopened it as In Progress')
    expect(phrase({ changes: [{ field: 'status', to: 'blocked' }] })).toBe('moved it to Blocked')
  })

  it('says what happened to a request\'s status', () => {
    const request = { entityType: 'request' as const }
    expect(phrase({ ...request, changes: [{ field: 'status', to: 'delivered' }] })).toBe('marked it delivered')
    expect(phrase({ ...request, changes: [{ field: 'status', to: 'archived' }] })).toBe('archived it')
    expect(phrase({ ...request, changes: [{ field: 'status', to: 'cancelled' }] })).toBe('cancelled it')
    expect(phrase({ ...request, changes: [{ field: 'status', to: 'client_review' }] })).toBe('moved it to Client Review')
  })

  it('says who it was handed to', () => {
    const names = { tm_liam: 'Liam', tm_staci: 'Staci' }
    expect(phrase({ names, changes: [{ field: 'assignee', to: 'tm_staci' }] })).toBe('assigned it to Staci')
    expect(phrase({ names, actorTeamMemberId: 'tm_liam', changes: [{ field: 'assignee', to: 'tm_liam' }] })).toBe('took it on')
    expect(phrase({ names, changes: [{ field: 'assignee', from: 'tm_liam', to: null }] })).toBe('unassigned it')
  })

  it('reads a due date as a calendar date, with no time zone in the way', () => {
    expect(phrase({ changes: [{ field: 'dueDate', to: '2026-10-02' }] })).toBe('set the due date to Fri 2 Oct')
    expect(phrase({ changes: [{ field: 'dueDate', to: '2026-01-01' }] })).toBe('set the due date to Thu 1 Jan')
    expect(phrase({ changes: [{ field: 'dueDate', to: '2026-12-31T00:00:00.000Z' }] })).toBe('set the due date to Thu 31 Dec')
    expect(phrase({ changes: [{ field: 'dueDate', from: '2026-10-02', to: null }] })).toBe('cleared the due date')
  })

  it('says the priority, the new title clipped, the hand-off and the deletion', () => {
    expect(phrase({ changes: [{ field: 'priority', to: 'high' }] })).toBe('set the priority to high')
    expect(phrase({ changes: [{ field: 'title', to: 'New footer tag' }] })).toBe('renamed it to "New footer tag"')
    const long = 'x'.repeat(100)
    expect(phrase({ changes: [{ field: 'title', to: long }] })).toBe(`renamed it to "${'x'.repeat(80)}..."`)
    expect(phrase({ changes: [{ field: 'waitingOn', to: 'Tim Lyons', phrase: 'handed it to Tim Lyons, waiting on approval' }] }))
      .toBe('handed it to Tim Lyons, waiting on approval')
    expect(phrase({ changes: [{ field: 'deleted', to: null }] })).toBe('deleted it')
  })

  it('lets a caller phrase replace the default', () => {
    expect(phrase({ entityType: 'request', changes: [{ field: 'status', to: 'delivered', phrase: 'approved the delivery' }] }))
      .toBe('approved the delivery')
  })

  it('joins one, two and three changes the way a person would', () => {
    expect(phrase({ changes: [{ field: 'priority', to: 'high' }] })).toBe('set the priority to high')
    expect(phrase({ changes: [{ field: 'priority', to: 'high' }, { field: 'status', to: 'done' }] }))
      .toBe('marked it done and set the priority to high')
    expect(phrase({
      names: { tm_staci: 'Staci' },
      changes: [{ field: 'status', to: 'done' }, { field: 'assignee', to: 'tm_staci' }, { field: 'priority', to: 'high' }],
    })).toBe('marked it done, assigned it to Staci and set the priority to high')
  })

  it('puts the time and the link after the words', () => {
    expect(line({ changes: [{ field: 'status', to: 'done' }] }))
      .toBe('Liam marked it done · 09:41 · <https://portal.tahi.studio/tasks/t1|Open task>')
    expect(line({ actor: 'Claude', changes: [{ field: 'status', to: 'done' }] })).toMatch(/^Claude marked it done/)
    expect(line({ actor: 'Liam as Tim', entityType: 'request', changes: [{ field: 'status', to: 'delivered', phrase: 'approved it' }] }))
      .toMatch(/^Liam as Tim approved it · 09:41/)
    expect(line({ link: null, changes: [{ field: 'deleted', to: null }] })).toBe('Liam deleted it · 09:41')
  })

  it('escapes what people typed, and only that', () => {
    expect(line({ actor: 'A&B', changes: [{ field: 'title', to: '<script> & "tags"' }] }))
      .toBe('A&amp;B renamed it to "&lt;script&gt; &amp; "tags"" · 09:41 · <https://portal.tahi.studio/tasks/t1|Open task>')
  })

  it('never writes an em or en dash, in any line or anywhere in the module', () => {
    // Built from code points so this file carries no dash of its own.
    const dash = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)
    expect(outputs.length).toBeGreaterThan(10)
    for (const out of outputs) expect(out).not.toMatch(dash)
    const source = readFileSync(join(__dirname, '../work-sync.ts'), 'utf8')
    expect(source).not.toMatch(dash)
  })
})

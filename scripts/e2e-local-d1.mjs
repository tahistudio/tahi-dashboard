#!/usr/bin/env node
/**
 * Build the local (miniflare) D1 from scratch, the way CI does.
 *
 * WHY THIS EXISTS. On 2026-09-13 the tenancy proof was run against a
 * hand-seeded QA sqlite that was six migrations behind, and
 * `GET /api/portal/notifications` answered
 * "D1_ERROR: no such table: notification_preferences": a real 500 that read
 * like a tenancy failure for a while. Nothing reapplies migrations to a local
 * D1 on its own, so the only durable fix is to build the schema from zero every
 * time. See the memory note project_qa_worktree_recipe.
 *
 * TWO SOURCES, IN THIS ORDER. The schema does not live in one place:
 *   1. drizzle/migrations/*.sql, replayed here.
 *   2. the inline migrations in app/api/admin/db/migrate/route.ts, replayed by
 *      the caller with `POST /api/admin/db/migrate {"name":"all"}` once a dev
 *      server is up. Workers have no filesystem, so migrations 0012 to 0097
 *      only ever existed as inline SQL in that route, which is why the drizzle
 *      folder jumps 0016 -> 0037 -> 0063 -> 0073 -> 0081.
 * A handful of drizzle statements depend on tables from source 2 (0083 alters
 * ai_reply_drafts, which no drizzle file creates). Those are written to
 * .wrangler/e2e-deferred-statements.json and settled by `--verify` after the
 * route has run. .github/workflows/e2e-tenancy.yml runs the whole sequence.
 *
 * WHY NOT `wrangler d1 execute --file` PER MIGRATION. The drizzle folder is not
 * replayable as a linear history: numbers collide (three 0004_*.sql),
 * 0002_request_steps_queue_order.sql recreates a table 0000 already made, and
 * 0003_married_molecule_man.sql indexes a column 0004 adds. wrangler aborts a
 * file at its first failing statement, so those collisions would silently skip
 * the rest of the file. Statements are applied one at a time here instead, in
 * passes, and only the two benign idempotency errors ("already exists",
 * "duplicate column name") are swallowed.
 *
 * Usage, from the repo root:
 *   node scripts/e2e-local-d1.mjs --reset     # fresh D1, replay the sql files
 *   node scripts/e2e-local-d1.mjs --verify    # after the runtime route has run
 *
 * --reset deletes .wrangler/state/v3/d1 first. Without it the replay runs
 * against whatever is there, which is safe (every statement is idempotent by
 * the time it is applied) but slower and less honest than starting from zero.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@libsql/client'

const BINDING = process.env.D1_BINDING ?? 'DB'
const MIGRATIONS_DIR = process.env.D1_MIGRATIONS_DIR ?? 'drizzle/migrations'
const STATE_DIR = path.join('.wrangler', 'state', 'v3', 'd1')
const OBJECT_DIR = path.join(STATE_DIR, 'miniflare-D1DatabaseObject')
const DEFERRED_FILE = path.join('.wrangler', 'e2e-deferred-statements.json')
const MIN_TABLES = 50

/**
 * Tables that only exist once BOTH sources have been replayed, named here
 * because each one was missing from the seeded QA sqlite on 2026-09-13 and cost
 * a debugging session. If --verify passes, the schema is whole.
 */
const REQUIRED_TABLES = [
  'organisations',
  'requests',
  'conversations',
  'contracts',
  'invoices',
  'feature_visibility',
  'notification_preferences',
  'webhook_deliveries',
  'financial_snapshots',
  'ai_reply_drafts',
]

/** Errors that mean "this statement already happened", and nothing else. */
const BENIGN = ['already exists', 'duplicate column name']

function isBenign(message) {
  const lower = message.toLowerCase()
  return BENIGN.some(fragment => lower.includes(fragment))
}

/**
 * Split a migration file into statements.
 *
 * Drizzle writes `--> statement-breakpoint` between statements, hand-written
 * migrations just use semicolons, and both carry `--` comments. Quotes are
 * tracked so a semicolon inside a string literal never splits a statement. No
 * migration in this repo defines a trigger, so there is no BEGIN ... END body
 * to worry about; add a guard here the day one appears.
 */
function splitStatements(sql) {
  const statements = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]
    const next = sql[i + 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        current += char
      }
      continue
    }
    if (!inSingle && !inDouble && !inBacktick && char === '-' && next === '-') {
      inLineComment = true
      i += 1
      continue
    }
    if (char === "'" && !inDouble && !inBacktick) inSingle = !inSingle
    else if (char === '"' && !inSingle && !inBacktick) inDouble = !inDouble
    else if (char === '`' && !inSingle && !inDouble) inBacktick = !inBacktick

    if (char === ';' && !inSingle && !inDouble && !inBacktick) {
      statements.push(current)
      current = ''
      continue
    }
    current += char
  }
  statements.push(current)

  return statements.map(s => s.trim()).filter(s => s.length > 0)
}

/**
 * Ask wrangler to create the local sqlite so miniflare owns the file name.
 *
 * wrangler's JS entry point is spawned directly rather than through npx: on
 * Windows, spawning the `npx.cmd` shim without a shell fails with EINVAL, and
 * turning the shell on would mean quoting the `select 1` argument by hand.
 */
function materialise() {
  const entry = path.join('node_modules', 'wrangler', 'bin', 'wrangler.js')
  if (!existsSync(entry)) {
    throw new Error(`wrangler is not installed at ${entry}; run npm ci first`)
  }
  execFileSync(
    process.execPath,
    [entry, 'd1', 'execute', BINDING, '--local', '--command', 'select 1'],
    { stdio: 'pipe' },
  )
}

/**
 * The sqlite file the dev server will open.
 *
 * miniflare names it from a hash of the binding, and an old snapshot copied in
 * by hand can leave a second file behind under a stale hash (that double-file
 * gotcha is in the memory note). wrangler has just written to the live one, so
 * the most recently modified file is the right answer.
 */
function findSqlite() {
  if (!existsSync(OBJECT_DIR)) return null
  const files = readdirSync(OBJECT_DIR)
    .filter(name => name.endsWith('.sqlite'))
    .map(name => path.join(OBJECT_DIR, name))
  if (files.length === 0) return null
  if (files.length > 1) {
    console.warn(`[e2e-local-d1] ${files.length} sqlite shards present; using the most recent`)
  }
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
}

function openClient() {
  materialise()
  const sqlite = findSqlite()
  if (!sqlite) throw new Error(`wrangler created no sqlite under ${OBJECT_DIR}`)
  console.log(`[e2e-local-d1] target ${sqlite}`)
  return createClient({ url: `file:${path.resolve(sqlite).split(path.sep).join('/')}` })
}

async function tableCount(client) {
  const res = await client.execute("select count(*) as n from sqlite_master where type = 'table'")
  return Number(res.rows[0]?.n ?? 0)
}

/** Replay every drizzle migration, in passes, and record what could not settle. */
async function apply() {
  if (process.argv.includes('--reset') && existsSync(STATE_DIR)) {
    rmSync(STATE_DIR, { recursive: true, force: true })
    console.log(`[e2e-local-d1] removed ${STATE_DIR}`)
  }
  if (!existsSync(MIGRATIONS_DIR)) {
    throw new Error(`no migrations directory at ${MIGRATIONS_DIR} (run from the repo root)`)
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()

  // Filename order is not application order, so the queue is replayed in
  // passes: anything that fails on a missing table or column is deferred to the
  // next pass. That converges in two or three passes and needs no
  // hand-maintained ordering file.
  const queue = []
  for (const name of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
    for (const statement of splitStatements(sql)) queue.push({ name, statement })
  }

  const client = openClient()
  let applied = 0
  let skipped = 0
  try {
    let pending = queue
    let pass = 0
    while (pending.length > 0) {
      pass += 1
      const deferred = []
      for (const item of pending) {
        try {
          await client.execute(item.statement)
          applied += 1
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (isBenign(message)) {
            skipped += 1
            continue
          }
          deferred.push({ ...item, error: message })
        }
      }
      console.log(
        `[e2e-local-d1] pass ${pass}: ${pending.length - deferred.length} settled, ${deferred.length} deferred`,
      )
      if (deferred.length === pending.length) {
        pending = deferred
        break
      }
      pending = deferred
    }

    const tables = await tableCount(client)
    console.log(
      `[e2e-local-d1] ${files.length} files, ${queue.length} statements, ${applied} applied, ${skipped} already present, ${tables} tables`,
    )
    if (tables < MIN_TABLES) {
      throw new Error(
        `only ${tables} tables after a full replay; expected more than ${MIN_TABLES}. ` +
          'The statements went somewhere other than the file the dev server opens.',
      )
    }

    mkdirSync(path.dirname(DEFERRED_FILE), { recursive: true })
    if (pending.length > 0) {
      // Not a failure yet. These are the statements that depend on inline-era
      // tables; --verify replays them after the runtime route has run and fails
      // there if any of them is a real defect rather than an ordering artefact.
      writeFileSync(DEFERRED_FILE, JSON.stringify(pending, null, 2))
      console.log(
        `[e2e-local-d1] ${pending.length} statements still failing, written to ${DEFERRED_FILE}:`,
      )
      for (const item of pending) console.log(`  ${item.name}: ${item.error}`)
      console.log('[e2e-local-d1] run --verify after POST /api/admin/db/migrate {"name":"all"}')
    } else if (existsSync(DEFERRED_FILE)) {
      unlinkSync(DEFERRED_FILE)
    }
  } finally {
    client.close()
  }
}

/** Settle the deferred statements and prove the whole schema is present. */
async function verify() {
  const client = openClient()
  try {
    const deferred = existsSync(DEFERRED_FILE)
      ? JSON.parse(readFileSync(DEFERRED_FILE, 'utf8'))
      : []
    const failures = []
    for (const item of deferred) {
      try {
        await client.execute(item.statement)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!isBenign(message)) failures.push(`${item.name}: ${message}`)
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} migration statements still fail after both sources were replayed:\n` +
          failures.join('\n'),
      )
    }
    console.log(`[e2e-local-d1] settled ${deferred.length} deferred statements`)

    const present = new Set()
    const rows = await client.execute("select name from sqlite_master where type = 'table'")
    for (const row of rows.rows) present.add(String(row.name))
    const missing = REQUIRED_TABLES.filter(name => !present.has(name))
    if (missing.length > 0) {
      throw new Error(`missing after both sources were replayed: ${missing.join(', ')}`)
    }

    const tables = await tableCount(client)
    console.log(`[e2e-local-d1] schema verified: ${tables} tables, all ${REQUIRED_TABLES.length} hot tables present`)
  } finally {
    client.close()
  }
}

const run = process.argv.includes('--verify') ? verify : apply
run().catch(err => {
  console.error(`[e2e-local-d1] ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

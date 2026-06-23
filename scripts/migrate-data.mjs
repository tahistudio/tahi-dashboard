#!/usr/bin/env node
// Orchestrator for tahi-test-dashboard -> tahi-dashboard data migration.
// Run from project root: node scripts/migrate-data.mjs <command>
//
// Commands:
//   status    print source + dest table row counts and R2 object counts
//   schema    pull source schema (CREATE TABLE / INDEX) and apply to dest
//   db        migrate every table from source to dest (idempotent, resumable)
//   r2        copy every R2 object from source to dest (skip if dest has it)
//   all       schema + db + r2 + final status
//   verify    re-run status and diff counts table-by-table
//
// Required env (or edit constants below):
//   TAHI_API_TOKEN     bearer token shared by both projects
//
// State is stored in scripts/.migrate-state.json (gitignored) so re-running
// after a crash resumes from the last completed table or R2 key.

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_PATH = join(__dirname, '.migrate-state.json')

const SOURCE = process.env.MIGRATE_SOURCE ?? 'https://tahi-test-dashboard.webflow.io/dashboard'
const DEST = process.env.MIGRATE_DEST ?? 'https://tahi-dashboard.webflow.io/dashboard'
const TOKEN = process.env.TAHI_API_TOKEN ?? 'tahi-mcp-dev-token-2026'

const HEADERS = { Authorization: `Bearer ${TOKEN}` }

const BATCH_SIZE = 500   // rows per export/import call
const R2_PAGE = 1000     // R2 keys per list call

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m',
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { tables: {}, r2: { lastKey: null, copied: 0 } }
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')) }
  catch { return { tables: {}, r2: { lastKey: null, copied: 0 } } }
}

function saveState(s) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2))
}

async function jget(base, path, query = {}) {
  const u = new URL(`${base}${path}`)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v))
  }
  const r = await fetch(u, { headers: HEADERS })
  if (!r.ok) {
    const body = await r.text().catch(() => '')
    throw new Error(`GET ${path} -> ${r.status}: ${body.slice(0, 200)}`)
  }
  return r.json()
}

async function jpost(base, path, body) {
  const r = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`POST ${path} -> ${r.status}: ${text.slice(0, 300)}`)
  }
  return r.json()
}

async function status() {
  console.log(`${c.bold}=== Source (${SOURCE}) ===${c.reset}`)
  const src = await jget(SOURCE, '/api/admin/migrate/db-tables')
  console.log(`  ${c.cyan}D1${c.reset}: ${src.tables.length} tables, ${src.total.toLocaleString()} total rows`)

  console.log(`${c.bold}=== Dest (${DEST}) ===${c.reset}`)
  const dst = await jget(DEST, '/api/admin/migrate/db-tables')
  console.log(`  ${c.cyan}D1${c.reset}: ${dst.tables.length} tables, ${dst.total.toLocaleString()} total rows`)

  console.log()
  console.log(`${c.bold}per-table diff:${c.reset}`)
  console.log(`  ${'TABLE'.padEnd(40)} ${'SRC'.padStart(10)} ${'DST'.padStart(10)}  STATUS`)
  console.log(`  ${'-'.repeat(40)} ${'-'.repeat(10)} ${'-'.repeat(10)}  ${'-'.repeat(20)}`)
  const dstMap = new Map(dst.tables.map(t => [t.name, t.rowCount]))
  for (const t of src.tables) {
    const dstCount = dstMap.get(t.name) ?? 0
    const status = dstCount === t.rowCount
      ? `${c.green}match${c.reset}`
      : dstCount === 0
        ? `${c.dim}empty${c.reset}`
        : dstCount < t.rowCount
          ? `${c.yellow}partial${c.reset}`
          : `${c.yellow}overflow${c.reset}`
    console.log(`  ${t.name.padEnd(40)} ${String(t.rowCount).padStart(10)} ${String(dstCount).padStart(10)}  ${status}`)
  }
  const srcNames = new Set(src.tables.map(t => t.name))
  const onlyDst = dst.tables.filter(t => !srcNames.has(t.name))
  if (onlyDst.length) {
    console.log(`  ${c.yellow}Only on dest:${c.reset} ${onlyDst.map(t => t.name).join(', ')}`)
  }

  // R2
  console.log()
  console.log(`${c.bold}=== R2 ===${c.reset}`)
  const [srcR2, dstR2] = await Promise.all([countR2(SOURCE), countR2(DEST)])
  console.log(`  source: ${srcR2.count} objects, ${(srcR2.size / 1e6).toFixed(2)} MB`)
  console.log(`  dest:   ${dstR2.count} objects, ${(dstR2.size / 1e6).toFixed(2)} MB`)

  return { src, dst, srcR2, dstR2 }
}

async function countR2(base) {
  let cursor = null, count = 0, size = 0
  do {
    const page = await jget(base, '/api/admin/migrate/r2-list', cursor ? { cursor } : {})
    count += page.objects.length
    size += page.objects.reduce((s, o) => s + (o.size || 0), 0)
    cursor = page.cursor
  } while (cursor)
  return { count, size }
}

async function dropDestTables() {
  console.log(`${c.bold}Dropping all dest tables${c.reset}`)
  const dst = await jget(DEST, '/api/admin/migrate/db-tables')
  if (dst.tables.length === 0) {
    console.log('  dest already empty')
    return
  }
  const drops = dst.tables.map(t => `DROP TABLE IF EXISTS "${t.name}"`)
  const DROP_BATCH = 20
  let total = 0
  for (let i = 0; i < drops.length; i += DROP_BATCH) {
    const chunk = drops.slice(i, i + DROP_BATCH)
    const result = await jpost(DEST, '/api/admin/migrate/db-exec', { statements: chunk })
    total += result.ok
    process.stdout.write(`\r  dropped ${total} / ${drops.length}`)
  }
  process.stdout.write('\n')
  console.log(`${c.green}Drop complete${c.reset}`)
}

async function applySchema({ stripFk = false } = {}) {
  console.log(`${c.bold}Schema sync starting${stripFk ? ' (FK stripped)' : ''}${c.reset}`)
  const src = await jget(SOURCE, '/api/admin/migrate/db-schema', stripFk ? { stripFk: 1 } : {})
  console.log(`  pulled ${src.tableCount} tables + ${src.indexCount} indexes from source`)

  const SCHEMA_BATCH = 20
  let okTotal = 0, failTotal = 0
  const failures = []
  for (let i = 0; i < src.statements.length; i += SCHEMA_BATCH) {
    const chunk = src.statements.slice(i, i + SCHEMA_BATCH)
    process.stdout.write(`\r  applying ${i + chunk.length} / ${src.statements.length}`)
    const result = await jpost(DEST, '/api/admin/migrate/db-exec', { statements: chunk })
    okTotal += result.ok
    failTotal += result.failed
    if (result.results) failures.push(...result.results)
  }
  process.stdout.write('\n')
  console.log(`  applied to dest: ${okTotal}/${okTotal + failTotal} succeeded`)
  if (failTotal > 0) {
    console.log(`${c.red}  ${failTotal} failed:${c.reset}`)
    for (const r of failures.slice(0, 20)) {
      console.log(`    - ${r.statement}...  ERR: ${r.error}`)
    }
    throw new Error(`${failTotal} schema statements failed`)
  }
  console.log(`${c.green}Schema sync complete${c.reset}`)
}

async function migrateDb() {
  const state = loadState()
  console.log(`${c.bold}D1 migration starting${c.reset}`)

  const src = await jget(SOURCE, '/api/admin/migrate/db-tables')
  const nonEmpty = src.tables.filter(t => t.rowCount > 0)
  console.log(`  ${nonEmpty.length} non-empty tables, ${nonEmpty.reduce((s, t) => s + t.rowCount, 0).toLocaleString()} rows total`)
  console.log()

  for (const t of nonEmpty) {
    if (state.tables[t.name]?.done) {
      console.log(`  ${c.dim}skip${c.reset} ${t.name.padEnd(40)} (already done)`)
      continue
    }
    const start = Date.now()
    let copied = state.tables[t.name]?.copied ?? 0
    let afterRowid = state.tables[t.name]?.lastRowid ?? 0
    process.stdout.write(`  ${c.cyan}${t.name.padEnd(40)}${c.reset} ${String(t.rowCount).padStart(8)} rows ...`)

    while (true) {
      const page = await jget(SOURCE, '/api/admin/migrate/db-export', { table: t.name, afterRowid, limit: BATCH_SIZE })
      if (page.rows.length === 0) break
      const result = await jpost(DEST, '/api/admin/migrate/db-import', { table: t.name, rows: page.rows })
      copied += page.rows.length
      process.stdout.write(`\r  ${c.cyan}${t.name.padEnd(40)}${c.reset} ${String(t.rowCount).padStart(8)} rows ... ${copied}/${t.rowCount} (batch inserted=${result.inserted})`)
      if (page.nextAfterRowid === null) break
      afterRowid = page.nextAfterRowid
      state.tables[t.name] = { copied, lastRowid: afterRowid, done: false }
      saveState(state)
    }

    state.tables[t.name] = { copied, done: true }
    saveState(state)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    process.stdout.write(`\r  ${c.green}done${c.reset} ${t.name.padEnd(40)} ${String(copied).padStart(8)} rows in ${elapsed}s\n`)
  }
  console.log(`${c.green}D1 migration complete${c.reset}`)
}

async function migrateR2() {
  const state = loadState()
  console.log(`${c.bold}R2 migration starting${c.reset}`)

  // Build the dest key set once (faster than HEAD per key for resumability)
  const destKeys = new Set()
  let cursor = null
  do {
    const page = await jget(DEST, '/api/admin/migrate/r2-list', cursor ? { cursor } : {})
    for (const o of page.objects) destKeys.add(o.key)
    cursor = page.cursor
  } while (cursor)
  console.log(`  dest already has ${destKeys.size} objects`)

  // Walk source
  cursor = null
  let total = 0, copied = 0, skipped = 0, bytes = 0
  do {
    const page = await jget(SOURCE, '/api/admin/migrate/r2-list', cursor ? { cursor } : {})
    for (const o of page.objects) {
      total++
      if (destKeys.has(o.key)) { skipped++; continue }
      // download from source
      const r = await fetch(`${SOURCE}/api/admin/migrate/r2-object?key=${encodeURIComponent(o.key)}`, { headers: HEADERS })
      if (!r.ok) {
        console.warn(`\n  ${c.yellow}skip${c.reset} ${o.key} (fetch ${r.status})`)
        continue
      }
      const ct = r.headers.get('content-type') ?? 'application/octet-stream'
      const customMeta = r.headers.get('x-r2-custom-metadata') ?? ''
      const buf = await r.arrayBuffer()
      // upload to dest
      const putHeaders = { ...HEADERS, 'content-type': ct }
      if (customMeta) putHeaders['x-r2-custom-metadata'] = customMeta
      const p = await fetch(`${DEST}/api/admin/migrate/r2-put?key=${encodeURIComponent(o.key)}`, {
        method: 'PUT', headers: putHeaders, body: buf,
      })
      if (!p.ok) {
        const t = await p.text().catch(() => '')
        console.warn(`\n  ${c.red}put fail${c.reset} ${o.key} ${p.status}: ${t.slice(0, 120)}`)
        continue
      }
      copied++
      bytes += buf.byteLength
      state.r2.lastKey = o.key
      state.r2.copied = (state.r2.copied ?? 0) + 1
      if (copied % 10 === 0) saveState(state)
      process.stdout.write(`\r  copied ${copied} / new ${copied + skipped} / total ${total}, ${(bytes / 1e6).toFixed(1)} MB`)
    }
    cursor = page.cursor
  } while (cursor)
  saveState(state)
  console.log(`\n${c.green}R2 migration complete${c.reset}: ${copied} copied, ${skipped} skipped (already present), ${total} total source objects`)
}

const cmd = process.argv[2]
try {
  if (cmd === 'status' || cmd === 'verify') await status()
  else if (cmd === 'schema') await applySchema({ stripFk: process.argv[3] === '--strip-fk' })
  else if (cmd === 'drop-dest') await dropDestTables()
  else if (cmd === 'reset-schema') {
    await dropDestTables()
    await applySchema({ stripFk: true })
  }
  else if (cmd === 'db') await migrateDb()
  else if (cmd === 'r2') await migrateR2()
  else if (cmd === 'all') { await applySchema(); await migrateDb(); await migrateR2(); await status() }
  else {
    console.log('Usage: node scripts/migrate-data.mjs <status|schema|reset-schema|drop-dest|db|r2|all|verify>')
    process.exit(1)
  }
} catch (e) {
  console.error(`${c.red}ERROR${c.reset}: ${e.message}`)
  process.exit(1)
}

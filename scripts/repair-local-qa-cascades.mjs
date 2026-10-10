#!/usr/bin/env node
// Restore missing deliverable cascades in a seeded LOCAL QA snapshot.
// Default is a read-only plan. Stop the dev server before --apply.
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { getTableName, is } from 'drizzle-orm'
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '../db/schema.ts'

const apply = process.argv.includes('--apply')
const quarantine = process.argv.includes('--quarantine-orphans')
const root = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
const quote = value => '"' + value.replaceAll('"', '""') + '"'
const parents = new Set(['contract_documents', 'proposals', 'project_schedules'])
const tables = Object.values(schema).filter(value => is(value, SQLiteTable)).map(getTableConfig)
const targets = new Map()
for (let changed = true; changed;) {
  changed = false
  for (const table of tables) {
    const keys = table.foreignKeys.filter(key => key.onDelete === 'cascade' && parents.has(getTableName(key.reference().foreignTable)))
    if (!keys.length) continue
    targets.set(table.name, keys)
    if (!parents.has(table.name)) { parents.add(table.name); changed = true }
  }
}
if (!fs.existsSync(root)) throw new Error('No local QA snapshot found. Nothing changed.')
const backupDir = path.resolve('.wrangler/qa-backups/cascades-' + Date.now())
for (const file of fs.readdirSync(root).filter(name => name.endsWith('.sqlite'))) {
  const database = new DatabaseSync(path.join(root, file))
  const plan = []
  for (const [name, keys] of targets) {
    const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
    if (!row) continue
    const existing = database.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all()
    const missing = keys.filter(key => {
      const ref = key.reference()
      return !existing.some(fk => fk.from === ref.columns[0].name && fk.table === getTableName(ref.foreignTable) && fk.to === ref.foreignColumns[0].name && fk.on_delete === 'CASCADE')
    })
    if (missing.length) plan.push({ name, ddl: row.sql, missing })
  }
  console.log(file + ': ' + plan.length + ' tables need cascade repair' + (apply ? '' : ' (dry run)'))
  if (!apply || !plan.length) { database.close(); continue }
  fs.mkdirSync(backupDir, { recursive: true })
  await backup(database, path.join(backupDir, file))
  database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE')
  try {
    // Preserve orphaned fixture rows in local quarantine tables. Never lose
    // snapshot data merely to make a new FK constraint pass.
    for (let changed = true; changed;) {
      changed = false
      for (const table of plan) {
        const predicates = table.missing.map(key => {
          const ref = key.reference()
          if (ref.columns.length !== 1) throw new Error('Composite FK requires manual review')
          const column = quote(ref.columns[0].name)
          return `${column} IS NOT NULL AND ${column} NOT IN (SELECT ${quote(ref.foreignColumns[0].name)} FROM ${quote(getTableName(ref.foreignTable))})`
        })
        const predicate = predicates.map(value => '(' + value + ')').join(' OR ')
        const count = database.prepare(`SELECT COUNT(*) AS n FROM ${quote(table.name)} WHERE ${predicate}`).get().n
        if (!count) continue
        if (!quarantine) throw new Error(table.name + ': orphan rows exist. Review, then use --quarantine-orphans to preserve them separately.')
        const holding = quote('qa_orphans_' + table.name)
        database.exec(`CREATE TABLE IF NOT EXISTS ${holding} AS SELECT * FROM ${quote(table.name)} WHERE 0`)
        database.exec(`INSERT INTO ${holding} SELECT * FROM ${quote(table.name)} WHERE ${predicate}`)
        database.exec(`DELETE FROM ${quote(table.name)} WHERE ${predicate}`)
        console.log(table.name + ': preserved ' + count + ' orphan rows in local quarantine')
        changed = true
      }
    }
    for (const table of plan) {
      const temp = quote('__qa_fk_' + table.name)
      const saved = database.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL").all(table.name)
      const constraints = table.missing.map(key => {
        const ref = key.reference()
        return `FOREIGN KEY (${ref.columns.map(column => quote(column.name)).join(',')}) REFERENCES ${quote(getTableName(ref.foreignTable))} (${ref.foreignColumns.map(column => quote(column.name)).join(',')}) ON DELETE CASCADE`
      })
      const open = table.ddl.indexOf('(')
      const close = table.ddl.lastIndexOf(')')
      const columns = database.prepare('PRAGMA table_info(' + quote(table.name) + ')').all().map(column => quote(column.name)).join(',')
      database.exec(`CREATE TABLE ${temp} ${table.ddl.slice(open, close)}, ${constraints.join(', ')}${table.ddl.slice(close)}`)
      database.exec(`INSERT INTO ${temp} (${columns}) SELECT ${columns} FROM ${quote(table.name)}`)
      database.exec(`DROP TABLE ${quote(table.name)}`)
      database.exec(`ALTER TABLE ${temp} RENAME TO ${quote(table.name)}`)
      for (const item of saved) database.exec(item.sql)
      const violations = database.prepare('PRAGMA foreign_key_check(' + quote(table.name) + ')').all()
      if (violations.length) throw new Error(table.name + ': FK verification failed')
    }
    database.exec('COMMIT; PRAGMA foreign_keys = ON')
    console.log(file + ': repaired; backup ' + backupDir.replaceAll('\\', '/'))
  } catch (error) {
    database.exec('ROLLBACK; PRAGMA foreign_keys = ON')
    throw error
  } finally { database.close() }
}

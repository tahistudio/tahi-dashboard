/**
 * The static guards over the lifecycle lists.
 *
 * Two failure modes this file exists to catch:
 *
 *   A NEW CONTACT COLUMN. Somebody adds a table holding a contacts.id, the
 *   merge does not know about it, and folding a duplicate contact leaves rows
 *   pointing at a person who has just been deleted. So the candidate columns
 *   are re-derived from db/schema.ts here, and every one of them must be
 *   either handled or on the documented exclusion list.
 *
 *   A MAILER SNEAKING IN. The standing rule on every operation in this family
 *   is that it cannot reach a person, and the way that is guaranteed is
 *   structural: the module writes D1 directly and imports nothing that can
 *   mail, invite or notify. A comment is not a guarantee, so the module graph
 *   is walked.
 *
 * (ORG_SCOPED_TABLES is re-derived from db/schema.ts by the import cleanup's
 * own test, which this module re-exports rather than duplicating.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import {
  CONTACT_REFERENCE_COLUMNS,
  ORG_SCOPED_TABLES,
  PARENT_KEYED_TABLES,
  PIPELINE_REFUSAL_TABLES,
} from '../refs'
import { schemaDouble } from './schema-double'

const REPO_ROOT = resolve(__dirname, '..', '..', '..')
const LIFECYCLE_DIR = resolve(__dirname, '..')
const SCHEMA = readFileSync(resolve(REPO_ROOT, 'db', 'schema.ts'), 'utf8')

interface SchemaTable {
  variable: string
  table: string
  body: string
}

/** Every sqliteTable in db/schema.ts, with its source block. */
function schemaTables(): SchemaTable[] {
  const pattern = /export const (\w+) = sqliteTable\(\s*'([^']+)'/g
  const found: Array<{ variable: string; table: string; start: number }> = []
  let match = pattern.exec(SCHEMA)
  while (match !== null) {
    found.push({ variable: match[1], table: match[2], start: match.index })
    match = pattern.exec(SCHEMA)
  }
  return found.map((entry, index) => ({
    variable: entry.variable,
    table: entry.table,
    body: SCHEMA.slice(entry.start, index + 1 < found.length ? found[index + 1].start : SCHEMA.length),
  }))
}

const TABLES = schemaTables()
const BY_VARIABLE = new Map(TABLES.map((entry) => [entry.variable, entry]))

/** property -> sql column, for one table block. */
function columnsOf(entry: SchemaTable): Map<string, string> {
  const out = new Map<string, string>()
  const pattern = /^\s*(\w+):\s*(?:text|integer|real)\('(\w+)'/gm
  let match = pattern.exec(entry.body)
  while (match !== null) {
    out.set(match[1], match[2])
    match = pattern.exec(entry.body)
  }
  return out
}

// ── the contact column list ──────────────────────────────────────────────────

/**
 * Columns that hold a contacts.id but are DELIBERATELY not re-pointed. Each
 * one is argued in lib/org-lifecycle/refs.ts; repeating the keys here is what
 * makes the derivation test able to pass without hiding anything.
 */
const DOCUMENTED_EXCLUSIONS: readonly string[] = [
  'auditLog.actorId',
]

describe('CONTACT_REFERENCE_COLUMNS is derived from the schema, not from memory', () => {
  /**
   * A dual-identity column: a `*_type` column whose vocabulary includes
   * 'contact', paired with the sibling id column it qualifies.
   */
  function dualIdentityColumns(): string[] {
    const out: string[] = []
    for (const entry of TABLES) {
      const lines = entry.body.split('\n')
      lines.forEach((line, index) => {
        const match = /^\s*(\w+)Type:\s*text\('(\w+)_type'\)/.exec(line)
        if (!match) return
        const context = lines.slice(Math.max(0, index - 3), index + 2).join(' ')
        if (!/contact/i.test(context)) return
        const property = `${match[1]}Id`
        if (!columnsOf(entry).has(property)) return
        out.push(`${entry.variable}.${property}`)
      })
    }
    return out
  }

  /** Every column declared as a foreign key onto contacts.id. */
  function contactForeignKeys(): string[] {
    const out: string[] = []
    for (const entry of TABLES) {
      for (const line of entry.body.split('\n')) {
        const match = /^\s*(\w+):\s*text\('(\w+)'\).*references\(\(\) => contacts\.id/.exec(line)
        if (match) out.push(`${entry.variable}.${match[1]}`)
      }
    }
    return out
  }

  const handled = new Set(CONTACT_REFERENCE_COLUMNS.map((entry) => `${entry.schemaKey}.${entry.column}`))

  it('derives a real list, so an empty walk cannot pass forever', () => {
    expect(dualIdentityColumns().length).toBeGreaterThan(8)
    expect(contactForeignKeys().length).toBeGreaterThan(2)
  })

  it('handles or documents every dual-identity contact column in db/schema.ts', () => {
    const missing = dualIdentityColumns().filter(
      (key) => !handled.has(key) && !DOCUMENTED_EXCLUSIONS.includes(key),
    )
    expect(missing).toEqual([])
  })

  it('handles every declared foreign key onto contacts.id', () => {
    const missing = contactForeignKeys().filter((key) => !handled.has(key))
    expect(missing).toEqual([])
  })

  it('names a real table and a real column for every entry', () => {
    const wrong: string[] = []
    for (const entry of CONTACT_REFERENCE_COLUMNS) {
      const table = BY_VARIABLE.get(entry.schemaKey)
      if (!table) { wrong.push(`${entry.schemaKey} is not a table in db/schema.ts`); continue }
      if (table.table !== entry.table) wrong.push(`${entry.schemaKey} is '${table.table}', not '${entry.table}'`)
      const columns = columnsOf(table)
      if (columns.get(entry.column) !== entry.sqlColumn) {
        wrong.push(`${entry.schemaKey}.${entry.column} is '${columns.get(entry.column)}', not '${entry.sqlColumn}'`)
      }
      if (entry.typeColumn && !columns.has(entry.typeColumn)) {
        wrong.push(`${entry.schemaKey}.${entry.typeColumn} does not exist`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('never rewrites the audit log, because it is immutable by design', () => {
    expect(handled.has('auditLog.actorId')).toBe(false)
  })
})

// ── the parent-keyed list ────────────────────────────────────────────────────

describe('PARENT_KEYED_TABLES names real children of real parents', () => {
  it('names a real table, column and parent for every entry', () => {
    const wrong: string[] = []
    for (const entry of PARENT_KEYED_TABLES) {
      const child = BY_VARIABLE.get(entry.schemaKey)
      const parent = BY_VARIABLE.get(entry.parentSchemaKey)
      if (!child) { wrong.push(`${entry.schemaKey} is not a table`); continue }
      if (!parent) { wrong.push(`${entry.parentSchemaKey} is not a table`); continue }
      if (child.table !== entry.table) wrong.push(`${entry.schemaKey} is '${child.table}'`)
      if (parent.table !== entry.parentTable) wrong.push(`${entry.parentSchemaKey} is '${parent.table}'`)
      if (!columnsOf(child).has(entry.column)) wrong.push(`${entry.table}.${entry.column} does not exist`)
    }
    expect(wrong).toEqual([])
  })

  it('carries no org_id itself, or it would belong in ORG_SCOPED_TABLES instead', () => {
    const orgScoped = new Set(ORG_SCOPED_TABLES.map((entry) => entry.table))
    // subscriptions, requests, tasks, conversations, messages, invoices and
    // brands ARE org-scoped and are the PARENTS here; the children are not.
    const overlap = PARENT_KEYED_TABLES.filter((entry) => orgScoped.has(entry.table))
    expect(overlap.map((entry) => entry.table)).toEqual([])
  })
})

describe('PIPELINE_REFUSAL_TABLES', () => {
  it('names only org-scoped tables, so the refusal read can key on org_id', () => {
    const orgScoped = new Set(ORG_SCOPED_TABLES.map((entry) => entry.table))
    const stray = PIPELINE_REFUSAL_TABLES.filter((entry) => !orgScoped.has(entry.table))
    expect(stray.map((entry) => entry.table)).toEqual([])
  })

  it('always includes discovery_calls, because a cron mails real people off it', () => {
    expect(PIPELINE_REFUSAL_TABLES.map((entry) => entry.table)).toContain('discovery_calls')
  })
})

// ── the test double ──────────────────────────────────────────────────────────

describe('the schema double is not fiction', () => {
  it('names a real table for every key, so a test cannot pass against an invented one', () => {
    const wrong: string[] = []
    for (const [key, value] of Object.entries(schemaDouble)) {
      const real = BY_VARIABLE.get(key)
      const name = (value as { __table: string }).__table
      if (!real) { wrong.push(`${key} is not a table in db/schema.ts`); continue }
      if (real.table !== name) wrong.push(`${key} is '${real.table}', not '${name}'`)
    }
    expect(wrong).toEqual([])
  })

  it('covers every org-scoped table, so the merge sweep is exercised in full', () => {
    const doubled = new Set(Object.values(schemaDouble).map((value) => (value as { __table: string }).__table))
    const missing = ORG_SCOPED_TABLES.filter((entry) => !doubled.has(entry.table))
    expect(missing.map((entry) => entry.table)).toEqual([])
  })
})

// ── the mail guard ───────────────────────────────────────────────────────────

const FORBIDDEN_MODULES: readonly string[] = [
  '@/lib/notifications',
  '@/lib/notification-email',
  '@/lib/notification-events',
  '@/lib/notify-request-team',
  '@/lib/request-status-effects',
  '@/lib/events',
  '@/lib/webhooks',
  '@/lib/email',
  '@/lib/email-previews',
  '@/lib/announcement-emails',
  '@/lib/contract-fully-signed-emails',
  '@/lib/xero-invoice-email',
  '@/lib/onboarding-invites',
  'resend',
  'react-email',
  '@react-email/components',
]

const FORBIDDEN_PREFIXES: readonly string[] = ['@clerk', '@/app/', '@/emails']

/** Strip comments so the guard reads CODE, not the prose that explains it. */
function stripComments(source: string): string {
  let out = ''
  let index = 0
  let quote: string | null = null
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (quote) {
      out += char
      if (char === '\\') { out += next ?? ''; index += 2; continue }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; index += 1; continue }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      index += 2
      continue
    }
    out += char
    index += 1
  }
  return out
}

function importSpecifiers(source: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    let match = pattern.exec(source)
    while (match !== null) { found.add(match[1]); match = pattern.exec(source) }
  }
  return [...found]
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue
      out.push(...listSourceFiles(full))
      continue
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(REPO_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try { if (statSync(candidate).isFile()) return candidate } catch { /* not this one */ }
  }
  return null
}

describe('merge and delete cannot reach a mailer', () => {
  const violations: string[] = []
  const visited = new Set<string>()
  const queue = listSourceFiles(LIFECYCLE_DIR)

  while (queue.length > 0) {
    const file = queue.shift() as string
    if (visited.has(file)) continue
    visited.add(file)
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const specifier of importSpecifiers(source)) {
      if (FORBIDDEN_MODULES.includes(specifier) || FORBIDDEN_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
        violations.push(`${relative(REPO_ROOT, file).replace(/\\/g, '/')} imports ${specifier}`)
        continue
      }
      const local = resolveLocal(specifier, file)
      if (local && !visited.has(local)) queue.push(local)
    }
  }

  const names = [...visited].map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))

  it('walks a real graph, not an empty one', () => {
    expect(names).toContain('lib/org-lifecycle/merge.ts')
    expect(names).toContain('lib/org-lifecycle/delete.ts')
    expect(names).toContain('lib/org-lifecycle/refs.ts')
    expect(names).toContain('lib/import/manyrequests/cleanup.ts')
    expect(names.some((name) => name.startsWith('db/'))).toBe(true)
  })

  it('imports nothing that can send an email, mint an invite or raise a notification', () => {
    expect(violations).toEqual([])
  })

  it('makes no direct fetch to the Resend API', () => {
    const offenders = [...visited].filter((file) => stripComments(readFileSync(file, 'utf8')).includes('api.resend.com'))
    expect(offenders.map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))).toEqual([])
  })

  it('imports no route handler', () => {
    const offenders = [...visited].filter((file) =>
      importSpecifiers(stripComments(readFileSync(file, 'utf8'))).some((specifier) => specifier.includes('/route')),
    )
    expect(offenders.map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))).toEqual([])
  })
})

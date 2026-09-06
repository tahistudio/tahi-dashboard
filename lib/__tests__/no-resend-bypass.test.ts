/**
 * ONE DOOR, AND NO SIDE DOOR.
 *
 * lib/email-delivery.ts applies the tahi.studio allowlist to every send. That
 * is worth nothing the moment a second file constructs its own Resend client
 * or POSTs to api.resend.com, and this is exactly what the tree looked like
 * before the gate: five SDK clients and three raw fetches, spread across the
 * contract, proposal and schedule share routes, the AI reply sender, the deal
 * nudge, the monthly billing summary and the pre-call digest cron. Every one
 * of them was a way for a real client to receive an email while the studio
 * believed nothing was going out.
 *
 * So this test walks the source tree and fails on any file other than the gate
 * that imports the Resend client, calls `.emails.send(`, or names the REST
 * endpoint. It is a lint rule that happens to live in the test run: reviewers
 * do not catch a new `new Resend(...)` reliably, and the failure mode is
 * somebody's inbox.
 *
 * IF THIS FAILS: do not add your file to the allowance. Call `deliverEmail`
 * from lib/email-delivery.ts, or `sendEmail` from lib/email.ts if you have a
 * React element. If you genuinely need a second transport, the allowlist has
 * to move into it too, and that is a conversation with Liam.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Repo root, from lib/__tests__. */
const ROOT = resolve(__dirname, '..', '..')

/** Where product code lives. Everything under these is walked. */
const SCANNED = ['app', 'components', 'lib', 'emails', 'workers', 'scripts', 'db', 'mcp-server']

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.wrangler', '.open-next'])

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/**
 * The only file allowed to hold a Resend client. One entry, and it should stay
 * one entry.
 */
const THE_ONE_DOOR = join('lib', 'email-delivery.ts')

/**
 * This spec, which necessarily contains the patterns it is looking for, and
 * the gate's own unit test, which mocks the SDK module by name.
 */
const TEST_FILES = new Set([
  join('lib', '__tests__', 'no-resend-bypass.test.ts'),
  join('lib', '__tests__', 'email-delivery.test.ts'),
  join('lib', '__tests__', 'email.test.ts'),
])

interface Rule {
  label: string
  pattern: RegExp
}

const RULES: Rule[] = [
  {
    label: "imports the Resend SDK (static or dynamic)",
    // import { Resend } from 'resend' / require('resend') / await import('resend')
    pattern: /(?:from|require\s*\(|import\s*\()\s*['"]resend['"]/,
  },
  {
    label: 'constructs a Resend client',
    pattern: /new\s+Resend\s*\(/,
  },
  {
    label: 'calls .emails.send(',
    pattern: /\.emails\s*\.\s*send\s*\(/,
  },
  {
    label: 'POSTs to the Resend REST API',
    pattern: /api\.resend\.com/,
  },
]

function walk(dir: string, out: string[]): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) walk(full, out)
    else if (EXTENSIONS.some(ext => entry.endsWith(ext))) out.push(full)
  }
  return out
}

function sourceFiles(): string[] {
  const files: string[] = []
  for (const dir of SCANNED) walk(join(ROOT, dir), files)
  return files
}

describe('the Resend client lives in exactly one file', () => {
  const files = sourceFiles()

  it('finds a source tree to scan at all (guards against a silently empty walk)', () => {
    expect(files.length).toBeGreaterThan(300)
  })

  it.each(RULES)('no file except the gate $label', ({ pattern }) => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(ROOT, file).split('/').join(sep)
      if (rel === THE_ONE_DOOR || TEST_FILES.has(rel)) continue
      const source = readFileSync(file, 'utf8')
      if (pattern.test(source)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('the gate itself still holds the client, so the rules above are testing something', () => {
    const source = readFileSync(join(ROOT, THE_ONE_DOOR), 'utf8')
    expect(/new\s+Resend\s*\(/.test(source)).toBe(true)
    expect(/\.emails\s*\.\s*send\s*\(/.test(source)).toBe(true)
  })
})

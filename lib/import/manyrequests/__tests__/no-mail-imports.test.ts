/**
 * THE STATIC GUARD.
 *
 * The hard rule on this import is that no real client or teammate may receive
 * any email from it, and the way that is guaranteed is structural: the importer
 * writes D1 directly and never touches a module that can mail, invite or
 * notify.
 *
 * A comment saying so is not a guarantee, so this walks the ENTIRE module graph
 * rooted at lib/import/manyrequests and fails if any file in it, at any depth,
 * imports a mail-capable module.
 *
 * It is a static walk on purpose. Mocking the mailer and asserting it was not
 * called would only prove the paths a test happened to exercise, and it would
 * miss the three routes that fetch https://api.resend.com/emails directly
 * rather than going through lib/email.ts (deals nudges, billing monthly-email,
 * ai-reply-drafts send). Those do not respect a stubbed mailer, which is
 * exactly why the rule is "import nothing from app/" and not "stub sendEmail".
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const IMPORTER_DIR = resolve(__dirname, '..')

/**
 * Anything here would give the importer a way to reach a person. The list is
 * the mail and identity surface named in the reconciliation, plus the two
 * blanket rules (no Clerk, nothing under app/).
 */
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

/**
 * The two ROUTE files, which are the real entry points.
 *
 * The library guard alone covered lib/import/manyrequests and nothing else, so
 * a future edit adding createNotifications, sendEmail or a Clerk invite to a
 * route handler would have failed nothing. These are walked with a relaxed
 * prefix rule: a route legitimately reads the session (lib/server-auth imports
 * @clerk/nextjs/server) and legitimately lives under app/, so those two
 * prefixes are dropped and replaced by a symbol scan for the mail and invite
 * calls themselves.
 */
const ROUTE_ROOTS: readonly string[] = [
  'app/api/admin/import/manyrequests/route.ts',
  'app/api/admin/import/cleanup/route.ts',
]

const ROUTE_FORBIDDEN_PREFIXES: readonly string[] = ['@/emails']

/**
 * Identifiers that mean "this reached a person", scanned over the route graph
 * because dropping the @clerk prefix there would otherwise let a Clerk
 * invitation through.
 */
const ROUTE_FORBIDDEN_SYMBOLS: readonly string[] = [
  'createNotifications',
  'createNotification(',
  'sendEmail',
  'sendReactEmail',
  'createInvitation',
  'invitations.',
  'api.resend.com',
]

/**
 * Strip comments so the guard reads CODE and not prose. Several files in this
 * directory explain the rule by naming the very modules and URLs the guard
 * forbids; a scanner that cannot tell a doc comment from a call would make
 * documenting the rule impossible.
 *
 * String literals are respected, so a URL containing `//` is not mistaken for
 * the start of a comment.
 */
export function stripComments(source: string): string {
  let out = ''
  let index = 0
  let quote: string | null = null
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (quote) {
      out += char
      if (char === '\\') {
        out += next ?? ''
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      index += 1
      continue
    }
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

/** Every `from '...'`, `import('...')` and `require('...')` in a source file. */
function importSpecifiers(source: string): string[] {
  const found = new Set<string>()
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    let match = pattern.exec(source)
    while (match !== null) {
      found.add(match[1])
      match = pattern.exec(source)
    }
  }
  return [...found]
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      // The tests themselves are not part of the shipped module graph.
      if (entry === '__tests__') continue
      out.push(...listSourceFiles(full))
      continue
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Resolve a local specifier to a file on disk, or null when it is a package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(REPO_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return null

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not this one.
    }
  }
  return null
}

interface Violation {
  file: string
  specifier: string
  via: string[]
}

function walkGraph(
  roots: readonly string[] = listSourceFiles(IMPORTER_DIR),
  forbiddenPrefixes: readonly string[] = FORBIDDEN_PREFIXES,
): { visited: string[]; violations: Violation[] } {
  const violations: Violation[] = []
  const visited = new Set<string>()
  const queue: Array<{ file: string; via: string[] }> = roots.map((file) => ({
    file,
    via: [],
  }))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    if (visited.has(current.file)) continue
    visited.add(current.file)

    const source = stripComments(readFileSync(current.file, 'utf8'))
    for (const specifier of importSpecifiers(source)) {
      const forbidden =
        FORBIDDEN_MODULES.includes(specifier) ||
        forbiddenPrefixes.some((prefix) => specifier.startsWith(prefix))
      if (forbidden) {
        violations.push({
          file: relative(REPO_ROOT, current.file).replace(/\\/g, '/'),
          specifier,
          via: current.via,
        })
        continue
      }
      const local = resolveLocal(specifier, current.file)
      if (local && !visited.has(local)) {
        queue.push({ file: local, via: [...current.via, relative(REPO_ROOT, current.file).replace(/\\/g, '/')] })
      }
    }
  }

  return { visited: [...visited], violations }
}

describe('the importer cannot reach a mailer', () => {
  const { visited, violations } = walkGraph()

  it('walks a real graph, not an empty one', () => {
    // A guard that silently walks nothing passes forever. These four files are
    // the spine of the importer; if the walk stops finding them, the guard is
    // broken rather than the code being clean.
    const names = visited.map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))
    expect(names).toContain('lib/import/manyrequests/run.ts')
    expect(names).toContain('lib/import/manyrequests/upsert.ts')
    expect(names).toContain('lib/import/manyrequests/plan.ts')
    expect(names).toContain('lib/import/manyrequests/cleanup.ts')
    // The walk follows @/ aliases into the rest of the tree, so it must reach
    // at least the schema module the upserter writes through.
    expect(names.some((name) => name.startsWith('db/'))).toBe(true)
  })

  it('imports nothing that can send an email, mint an invite or raise a notification', () => {
    const readable = violations.map((v) => `${v.file} imports ${v.specifier}${v.via.length ? ` (via ${v.via.join(' -> ')})` : ''}`)
    expect(readable).toEqual([])
  })

  it('imports no route handler and nothing under app/', () => {
    const routeImports = visited.filter((file) => {
      const source = stripComments(readFileSync(file, 'utf8'))
      return importSpecifiers(source).some((specifier) => specifier.includes('/route'))
    })
    expect(routeImports.map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))).toEqual([])
  })

  it('makes no direct fetch to the Resend API', () => {
    const offenders = visited.filter((file) => stripComments(readFileSync(file, 'utf8')).includes('api.resend.com'))
    expect(offenders.map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))).toEqual([])
  })
})

describe('the two endpoints cannot reach a mailer either', () => {
  const roots = ROUTE_ROOTS.map((path) => resolve(REPO_ROOT, path))
  const { visited, violations } = walkGraph(roots, ROUTE_FORBIDDEN_PREFIXES)

  it('walks a real graph rooted at the route files themselves', () => {
    const names = visited.map((file) => relative(REPO_ROOT, file).replace(/\\/g, '/'))
    for (const root of ROUTE_ROOTS) expect(names).toContain(root)
    // And follows them into the auth and permission modules they actually use,
    // which is the part the library-only walk never saw.
    expect(names).toContain('lib/server-auth.ts')
    expect(names).toContain('lib/permissions.ts')
    expect(names).toContain('lib/audit.ts')
    expect(names).toContain('lib/import/manyrequests/run.ts')
  })

  it('imports nothing that can send an email, mint an invite or raise a notification', () => {
    const readable = violations.map((v) => `${v.file} imports ${v.specifier}${v.via.length ? ` (via ${v.via.join(' -> ')})` : ''}`)
    expect(readable).toEqual([])
  })

  it('calls no mail, notification or invitation helper anywhere in the graph', () => {
    // The prefix rule is relaxed here (a route legitimately reads the Clerk
    // session and legitimately lives under app/), so the CALLS themselves are
    // what is banned rather than the module they would come from.
    const offenders: string[] = []
    for (const file of visited) {
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const symbol of ROUTE_FORBIDDEN_SYMBOLS) {
        if (source.includes(symbol)) {
          offenders.push(`${relative(REPO_ROOT, file).replace(/\\/g, '/')} mentions ${symbol}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})

/**
 * A server module must never import a VALUE from a 'use client' file.
 *
 * This is the guard for the 2026-09-06 production outage. The dashboard layout
 * imported `resolvePinnedCurrency` from lib/display-currency-context.tsx (a
 * 'use client' module) and called it. In the server bundle Next's
 * next-flight-loader does not ship the real module: every named export is
 * replaced with a client reference whose body throws
 * "Attempted to call resolvePinnedCurrency() from the server". One
 * unconditional call in the layout that wraps every dashboard route meant
 * every signed-in page answered with a server-side exception.
 *
 * Nothing else caught it. `tsc` resolves the real module's types, Vitest runs
 * in Node where the directive is an inert string, and `next build` never
 * prerenders a layout that awaits Clerk and cookies(). So the boundary itself
 * is the test: a file with no 'use client' directive may import only
 * PascalCase symbols (components, which React is allowed to serialise across
 * the boundary) and types (erased at compile time) from a client module.
 *
 * Deliberately a source scan rather than an import: importing the layout would
 * pull in Clerk, D1 and the whole component tree.
 *
 * What it does NOT see, stated so the next reader does not mistake it for a
 * proof. It catches static `import ... from` and `export ... from` in every
 * shape we write them, including multi-line clauses and `* as ns`. It misses:
 *   - dynamic `await import('@/lib/some-client-module')`, which is not a
 *     statement at the start of a line;
 *   - a PascalCase CONSTANT exported from a client module, which
 *     `isComponentName` waves through because it cannot tell an object from a
 *     component without type information.
 * Both are one edit away from being real, so treat a green run as "the known
 * shape of the outage cannot come back", not as "the boundary is sound".
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const ROOTS = ['app', 'lib', 'components', 'emails']
/** Server entry points that are not inside one of the roots above. */
const EXTRA_FILES = ['middleware.ts']
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.next', '.open-next'])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Repo-relative, forward slashes, so a failure reads the same on any OS. */
function rel(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/')
}

/**
 * True when the first statement of the file is the 'use client' directive.
 * Leading block comments, line comments and blank lines are skipped, which is
 * how the compiler reads it too.
 */
export function hasUseClientDirective(source: string): boolean {
  let rest = source.replace(/^﻿/, '')
  for (;;) {
    const trimmed = rest.replace(/^\s+/, '')
    if (trimmed.startsWith('/*')) {
      const end = trimmed.indexOf('*/')
      if (end === -1) return false
      rest = trimmed.slice(end + 2)
      continue
    }
    if (trimmed.startsWith('//')) {
      const end = trimmed.indexOf('\n')
      if (end === -1) return false
      rest = trimmed.slice(end + 1)
      continue
    }
    return /^(['"])use client\1/.test(trimmed)
  }
}

const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx']

/** Resolve a local import specifier to a file on disk, or null if it is a package. */
function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(REPO_ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix
    if (existsSync(candidate)) return candidate
  }
  return null
}

interface ImportedSymbol {
  name: string
  /** `import type` / `type X` specifiers are erased, so they may always cross. */
  typeOnly: boolean
}

/**
 * Anchored to the start of a line (`m`) so a comment that happens to contain
 * the word "import" cannot be read as one. A real import (or re-export)
 * statement is always the first thing on its line; its clause may still wrap
 * onto the next.
 *
 * `export ... from` is in here as well as `import ... from`: a server file that
 * re-exports a client module's function hands the same throwing stub to every
 * one of its own callers, and the narrower regex could not see it.
 */
const IMPORT_RE = /^(?:import|export)\s+((?:type\s+)?[^;'"]*?)\s+from\s+['"]([^'"]+)['"]/gm

/** Names an import statement binds, minus anything type-only. */
function importedSymbols(clause: string): ImportedSymbol[] {
  const out: ImportedSymbol[] = []
  const statementTypeOnly = /^type\s/.test(clause.trim())
  const body = clause.trim().replace(/^type\s+/, '')

  const bracesAt = body.indexOf('{')
  const head = (bracesAt === -1 ? body : body.slice(0, bracesAt)).replace(/,\s*$/, '').trim()
  if (head) {
    // Default and namespace imports. `* as ns` cannot be narrowed to one
    // symbol, so it is reported and has to be rewritten rather than allowed.
    out.push({ name: head.startsWith('*') ? head : head, typeOnly: statementTypeOnly })
  }
  if (bracesAt !== -1) {
    const inner = body.slice(bracesAt + 1, body.lastIndexOf('}'))
    for (const raw of inner.split(',')) {
      const piece = raw.trim()
      if (!piece) continue
      const pieceTypeOnly = statementTypeOnly || /^type\s/.test(piece)
      const local = piece.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
      if (local) out.push({ name: local, typeOnly: pieceTypeOnly })
    }
  }
  return out
}

/** A component: React may render one across the boundary. `SCREAMING_CASE` is a constant. */
function isComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && name !== name.toUpperCase()
}

interface Violation {
  file: string
  module: string
  symbol: string
}

function findViolations(files: string[]): Violation[] {
  const out: Violation[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (hasUseClientDirective(source)) continue
    for (const match of source.matchAll(IMPORT_RE)) {
      const target = resolveLocal(match[2], file)
      if (!target) continue
      if (!hasUseClientDirective(readFileSync(target, 'utf8'))) continue
      for (const symbol of importedSymbols(match[1])) {
        if (symbol.typeOnly) continue
        if (isComponentName(symbol.name)) continue
        out.push({ file: rel(file), module: rel(target), symbol: symbol.name })
      }
    }
  }
  return out
}

const ALL_SOURCES = [
  ...ROOTS.flatMap((dir) => sourceFiles(join(REPO_ROOT, dir))),
  ...EXTRA_FILES.map((f) => join(REPO_ROOT, f)).filter((f) => existsSync(f)),
]

describe('the server / client module boundary', () => {
  it('reads the directive the way the compiler does', () => {
    expect(hasUseClientDirective("'use client'\nexport const a = 1\n")).toBe(true)
    expect(hasUseClientDirective('/** header */\n\n"use client"\n')).toBe(true)
    expect(hasUseClientDirective('// note\n\n\'use client\'\n')).toBe(true)
    expect(hasUseClientDirective("export const a = 1\n'use client'\n")).toBe(false)
    expect(hasUseClientDirective('export const a = 1\n')).toBe(false)
  })

  it('finds the tree it is meant to be scanning', () => {
    expect(ALL_SOURCES.length).toBeGreaterThan(200)
    const clientModules = ALL_SOURCES.filter((f) => hasUseClientDirective(readFileSync(f, 'utf8')))
    expect(clientModules.length).toBeGreaterThan(50)
  })

  it("the dashboard layout imports no value from a 'use client' module", () => {
    const layout = join(REPO_ROOT, 'app', '(dashboard)', 'layout.tsx')
    expect(existsSync(layout)).toBe(true)
    expect(findViolations([layout])).toEqual([])
  })

  it('no server file anywhere calls across the boundary', () => {
    expect(findViolations(ALL_SOURCES)).toEqual([])
  })
})

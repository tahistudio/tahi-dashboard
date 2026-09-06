/**
 * GET /api/admin/audit?actionPrefix= : the prefix filter, and the wildcard bug
 * that made the Act as client trail unreadable.
 *
 * The route used to sanitise the prefix with `.replace(/[%_]/g, '')`, which
 * DELETES the SQL wildcards instead of escaping them. `permission.` survived
 * that untouched, so the permissions history worked and nobody noticed; the
 * moment a prefix carried an underscore the filter silently became a different
 * question. `acting_as_client.` turned into `actingasclient.`, the query ran
 * `LIKE 'actingasclient.%'`, and every reader of the acting trail (the MCP
 * tool the README calls "the record Act as client exists to produce", and the
 * audit viewer's own filter) answered "nothing happened".
 *
 * So these tests assert MEANING, not just the string: the emitted pattern is
 * run through a LIKE evaluator that honours the ESCAPE clause, and checked
 * against actions that should and should not match.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface CapturedSql { strings: string[]; values: unknown[] }

const captured: { conditions: unknown[]; rows: unknown[] } = { conditions: [], rows: [] }

const getRequestAuth = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: (...a: unknown[]) => getRequestAuth(...a),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

vi.mock('@/db/d1', () => ({
  schema: {
    auditLog: { action: 'audit_log.action', actorId: 'actor_id', entityType: 'entity_type', entityId: 'entity_id', createdAt: 'created_at' },
    teamMembers: { id: 'id', name: 'name', clerkUserId: 'clerk_user_id' },
    organisations: { id: 'id', name: 'name' },
    roles: { id: 'id', name: 'name' },
    contacts: { id: 'id', name: 'name' },
  },
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return {
    sql: (strings: TemplateStringsArray, ...values: unknown[]): CapturedSql => ({
      strings: Array.from(strings),
      values,
    }),
    eq: stub, and: (...c: unknown[]) => { captured.conditions = c; return { args: c } },
    gte: stub, lte: stub, desc: stub, inArray: stub,
  }
})

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'orderBy', 'limit']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.offset = vi.fn(() => Promise.resolve(captured.rows))
  return { db: vi.fn().mockResolvedValue({ select: vi.fn(() => chain) }) }
})

import { GET } from '@/app/api/admin/audit/route'
import { AUDIT_LIKE_ESCAPE, escapeAuditLikePrefix } from '@/lib/audit'
import { NextRequest } from 'next/server'

function req(query: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/audit' + query)
}

/**
 * SQLite LIKE with an ESCAPE clause, for the patterns this route emits.
 *
 * Deliberately a real evaluator rather than a string comparison: the failure
 * being guarded against was a pattern that looked plausible and matched the
 * wrong set of rows.
 */
function likeMatches(pattern: string, escape: string, value: string): boolean {
  let re = '^'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === escape) {
      const next = pattern[++i]
      if (next !== undefined) re += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      continue
    }
    if (ch === '%') { re += '[\\s\\S]*'; continue }
    if (ch === '_') { re += '[\\s\\S]'; continue }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(re + '$').test(value)
}

/** The single LIKE condition the route pushed, as { pattern, escape }. */
function likeCondition(): { pattern: string; escape: string } {
  const chunk = captured.conditions.find(
    (c): c is CapturedSql =>
      typeof c === 'object' && c !== null && 'strings' in c &&
      (c as CapturedSql).strings.join('').includes('LIKE'),
  )
  if (!chunk) throw new Error('no LIKE condition was pushed')
  return { pattern: String(chunk.values[1]), escape: String(chunk.values[2]) }
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.conditions = []
  captured.rows = []
  getRequestAuth.mockResolvedValue({ userId: 'user_liam', orgId: 'org_tahi', sessionId: 's' })
})

describe('escapeAuditLikePrefix', () => {
  it('escapes the underscore rather than deleting it', () => {
    // The whole bug in one assertion. Deleting it produced
    // 'actingasclient.', a prefix nothing in the table starts with.
    expect(escapeAuditLikePrefix('acting_as_client.')).toBe('acting\\_as\\_client.')
    expect(escapeAuditLikePrefix('acting_as_client.')).not.toContain('actingasclient')
  })

  it('leaves a prefix with no wildcards exactly as it was', () => {
    // permission. is the prefix that worked all along, and must keep working
    // byte for byte: two live surfaces and an MCP tool pass it.
    expect(escapeAuditLikePrefix('permission.')).toBe('permission.')
    expect(escapeAuditLikePrefix('contract')).toBe('contract')
  })

  it('escapes the escape character first, so a trailing backslash cannot eat the %', () => {
    expect(escapeAuditLikePrefix('weird\\')).toBe('weird\\\\')
    expect(likeMatches(escapeAuditLikePrefix('weird\\') + '%', AUDIT_LIKE_ESCAPE, 'weird\\thing')).toBe(true)
  })

  it('keeps a % in the input literal instead of widening the filter', () => {
    expect(likeMatches(escapeAuditLikePrefix('a%b') + '%', AUDIT_LIKE_ESCAPE, 'a%bc')).toBe(true)
    expect(likeMatches(escapeAuditLikePrefix('a%b') + '%', AUDIT_LIKE_ESCAPE, 'azzzbc')).toBe(false)
  })
})

describe('GET /api/admin/audit?actionPrefix=', () => {
  it('matches the acting trail for a prefix carrying underscores', async () => {
    await GET(req('?actionPrefix=acting_as_client.'))
    const { pattern, escape } = likeCondition()

    expect(likeMatches(pattern, escape, 'acting_as_client.request.created')).toBe(true)
    expect(likeMatches(pattern, escape, 'acting_as_client.message.posted')).toBe(true)
    // The rows the old stripped pattern would have needed in order to match.
    expect(likeMatches(pattern, escape, 'actingasclient.request.created')).toBe(false)
    // And the underscore stays literal rather than matching any character.
    expect(likeMatches(pattern, escape, 'actingXasXclient.request.created')).toBe(false)
    // Nothing outside the prefix leaks in.
    expect(likeMatches(pattern, escape, 'permission.granted')).toBe(false)
  })

  it('still answers the permission history the same way', async () => {
    await GET(req('?actionPrefix=permission.'))
    const { pattern, escape } = likeCondition()
    expect(pattern).toBe('permission.%')
    expect(likeMatches(pattern, escape, 'permission.granted')).toBe(true)
    expect(likeMatches(pattern, escape, 'acting_as_client.request.created')).toBe(false)
  })

  it('will not let a caller widen the filter with their own wildcards', async () => {
    // A prefix filter that can be turned into "everything" is not a filter.
    await GET(req('?actionPrefix=' + encodeURIComponent('%')))
    const { pattern, escape } = likeCondition()
    expect(likeMatches(pattern, escape, 'permission.granted')).toBe(false)
    expect(likeMatches(pattern, escape, '%anything')).toBe(true)
  })

  it('pushes no LIKE condition when no prefix is asked for', async () => {
    await GET(req('?page=1'))
    expect(
      captured.conditions.some(
        (c) => typeof c === 'object' && c !== null && 'strings' in c,
      ),
    ).toBe(false)
  })

  it('refuses a caller who is not a Tahi admin', async () => {
    getRequestAuth.mockResolvedValue({ userId: 'user_bob', orgId: 'org_client', sessionId: 's' })
    const res = await GET(req('?actionPrefix=acting_as_client.'))
    expect(res.status).toBe(403)
  })
})

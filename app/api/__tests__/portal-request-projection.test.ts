/**
 * Unit tests for GET /api/portal/requests/[id] - the client-safe projection.
 *
 * The bare drizzle.select() used to hand a paying client the whole requests
 * row, including internal routing/scope columns. The route now projects an
 * explicit allow-list. We assert (a) the internal columns are ABSENT from the
 * response (absence, not blanking), and (b) message authors resolve to a real
 * name with a server-computed own-message flag.
 *
 * The db mock is projection-aware: select(projection).from(table) returns the
 * queued source rows reduced to the projection's keys, exactly like drizzle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
interface Op { op: string; args: unknown[] }

const state: {
  queues: Record<string, Row[][]>
  /** Every select the route issued, in order, with the where it built. */
  calls: Array<{ table: string; where: unknown }>
} = { queues: {}, calls: [] }

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
// The client feature_visibility gate is covered in portal-feature-visibility.test.ts;
// stub it so this file keeps its minimal schema mock (no feature_visibility table).
vi.mock('@/lib/require-feature', () => ({
  requirePortalFeature: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/notifications', () => ({ notifyTeamMember: vi.fn() }))
vi.mock('@/lib/events', () => ({ dispatchDomainEvent: vi.fn() }))

// Every column is a DISTINCT sentinel so a where assertion names one column
// rather than matching any of them. Only the projection's KEYS matter to the
// fake below, so the values are free.
vi.mock('@/db/d1', () => ({
  schema: {
    requests: {
      _table: 'requests',
      id: 'requests.id', orgId: 'requests.orgId', isInternal: 'requests.isInternal',
    },
    contacts: {
      _table: 'contacts',
      id: 'contacts.id', name: 'contacts.name', clerkUserId: 'contacts.clerkUserId',
    },
    organisations: { _table: 'organisations', id: 'organisations.id', name: 'organisations.name' },
    messages: {
      _table: 'messages',
      id: 'messages.id', authorId: 'messages.authorId', authorType: 'messages.authorType',
      requestId: 'messages.requestId', isInternal: 'messages.isInternal',
      deletedAt: 'messages.deletedAt',
    },
    teamMembers: { _table: 'teamMembers', id: 'teamMembers.id', name: 'teamMembers.name' },
    files: {
      _table: 'files',
      id: 'files.id', messageId: 'files.messageId', orgId: 'files.orgId',
    },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (...args: unknown[]) => ({ op: 'eq', args }),
  and: (...args: unknown[]) => ({ op: 'and', args }),
  asc: (...args: unknown[]) => ({ op: 'asc', args }),
  isNull: (...args: unknown[]) => ({ op: 'isNull', args }),
  inArray: (...args: unknown[]) => ({ op: 'inArray', args }),
}))

type Chain = Promise<Row[]> & {
  leftJoin: () => Chain
  where: (w?: unknown) => Chain
  orderBy: () => Chain
  limit: () => Chain
}

vi.mock('@/lib/db', () => {
  function chainFor(tableName: string | undefined, projection: Record<string, unknown> | undefined): Chain {
    const resultSets = state.queues[tableName ?? ''] ?? []
    const rows = resultSets.length > 0 ? (resultSets.shift() as Row[]) : []
    const projected = projection
      ? rows.map(r => Object.fromEntries(Object.keys(projection).map(k => [k, r[k]])))
      : rows
    const chain = Promise.resolve(projected) as Chain
    chain.leftJoin = () => chain
    // The where is recorded, not applied: these tests assert the SQL the route
    // BUILT (the deletedAt filter, the sliced IN), and feed the rows it should
    // have got back through the queue above.
    chain.where = (w?: unknown) => {
      state.calls.push({ table: tableName ?? '', where: w })
      return chain
    }
    chain.orderBy = () => chain
    chain.limit = () => chain
    return chain
  }
  const select = (projection?: Record<string, unknown>) => ({
    from: (table: { _table?: string } | undefined) => chainFor(table?._table, projection),
  })
  return { db: vi.fn().mockResolvedValue({ select }) }
})

import { GET } from '@/app/api/portal/requests/[id]/route'
import { NextRequest } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'

type PortalAuth = Awaited<ReturnType<typeof getPortalAuth>>

function portalAuth(overrides: Partial<PortalAuth> = {}): PortalAuth {
  return {
    userId: 'user_client',
    orgId: 'org_client',
    sessionId: 'sess_1',
    clerkOrgId: 'org_client',
    impersonating: false,
    ...overrides,
  }
}

function makeGet(): NextRequest {
  return new NextRequest('http://localhost:3000/api/portal/requests/r1', { method: 'GET' })
}
const ctx = { params: Promise.resolve({ id: 'r1' }) }

// ── Where-clause walkers ─────────────────────────────────────────────────────
// The drizzle mock above turns every predicate into { op, args }, so a nested
// and(...) is just a tree to walk.

function flatten(node: unknown, out: Op[] = []): Op[] {
  if (!node || typeof node !== 'object') return out
  const op = node as Op
  if (typeof op.op !== 'string') return out
  out.push(op)
  if (op.op === 'and' || op.op === 'or') {
    for (const child of op.args) flatten(child, out)
  }
  return out
}

/** Is `col` filtered with the given operator anywhere in this where? */
function whereHas(where: unknown, op: string, col: unknown): boolean {
  return flatten(where).some(p => p.op === op && p.args[0] === col)
}

/** The id list bound into an inArray on `col`, or null. */
function inArrayIds(where: unknown, col: unknown): string[] | null {
  const found = flatten(where).find(p => p.op === 'inArray' && p.args[0] === col)
  return found ? (found.args[1] as string[]) : null
}

const callsFor = (table: string) => state.calls.filter(c => c.table === table)

// A source row that carries every internal column the projection must drop.
const REQUEST_SOURCE: Row = {
  id: 'r1', orgId: 'org_client', type: 'small_task', category: 'design', title: 'Homepage',
  description: '<p>x</p>', status: 'client_review', priority: 'standard', estimatedHours: 3,
  startDate: null, dueDate: null, revisionCount: 0, maxRevisions: 3, requestNumber: 1,
  size: 'small', parentRequestId: null, createdAt: 't', updatedAt: 't', deliveredAt: null,
  // internal-only columns:
  scopeFlagged: true, scopeFlagReason: 'over budget', isInternal: false, assigneeId: 'tm1',
  checklists: '[{"title":"x"}]', tags: '["vip"]', queueOrder: 5, scheduleRowId: 'sch1',
}

describe('GET /api/portal/requests/[id] projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
    vi.mocked(getPortalAuth).mockResolvedValue(portalAuth())
    state.queues = {}
    state.calls = []
  })

  it('omits internal columns from the request payload (absence, not blanking)', async () => {
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [[]],
    }
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as { request: Row }

    // Client-safe fields survive.
    expect(json.request.id).toBe('r1')
    expect(json.request.title).toBe('Homepage')
    expect(json.request.status).toBe('client_review')

    // Internal columns must not be present at all.
    for (const leaked of [
      'scopeFlagged', 'scopeFlagReason', 'isInternal', 'assigneeId',
      'checklists', 'tags', 'queueOrder', 'scheduleRowId',
    ]) {
      expect(json.request).not.toHaveProperty(leaked)
    }
  })

  it('labels messages by author and flags the client\'s own messages', async () => {
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [[
        { id: 'm1', authorId: 'contact_self', authorType: 'contact', body: 'hi', isInternal: false, editedAt: null, createdAt: 't1', teamMemberName: null, contactName: 'Sam' },
        { id: 'm2', authorId: 'tm1', authorType: 'team_member', body: 'hello', isInternal: false, editedAt: null, createdAt: 't2', teamMemberName: 'Ana', contactName: null },
      ]],
    }
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as {
      messages: Array<{ id: string; isOwn: boolean; authorName: string | null; teamMemberName: string | null }>
    }

    const own = json.messages.find(m => m.id === 'm1')!
    expect(own.isOwn).toBe(true)
    expect(own.authorName).toBe('Sam (Acme)')

    const team = json.messages.find(m => m.id === 'm2')!
    expect(team.isOwn).toBe(false)
    expect(team.authorName).toBeNull()
    expect(team.teamMemberName).toBe('Ana')
  })

  it('hands the client the files posted with each message', async () => {
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [[
        { id: 'm1', authorId: 'tm1', authorType: 'team_member', body: 'Here it is', isInternal: false, editedAt: null, createdAt: 't1', teamMemberName: 'Ana', contactName: null },
        { id: 'm2', authorId: 'tm1', authorType: 'team_member', body: 'and a note', isInternal: false, editedAt: null, createdAt: 't2', teamMemberName: 'Ana', contactName: null },
      ]],
      // The third row is stamped onto a message this client cannot see (an
      // internal note, or a deleted one): the query is keyed off the ids of
      // the messages resolved above, so it must never reach the payload.
      files: [[
        { id: 'f1', messageId: 'm1', filename: 'logo.svg', storageKey: 'org/req/logo.svg', mimeType: 'image/svg+xml', sizeBytes: 120 },
        { id: 'f2', messageId: 'm1', filename: 'notes.pdf', storageKey: 'org/req/notes.pdf', mimeType: 'application/pdf', sizeBytes: 400 },
        { id: 'f3', messageId: 'm_internal', filename: 'margins.xlsx', storageKey: 'org/req/margins.xlsx', mimeType: null, sizeBytes: 9 },
      ]],
    }
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(200)
    const json = await res.json() as {
      messages: Array<{ id: string; files: Array<{ id: string; filename: string }> }>
    }

    const withFiles = json.messages.find(m => m.id === 'm1')!
    expect(withFiles.files.map(f => f.filename)).toEqual(['logo.svg', 'notes.pdf'])

    const without = json.messages.find(m => m.id === 'm2')!
    expect(without.files).toEqual([])

    const everyFileId = json.messages.flatMap(m => m.files.map(f => f.id))
    expect(everyFileId).not.toContain('f3')
  })

  it('hides a message the studio deleted, and its internal notes', async () => {
    // Asserted on the SQL, not on the rows: the fake returns whatever the
    // queue holds, so only the built where can prove the filter is there.
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [[]],
    }
    await GET(makeGet(), ctx)

    const messageWhere = callsFor('messages')[0]?.where
    expect(whereHas(messageWhere, 'isNull', 'messages.deletedAt')).toBe(true)
    expect(whereHas(messageWhere, 'eq', 'messages.isInternal')).toBe(true)
    expect(whereHas(messageWhere, 'eq', 'messages.requestId')).toBe(true)
  })

  it('slices the file lookup so a long thread cannot blow the D1 parameter cap', async () => {
    // D1 caps a statement at 100 bound parameters. One IN over 150 message ids
    // used to throw INSIDE the detail GET, so the client lost the entire
    // request payload (title, status, thread), not just the attachments.
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: `m${i}`, authorId: 'tm1', authorType: 'team_member', body: 'x',
      isInternal: false, editedAt: null, createdAt: `t${i}`,
      teamMemberName: 'Ana', contactName: null,
    }))
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [many],
      // One result set per slice, so a file at each end of the thread proves
      // the union puts both chunks back together.
      files: [
        [{ id: 'f_first', messageId: 'm0', filename: 'first.png', storageKey: 'k1', mimeType: null, sizeBytes: 1 }],
        [{ id: 'f_last', messageId: 'm149', filename: 'last.png', storageKey: 'k2', mimeType: null, sizeBytes: 2 }],
      ],
    }

    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(200)

    const fileCalls = callsFor('files')
    expect(fileCalls.length).toBeGreaterThan(1)
    for (const call of fileCalls) {
      const ids = inArrayIds(call.where, 'files.messageId')
      expect(ids).not.toBeNull()
      expect(ids!.length).toBeLessThan(100)
      // The org guard rides along on every slice, not only the first.
      expect(whereHas(call.where, 'eq', 'files.orgId')).toBe(true)
    }
    // Every id goes out exactly once, in order.
    expect(fileCalls.flatMap(c => inArrayIds(c.where, 'files.messageId') ?? []))
      .toEqual(many.map(m => m.id))

    const json = await res.json() as {
      messages: Array<{ id: string; files: Array<{ filename: string }> }>
    }
    expect(json.messages.find(m => m.id === 'm0')!.files.map(f => f.filename)).toEqual(['first.png'])
    expect(json.messages.find(m => m.id === 'm149')!.files.map(f => f.filename)).toEqual(['last.png'])
  })

  it('asks for no files at all when the thread is empty', async () => {
    state.queues = {
      requests: [[REQUEST_SOURCE]],
      contacts: [[{ id: 'contact_self' }]],
      organisations: [[{ name: 'Acme' }]],
      messages: [[]],
      files: [[{ id: 'f1', messageId: 'm1', filename: 'leak.pdf', storageKey: 'k', mimeType: null, sizeBytes: 1 }]],
    }
    const res = await GET(makeGet(), ctx)
    const json = await res.json() as { messages: unknown[] }
    expect(json.messages).toEqual([])
    expect(callsFor('files')).toHaveLength(0)
  })

  it('returns 404 when the request does not resolve under the caller org', async () => {
    state.queues = { requests: [[]] }
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(404)
  })

  it('returns 403 for the Tahi admin org', async () => {
    vi.mocked(getPortalAuth).mockResolvedValueOnce(portalAuth({ orgId: 'org_tahi', clerkOrgId: 'org_tahi' }))
    const res = await GET(makeGet(), ctx)
    expect(res.status).toBe(403)
  })
})

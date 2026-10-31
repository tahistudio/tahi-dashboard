/**
 * Site QA comment notes: create, list, delete, validation, the closed-round refusal, resolve in the
 * same call, author attribution for MCP calls, and the cascade when a comment is deleted. Uses a
 * small in-memory fake of the Drizzle calls the routes make.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
type Cond = { op: 'eq'; col: string; val: unknown } | { op: 'and'; list: Cond[] }

const tables: Record<string, Row[]> = { comments: [], notes: [], members: [] }

function field(col: string): { table: string; key: string } {
  const [table, key] = col.split('.')
  return { table, key }
}
function matches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true
  if (cond.op === 'and') return cond.list.every(c => matches(row, c))
  return row[field(cond.col).key] === cond.val
}

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  and: (...list: unknown[]) => ({ op: 'and', list }),
  asc: (col: string) => col,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join('?'), values }),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    qaComments: { __t: 'comments', id: 'comments.id' },
    qaCommentNotes: { __t: 'notes', id: 'notes.id', commentId: 'notes.commentId', createdAt: 'notes.createdAt' },
    teamMembers: { __t: 'members', name: 'members.name', clerkUserId: 'members.clerkUserId' },
  },
}))

// Statements are lazy like Drizzle's: they run when awaited or when handed to batch().
interface Stmt extends PromiseLike<Row[]> {
  run: () => Row[]
  returning: () => Stmt
}
const fail = { onUpdate: false }

function stmt(run: () => Row[]): Stmt {
  const self: Stmt = {
    run,
    returning: () => self,
    then: (resolve, reject) => {
      try {
        return Promise.resolve(run()).then(resolve, reject)
      } catch (err) {
        return Promise.reject(err).then(resolve, reject)
      }
    },
  }
  return self
}

vi.mock('@/lib/db', () => ({
  db: vi.fn(async () => ({
    select: vi.fn(() => {
      let table = ''
      let cond: Cond | undefined
      const run = () => tables[table].filter(r => matches(r, cond))
      const chain: Record<string, unknown> = {}
      chain.from = (t: { __t: string }) => { table = t.__t; return chain }
      chain.where = (c: Cond) => { cond = c; return chain }
      chain.orderBy = () => chain
      chain.limit = async () => run()
      chain.then = (resolve: (rows: Row[]) => unknown) => Promise.resolve(run()).then(resolve)
      return chain
    }),
    insert: vi.fn((t: { __t: string }) => ({
      values: (v: Row) => stmt(() => {
        tables[t.__t].push({ ...v })
        return [{ ...v }]
      }),
    })),
    update: vi.fn((t: { __t: string }) => ({
      set: (patch: Row) => ({
        where: (c: Cond) => stmt(() => {
          if (fail.onUpdate) throw new Error('update failed')
          const hit = tables[t.__t].filter(r => matches(r, c))
          for (const r of hit) Object.assign(r, patch)
          return hit.map(r => ({ ...r }))
        }),
      }),
    })),
    delete: vi.fn((t: { __t: string }) => ({
      where: (c: Cond) => stmt(() => {
        tables[t.__t] = tables[t.__t].filter(r => !matches(r, c))
        return []
      }),
    })),
    // Raw SQL: only the two guarded statements the notes route sends are understood.
    run: vi.fn((q: { text: string; values: unknown[] }) => stmt(() => {
      const v = q.values
      if (q.text.includes('INSERT INTO qa_comment_notes')) {
        const [id, commentId, body, authorId, authorName, source, createdAt, countFor, max] = v
        const held = tables.notes.filter(n => n.commentId === countFor).length
        if (held < (max as number)) tables.notes.push({ id, commentId, body, authorId, authorName, source, createdAt })
        return []
      }
      if (q.text.includes('UPDATE qa_comments')) {
        if (fail.onUpdate) throw new Error('update failed')
        const [resolvedAt, updatedAt, id, noteId] = v
        if (tables.notes.some(n => n.id === noteId)) {
          for (const c of tables.comments.filter(c => c.id === id)) Object.assign(c, { status: 'resolved', resolvedAt, updatedAt })
        }
        return []
      }
      throw new Error('unexpected sql')
    })),
    // All or nothing: a throw restores every table to how it was before the batch.
    batch: vi.fn(async (list: Stmt[]) => {
      const snapshot = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map(r => ({ ...r }))]))
      try {
        return list.map(q => q.run())
      } catch (err) {
        for (const k of Object.keys(snapshot)) tables[k] = snapshot[k]
        throw err
      }
    }),
  })),
}))

const auth = vi.hoisted(() => ({
  value: { userId: 'user_admin', orgId: 'org_tahi', sessionId: 's' } as Record<string, unknown>,
}))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(async () => auth.value),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn(async () => null) }))
vi.mock('@/lib/require-admin', () => ({ requireAdmin: vi.fn(async () => null) }))
vi.mock('@/lib/qa/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa/server')>()
  return { ...actual, loadRoundPage: vi.fn() }
})

import { GET, POST } from '@/app/api/admin/qa/comments/[id]/notes/route'
import { DELETE as DELETE_NOTE } from '@/app/api/admin/qa/comments/[id]/notes/[noteId]/route'
import { DELETE as DELETE_COMMENT } from '@/app/api/admin/qa/comments/[id]/route'
import { loadRoundPage } from '@/lib/qa/server'

interface NoteJson {
  note: Record<string, unknown>
  notes: { body: string }[]
  comment: { noteCount: number; status: string; resolvedAt: string | null; notes: { body: string }[] }
}
async function jsonOf(res: Response): Promise<NoteJson> {
  return (await res.json()) as NoteJson
}

const params = (id = 'c_1') => ({ params: Promise.resolve({ id }) })
const noteParams = (id: string, noteId: string) => ({ params: Promise.resolve({ id, noteId }) })

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/qa/comments/c_1/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const plain = () => new NextRequest('http://localhost/api/admin/qa/comments/c_1/notes')

function setRound(status: 'open' | 'closed') {
  vi.mocked(loadRoundPage).mockResolvedValue({
    roundPage: { id: 'rp_1', path: '/' },
    round: { id: 'r_1', status },
    site: { id: 's_1' },
  } as unknown as Awaited<ReturnType<typeof loadRoundPage>>)
}

beforeEach(() => {
  tables.comments = [{ id: 'c_1', roundPageId: 'rp_1', status: 'open', body: 'Too low', browser: 'chromium', viewport: 'desktop',
    selector: 'h1', ox: 0.5, oy: 0.5, elementTag: null, elementText: null, requestId: null, authorId: null, authorName: null,
    createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z', resolvedAt: null, elementContext: null }]
  tables.notes = []
  tables.members = [{ clerkUserId: 'user_admin', name: 'Liam' }, { clerkUserId: 'user_staci', name: 'Staci' }]
  auth.value = { userId: 'user_admin', orgId: 'org_tahi', sessionId: 's' }
  fail.onUpdate = false
  setRound('open')
})

describe('POST comment notes', () => {
  it('adds a note with the signed-in author and lists it back', async () => {
    const res = await POST(post({ body: '  Padding fixed  ' }), params())
    expect(res.status).toBe(201)
    const json = await jsonOf(res)
    expect(json.note).toMatchObject({ commentId: 'c_1', body: 'Padding fixed', authorId: 'user_admin', authorName: 'Liam', source: 'dashboard' })
    expect(json.comment.noteCount).toBe(1)
    expect(json.comment.status).toBe('open')

    const list = await jsonOf(await GET(plain(), params()))
    expect(list.notes).toHaveLength(1)
    expect(list.notes[0].body).toBe('Padding fixed')
  })

  it('records the MCP person, not the service user, and marks the source', async () => {
    auth.value = {
      userId: 'api-service', orgId: 'org_tahi', sessionId: null,
      mcpActor: { teamMemberId: 'tm_staci', clerkUserId: 'user_staci', profile: 'full' },
    }
    const json = await jsonOf(await POST(post({ body: 'Checked in Safari' }), params()))
    expect(json.note).toMatchObject({ authorId: 'user_staci', authorName: 'Staci', source: 'mcp' })
  })

  it('is atomic: when the resolve fails the note is not kept', async () => {
    fail.onUpdate = true
    await expect(POST(post({ body: 'Fixed', resolve: true }), params())).rejects.toThrow('update failed')
    expect(tables.notes).toHaveLength(0)
    expect(tables.comments[0].status).toBe('open')
  })

  it('marks a service token call with no person as service', async () => {
    auth.value = { userId: 'api-service', orgId: 'org_tahi', sessionId: null }
    const json = await jsonOf(await POST(post({ body: 'From a script' }), params()))
    expect(json.note.source).toBe('service')
  })

  it('a refused note never resolves the comment', async () => {
    tables.notes = Array.from({ length: 100 }, (_, i) => ({ id: `n_${i}`, commentId: 'c_1', body: 'x', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T01:00:00.000Z' }))
    const res = await POST(post({ body: 'one too many', resolve: true }), params())
    expect(res.status).toBe(409)
    expect(tables.comments[0].status).toBe('open')
    expect(tables.notes).toHaveLength(100)
  })

  it('refuses the 101st note with 409', async () => {
    tables.notes = Array.from({ length: 100 }, (_, i) => ({ id: `n_${i}`, commentId: 'c_1', body: 'x', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T01:00:00.000Z' }))
    const res = await POST(post({ body: 'one too many' }), params())
    expect(res.status).toBe(409)
    expect(tables.notes).toHaveLength(100)
    tables.notes.pop()
    expect((await POST(post({ body: 'the 100th' }), params())).status).toBe(201)
  })

  it('resolves the comment in the same call when resolve is true', async () => {
    const json = await jsonOf(await POST(post({ body: 'Fixed', resolve: true }), params()))
    expect(json.comment.status).toBe('resolved')
    expect(json.comment.resolvedAt).not.toBeNull()
    expect(tables.comments[0].status).toBe('resolved')
    expect(json.comment.notes).toHaveLength(1)
  })

  it('returns the thread oldest first', async () => {
    tables.notes = [
      { id: 'n_b', commentId: 'c_1', body: 'second', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T02:00:00.000Z' },
      { id: 'n_a', commentId: 'c_1', body: 'first', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T01:00:00.000Z' },
    ]
    const json = await jsonOf(await POST(post({ body: 'third' }), params()))
    expect(json.comment.notes.map((n: { body: string }) => n.body)).toEqual(['first', 'second', 'third'])
  })

  it('validates the body', async () => {
    for (const bad of [{ body: '   ' }, { body: 5 }, {}, { body: 'x'.repeat(4001) }, { body: 'ok', resolve: 'yes' }]) {
      const res = await POST(post(bad), params())
      expect(res.status).toBe(400)
    }
    expect((await POST(post('not json'), params())).status).toBe(400)
    expect(tables.notes).toHaveLength(0)
    expect((await POST(post({ body: 'x'.repeat(4000) }), params())).status).toBe(201)
  })

  it('refuses when the round is closed, and writes nothing', async () => {
    setRound('closed')
    const res = await POST(post({ body: 'late', resolve: true }), params())
    expect(res.status).toBe(409)
    expect(tables.notes).toHaveLength(0)
    expect(tables.comments[0].status).toBe('open')
  })

  it('returns 404 for an unknown comment and 403 for a non-admin', async () => {
    expect((await POST(post({ body: 'x' }), params('missing'))).status).toBe(404)
    auth.value = { userId: 'user_client', orgId: 'org_client', sessionId: 's' }
    expect((await POST(post({ body: 'x' }), params())).status).toBe(403)
    expect((await GET(plain(), params())).status).toBe(403)
  })
})

describe('DELETE note and comment', () => {
  beforeEach(() => {
    tables.notes = [
      { id: 'n_1', commentId: 'c_1', body: 'a', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T01:00:00.000Z' },
      { id: 'n_2', commentId: 'c_1', body: 'b', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T02:00:00.000Z' },
      { id: 'n_3', commentId: 'c_other', body: 'c', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T03:00:00.000Z' },
    ]
  })
  const req = () => new NextRequest('http://localhost/x', { method: 'DELETE' })

  it('deletes one note of the comment only', async () => {
    expect((await DELETE_NOTE(req(), noteParams('c_1', 'n_1'))).status).toBe(200)
    expect(tables.notes.map(n => n.id)).toEqual(['n_2', 'n_3'])
  })

  it('does not delete a note that belongs to another comment', async () => {
    expect((await DELETE_NOTE(req(), noteParams('c_1', 'n_3'))).status).toBe(404)
    expect(tables.notes).toHaveLength(3)
  })

  it('refuses a note delete when the round is closed', async () => {
    setRound('closed')
    expect((await DELETE_NOTE(req(), noteParams('c_1', 'n_1'))).status).toBe(409)
    expect(tables.notes).toHaveLength(3)
  })

  it('deleting the comment deletes its notes and leaves other comments notes alone', async () => {
    const res = await DELETE_COMMENT(req(), params('c_1'))
    expect(res.status).toBe(200)
    expect(tables.comments).toHaveLength(0)
    expect(tables.notes.map(n => n.id)).toEqual(['n_3'])
  })

  it('keeps the notes when the comment delete is refused for a closed round', async () => {
    setRound('closed')
    expect((await DELETE_COMMENT(req(), params('c_1'))).status).toBe(409)
    expect(tables.notes).toHaveLength(3)
  })
})

/**
 * PATCH /api/admin/tasks/bulk.
 *
 * Before the Tasks port this route had no access scoping at all (CLAUDE.md
 * rule 11), issued one UPDATE per id, and returned `taskIds.length` as
 * `updatedCount` whether or not any row existed.
 *
 * The drizzle condition builders are replaced with plain recorders so the
 * scope clause the route hands the reachable-id query can be read and asserted
 * directly. Asserting on a hand-set row list instead would leave the scoping
 * deletable with every test still green, which is the opposite of what a
 * rule 11 regression test is for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { where: unknown; set: Record<string, unknown> }[] = []
const selectWheres: unknown[] = []
let scopedOrgIds: string[] | null = null
let existingIds: string[] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: async () => scopedOrgIds,
}))

vi.mock('@/db/d1', () => ({ schema: { tasks: { id: 'id', orgId: 'org_id' } } }))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    and: (...parts: unknown[]) => ({ op: 'and', parts }),
    or: (...parts: unknown[]) => ({ op: 'or', parts }),
    inArray: (col: unknown, values: unknown[]) => ({ op: 'inArray', col, values }),
    isNull: (col: unknown) => ({ op: 'isNull', col }),
  }
})

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: () => ({
        where: async (where: unknown) => {
          selectWheres.push(where)
          return existingIds.map(id => ({ id }))
        },
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => { calls.push({ where, set }) },
      }),
    }),
  }),
}))

const ids = (values: string[]) => ({ op: 'inArray', col: 'id', values })
const noClient = { op: 'isNull', col: 'org_id' }

const { PATCH } = await import('../bulk/route')

function patch(body: unknown): Request {
  return new Request('http://localhost/api/admin/tasks/bulk', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/admin/tasks/bulk', () => {
  beforeEach(() => {
    calls.length = 0
    selectWheres.length = 0
    scopedOrgIds = null
    existingIds = ['a', 'b']
  })

  it('asks only for the rows the caller access rule reaches', async () => {
    await PATCH(patch({ taskIds: ['a', 'b'], updates: { status: 'done' } }) as never)
    // Unrestricted: the ids alone, no scope clause to and together.
    expect(selectWheres[0]).toEqual(ids(['a', 'b']))

    scopedOrgIds = []
    await PATCH(patch({ taskIds: ['a', 'b'], updates: { status: 'done' } }) as never)
    // No client at all: only the studio's own unclientted tasks.
    expect(selectWheres[1]).toEqual({ op: 'and', parts: [ids(['a', 'b']), noClient] })

    scopedOrgIds = ['o1']
    await PATCH(patch({ taskIds: ['a', 'b'], updates: { status: 'done' } }) as never)
    expect(selectWheres[2]).toEqual({
      op: 'and',
      parts: [
        ids(['a', 'b']),
        { op: 'or', parts: [{ op: 'inArray', col: 'org_id', values: ['o1'] }, noClient] },
      ],
    })
  })

  it('issues exactly one update for the whole selection', async () => {
    await PATCH(patch({ taskIds: ['a', 'b'], updates: { status: 'done' } }) as never)
    expect(calls).toHaveLength(1)
  })

  it('counts the rows it could actually reach, not the ids it was given', async () => {
    existingIds = ['a']
    const res = await PATCH(patch({ taskIds: ['a', 'ghost'], updates: { status: 'done' } }) as never)
    await expect(res.json()).resolves.toEqual({ success: true, updatedCount: 1 })
  })

  it('returns zero and skips the write when scoping reaches nothing', async () => {
    scopedOrgIds = []
    existingIds = []
    const res = await PATCH(patch({ taskIds: ['a'], updates: { status: 'done' } }) as never)
    expect(calls).toHaveLength(0)
    await expect(res.json()).resolves.toEqual({ success: true, updatedCount: 0 })
  })

  it('accepts a due date, including clearing it', async () => {
    await PATCH(patch({ taskIds: ['a'], updates: { dueDate: '2026-09-09' } }) as never)
    expect(calls[0].set.dueDate).toBe('2026-09-09')
    calls.length = 0
    await PATCH(patch({ taskIds: ['a'], updates: { dueDate: null } }) as never)
    expect(calls[0].set.dueDate).toBeNull()
  })

  it('sets completedAt on done and clears it on anything else', async () => {
    await PATCH(patch({ taskIds: ['a'], updates: { status: 'done' } }) as never)
    expect(calls[0].set.completedAt).toBeTypeOf('string')
    calls.length = 0
    await PATCH(patch({ taskIds: ['a'], updates: { status: 'todo' } }) as never)
    expect(calls[0].set.completedAt).toBeNull()
  })

  it('rejects an invalid priority', async () => {
    const res = await PATCH(patch({ taskIds: ['a'], updates: { priority: 'medium' } }) as never)
    expect(res.status).toBe(400)
  })
})

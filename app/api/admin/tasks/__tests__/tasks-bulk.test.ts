/**
 * PATCH /api/admin/tasks/bulk.
 *
 * Before the Tasks port this route had no access scoping at all (CLAUDE.md
 * rule 11), issued one UPDATE per id, and returned `taskIds.length` as
 * `updatedCount` whether or not any row existed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { where: unknown; set: Record<string, unknown> }[] = []
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

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => ({
      from: () => ({
        where: async () => existingIds.map(id => ({ id })),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => { calls.push({ where, set }) },
      }),
    }),
  }),
}))

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
    scopedOrgIds = null
    existingIds = ['a', 'b']
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

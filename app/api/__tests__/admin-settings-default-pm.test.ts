/**
 * The two engagement-type project manager defaults, PATCH validation on
 * /api/admin/settings.
 *
 * studio.defaultProjectManagerId.retainer and .project are deliberately
 * permissive about WHICH id, same as studio.projectManagerId: an id that does
 * not resolve to a real team member simply makes
 * assignDefaultProjectManager (lib/default-project-manager-server.ts) skip
 * the client silently at creation time, so PATCH only rejects a
 * whitespace-only value, which would look "set" in the settings table while
 * resolving to nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state: {
  rows: Row[]
  updates: Row[]
  inserts: Row[]
} = { rows: [], updates: [], inserts: [] }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
    sessionId: 'sess_1',
  }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: { settings: { key: 'settings.key', value: 'settings.value' } },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ __op: 'eq', col, val }),
}))

function chain(result: Row[]) {
  const node = {
    where: () => chain(result),
    limit: () => chain(result),
    then: <T>(onOk: (r: Row[]) => T, onErr?: (e: unknown) => T) =>
      Promise.resolve(result).then(onOk, onErr),
  }
  return node
}

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => ({ from: () => chain(state.rows) }),
    update: () => ({
      set: (patch: Row) => {
        state.updates.push(patch)
        return { where: () => Promise.resolve(undefined) }
      },
    }),
    insert: () => ({
      values: (row: Row) => {
        state.inserts.push(row)
        return Promise.resolve(undefined)
      },
    }),
  }),
}))

import { PATCH } from '@/app/api/admin/settings/route'
import { NextRequest } from 'next/server'
import {
  DEFAULT_PROJECT_MANAGER_PROJECT_SETTING_KEY,
  DEFAULT_PROJECT_MANAGER_RETAINER_SETTING_KEY,
} from '@/lib/studio-project-manager'

function patchReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.rows = []
  state.updates = []
  state.inserts = []
})

describe.each([
  ['retainer', DEFAULT_PROJECT_MANAGER_RETAINER_SETTING_KEY],
  ['project', DEFAULT_PROJECT_MANAGER_PROJECT_SETTING_KEY],
])('PATCH /api/admin/settings studio.defaultProjectManagerId.%s', (_label, key) => {
  it('stores a team member id', async () => {
    const res = await PATCH(patchReq({ key, value: 'tm_liam' }))
    expect(res.status).toBe(200)
    expect(state.inserts[0]).toMatchObject({ key, value: 'tm_liam' })
  })

  it('accepts an id it cannot itself verify: an unknown one falls through at assignment time, not here', async () => {
    const res = await PATCH(patchReq({ key, value: 'anything-at-all' }))
    expect(res.status).toBe(200)
  })

  it('lets an empty value through as a clear, back to no default', async () => {
    state.rows = [{ key, value: 'tm_liam' }]
    const res = await PATCH(patchReq({ key, value: '' }))
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('value', '')
  })

  it('lets a null value through as a clear', async () => {
    state.rows = [{ key, value: 'tm_liam' }]
    const res = await PATCH(patchReq({ key, value: null }))
    expect(res.status).toBe(200)
    expect(state.updates[0]).toHaveProperty('value', null)
  })

  it('rejects a whitespace-only value, which would look set but resolve to nothing', async () => {
    const res = await PATCH(patchReq({ key, value: '   ' }))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain(key)
    expect(state.inserts).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })
})

describe('PATCH /api/admin/settings the two default-PM keys stay independent', () => {
  it('setting the retainer key never touches the project key, and vice versa', async () => {
    const res1 = await PATCH(patchReq({ key: DEFAULT_PROJECT_MANAGER_RETAINER_SETTING_KEY, value: 'tm_liam' }))
    expect(res1.status).toBe(200)
    const res2 = await PATCH(patchReq({ key: DEFAULT_PROJECT_MANAGER_PROJECT_SETTING_KEY, value: 'tm_staci' }))
    expect(res2.status).toBe(200)
    expect(state.inserts).toEqual([
      { key: DEFAULT_PROJECT_MANAGER_RETAINER_SETTING_KEY, value: 'tm_liam', updatedAt: expect.any(String) },
      { key: DEFAULT_PROJECT_MANAGER_PROJECT_SETTING_KEY, value: 'tm_staci', updatedAt: expect.any(String) },
    ])
  })
})

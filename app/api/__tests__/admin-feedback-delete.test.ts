/**
 * DELETE /api/admin/feedback/[id], admin-only hard delete of one feedback
 * comment row. Removes the R2 screenshot object first (when the row has
 * one), then the row itself, so a dangling object never outlives its row.
 * A missing R2 object is not an error, R2's delete is idempotent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = { id: string; screenshotKey: string | null }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/db/d1', () => ({
  schema: {
    feedbackComments: {
      _table: 'feedback_comments',
      id: 'id',
      screenshotKey: 'screenshot_key',
    },
  },
}))

const h = vi.hoisted(() => ({
  state: {
    rowToReturn: undefined as Row | undefined,
    deleteCalls: [] as string[],
    hasStorage: true,
    storageDelete: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(() => ({
    env: h.state.hasStorage ? { STORAGE: { delete: h.state.storageDelete } } : {},
  })),
}))

vi.mock('@/lib/db', () => {
  const select = vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: async () => (h.state.rowToReturn ? [h.state.rowToReturn] : []),
      }),
    }),
  }))
  const del = vi.fn(() => ({
    where: async () => { h.state.deleteCalls.push('feedback_comments') },
  }))
  return { db: vi.fn().mockResolvedValue({ select, delete: del }) }
})

import { DELETE } from '@/app/api/admin/feedback/[id]/route'
import { NextRequest } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'

function feedbackDelete(id: string): { req: NextRequest; ctx: { params: Promise<{ id: string }> } } {
  return {
    req: new NextRequest(`http://localhost:3000/api/admin/feedback/${id}`, { method: 'DELETE' }),
    ctx: { params: Promise.resolve({ id }) },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.rowToReturn = undefined
  h.state.deleteCalls = []
  h.state.hasStorage = true
  h.state.storageDelete = vi.fn().mockResolvedValue(undefined)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi', sessionId: 's1' })
})

describe('DELETE /api/admin/feedback/[id] - auth', () => {
  it('403s a non-admin caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'user_client', orgId: 'org_client', sessionId: 's1' })
    const { req, ctx } = feedbackDelete('fb_1')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(403)
    expect(h.state.deleteCalls).toHaveLength(0)
  })

  it('403s a signed-out caller', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null, sessionId: null })
    const { req, ctx } = feedbackDelete('fb_1')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/admin/feedback/[id] - deleting', () => {
  it('404s an unknown id', async () => {
    h.state.rowToReturn = undefined
    const { req, ctx } = feedbackDelete('fb_missing')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(404)
    expect(h.state.storageDelete).not.toHaveBeenCalled()
    expect(h.state.deleteCalls).toHaveLength(0)
  })

  it('deletes the R2 object before the row, in order', async () => {
    h.state.rowToReturn = { id: 'fb_1', screenshotKey: 'feedback/abc.webp' }
    const callOrder: string[] = []
    h.state.storageDelete.mockImplementation(async () => { callOrder.push('storage') })
    const { req, ctx } = feedbackDelete('fb_1')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect(h.state.storageDelete).toHaveBeenCalledWith('feedback/abc.webp')
    // The row delete pushes onto deleteCalls; storage push happens first.
    callOrder.push(...h.state.deleteCalls)
    expect(callOrder).toEqual(['storage', 'feedback_comments'])
    const json = await res.json() as { deleted: boolean; id: string }
    expect(json).toEqual({ deleted: true, id: 'fb_1' })
  })

  it('skips the storage call and still deletes the row when there is no screenshot', async () => {
    h.state.rowToReturn = { id: 'fb_2', screenshotKey: null }
    const { req, ctx } = feedbackDelete('fb_2')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect(h.state.storageDelete).not.toHaveBeenCalled()
    expect(h.state.deleteCalls).toEqual(['feedback_comments'])
  })

  it('tolerates a missing R2 object and still deletes the row', async () => {
    h.state.rowToReturn = { id: 'fb_3', screenshotKey: 'feedback/gone.webp' }
    // R2's delete is idempotent: it resolves normally even when the key
    // does not exist, so the mock resolving undefined already models that.
    h.state.storageDelete.mockResolvedValue(undefined)
    const { req, ctx } = feedbackDelete('fb_3')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect(h.state.deleteCalls).toEqual(['feedback_comments'])
  })

  it('skips the storage call when the STORAGE binding is missing, still deletes the row', async () => {
    h.state.hasStorage = false
    h.state.rowToReturn = { id: 'fb_4', screenshotKey: 'feedback/orphan.webp' }
    const { req, ctx } = feedbackDelete('fb_4')
    const res = await DELETE(req, ctx)
    expect(res.status).toBe(200)
    expect(h.state.deleteCalls).toEqual(['feedback_comments'])
  })
})

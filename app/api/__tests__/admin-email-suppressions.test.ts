/**
 * GET / DELETE /api/admin/email-suppressions.
 *
 * The readable half of the email delivery allowlist: what was held back, and
 * the one button that destroys that record.
 *
 * Two things are pinned because both are the kind of thing that only shows up
 * at the worst moment:
 *   1. GET degrades to an empty log on a database that has not had migration
 *      0094 applied. The card it feeds sits inside Studio details, next to the
 *      mode and the domains, and a 500 there would hide the setting that
 *      actually matters behind a missing table.
 *   2. DELETE is super-admin only. The MCP service token resolves to `admin`,
 *      not `super_admin`, so an assistant can read the log and cannot erase it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  isSuperAdmin: true,
  deleted: 0,
  listThrows: false,
  deleteThrows: false,
}))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/permissions', () => ({
  resolvePermissions: vi.fn(async () => ({ isSuperAdmin: state.isSuperAdmin })),
}))

vi.mock('@/lib/email-gate', () => ({
  listEmailSuppressions: vi.fn(async () => {
    if (state.listThrows) throw new Error('no such table: email_suppressions')
    return state.rows
  }),
  clearEmailSuppressions: vi.fn(async () => {
    if (state.deleteThrows) throw new Error('D1 write failed')
    state.deleted += 1
  }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))

import { NextRequest } from 'next/server'
import { GET, DELETE } from '@/app/api/admin/email-suppressions/route'
import { getRequestAuth } from '@/lib/server-auth'
import { clearEmailSuppressions } from '@/lib/email-gate'

const URL_ = 'http://localhost:3000/api/admin/email-suppressions'
const getReq = () => new NextRequest(URL_)
const delReq = () => new NextRequest(URL_, { method: 'DELETE' })

const ROW = {
  id: 'sup-1',
  createdAt: '2026-09-06T09:00:00Z',
  to: 'owner@acme.test',
  orgId: 'org-a',
  template: 'invoice-sent',
  subject: 'Invoice INV-1 from Tahi Studio',
  reason: 'not_in_allowlist',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
  state.rows = []
  state.isSuperAdmin = true
  state.deleted = 0
  state.listThrows = false
  state.deleteThrows = false
  vi.mocked(getRequestAuth).mockResolvedValue({
    userId: 'user_admin',
    orgId: 'org_tahi',
  } as never)
})

describe('GET', () => {
  it('returns the rows and the cap', async () => {
    state.rows = [ROW]
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json() as { items: unknown[]; limit: number }
    expect(body.items).toEqual([ROW])
    expect(body.limit).toBe(100)
  })

  it('reads an empty log as an empty list, not as an error', async () => {
    const body = await (await GET(getReq())).json() as { items: unknown[] }
    expect(body.items).toEqual([])
  })

  it('degrades to an empty log when the table is not on this database yet', async () => {
    state.listThrows = true
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json() as { items: unknown[]; unavailable?: boolean }
    expect(body.items).toEqual([])
    expect(body.unavailable).toBe(true)
  })

  it('is closed to a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_client',
      orgId: 'org_client',
    } as never)
    expect((await GET(getReq())).status).toBe(403)
  })
})

describe('DELETE', () => {
  it('clears the log for a super admin', async () => {
    const res = await DELETE(delReq())
    expect(res.status).toBe(200)
    expect(vi.mocked(clearEmailSuppressions)).toHaveBeenCalledTimes(1)
    expect(state.deleted).toBe(1)
  })

  it('refuses an admin who is not a super admin, and does not clear', async () => {
    state.isSuperAdmin = false
    const res = await DELETE(delReq())
    expect(res.status).toBe(403)
    expect(vi.mocked(clearEmailSuppressions)).not.toHaveBeenCalled()
  })

  it('is closed to a caller outside the Tahi org', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({
      userId: 'user_client',
      orgId: 'org_client',
    } as never)
    expect((await DELETE(delReq())).status).toBe(403)
    expect(vi.mocked(clearEmailSuppressions)).not.toHaveBeenCalled()
  })

  it('reports a failed clear rather than claiming it worked', async () => {
    state.deleteThrows = true
    const res = await DELETE(delReq())
    expect(res.status).toBe(500)
  })
})

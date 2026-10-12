/**
 * GET /api/admin/mcp/identity. The worker's refresh check, service bearer only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const authState: { userId: string | null; orgId: string | null } = { userId: 'api-service', orgId: null }
const members: Record<string, unknown> = {}
const clerkState = { memberOfTahi: true, throws: false, dbThrows: false }

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(async () => ({ ...authState, sessionId: null })),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/db', () => ({ db: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/mcp-profile-server', () => ({
  readMcpMemberById: vi.fn(async (_db: unknown, id: string) => {
    if (clerkState.dbThrows) throw new Error('D1_ERROR: boom')
    return members[id] ?? null
  }),
  isClerkUserInTahiOrg: vi.fn(async () => {
    if (clerkState.throws) throw new Error('clerk down')
    return clerkState.memberOfTahi
  }),
}))

import { GET } from '../admin/mcp/identity/route'

function get(query = '?teamMemberId=tm_1') {
  return new NextRequest(`https://portal.tahi.studio/api/admin/mcp/identity${query}`)
}

beforeEach(() => {
  authState.userId = 'api-service'
  authState.orgId = null
  clerkState.memberOfTahi = true
  clerkState.throws = false
  clerkState.dbThrows = false
  for (const key of Object.keys(members)) delete members[key]
  members.tm_1 = { teamMemberId: 'tm_1', name: 'Liam', email: 'l@tahi.studio', clerkUserId: 'user_liam', profile: 'full' }
  members.tm_2 = { teamMemberId: 'tm_2', name: 'Pat', email: 'p@tahi.studio', clerkUserId: 'user_pat', profile: null }
})

describe('GET /api/admin/mcp/identity', () => {
  it('refuses a session caller, even an admin', async () => {
    authState.userId = 'user_liam'
    authState.orgId = 'org_tahi'
    expect((await GET(get())).status).toBe(403)
  })

  it('requires teamMemberId', async () => {
    expect((await GET(get(''))).status).toBe(400)
  })

  it('reports an active member', async () => {
    const res = await GET(get())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ active: true, profile: 'full', clerkUserId: 'user_liam', name: 'Liam' })
  })

  it('is inactive for a null profile', async () => {
    const body = (await (await GET(get('?teamMemberId=tm_2'))).json()) as { active: boolean; profile: string | null }
    expect(body.active).toBe(false)
    expect(body.profile).toBeNull()
  })

  it('is inactive when the Clerk user is no longer in the Tahi org', async () => {
    clerkState.memberOfTahi = false
    const res = await GET(get())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { active: boolean; profile: string | null }
    expect(body.active).toBe(false)
    expect(body.profile).toBe('full')
  })

  it('answers 503 membership_check_unavailable when Clerk throws', async () => {
    clerkState.throws = true
    const res = await GET(get())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'membership_check_unavailable' })
  })

  it('answers 503 when D1 throws', async () => {
    clerkState.dbThrows = true
    expect((await GET(get())).status).toBe(503)
  })

  it('is inactive for an unknown id', async () => {
    const res = await GET(get('?teamMemberId=nope'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ active: false, profile: null, clerkUserId: null, name: null })
  })
})

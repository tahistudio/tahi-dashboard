/**
 * A worker MCP call (userId 'api-service' plus a verified mcpActor) is
 * recorded against the real person on task creation and blocker links, while
 * the access inputs keep the service identity. Without an actor nothing
 * changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(async () => auth.current),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn(async () => null) }))
vi.mock('@/lib/db', () => ({ db: vi.fn(async () => ({})) }))

const createTaskRecord = vi.hoisted(() => vi.fn(async () => ({ ok: true, task: { id: 't1' } })))
vi.mock('@/lib/task-writes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTaskRecord,
}))

const addBlocker = vi.hoisted(() => vi.fn(async () => NextResponse.json({ id: 'b1' }, { status: 201 })))
vi.mock('@/lib/blockers-server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addBlocker,
}))

import { POST as createTask } from '@/app/api/admin/tasks/route'
import { POST as addTaskBlocker } from '@/app/api/admin/tasks/[id]/blockers/route'

const ACTOR = { teamMemberId: 'tm_staci', clerkUserId: 'user_staci', profile: 'designer' as const }

function post(url: string, body: unknown) {
  return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tasks POST', () => {
  it('authorises as the service identity and records the MCP person as the creator', async () => {
    auth.current = { userId: 'api-service', orgId: 'org_tahi', sessionId: null, mcpActor: ACTOR }
    await createTask(post('https://x/api/admin/tasks', { title: 'Hero', type: 'tahi_internal' }))
    expect(createTaskRecord).toHaveBeenCalledWith(expect.anything(), expect.anything(), { actorType: 'team_member', actorId: 'api-service', recordedActorId: 'user_staci' })
  })

  it('keeps api-service when no actor is present', async () => {
    auth.current = { userId: 'api-service', orgId: 'org_tahi', sessionId: null }
    await createTask(post('https://x/api/admin/tasks', { title: 'Hero', type: 'tahi_internal' }))
    expect(createTaskRecord).toHaveBeenCalledWith(expect.anything(), expect.anything(), { actorType: 'team_member', actorId: 'api-service', recordedActorId: 'api-service' })
  })
})

describe('task blockers POST', () => {
  it('guards as the service identity and records the person', async () => {
    auth.current = { userId: 'api-service', orgId: 'org_tahi', sessionId: null, mcpActor: ACTOR }
    const res = await addTaskBlocker(
      post('https://x/api/admin/tasks/t1/blockers', { blockerType: 'task', blockerId: 't2' }),
      { params: Promise.resolve({ id: 't1' }) },
    )
    expect(res.status).toBe(201)
    expect(addBlocker).toHaveBeenCalledWith(expect.anything(), 'api-service', { type: 'task', id: 't1' }, { type: 'task', id: 't2' }, 'user_staci')
  })
})

/**
 * POST /api/admin/developer-handoff: auth, feature and scoping gates,
 * validation, the recorded actor, and the pass-through of the lib result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }))
import { NextResponse, NextRequest } from 'next/server'

type Row = Record<string, unknown>

const state: { requestRows: Row[] } = { requestRows: [] }

const getRequestAuth = vi.fn()
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: (...args: unknown[]) => getRequestAuth(...args),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))

const requireFeature = vi.fn()
vi.mock('@/lib/require-feature', () => ({
  requireFeature: (...args: unknown[]) => requireFeature(...args),
}))

const requireAccessToOrg = vi.fn()
vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: (...args: unknown[]) => requireAccessToOrg(...args),
}))

const guardTask = vi.fn()
vi.mock('@/lib/task-access', () => ({
  guardTask: (...args: unknown[]) => guardTask(...args),
}))

vi.mock('@/lib/mcp-actor', () => ({
  attributedUserId: (auth: { userId: string | null; mcpActor?: { clerkUserId: string } | null }) =>
    auth.userId === 'api-service' && auth.mcpActor ? auth.mcpActor.clerkUserId : auth.userId,
}))

const handOffToDeveloper = vi.fn()
vi.mock('@/lib/developer-handoff', () => ({
  MAX_HANDOFF_NOTE_LENGTH: 2000,
  sanitiseHandoffNote: (note: string) => note.trim(),
  handOffToDeveloper: (...args: unknown[]) => handOffToDeveloper(...args),
}))

vi.mock('@/db/d1', () => ({
  schema: { requests: { _table: 'requests', id: 'id', orgId: 'org_id' } },
}))

vi.mock('drizzle-orm', () => ({ eq: (...args: unknown[]) => ({ args }) }))

vi.mock('@/lib/db', () => {
  type Chain = Promise<Row[]> & { where: () => Chain; limit: () => Chain }
  const chainFor = (rows: Row[]): Chain => {
    const c = Promise.resolve(rows) as Chain
    c.where = () => c
    c.limit = () => c
    return c
  }
  return {
    db: vi.fn().mockResolvedValue({
      select: () => ({ from: () => chainFor(state.requestRows) }),
    }),
  }
})

import { POST } from '@/app/api/admin/developer-handoff/route'

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/developer-handoff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const OK_RESULT = {
  ok: true,
  developerTeamMemberId: 'tm_liam',
  developerName: 'Liam',
  addedAsAssignee: true,
  noteId: 'n_1',
  notified: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  state.requestRows = [{ orgId: 'org_client' }]
  getRequestAuth.mockResolvedValue({ orgId: 'org_tahi', userId: 'user_staci', sessionId: 's' })
  requireFeature.mockResolvedValue(null)
  requireAccessToOrg.mockResolvedValue(null)
  guardTask.mockResolvedValue(null)
  handOffToDeveloper.mockResolvedValue(OK_RESULT)
})

describe('POST /api/admin/developer-handoff', () => {
  it('answers 403 to a non-admin org and does nothing else', async () => {
    getRequestAuth.mockResolvedValue({ orgId: 'org_client', userId: 'user_c', sessionId: 's' })
    const res = await POST(post({ subjectType: 'task', subjectId: 't1', note: 'x' }))
    expect(res.status).toBe(403)
    expect(handOffToDeveloper).not.toHaveBeenCalled()
  })

  it('validates the body with a 400 and a sentence', async () => {
    const bad: unknown[] = [
      'not json',
      { subjectType: 'deal', subjectId: 't1', note: 'x' },
      { subjectType: 'task', subjectId: '  ', note: 'x' },
      { subjectType: 'task', subjectId: 't1', note: '   ' },
      { subjectType: 'task', subjectId: 't1' },
      { subjectType: 'task', subjectId: 't1', note: 'a'.repeat(2001) },
    ]
    for (const body of bad) {
      const res = await POST(post(body))
      expect(res.status).toBe(400)
      const json = await res.json() as { error: string }
      expect(json.error.length).toBeGreaterThan(10)
    }
    expect(handOffToDeveloper).not.toHaveBeenCalled()
  })

  it('accepts a note of exactly 2000 characters', async () => {
    const res = await POST(post({ subjectType: 'task', subjectId: 't1', note: 'a'.repeat(2000) }))
    expect(res.status).toBe(201)
  })

  it('checks the tasks feature for a task and the requests feature for a request', async () => {
    await POST(post({ subjectType: 'task', subjectId: 't1', note: 'x' }))
    expect(requireFeature.mock.calls[0][1]).toBe('tasks')
    await POST(post({ subjectType: 'request', subjectId: 'r1', note: 'x' }))
    expect(requireFeature.mock.calls[1][1]).toBe('requests')
  })

  it('returns the feature denial untouched', async () => {
    requireFeature.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))
    const res = await POST(post({ subjectType: 'task', subjectId: 't1', note: 'x' }))
    expect(res.status).toBe(403)
    expect(handOffToDeveloper).not.toHaveBeenCalled()
  })

  it('applies the task guard and stops when it denies', async () => {
    guardTask.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(post({ subjectType: 'task', subjectId: 't1', note: 'x' }))
    expect(res.status).toBe(403)
    expect(guardTask.mock.calls[0][2]).toBe('t1')
    expect(handOffToDeveloper).not.toHaveBeenCalled()
  })

  it('answers 404 for a request that does not exist', async () => {
    state.requestRows = []
    const res = await POST(post({ subjectType: 'request', subjectId: 'ghost', note: 'x' }))
    expect(res.status).toBe(404)
    expect(handOffToDeveloper).not.toHaveBeenCalled()
  })

  it('scopes a request to its org and stops when access is denied', async () => {
    requireAccessToOrg.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(post({ subjectType: 'request', subjectId: 'r1', note: 'x' }))
    expect(requireAccessToOrg.mock.calls[0][2]).toBe('org_client')
    expect(res.status).toBe(403)
    expect(handOffToDeveloper).not.toHaveBeenCalled()
  })

  it('hands off with the attributed actor and returns the result', async () => {
    getRequestAuth.mockResolvedValue({
      orgId: 'org_tahi', userId: 'api-service', sessionId: 's',
      mcpActor: { teamMemberId: 'tm_staci', clerkUserId: 'user_staci', profile: 'designer' },
    })
    const res = await POST(post({ subjectType: 'request', subjectId: ' r1 ', note: ' Needs JS ' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      developerTeamMemberId: 'tm_liam',
      developerName: 'Liam',
      addedAsAssignee: true,
      noteId: 'n_1',
      notified: true,
    })
    expect(handOffToDeveloper.mock.calls[0][1]).toEqual({
      subjectType: 'request', subjectId: 'r1', note: 'Needs JS', actorUserId: 'user_staci',
    })
  })

  it('passes a 409 from the lib through with its sentence', async () => {
    handOffToDeveloper.mockResolvedValue({
      ok: false, code: 'no_developer', status: 409,
      message: 'No developer is configured. Set the mcp.developerTeamMemberId setting.',
    })
    const res = await POST(post({ subjectType: 'task', subjectId: 't1', note: 'x' }))
    expect(res.status).toBe(409)
    expect((await res.json() as { error: string }).error).toContain('mcp.developerTeamMemberId')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const state = vi.hoisted(() => ({
  deniedFeature: 'tasks',
  orgId: 'tahi-org',
  feature: vi.fn(),
  business: vi.fn(),
}))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ userId: 'user-a', orgId: state.orgId }),
  isTahiAdmin: (orgId: string) => orgId === 'tahi-org',
}))
vi.mock('@/lib/require-feature', () => ({
  requireFeature: async (auth: unknown, keys: readonly string[]) => {
    state.feature(auth, keys)
    return keys.includes(state.deniedFeature)
      ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      : null
  },
}))
vi.mock('@/lib/db', () => ({
  db: async () => { state.business('db'); throw new Error('Business work must not start') },
}))
vi.mock('@/lib/access-scoping', () => ({ resolveAccessScoping: state.business }))
vi.mock('@/lib/task-suggestions', () => ({
  listSuggestions: state.business, countSuggestions: state.business,
  loadSuggestion: state.business, guardSuggestion: state.business,
  decideSuggestion: state.business, normaliseRejectReason: state.business,
  snoozePreset: state.business,
}))

const { GET } = await import('../route')
const { POST: decide } = await import('../[id]/decide/route')
const { POST: bulk } = await import('../decide-bulk/route')
const routes = [
  { name: 'inbox', run: () => GET(new Request('http://localhost/api/admin/task-suggestions') as never) },
  { name: 'single decision', run: () => decide(new Request('http://localhost/api/admin/task-suggestions/a/decide', {
    method: 'POST', body: JSON.stringify({ action: 'approve' }),
  }) as never, { params: Promise.resolve({ id: 'a' }) }) },
  { name: 'bulk decision', run: () => bulk(new Request('http://localhost/api/admin/task-suggestions/decide-bulk', {
    method: 'POST', body: JSON.stringify({ ids: ['a'], action: 'approve' }),
  }) as never) },
]

beforeEach(() => {
  state.deniedFeature = 'tasks'
  state.orgId = 'tahi-org'
  state.feature.mockClear()
  state.business.mockClear()
})

describe.each(routes)('$name feature boundary', ({ run }) => {
  it.each(['tasks', 'requests'])('refuses a denied %s grant before reading proposals, duplicate candidates or applying work', async feature => {
    state.deniedFeature = feature
    expect((await run()).status).toBe(403)
    expect(state.feature).toHaveBeenCalledWith({ userId: 'user-a', orgId: 'tahi-org' }, ['tasks', 'requests'])
    expect(state.business).not.toHaveBeenCalled()
  })
  it('refuses a client before resolving studio grants', async () => {
    state.orgId = 'client-org'
    expect((await run()).status).toBe(403)
    expect(state.feature).not.toHaveBeenCalled()
    expect(state.business).not.toHaveBeenCalled()
  })
})

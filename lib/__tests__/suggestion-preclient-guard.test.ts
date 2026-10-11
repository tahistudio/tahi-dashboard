import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ scope: null as string[] | null, fail: false }))
vi.mock('@/lib/access-scoping', () => ({
  resolveAccessScoping: async () => {
    if (state.fail) throw new Error('Permission lookup unavailable')
    return state.scope
  },
}))
const { guardSuggestion } = await import('@/lib/task-suggestions')
beforeEach(() => { state.scope = null; state.fail = false })

describe('suggestions with no client require current access', () => {
  it.each([null, ['org-a']])('admits an unrestricted or non-empty scope', async scope => {
    state.scope = scope
    expect(await guardSuggestion({} as never, 'user-a', { orgId: null } as never)).toBeNull()
  })
  it('refuses a zero-access caller rather than treating no client as permission', async () => {
    state.scope = []
    expect((await guardSuggestion({} as never, 'user-a', { orgId: null } as never))?.status).toBe(403)
  })
  it('does not grant access after a failed scope lookup', async () => {
    state.fail = true
    await expect(guardSuggestion({} as never, 'user-a', { orgId: null } as never)).rejects.toThrow('Permission lookup unavailable')
  })
  it('preserves the named-client fence', async () => {
    state.scope = ['org-a']
    expect((await guardSuggestion({} as never, 'user-a', { orgId: 'org-b' } as never))?.status).toBe(403)
    expect(await guardSuggestion({} as never, 'user-a', { orgId: 'org-a' } as never)).toBeNull()
  })
})

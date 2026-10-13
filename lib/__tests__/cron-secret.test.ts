import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getRequestAuth: vi.fn(), isTahiAdmin: vi.fn(() => false) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }))

import { assertCronAuth, hasCronSecretAuth } from '@/lib/cron-runs'
import { getRequestAuth } from '@/lib/server-auth'

function request(values: Record<string, string | undefined>) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) headers.set(key, value)
  return new NextRequest('http://localhost/api/admin/cron/test', { method: 'POST', headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TAHI_CRON_SECRET', 'private-secret')
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: null, orgId: null, sessionId: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('shared scheduler secret authentication', () => {
  it.each([
    { 'x-cron-secret': 'private-secret' },
    { authorization: 'Bearer private-secret' },
    { 'x-cron-secret': 'incorrect', authorization: 'Bearer private-secret' },
    { 'x-cron-secret': 'private-secret', authorization: 'Bearer incorrect' },
  ])('accepts an exact credential in either header', async headers => {
    expect(hasCronSecretAuth(request(headers))).toBe(true)
    expect(await assertCronAuth(request(headers))).toEqual({ ok: true, userId: 'system' })
    expect(getRequestAuth).not.toHaveBeenCalled()
  })

  it.each(['private-secre', 'private-secretx', 'xrivate-secret', 'private-secrex', 'PRIVATE-SECRET'])('refuses the mismatch %s', async value => {
    const req = request({ 'x-cron-secret': value, authorization: `Bearer ${value}` })
    expect(hasCronSecretAuth(req)).toBe(false)
    expect((await assertCronAuth(req)).ok).toBe(false)
    expect(getRequestAuth).toHaveBeenCalledOnce()
  })

  it('fails closed for an empty configured secret', () => {
    vi.stubEnv('TAHI_CRON_SECRET', '')
    expect(hasCronSecretAuth(request({ 'x-cron-secret': '', authorization: 'Bearer ' }))).toBe(false)
  })

  it('retains the legacy CRON_SECRET fallback when the Tahi secret is absent', () => {
    delete process.env.TAHI_CRON_SECRET
    vi.stubEnv('CRON_SECRET', 'legacy-secret')
    expect(hasCronSecretAuth(request({ 'x-cron-secret': 'legacy-secret' }))).toBe(true)
  })
})

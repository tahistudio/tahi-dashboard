import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@clerk/nextjs/server', () => ({ clerkClient: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(), getServerAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
import { clerkClient } from '@clerk/nextjs/server'
import { getRequestAuth, getServerAuth } from '@/lib/server-auth'
import { assertSitemapApiAccess, assertSitemapPageAccess } from '@/lib/sitemap-auth'

const getUser = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(clerkClient).mockResolvedValue({ users: { getUser } } as never)
  getUser.mockResolvedValue({ primaryEmailAddress: { emailAddress: 'business@tahi.studio' } })
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'founder', orgId: 'org_tahi', sessionId: 'test' })
})

describe('sitemap API studio identity', () => {
  it('refuses an allowlisted email whose authenticated org is not Tahi', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'founder', orgId: 'client-org', sessionId: 'test' })
    expect(await assertSitemapApiAccess(new NextRequest('http://localhost/api/admin/sitemap'))).toBeNull()
    expect(getUser).not.toHaveBeenCalled()
  })
  it('keeps the allowlisted Tahi founder allowed', async () => {
    expect(await assertSitemapApiAccess(new NextRequest('http://localhost/api/admin/sitemap'))).toBe('founder')
    expect(getUser).toHaveBeenCalledWith('founder')
  })
  it('keeps the verified service identity allowed without a Clerk lookup', async () => {
    vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'api-service', orgId: 'org_tahi', sessionId: null })
    expect(await assertSitemapApiAccess(new NextRequest('http://localhost/api/admin/sitemap'))).toBe('api-service')
    expect(getUser).not.toHaveBeenCalled()
  })
  it('preserves the separate page email allowlist behavior', async () => {
    vi.mocked(getServerAuth).mockResolvedValue({ userId: 'founder', orgId: 'client-org', sessionId: 'test' } as never)
    expect(await assertSitemapPageAccess()).toBe('founder')
  })
})

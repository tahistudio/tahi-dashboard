import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@clerk/backend', () => ({ createClerkClient: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: vi.fn() }))
vi.mock('@/lib/acting-eligibility', () => ({ resolveActEligibility: vi.fn() }))
vi.mock('@/lib/portal-identity', () => ({ resolvePreviewContactId: vi.fn() }))

import { isTahiAdmin, type RequestAuthResult } from '@/lib/server-auth'

// Mock environment variable before importing module
const TAHI_ORG_ID = 'org_tahi_test_123'

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', TAHI_ORG_ID)
})

afterEach(() => vi.unstubAllEnvs())

describe('isTahiAdmin', () => {
  it('returns true when orgId matches NEXT_PUBLIC_TAHI_ORG_ID', () => {
    expect(isTahiAdmin(TAHI_ORG_ID)).toBe(true)
  })

  it('returns false when orgId does not match', () => {
    expect(isTahiAdmin('org_other_456')).toBe(false)
  })

  it('returns false when orgId is null', () => {
    expect(isTahiAdmin(null)).toBe(false)
  })

  it('returns false when orgId is empty string', () => {
    expect(isTahiAdmin('')).toBe(false)
  })

  it('returns false when env var is not set', () => {
    delete process.env.NEXT_PUBLIC_TAHI_ORG_ID
    expect(isTahiAdmin('org_tahi_test_123')).toBe(false)
  })

  it('returns false when env var is empty', () => {
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = ''
    expect(isTahiAdmin('')).toBe(false)
  })
})

describe('RequestAuthResult type contract', () => {
  // Verify the shape that getRequestAuth and getServerAuth must return
  it('defines the expected auth result shape', () => {
    const result: RequestAuthResult = {
      userId: 'user_123',
      orgId: 'org_456',
      sessionId: 'sess_789',
    }
    expect(result).toHaveProperty('userId')
    expect(result).toHaveProperty('orgId')
    expect(result).toHaveProperty('sessionId')
  })

  it('allows null values in auth result', () => {
    const result: RequestAuthResult = {
      userId: null,
      orgId: null,
      sessionId: null,
    }
    expect(result.userId).toBeNull()
    expect(result.orgId).toBeNull()
    expect(result.sessionId).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/people', () => ({ lookupOrCreatePerson: vi.fn() }))
vi.mock('@/lib/cron-runs', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/cron-runs')>()
  return { ...actual, constantTimeEqual: vi.fn(actual.constantTimeEqual) }
})

import { db } from '@/lib/db'
import { constantTimeEqual } from '@/lib/cron-runs'
import { POST } from '@/app/api/public/leads/route'

function request(authorization?: string) {
  return new NextRequest('http://localhost/api/public/leads', {
    method: 'POST', headers: authorization ? { authorization, 'Content-Type': 'application/json' } : {},
    body: JSON.stringify({}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PUBLIC_LEAD_SECRET', 'qa-lead-secret')
})
afterEach(() => vi.unstubAllEnvs())

describe('public lead secret comparison', () => {
  it.each([undefined, 'Bearer qa-lead-secreu', 'Bearer qa-lead-secret-extra', 'qa-lead-secret'])('rejects an invalid header %s through the constant-time helper', async header => {
    expect((await POST(request(header))).status).toBe(403)
    expect(constantTimeEqual).toHaveBeenCalledWith(header ?? '', 'Bearer qa-lead-secret')
    expect(db).not.toHaveBeenCalled()
  })

  it('accepts the exact header and reaches body validation', async () => {
    const response = await POST(request('Bearer qa-lead-secret'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'name is required' })
    expect(constantTimeEqual).toHaveBeenCalledWith('Bearer qa-lead-secret', 'Bearer qa-lead-secret')
  })

  it('fails closed when the secret is not configured', async () => {
    vi.stubEnv('PUBLIC_LEAD_SECRET', '')
    expect((await POST(request('Bearer qa-lead-secret'))).status).toBe(500)
    expect(db).not.toHaveBeenCalled()
  })
})

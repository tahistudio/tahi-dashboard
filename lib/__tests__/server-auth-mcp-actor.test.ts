/**
 * The worker MCP actor header on getRequestAuth.
 *
 * The header names who a write is recorded for. It must never become an
 * authorisation input, so the cases below pin: it is read only behind the
 * shared bearer, userId stays 'api-service' either way, and every way of being
 * invalid degrades to the plain service identity with no throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const TAHI_ORG = 'org_tahi'
const TOKEN = 'service-token-for-tests'
const SECRET = 'a-test-identity-secret-of-32-chars-or-more'

const clerkAuth = vi.fn()

vi.mock('@clerk/nextjs/server', () => ({ auth: () => clerkAuth() }))
vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ authenticateRequest: () => Promise.resolve({ isSignedIn: false }) }),
}))
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
  headers: () => Promise.resolve({ get: () => null }),
}))
vi.mock('@/lib/permissions', () => ({ resolvePermissions: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: () => Promise.resolve({}) }))
vi.mock('@/db/d1', () => ({ schema: { organisations: { id: 'id', clerkOrgId: 'clerkOrgId' } } }))
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }))

import { NextRequest } from 'next/server'
import { getRequestAuth, getPortalAuth } from '@/lib/server-auth'
import { attributedUserId, attributedTeamMemberId } from '@/lib/mcp-actor'
import {
  MCP_ACTOR_HEADER,
  signIdentityEnvelope,
  actorClaims,
  nowSeconds,
  type ConsentClaims,
} from '@/lib/mcp-identity'

/** A header that is present but does not verify never falls back to the service identity (L-A). */
const UNAUTHENTICATED = { userId: null, orgId: null, sessionId: null }

const identity = { tm: 'tm-staci', cu: 'user_staci', p: 'designer' as const }

function request(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/tasks', { method: 'POST', headers })
}

async function actorHeader(overrides: Partial<ReturnType<typeof actorClaims>> = {}, secret = SECRET): Promise<string> {
  return signIdentityEnvelope({ ...actorClaims(identity), ...overrides }, secret)
}

beforeEach(() => {
  clerkAuth.mockReset()
  process.env.TAHI_API_TOKEN = TOKEN
  process.env.MCP_IDENTITY_SECRET = SECRET
  process.env.NEXT_PUBLIC_TAHI_ORG_ID = TAHI_ORG
})

afterEach(() => {
  delete process.env.TAHI_API_TOKEN
  delete process.env.MCP_IDENTITY_SECRET
})

describe('getRequestAuth with the mcp actor header', () => {
  it('ignores the header without the bearer (a Clerk session gets nothing from it)', async () => {
    clerkAuth.mockResolvedValue({ userId: 'user_clerk', orgId: TAHI_ORG, sessionId: 'sess_1' })
    const result = await getRequestAuth(request({ [MCP_ACTOR_HEADER]: await actorHeader() }))
    expect(result.userId).toBe('user_clerk')
    expect(result.mcpActor).toBeUndefined()
  })

  it('ignores the header behind a wrong bearer', async () => {
    clerkAuth.mockResolvedValue({ userId: null })
    const result = await getRequestAuth(
      request({ authorization: 'Bearer not-the-token', [MCP_ACTOR_HEADER]: await actorHeader() }),
    )
    expect(result.userId).toBeNull()
    expect(result.mcpActor).toBeUndefined()
  })

  it('keeps userId api-service and sets mcpActor for a bearer plus a valid header', async () => {
    const result = await getRequestAuth(
      request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: await actorHeader() }),
    )
    expect(result.userId).toBe('api-service')
    expect(result.orgId).toBe(TAHI_ORG)
    expect(result.mcpActor).toEqual({ teamMemberId: 'tm-staci', clerkUserId: 'user_staci', profile: 'designer' })
  })

  it('returns the plain service identity for a bearer with no header', async () => {
    const result = await getRequestAuth(request({ authorization: `Bearer ${TOKEN}` }))
    expect(result).toEqual({ userId: 'api-service', orgId: TAHI_ORG, sessionId: null })
  })

  it('fails closed on a header with a bad signature', async () => {
    const header = await actorHeader({}, 'a-different-secret-that-is-long-enough-xx')
    const result = await getRequestAuth(request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: header }))
    expect(result).toEqual(UNAUTHENTICATED)
    expect(result.mcpActor).toBeUndefined()
  })

  it('fails closed on an expired header', async () => {
    const now = nowSeconds()
    const header = await actorHeader({ iat: now - 600, exp: now - 300 })
    const result = await getRequestAuth(request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: header }))
    expect(result).toEqual(UNAUTHENTICATED)
    expect(result.mcpActor).toBeUndefined()
  })

  it('fails closed on an envelope of another type (a consent assertion cannot be replayed)', async () => {
    const now = nowSeconds()
    const consent: ConsentClaims = {
      typ: 'mcp_consent',
      nonce: 'n',
      tm: 'tm-staci',
      cu: 'user_staci',
      p: 'full',
      name: 'Staci',
      iat: now,
      exp: now + 120,
    }
    const header = await signIdentityEnvelope(consent, SECRET)
    const result = await getRequestAuth(request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: header }))
    expect(result).toEqual(UNAUTHENTICATED)
    expect(result.mcpActor).toBeUndefined()
  })

  it('fails closed on the header when the secret is unset or shorter than 32 characters', async () => {
    const header = await actorHeader()
    delete process.env.MCP_IDENTITY_SECRET
    let result = await getRequestAuth(request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: header }))
    expect(result).toEqual(UNAUTHENTICATED)

    process.env.MCP_IDENTITY_SECRET = 'too-short'
    result = await getRequestAuth(request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: header }))
    expect(result).toEqual(UNAUTHENTICATED)
    expect(result.mcpActor).toBeUndefined()
  })

  it('fails closed on a malformed header without throwing', async () => {
    const result = await getRequestAuth(request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: 'garbage' }))
    expect(result).toEqual(UNAUTHENTICATED)
    expect(result.mcpActor).toBeUndefined()
  })

  it('survives getPortalAuth, which spreads the result', async () => {
    const result = await getPortalAuth(
      request({ authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: await actorHeader() }),
    )
    expect(result.userId).toBe('api-service')
    expect(result.mcpActor?.teamMemberId).toBe('tm-staci')
  })
})

describe('designer route list on the dashboard (second layer)', () => {
  function at(method: string, path: string, headers: Record<string, string>): NextRequest {
    return new NextRequest(`http://localhost:3000${path}`, { method, headers })
  }

  it('answers a designer write outside the list as unauthenticated', async () => {
    const res = await getRequestAuth(at('PATCH', '/api/admin/invoices/inv1', { authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: await actorHeader() }))
    expect(res).toEqual({ userId: null, orgId: null, sessionId: null })
  })

  it('lets a designer read anything and write on the list', async () => {
    const read = await getRequestAuth(at('GET', '/api/admin/invoices', { authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: await actorHeader() }))
    expect(read.userId).toBe('api-service')
    const write = await getRequestAuth(at('PATCH', '/api/admin/tasks/t1', { authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: await actorHeader() }))
    expect(write.userId).toBe('api-service')
    expect(write.mcpActor?.profile).toBe('designer')
  })

  it('leaves the full profile untouched', async () => {
    const res = await getRequestAuth(at('PATCH', '/api/admin/invoices/inv1', { authorization: `Bearer ${TOKEN}`, [MCP_ACTOR_HEADER]: await actorHeader({ p: 'full' }) }))
    expect(res.userId).toBe('api-service')
    expect(res.mcpActor?.profile).toBe('full')
  })
})

describe('attributedUserId and attributedTeamMemberId', () => {
  const actor = { teamMemberId: 'tm-staci', clerkUserId: 'user_staci', profile: 'full' as const }

  it('returns the actor for the service identity when an actor is present', () => {
    const auth = { userId: 'api-service', mcpActor: actor }
    expect(attributedUserId(auth)).toBe('user_staci')
    expect(attributedTeamMemberId(auth)).toBe('tm-staci')
  })

  it('returns the caller for the service identity with no actor', () => {
    expect(attributedUserId({ userId: 'api-service' })).toBe('api-service')
    expect(attributedUserId({ userId: 'api-service', mcpActor: null })).toBe('api-service')
    expect(attributedTeamMemberId({ userId: 'api-service' })).toBeNull()
  })

  it('never lets an actor override a real Clerk session', () => {
    const auth = { userId: 'user_liam', mcpActor: actor }
    expect(attributedUserId(auth)).toBe('user_liam')
    expect(attributedTeamMemberId(auth)).toBeNull()
  })

  it('passes a null userId through', () => {
    expect(attributedUserId({ userId: null })).toBeNull()
  })
})

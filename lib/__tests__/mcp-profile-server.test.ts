import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join('?'), values }),
}))

import {
  parseConsentCallback,
  readMcpMemberById,
  resolveMcpConsentEligibility,
} from '../mcp-profile-server'

type Row = { id: string; name: string; email: string; clerk_user_id: string | null; mcp_profile?: string | null }

function fakeDb(handler: (text: string) => Row[] | Error) {
  return {
    all: vi.fn(async (query: { text: string }) => {
      const result = handler(query.text)
      if (result instanceof Error) throw result
      return result
    }),
  } as unknown as Parameters<typeof readMcpMemberById>[0]
}

const row: Row = { id: 'tm_1', name: 'Liam', email: 'l@tahi.studio', clerk_user_id: 'user_liam', mcp_profile: 'full' }

describe('resolveMcpConsentEligibility', () => {
  const database = fakeDb(() => [row])

  it('not_signed_in without a user', async () => {
    expect(await resolveMcpConsentEligibility(database, { userId: null, orgId: 'org_tahi' })).toEqual({ ok: false, reason: 'not_signed_in' })
  })
  it('service_token for the api-service user', async () => {
    expect(await resolveMcpConsentEligibility(database, { userId: 'api-service', orgId: null })).toEqual({ ok: false, reason: 'service_token' })
  })
  it('not_studio outside the studio org', async () => {
    expect(await resolveMcpConsentEligibility(database, { userId: 'user_x', orgId: 'org_client' })).toEqual({ ok: false, reason: 'not_studio' })
  })
  it('no_team_member when no row matches', async () => {
    expect(await resolveMcpConsentEligibility(fakeDb(() => []), { userId: 'user_x', orgId: 'org_tahi' })).toEqual({ ok: false, reason: 'no_team_member' })
  })
  it('no_profile when the profile is null', async () => {
    const db = fakeDb(() => [{ ...row, mcp_profile: null }])
    expect(await resolveMcpConsentEligibility(db, { userId: 'user_liam', orgId: 'org_tahi' })).toEqual({ ok: false, reason: 'no_profile' })
  })
  it('no_profile when the stored value is not a known profile', async () => {
    const db = fakeDb(() => [{ ...row, mcp_profile: 'root' }])
    expect(await resolveMcpConsentEligibility(db, { userId: 'user_liam', orgId: 'org_tahi' })).toEqual({ ok: false, reason: 'no_profile' })
  })
  it('ok with member and profile', async () => {
    const result = await resolveMcpConsentEligibility(database, { userId: 'user_liam', orgId: 'org_tahi' })
    expect(result).toMatchObject({ ok: true, profile: 'full', member: { teamMemberId: 'tm_1', clerkUserId: 'user_liam' } })
  })
  it('falls back to no profile when the column does not exist yet', async () => {
    const db = fakeDb(text => {
      if (text.includes('mcp_profile')) return new Error('D1_ERROR: no such column: mcp_profile')
      return [{ id: row.id, name: row.name, email: row.email, clerk_user_id: row.clerk_user_id }]
    })
    const member = await readMcpMemberById(db, 'tm_1')
    expect(member).toMatchObject({ teamMemberId: 'tm_1', profile: null })
    expect(await resolveMcpConsentEligibility(db, { userId: 'user_liam', orgId: 'org_tahi' })).toEqual({ ok: false, reason: 'no_profile' })
  })
  it('throws any other error so callers fail closed (and the refresh check retries)', async () => {
    const db = fakeDb(() => new Error('network down'))
    await expect(readMcpMemberById(db, 'tm_1')).rejects.toThrow('network down')
  })
})

describe('parseConsentCallback', () => {
  it('accepts https and local http only', () => {
    expect(parseConsentCallback('https://mcp.tahi.studio/cb')).not.toBeNull()
    expect(parseConsentCallback('http://localhost:8787/cb')).not.toBeNull()
    expect(parseConsentCallback('http://127.0.0.1:8787/cb')).not.toBeNull()
    expect(parseConsentCallback('http://mcp.tahi.studio/cb')).toBeNull()
    expect(parseConsentCallback('javascript:alert(1)')).toBeNull()
    expect(parseConsentCallback('https://user:pw@mcp.tahi.studio/cb')).toBeNull()
    expect(parseConsentCallback('nonsense')).toBeNull()
  })
})

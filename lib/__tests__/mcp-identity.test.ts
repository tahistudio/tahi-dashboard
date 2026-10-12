import { describe, it, expect } from 'vitest'
import {
  actorClaims,
  isUsableIdentitySecret,
  parseMcpProfile,
  randomNonce,
  signIdentityEnvelope,
  verifyIdentityEnvelope,
  type ConsentClaims,
  type ConsentRequestClaims,
} from '@/lib/mcp-identity'

const SECRET = 'test-identity-secret-0123456789-abcdef'
const OTHER = 'another-identity-secret-0123456789-xyz'
const NOW = 1_800_000_000

function consent(overrides: Partial<ConsentClaims> = {}): ConsentClaims {
  return {
    typ: 'mcp_consent', nonce: 'n1', tm: 'tm-1', cu: 'user_1', p: 'designer', name: 'Staci Bonnie',
    iat: NOW, exp: NOW + 120, ...overrides,
  }
}

const request: ConsentRequestClaims = {
  typ: 'mcp_consent_request', cid: 'client', ruri: 'https://claude.ai/api/mcp/auth_callback', st: 'state',
  cc: 'challenge', cb: 'https://mcp.example/authorize/callback', nonce: 'n1', iat: NOW, exp: NOW + 600,
}

describe('signIdentityEnvelope / verifyIdentityEnvelope', () => {
  it('round trips each envelope type, including non-ASCII names', async () => {
    const token = await signIdentityEnvelope(consent({ name: 'Zoë Ōtaki' }), SECRET)
    expect(await verifyIdentityEnvelope(token, SECRET, 'mcp_consent', NOW + 1)).toMatchObject({ tm: 'tm-1', name: 'Zoë Ōtaki' })
    const req = await signIdentityEnvelope(request, SECRET)
    expect(await verifyIdentityEnvelope(req, SECRET, 'mcp_consent_request', NOW + 1)).toMatchObject({ nonce: 'n1', st: 'state' })
    const actor = await signIdentityEnvelope(actorClaims({ tm: 'tm-1', cu: 'user_1', p: 'full' }, NOW), SECRET)
    expect(await verifyIdentityEnvelope(actor, SECRET, 'mcp_actor', NOW + 1)).toMatchObject({ p: 'full', exp: NOW + 300 })
  })

  it('refuses another secret', async () => {
    const token = await signIdentityEnvelope(consent(), SECRET)
    expect(await verifyIdentityEnvelope(token, OTHER, 'mcp_consent', NOW)).toBeNull()
  })

  it('refuses one envelope type replayed as another', async () => {
    const token = await signIdentityEnvelope(consent(), SECRET)
    expect(await verifyIdentityEnvelope(token, SECRET, 'mcp_actor', NOW)).toBeNull()
    expect(await verifyIdentityEnvelope(token, SECRET, 'mcp_consent_request', NOW)).toBeNull()
  })

  it('refuses expired and future-dated envelopes', async () => {
    const token = await signIdentityEnvelope(consent(), SECRET)
    expect(await verifyIdentityEnvelope(token, SECRET, 'mcp_consent', NOW + 120)).toBeNull()
    const future = await signIdentityEnvelope(consent({ iat: NOW + 3600, exp: NOW + 3700 }), SECRET)
    expect(await verifyIdentityEnvelope(future, SECRET, 'mcp_consent', NOW)).toBeNull()
  })

  it('refuses a tampered payload', async () => {
    const token = await signIdentityEnvelope(consent(), SECRET)
    const [, sig] = token.split('.')
    const forged = btoa(JSON.stringify(consent({ p: 'full' }))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifyIdentityEnvelope(`${forged}.${sig}`, SECRET, 'mcp_consent', NOW)).toBeNull()
  })

  it('refuses a signed envelope with an unknown profile or missing fields', async () => {
    const bad = await signIdentityEnvelope({ ...consent(), p: 'owner' } as unknown as ConsentClaims, SECRET)
    expect(await verifyIdentityEnvelope(bad, SECRET, 'mcp_consent', NOW)).toBeNull()
    const noTm = await signIdentityEnvelope({ ...consent(), tm: '' }, SECRET)
    expect(await verifyIdentityEnvelope(noTm, SECRET, 'mcp_consent', NOW)).toBeNull()
  })

  it('fails closed on junk and on a short or missing secret', async () => {
    expect(await verifyIdentityEnvelope('junk', SECRET, 'mcp_consent', NOW)).toBeNull()
    expect(await verifyIdentityEnvelope('a.b.c', SECRET, 'mcp_consent', NOW)).toBeNull()
    expect(await verifyIdentityEnvelope(null, SECRET, 'mcp_consent', NOW)).toBeNull()
    const token = await signIdentityEnvelope(consent(), SECRET)
    expect(await verifyIdentityEnvelope(token, undefined, 'mcp_consent', NOW)).toBeNull()
    await expect(signIdentityEnvelope(consent(), 'short')).rejects.toThrow('MCP_IDENTITY_SECRET')
    expect(isUsableIdentitySecret('x'.repeat(31))).toBe(false)
    expect(isUsableIdentitySecret('x'.repeat(32))).toBe(true)
  })
})

describe('helpers', () => {
  it('parses only the two profiles', () => {
    expect(parseMcpProfile('full')).toBe('full')
    expect(parseMcpProfile('designer')).toBe('designer')
    expect(parseMcpProfile('admin')).toBeNull()
    expect(parseMcpProfile(null)).toBeNull()
  })

  it('makes distinct url-safe nonces', () => {
    const a = randomNonce()
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(randomNonce()).not.toBe(a)
  })
})

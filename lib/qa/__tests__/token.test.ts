import { describe, it, expect } from 'vitest'
import { signViewToken, verifyViewToken, decodeViewTokenPayload } from '@/lib/qa/token'

const SECRET = 'test-secret-that-is-long-enough-123456'
const payload = { o: 'https://acme.webflow.io', p: 'https://portal.tahi.studio', exp: 2_000_000_000 }

describe('view tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(await verifyViewToken(token, SECRET, 1_900_000_000)).toEqual(payload)
  })
  it('rejects an expired token', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(await verifyViewToken(token, SECRET, 2_000_000_001)).toBeNull()
  })
  it('rejects a tampered payload', async () => {
    const token = await signViewToken(payload, SECRET)
    const [, sig] = token.split('.')
    const forged = btoa(JSON.stringify({ ...payload, o: 'https://evil.com' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifyViewToken(`${forged}.${sig}`, SECRET, 1_900_000_000)).toBeNull()
  })
  it('rejects the wrong secret and junk', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(await verifyViewToken(token, 'another-secret-another-secret-xx', 1)).toBeNull()
    expect(await verifyViewToken('junk', SECRET, 1)).toBeNull()
    expect(await verifyViewToken('a.b.c', SECRET, 1)).toBeNull()
  })
  it('decodes the payload without verifying (scanner side)', async () => {
    const token = await signViewToken(payload, SECRET)
    expect(decodeViewTokenPayload(token)).toEqual(payload)
    expect(decodeViewTokenPayload('junk')).toBeNull()
  })
})

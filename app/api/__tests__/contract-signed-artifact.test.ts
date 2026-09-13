/**
 * T3.7 S4: the signed PDF is written to R2, not left as a one-shot email
 * attachment.
 *
 * Two layers:
 *   1. lib/contract-signed-artifact.ts's pure key/byte helpers, against a
 *      minimal in-memory R2Bucket stub.
 *   2. resolveContractSignedPdfBytes: R2 hit short-circuits the rebuild;
 *      an R2 miss rebuilds from signers/signatures and best-effort
 *      backfills the key. buildSignedPdfBase64 is mocked here so this is a
 *      test of the resolve/backfill logic, not of jsPDF rendering.
 *
 * The routes that serve this (admin download/resend, public signer download)
 * are tested separately in contract-signed-pdf-routes.test.ts: this file
 * imports the REAL module to test it, and a route test mocking the same
 * module would collide (vi.mock is hoisted file-wide in Vitest).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// lib/contract-signed-artifact.ts
// ---------------------------------------------------------------------------

vi.mock('@/lib/contract-signed-pdf', () => ({
  buildSignedPdfBase64: vi.fn(() => btoa('rebuilt-pdf-bytes')),
}))

import {
  contractSignedPdfKey,
  base64ToBytes,
  putContractSignedPdf,
  getContractSignedPdf,
  resolveContractSignedPdfBytes,
  type SignedPdfDocRow,
} from '@/lib/contract-signed-artifact'
import { buildSignedPdfBase64 } from '@/lib/contract-signed-pdf'

function fakeR2(initial: Record<string, Uint8Array> = {}) {
  const store = { ...initial }
  const putCalls: Array<{ key: string; contentType?: string }> = []
  const bucket = {
    async put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      store[key] = value
      putCalls.push({ key, contentType: opts?.httpMetadata?.contentType })
    },
    async get(key: string) {
      const value = store[key]
      if (!value) return null
      return { arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) }
    },
  }
  return { bucket, store, putCalls }
}

describe('lib/contract-signed-artifact', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keys a contract at a stable, predictable path', () => {
    expect(contractSignedPdfKey('c1')).toBe('contracts/c1/signed.pdf')
  })

  it('round-trips base64 to bytes', () => {
    const bytes = base64ToBytes(btoa('hello pdf'))
    expect(new TextDecoder().decode(bytes)).toBe('hello pdf')
  })

  it('puts a PDF at the contract key with the right content type', async () => {
    const { bucket, putCalls } = fakeR2()
    const key = await putContractSignedPdf({ STORAGE: bucket as never }, 'c1', btoa('pdf-bytes'))
    expect(key).toBe('contracts/c1/signed.pdf')
    expect(putCalls).toEqual([{ key: 'contracts/c1/signed.pdf', contentType: 'application/pdf' }])
  })

  it('reads back what was put', async () => {
    const { bucket } = fakeR2()
    await putContractSignedPdf({ STORAGE: bucket as never }, 'c1', btoa('pdf-bytes'))
    const bytes = await getContractSignedPdf({ STORAGE: bucket as never }, 'contracts/c1/signed.pdf')
    expect(bytes && new TextDecoder().decode(bytes)).toBe('pdf-bytes')
  })

  it('answers null for a missing object rather than throwing', async () => {
    const { bucket } = fakeR2()
    expect(await getContractSignedPdf({ STORAGE: bucket as never }, 'contracts/ghost/signed.pdf')).toBeNull()
  })

  describe('resolveContractSignedPdfBytes', () => {
    const doc: SignedPdfDocRow = {
      id: 'c1',
      name: 'Acme SOW',
      type: 'sow',
      bodyHtml: '<p>Terms</p>',
      signedAt: '2026-01-02T00:00:00Z',
      finalHash: 'final-hash',
      publicShareToken: 'tok_123',
      signedStorageKey: null,
    }

    function fakeSelectDb(signers: unknown[], signatures: unknown[]) {
      const queue = [signers, signatures]
      const updateSets: unknown[] = []
      const chain = (result: unknown): Record<string, unknown> => {
        const proxy: Record<string, unknown> = new Proxy({}, {
          get(_t, key) {
            if (key === 'then') {
              return (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok)
            }
            if (key === 'set') return (v: unknown) => { updateSets.push(v); return proxy }
            return () => proxy
          },
        })
        return proxy
      }
      return {
        db: {
          select: () => chain(queue.shift() ?? []),
          update: () => chain(undefined),
        },
        updateSets,
      }
    }

    it('reads straight from R2 when the stored key resolves there, never touching the database', async () => {
      const { bucket } = fakeR2({ 'contracts/c1/signed.pdf': base64ToBytes(btoa('from-r2')) })
      const { db } = fakeSelectDb([], [])
      const withKey: SignedPdfDocRow = { ...doc, signedStorageKey: 'contracts/c1/signed.pdf' }

      const bytes = await resolveContractSignedPdfBytes(db as never, { STORAGE: bucket as never }, withKey)
      expect(new TextDecoder().decode(bytes)).toBe('from-r2')
      expect(buildSignedPdfBase64).not.toHaveBeenCalled()
    })

    it('rebuilds from signers and signatures when there is no stored key', async () => {
      const { bucket } = fakeR2()
      const { db, updateSets } = fakeSelectDb(
        [{ id: 's1', name: 'Jo Yarnall', email: 'jo@acme.com', role: 'client', signedAt: '2026-01-02T00:00:00Z' }],
        [{ signerId: 's1', signatureDataUrl: 'data:image/png;base64,AAAA', signedAt: '2026-01-02T00:00:00Z' }],
      )

      const bytes = await resolveContractSignedPdfBytes(db as never, { STORAGE: bucket as never }, doc)
      expect(new TextDecoder().decode(bytes)).toBe('rebuilt-pdf-bytes')
      expect(buildSignedPdfBase64).toHaveBeenCalledTimes(1)
      // Best-effort backfill: the next reader gets a straight R2 hit.
      expect(bucket.get).toBeDefined()
      const stored = await bucket.get('contracts/c1/signed.pdf')
      expect(stored).not.toBeNull()
      expect(updateSets).toEqual([{ signedStorageKey: 'contracts/c1/signed.pdf', updatedAt: expect.any(String) }])
    })

    it('rebuilds and returns bytes even when there is no STORAGE binding at all', async () => {
      const { db } = fakeSelectDb([], [])
      const bytes = await resolveContractSignedPdfBytes(db as never, undefined, doc)
      expect(new TextDecoder().decode(bytes)).toBe('rebuilt-pdf-bytes')
    })

    it('rebuilds when the stored key no longer resolves in R2 (object went missing)', async () => {
      const { bucket } = fakeR2() // empty: signedStorageKey points at nothing
      const { db } = fakeSelectDb([], [])
      const withKey: SignedPdfDocRow = { ...doc, signedStorageKey: 'contracts/c1/signed.pdf' }

      const bytes = await resolveContractSignedPdfBytes(db as never, { STORAGE: bucket as never }, withKey)
      expect(new TextDecoder().decode(bytes)).toBe('rebuilt-pdf-bytes')
    })
  })
})

/**
 * T3.7 S4: the admin and public signed-pdf routes: org-scoping, status
 * gating, and headers. lib/contract-signed-artifact.ts's own resolve/backfill
 * logic is unit tested directly in contract-signed-artifact.test.ts and is
 * mocked here, so this file is only about the routes: guard order and the
 * response they build from whatever bytes the resolver hands back.
 *
 * Kept in a separate file from contract-signed-artifact.test.ts on purpose:
 * that file imports the REAL module to test it, and vi.mock is hoisted
 * file-wide in Vitest, so a partial mock of the same module here would have
 * silently replaced the real implementation under test there too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type QueryRecord = { method: string; args: unknown[] }

function makeChain(result: unknown, record: QueryRecord[]): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy({}, {
    get(_target, key) {
      if (key === 'then') {
        return (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
          Promise.resolve(result).then(ok, err)
      }
      if (typeof key !== 'string') return undefined
      return (...args: unknown[]) => {
        record.push({ method: key, args })
        return proxy
      }
    },
  })
  return proxy
}

function makeDb(selectResults: unknown[] = []) {
  const calls: QueryRecord[] = []
  const queue = [...selectResults]
  const handle = {
    select: (...args: unknown[]) => {
      calls.push({ method: 'select', args })
      return makeChain(queue.length ? queue.shift() : [], calls)
    },
  }
  return { handle, calls }
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: vi.fn() }))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({ env: { STORAGE: {} } }),
}))

vi.mock('@/lib/contract-signed-artifact', () => ({
  resolveContractSignedPdfBytes: vi.fn(async () => new TextEncoder().encode('the-pdf-bytes')),
}))

vi.mock('@/lib/contract-fully-signed-emails', () => ({
  slugify: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
  sendFullySignedContractEmails: vi.fn().mockResolvedValue(undefined),
}))

import { db } from '@/lib/db'
import { scopedOrgIds } from '@/lib/access-scope'
import { sendFullySignedContractEmails } from '@/lib/contract-fully-signed-emails'
import { NextRequest } from 'next/server'
import { GET as adminGet, POST as adminPost } from '@/app/api/admin/contracts/[id]/signed-pdf/route'
import { GET as publicGet } from '@/app/api/public/contracts/[token]/signed-pdf/route'

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) })
const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) })
const req = (url: string) => new NextRequest(`http://localhost:3000${url}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'all' })
})

describe('GET /api/admin/contracts/[id]/signed-pdf', () => {
  it('404s a contract that does not exist', async () => {
    const { handle } = makeDb([[]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await adminGet(req('/api/admin/contracts/ghost/signed-pdf'), routeParams('ghost'))
    expect(res.status).toBe(404)
  })

  it('403s a scoped team member denied this contract, before any status check', async () => {
    vi.mocked(scopedOrgIds).mockResolvedValue({ kind: 'none' })
    const { handle } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await adminGet(req('/api/admin/contracts/doc-1/signed-pdf'), routeParams('doc-1'))
    expect(res.status).toBe(403)
  })

  it('409s a contract that is not fully signed yet', async () => {
    const { handle } = makeDb([[{ id: 'doc-1', status: 'sent' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await adminGet(req('/api/admin/contracts/doc-1/signed-pdf'), routeParams('doc-1'))
    expect(res.status).toBe(409)
  })

  it('streams the PDF with an attachment filename when signed', async () => {
    const { handle } = makeDb([[{ id: 'doc-1', name: 'Acme SOW', status: 'signed' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await adminGet(req('/api/admin/contracts/doc-1/signed-pdf'), routeParams('doc-1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="acme-sow-signed.pdf"')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes)).toBe('the-pdf-bytes')
  })
})

describe('POST /api/admin/contracts/[id]/signed-pdf (resend)', () => {
  it('409s a contract that is not fully signed yet', async () => {
    const { handle } = makeDb([[{ status: 'sent' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await adminPost(req('/api/admin/contracts/doc-1/signed-pdf'), routeParams('doc-1'))
    expect(res.status).toBe(409)
    expect(sendFullySignedContractEmails).not.toHaveBeenCalled()
  })

  it('re-sends the fully-signed email fan-out when signed', async () => {
    const { handle } = makeDb([[{ status: 'signed' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await adminPost(req('/api/admin/contracts/doc-1/signed-pdf'), routeParams('doc-1'))
    expect(res.status).toBe(200)
    expect(sendFullySignedContractEmails).toHaveBeenCalledWith('doc-1')
  })
})

describe('GET /api/public/contracts/[token]/signed-pdf', () => {
  it('404s a malformed token without touching the database', async () => {
    const { handle, calls } = makeDb()
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await publicGet(req('/api/public/contracts/short/signed-pdf'), tokenParams('short'))
    expect(res.status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('404s a real token whose contract is not yet fully signed', async () => {
    const token = 'a'.repeat(32)
    const { handle } = makeDb([[{ id: 'doc-1', status: 'sent' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await publicGet(req(`/api/public/contracts/${token}/signed-pdf`), tokenParams(token))
    expect(res.status).toBe(404)
  })

  it('streams the PDF once the contract is signed', async () => {
    const token = 'a'.repeat(32)
    const { handle } = makeDb([[{ id: 'doc-1', name: 'Acme SOW', status: 'signed' }]])
    vi.mocked(db).mockResolvedValue(handle as never)
    const res = await publicGet(req(`/api/public/contracts/${token}/signed-pdf`), tokenParams(token))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="acme-sow-signed.pdf"')
  })
})

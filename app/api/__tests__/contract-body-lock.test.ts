/**
 * T3.6 S4: PATCH /api/admin/contracts/[id] refuses to edit bodyHtml or
 * variableValues once a contract has left 'draft'. Before this a contract's
 * body stayed a plain editable column for its whole life, so an edit after
 * signing invalidated what "this is what you signed" meant for every
 * signature already taken, with nothing refusing it.
 *
 * Uses the repo's recorder-style fake D1 (matching the admin half of
 * app/api/__tests__/services-org-scope.test.ts): what's under test here is
 * the ORDER and the OUTCOME of the guard, not any SQL condition.
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
  const entry = (method: string, args: unknown[], result: unknown) => {
    calls.push({ method, args })
    return makeChain(result, calls)
  }
  const handle = {
    select: (...args: unknown[]) => entry('select', args, queue.length ? queue.shift() : []),
    insert: (...args: unknown[]) => entry('insert', args, []),
    update: (...args: unknown[]) => entry('update', args, []),
    delete: (...args: unknown[]) => entry('delete', args, []),
  }
  return { handle, calls }
}

const methods = (calls: QueryRecord[]) => calls.map((c) => c.method)

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/access-scope', () => ({
  scopedOrgIds: vi.fn().mockResolvedValue({ kind: 'all' }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/admin/contracts/[id]/route'

function jsonReq(body: unknown) {
  return new NextRequest('http://localhost:3000/api/admin/contracts/doc-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 'doc-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/admin/contracts/[id], the body lock', () => {
  it('refuses a bodyHtml edit on a sent contract, naming the error so the UI can show it', async () => {
    const { handle, calls } = makeDb([[{ orgId: 'org-a', dealId: null, name: 'Acme SOW', status: 'sent' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(jsonReq({ bodyHtml: '<p>New body</p>' }), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'A sent contract cannot be edited. Revoke it first.' })
    expect(methods(calls)).not.toContain('update')
  })

  it('refuses a variableValues edit on a partially_signed contract', async () => {
    const { handle, calls } = makeDb([[{ orgId: 'org-a', dealId: null, name: 'Acme SOW', status: 'partially_signed' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(jsonReq({ variableValues: { client_name: 'New name' } }), params)
    expect(res.status).toBe(400)
    expect(methods(calls)).not.toContain('update')
  })

  it('refuses a body edit on a signed contract', async () => {
    const { handle } = makeDb([[{ orgId: 'org-a', dealId: null, name: 'Acme SOW', status: 'signed' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(jsonReq({ bodyHtml: '<p>New body</p>' }), params)
    expect(res.status).toBe(400)
  })

  it('allows a bodyHtml edit while the contract is still draft', async () => {
    const { handle, calls } = makeDb([[{ orgId: 'org-a', dealId: null, name: 'Acme SOW', status: 'draft' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(jsonReq({ bodyHtml: '<p>New body</p>' }), params)
    expect(res.status).toBe(200)
    const patch = calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>
    expect(patch.bodyHtml).toBe('<p>New body</p>')
  })

  it('allows a non-body field (name) to change on a sent contract', async () => {
    const { handle, calls } = makeDb([[{ orgId: 'org-a', dealId: null, name: 'Acme SOW', status: 'sent' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(jsonReq({ name: 'Renamed SOW' }), params)
    expect(res.status).toBe(200)
    const patch = calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>
    expect(patch.name).toBe('Renamed SOW')
  })

  it('allows an expiresAt edit on a sent contract (not a body field)', async () => {
    const { handle } = makeDb([[{ orgId: 'org-a', dealId: null, name: 'Acme SOW', status: 'sent' }]])
    vi.mocked(db).mockResolvedValue(handle as never)

    const res = await PATCH(jsonReq({ expiresAt: '2027-01-01T00:00:00.000Z' }), params)
    expect(res.status).toBe(200)
  })
})

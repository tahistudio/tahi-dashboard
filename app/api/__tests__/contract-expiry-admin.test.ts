import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { NextRequest } from 'next/server'

// Feature decisions are exercised through real handlers in sales-artifact-feature-guards.test.ts.
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'qa-admin', orgId: 'org-tahi', sessionId: null }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org-tahi'),
}))
vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: vi.fn().mockResolvedValue({ kind: 'all' }) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/app-url', () => ({ publicUrl: (path: string) => `https://portal.example.test${path}` }))
vi.mock('@/lib/email', () => ({ emailFromAddress: () => 'QA <qa@example.test>' }))
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: vi.fn().mockResolvedValue({ success: true, suppressed: [] }),
  resolveDeliveryPolicy: vi.fn().mockResolvedValue({ mode: 'allowlist' }),
  resolveOrgRecipientScope: vi.fn().mockResolvedValue(undefined),
  partitionRecipients: vi.fn((emails: string[]) => ({ allowed: emails, suppressed: [] })),
  recordEmailSuppressions: vi.fn().mockResolvedValue(undefined),
}))

import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { deliverEmail, resolveDeliveryPolicy, recordEmailSuppressions } from '@/lib/email-delivery'
import { POST as create } from '@/app/api/admin/contracts/route'
import { PATCH as patch } from '@/app/api/admin/contracts/[id]/route'
import { POST as email } from '@/app/api/admin/contracts/[id]/email/route'
import { POST as share } from '@/app/api/admin/contracts/[id]/send/route'

let sqlite: DatabaseSync
let queries: string[]

function d1Adapter(database: DatabaseSync) {
  return {
    prepare(query: string) {
      queries.push(query)
      const statement = database.prepare(query)
      const bind = (...params: unknown[]) => ({
        async all() { return { results: statement.all(...params as never[]) } },
        async run() { statement.run(...params as never[]); return { success: true } },
        async raw() {
          const rows = statement.all(...params as never[]) as Array<Record<string, unknown>>
          return rows.map(row => Object.values(row))
        },
      })
      return { bind, ...bind() }
    },
  }
}

const params = { params: Promise.resolve({ id: 'doc-qa' }) }
const NOW = '2026-09-30T10:00:00.000Z'
const END_OF_DAY = '2026-09-30T10:59:59.999Z'
const creation = { name: 'QA SOW', type: 'sow', bodyHtml: '<p>QA terms</p>', orgId: 'org-qa' }

function request(body: unknown, method: 'POST' | 'PATCH' = 'POST') {
  return new NextRequest('http://localhost:3000/api/admin/contracts/doc-qa', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

function shareRequest(rotate = false) {
  return new NextRequest(`http://localhost:3000/api/admin/contracts/doc-qa/send${rotate ? '?rotate=1' : ''}`, { method: 'POST' })
}

function seed(status = 'draft', expiresAt: string | null = null, token: string | null = null) {
  sqlite.prepare(`INSERT INTO contract_documents
    (id, org_id, name, type, body_html, status, expires_at, public_share_token, updated_at)
    VALUES ('doc-qa', 'org-qa', 'QA SOW', 'sow', '<p>QA terms</p>', ?, ?, ?, 'original')`)
    .run(status, expiresAt, token)
  sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, name, email, role, status, position)
    VALUES ('signer-qa', 'doc-qa', 'QA Signer', 'qa@example.test', 'client', 'pending', 0)`).run()
}

function row(id = 'doc-qa') {
  return sqlite.prepare('SELECT * FROM contract_documents WHERE id = ?').get(id) as Record<string, unknown>
}

function expectNoSendSideEffects() {
  expect(queries.some(query => /^(update|insert|delete)\b/i.test(query))).toBe(false)
  expect(queries.some(query => query.includes('contract_signers'))).toBe(false)
  expect(deliverEmail).not.toHaveBeenCalled()
  expect(resolveDeliveryPolicy).not.toHaveBeenCalled()
  expect(recordEmailSuppressions).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(crypto, 'getRandomValues')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  queries = []
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE contract_documents (
      id text PRIMARY KEY, org_id text, deal_id text, lead_id text, proposal_id text, template_id text,
      type text, name text, status text, body_html text, variable_values text,
      public_share_token text, public_shared_at text, signed_storage_key text,
      sent_at text, signed_at text, expires_at text, final_hash text,
      created_by_id text, created_at text, updated_at text
    );
    CREATE TABLE contract_signers (
      id text PRIMARY KEY, contract_id text, role text, name text, email text,
      position integer, status text, signed_at text, signature_id text, created_at text, updated_at text
    );
  `)
  vi.mocked(db).mockResolvedValue(drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) as never)
})

afterEach(() => {
  sqlite.close()
  vi.useRealTimers()
  vi.mocked(crypto.getRandomValues).mockRestore()
})

describe('contract POST expiry persistence', () => {
  it.each([
    ['2026-09-30', END_OF_DAY],
    ['2026-07-15', '2026-07-15T11:59:59.999Z'],
    ['2026-09-30T23:59:59Z', '2026-09-30T23:59:59.000Z'],
    ['2026-09-30T22:30:00+13:00', '2026-09-30T09:30:00.000Z'],
  ])('stores the correct instant for %s', async (expiresAt, expected) => {
    const res = await create(request({ ...creation, expiresAt }))
    expect(res.status).toBe(201)
    const created = await res.json() as { id: string }
    expect(row(created.id)).toMatchObject({ expires_at: expected, status: 'draft', name: 'QA SOW' })
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it.each(['not-a-date', '2026-02-30', '2026-02-29T15:30:00+13:00'])('rejects invalid expiry %s without inserting anything', async (expiresAt) => {
    const res = await create(request({ ...creation, expiresAt }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'expiresAt must be a valid date or timestamp.' })
    expect(sqlite.prepare('SELECT count(*) AS count FROM contract_documents').get()).toMatchObject({ count: 0 })
    expect(queries.some(query => /^insert\b/i.test(query))).toBe(false)
  })

  it('creates a contract without imposing a deadline when omitted', async () => {
    const res = await create(request(creation))
    expect(res.status).toBe(201)
    const created = await res.json() as { id: string }
    expect(row(created.id).expires_at).toBeNull()
  })

  it.each([0, false, 42, true, {}, []])('returns a validation error for non-string deadline %j instead of throwing', async (expiresAt) => {
    const res = await create(request({ ...creation, expiresAt }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'expiresAt must be a valid date or timestamp.' })
    expect(sqlite.prepare('SELECT count(*) AS count FROM contract_documents').get()).toMatchObject({ count: 0 })
    expect(queries.some(query => /^insert\b/i.test(query))).toBe(false)
  })
})

describe('contract PATCH expiry persistence', () => {
  it.each(['draft', 'sent', 'partially_signed'])('extends a %s contract to the selected Auckland end of day', async (status) => {
    seed(status, '2026-09-01T00:00:00Z')
    const res = await patch(request({ expiresAt: '2026-09-30' }, 'PATCH'), params)
    expect(res.status).toBe(200)
    expect(row()).toMatchObject({ expires_at: END_OF_DAY, status })
  })

  it('preserves an explicitly supplied legacy absolute instant', async () => {
    seed('sent', END_OF_DAY)
    const res = await patch(request({ expiresAt: '2026-09-30T23:59:59Z' }, 'PATCH'), params)
    expect(res.status).toBe(200)
    expect(row().expires_at).toBe('2026-09-30T23:59:59.000Z')
  })

  it.each([null, ''])('clears the deadline when explicitly given %s', async (expiresAt) => {
    seed('sent', END_OF_DAY)
    expect((await patch(request({ expiresAt }, 'PATCH'), params)).status).toBe(200)
    expect(row().expires_at).toBeNull()
  })

  it('leaves a legacy instant untouched when expiresAt is omitted', async () => {
    const legacy = '2026-09-30T23:59:59Z'
    seed('sent', legacy)
    expect((await patch(request({ name: 'Renamed QA SOW' }, 'PATCH'), params)).status).toBe(200)
    expect(row()).toMatchObject({ expires_at: legacy, name: 'Renamed QA SOW' })
  })

  it.each(['not-a-date', '2026-02-30', '2026-04-31T10:30:00Z'])('refuses invalid expiry %s without changing the row', async (expiresAt) => {
    seed('sent', END_OF_DAY)
    const before = row()
    const res = await patch(request({ expiresAt }, 'PATCH'), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'expiresAt must be a valid date or timestamp.' })
    expect(row()).toEqual(before)
    expect(queries.some(query => /^update\b/i.test(query))).toBe(false)
  })

  it.each([0, false, 42, true, {}, []])('returns a validation error for non-string deadline %j and leaves the row intact', async (expiresAt) => {
    seed('sent', END_OF_DAY)
    const before = row()
    const res = await patch(request({ expiresAt }, 'PATCH'), params)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'expiresAt must be a valid date or timestamp.' })
    expect(row()).toEqual(before)
    expect(queries.some(query => /^update\b/i.test(query))).toBe(false)
  })
})

describe('contract share token expiry guard (the MCP send_contract path)', () => {
  const lapsedCases = ['draft', 'sent', 'partially_signed'].flatMap(status => [
    { status, token: null, rotate: false },
    { status, token: 'existing-token', rotate: false },
    { status, token: 'existing-token', rotate: true },
  ])

  it.each(lapsedCases)('blocks lapsed $status with token $token and rotate=$rotate before any side effects', async ({ status, token, rotate }) => {
    seed(status, '2026-09-29T10:59:59.999Z', token)
    const before = row()
    const res = await share(shareRequest(rotate), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This contract is closed or lapsed. Extend a lapsed deadline before sharing it.' })
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expect(row()).toEqual(before)
    expectNoSendSideEffects()
  })

  it.each(['signed', 'cancelled', 'expired'])('blocks terminal %s even with a future deadline and a rotation request', async (status) => {
    seed(status, '2026-12-31T10:59:59.999Z', 'existing-token')
    const before = row()
    const res = await share(shareRequest(true), params)
    expect(res.status).toBe(409)
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expect(row()).toEqual(before)
    expectNoSendSideEffects()
  })

  it('mints a token for an open draft, stamps sent and returns the signer URL without sending email', async () => {
    seed('draft', END_OF_DAY)
    const res = await share(shareRequest(), params)
    expect(res.status).toBe(200)
    const result = await res.json() as { token: string; signers: unknown[] }
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(crypto.getRandomValues).toHaveBeenCalledOnce()
    expect(row()).toMatchObject({ status: 'sent', sent_at: NOW, public_share_token: result.token, expires_at: END_OF_DAY })
    expect(result.signers).toEqual([{
      id: 'signer-qa', name: 'QA Signer', email: 'qa@example.test', status: 'pending',
      signPath: `/p/contract/${result.token}/sign/signer-qa`,
    }])
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it('reuses an existing open token without minting or changing the original sent time', async () => {
    seed('sent', null, 'existing-token')
    sqlite.prepare("UPDATE contract_documents SET sent_at = 'original-sent-time' WHERE id = 'doc-qa'").run()
    const res = await share(shareRequest(), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ token: 'existing-token' })
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expect(row()).toMatchObject({ status: 'sent', sent_at: 'original-sent-time', public_share_token: 'existing-token' })
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it('rotates an open partially signed token without resetting the contract state', async () => {
    seed('partially_signed', END_OF_DAY, 'existing-token')
    const res = await share(shareRequest(true), params)
    expect(res.status).toBe(200)
    const result = await res.json() as { token: string }
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(result.token).not.toBe('existing-token')
    expect(crypto.getRandomValues).toHaveBeenCalledOnce()
    expect(row()).toMatchObject({ status: 'partially_signed', public_share_token: result.token, expires_at: END_OF_DAY })
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it('allows sharing at the last millisecond, then refuses rotation at Auckland midnight', async () => {
    seed('sent', END_OF_DAY, 'existing-token')
    vi.setSystemTime(new Date(END_OF_DAY))
    expect((await share(shareRequest(), params)).status).toBe(200)
    const before = row()
    vi.clearAllMocks()
    queries = []
    vi.setSystemTime(new Date('2026-09-30T11:00:00.000Z'))
    expect((await share(shareRequest(true), params)).status).toBe(409)
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expect(row()).toEqual(before)
    expectNoSendSideEffects()
  })

  it('honours the legacy absolute instant until it passes, rather than shortening it to Auckland end of day', async () => {
    seed('sent', '2026-09-30T23:59:59Z', 'existing-token')
    vi.setSystemTime(new Date('2026-09-30T20:00:00Z'))
    expect((await share(shareRequest(), params)).status).toBe(200)
    vi.clearAllMocks()
    queries = []
    vi.setSystemTime(new Date('2026-09-30T23:59:59.001Z'))
    expect((await share(shareRequest(), params)).status).toBe(409)
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expectNoSendSideEffects()
  })

  it('allows sharing again once PATCH extends the deadline of a clock-lapsed sent contract', async () => {
    seed('sent', '2026-09-29T10:59:59.999Z')
    expect((await share(shareRequest(), params)).status).toBe(409)
    expect((await patch(request({ expiresAt: '2026-09-30' }, 'PATCH'), params)).status).toBe(200)
    expect((await share(shareRequest(), params)).status).toBe(200)
    expect(row()).toMatchObject({ status: 'sent', expires_at: END_OF_DAY })
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it('returns 404 without minting or writing for a missing contract', async () => {
    expect((await share(shareRequest(true), params)).status).toBe(404)
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expectNoSendSideEffects()
  })

  it('rejects a non-admin before querying or minting', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({ userId: 'qa-client', orgId: 'org-qa', sessionId: null })
    expect((await share(shareRequest(), params)).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expectNoSendSideEffects()
  })
})

describe('contract email expiry guard', () => {
  it.each(['draft', 'sent', 'partially_signed'])('blocks lapsed %s before minting a token, reading signers or emailing', async (status) => {
    seed(status, '2026-09-29T10:59:59.999Z')
    const before = row()
    const res = await email(request({ cc: [{ email: 'cc@example.test' }] }), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This contract has lapsed. Extend its signing deadline before sending another link.' })
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expect(row()).toEqual(before)
    expectNoSendSideEffects()
  })

  it('also blocks a lapsed contract that already has a share token', async () => {
    seed('sent', '2026-09-29T10:59:59.999Z', 'existing-token')
    expect((await email(request({}), params)).status).toBe(409)
    expect(row().public_share_token).toBe('existing-token')
    expectNoSendSideEffects()
  })

  it.each(['signed', 'cancelled'])('refuses %s with its final outcome instead of calling it lapsed', async (status) => {
    seed(status, '2026-09-29T10:59:59.999Z')
    const res = await email(request({}), params)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This contract is not open for signing.' })
    expect(crypto.getRandomValues).not.toHaveBeenCalled()
    expect(row().status).toBe(status)
    expectNoSendSideEffects()
  })

  it('blocks explicitly expired status without relying on an expiry timestamp', async () => {
    seed('expired')
    const res = await email(request({}), params)
    expect(res.status).toBe(409)
    expectNoSendSideEffects()
  })

  it('mints and persists a token for an open draft and sends the real deadline in its email', async () => {
    seed('draft', END_OF_DAY)
    const res = await email(request({}), params)
    expect(res.status).toBe(200)
    const result = await res.json() as { token: string; sent: unknown[]; failed: unknown[] }
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(result.sent).toEqual([{ signerId: 'signer-qa', email: 'qa@example.test' }])
    expect(result.failed).toEqual([])
    expect(row()).toMatchObject({ public_share_token: result.token, status: 'sent', sent_at: NOW })
    expect(deliverEmail).toHaveBeenCalledOnce()
    expect(vi.mocked(deliverEmail).mock.calls[0][0]).toMatchObject({
      to: 'qa@example.test', template: 'contract-sign',
      html: expect.stringMatching(/30 September 2026.*11:59\s*pm/),
    })
  })

  it('allows a legacy deadline until its actual instant, rather than shortening it to Auckland end of day', async () => {
    seed('sent', '2026-09-30T23:59:59Z', 'existing-token')
    vi.setSystemTime(new Date('2026-09-30T20:00:00Z'))
    expect((await email(request({}), params)).status).toBe(200)
    expect(deliverEmail).toHaveBeenCalledOnce()
    expect(row().expires_at).toBe('2026-09-30T23:59:59Z')
  })

  it('allows the final millisecond, then refuses at Auckland midnight', async () => {
    seed('sent', END_OF_DAY, 'existing-token')
    vi.setSystemTime(new Date(END_OF_DAY))
    expect((await email(request({}), params)).status).toBe(200)
    vi.clearAllMocks()
    queries = []
    vi.setSystemTime(new Date('2026-09-30T11:00:00.000Z'))
    expect((await email(request({}), params)).status).toBe(409)
    expectNoSendSideEffects()
  })

  it('leaves a contract without a deadline open', async () => {
    seed('partially_signed', null, 'existing-token')
    expect((await email(request({}), params)).status).toBe(200)
    expect(row().status).toBe('partially_signed')
    expect(deliverEmail).toHaveBeenCalledOnce()
  })

  it('returns 404 without email or token side effects for a missing contract', async () => {
    expect((await email(request({}), params)).status).toBe(404)
    expectNoSendSideEffects()
  })

  it('rejects a non-admin before touching the database', async () => {
    vi.mocked(getRequestAuth).mockResolvedValueOnce({ userId: 'qa-client', orgId: 'org-qa', sessionId: null })
    expect((await email(request({}), params)).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expectNoSendSideEffects()
  })
})

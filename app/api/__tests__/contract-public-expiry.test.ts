/**
 * A lapsed contract is refused on the READ, before any signature pad
 * renders, not only on the sign POST.
 *
 * GET /api/public/contracts/[token] used to refuse only when the status
 * already said 'cancelled' or 'expired', and only the sign route ever writes
 * 'expired' (lazily, on the first attempt after the deadline). So a client on
 * a lapsed link got the full document and the pad, drew, submitted, and only
 * then read "This contract has expired." Both routes now share
 * lib/contract-signing-state.ts#isContractPastExpiry.
 *
 * Runs the real routes over a real SQLite database (node:sqlite behind a
 * D1-shaped adapter, the pattern in contract-sign-notify.test.ts), because
 * the claims are about rows: what the read answers for a given status and
 * deadline, and that the read leaves the row alone while the sign route
 * still flips it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'

vi.mock('@/lib/notifications', () => ({ notifyAllAdmins: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: vi.fn().mockResolvedValue({ success: true, suppressed: [] }),
  resolveDeliveryPolicy: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/contract-fully-signed-emails', () => ({
  sendFullySignedContractEmails: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn().mockResolvedValue({ ctx: {} }) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { NextRequest } from 'next/server'
import { GET as read } from '@/app/api/public/contracts/[token]/route'
import { POST as sign } from '@/app/api/public/contracts/[token]/sign/[signerId]/route'
import { isContractPastExpiry } from '@/lib/contract-signing-state'

interface BoundStatement {
  all(): Promise<{ results: unknown[] }>
  run(): Promise<{ success: boolean }>
  raw(): Promise<unknown[][]>
}

function d1Adapter(sqlite: DatabaseSync) {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query)
      const bind = (...params: unknown[]): BoundStatement => ({
        async all() {
          return { results: stmt.all(...(params as never[])) as unknown[] }
        },
        async run() {
          stmt.run(...(params as never[]))
          return { success: true }
        },
        async raw() {
          const rows = stmt.all(...(params as never[])) as Array<Record<string, unknown>>
          return rows.map((row) => Object.values(row))
        },
      })
      return { bind, ...bind() }
    },
  }
}

const TOKEN = 'a'.repeat(32)
const PAST = '2026-01-01T23:59:59.000Z'
const FUTURE = '2999-01-01T23:59:59.000Z'

let sqlite: DatabaseSync

function seed(status: string, expiresAt: string | null, finalHash: string | null = null) {
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
      position integer, status text, signed_at text, signature_id text,
      created_at text, updated_at text
    );
    CREATE TABLE contract_signatures (
      id text PRIMARY KEY, contract_id text, signer_id text, signature_data_url text,
      ip_hash text, user_agent text, country text, chain_hash text, body_hash text,
      signed_at text, created_at text, updated_at text
    );
  `)
  sqlite.prepare(`INSERT INTO contract_documents
    (id, org_id, type, name, status, body_html, public_share_token, sent_at, signed_at, expires_at, final_hash, created_by_id, created_at, updated_at)
    VALUES ('doc-1', 'org-a', 'sow', 'Acme SOW', ?, '<p>Terms</p>', ?, '2025-12-01T00:00:00Z', ?, ?, ?, 'creator-1', '2025-12-01T00:00:00Z', '2025-12-01T00:00:00Z')`)
    .run(status, TOKEN, status === 'signed' && finalHash ? '2025-12-05T00:00:00Z' : null, expiresAt, finalHash)
  sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status)
    VALUES ('signer-a', 'doc-1', 'client', 'Jo Yarnall', 'jo@acme.com', 1, 'pending')`).run()
  vi.mocked(db).mockResolvedValue(drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) as never)
}

function statusNow(): string {
  return (sqlite.prepare("SELECT status FROM contract_documents WHERE id = 'doc-1'").get() as { status: string }).status
}

const readReq = () => new NextRequest(`http://localhost:3000/api/public/contracts/${TOKEN}`)
const readParams = { params: Promise.resolve({ token: TOKEN }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lib/contract-signing-state isContractPastExpiry', () => {
  const now = Date.parse('2026-09-26T00:00:00Z')

  it('is true for an open contract whose deadline has passed', () => {
    expect(isContractPastExpiry('sent', '2026-09-20T23:59:59.000Z', now)).toBe(true)
    expect(isContractPastExpiry('partially_signed', '2026-09-20T23:59:59.000Z', now)).toBe(true)
  })

  it('is true for a row the sign route already flipped to expired, deadline or not', () => {
    expect(isContractPastExpiry('expired', null, now)).toBe(true)
  })

  it('is false before the deadline and when there is no deadline', () => {
    expect(isContractPastExpiry('sent', '2026-10-01T00:00:00.000Z', now)).toBe(false)
    expect(isContractPastExpiry('sent', null, now)).toBe(false)
  })

  it('never calls a signed or cancelled contract expired: the outcome came first', () => {
    expect(isContractPastExpiry('signed', '2026-01-01T00:00:00.000Z', now)).toBe(false)
    expect(isContractPastExpiry('cancelled', '2026-01-01T00:00:00.000Z', now)).toBe(false)
  })

  it('ignores an unparseable deadline rather than expiring on it', () => {
    expect(isContractPastExpiry('sent', 'not a date', now)).toBe(false)
  })
})

describe('GET /api/public/contracts/[token], refusing a lapsed contract on the read', () => {
  it('answers 410 with reason expired for a sent contract past its deadline, and no document', async () => {
    seed('sent', PAST)
    const res = await read(readReq(), readParams)
    expect(res.status).toBe(410)
    const body = await res.json() as Record<string, unknown>
    expect(body).toEqual({ error: 'This contract has expired.', reason: 'expired', expiresAt: PAST })
    expect(body).not.toHaveProperty('contract')
    expect(body).not.toHaveProperty('signers')
  })

  it('answers 410 for a partially signed contract past its deadline too', async () => {
    seed('partially_signed', PAST)
    const res = await read(readReq(), readParams)
    expect(res.status).toBe(410)
    expect((await res.json() as { reason: string }).reason).toBe('expired')
  })

  it('leaves the row as it was: the read never writes, so the studio can still extend the date', async () => {
    seed('sent', PAST)
    await read(readReq(), readParams)
    expect(statusNow()).toBe('sent')
  })

  it('still answers 410 expired once the sign route has flipped the status', async () => {
    seed('expired', PAST)
    const res = await read(readReq(), readParams)
    expect(res.status).toBe(410)
    expect((await res.json() as { reason: string }).reason).toBe('expired')
  })

  it('answers 410 with reason cancelled for a cancelled contract', async () => {
    seed('cancelled', FUTURE)
    const res = await read(readReq(), readParams)
    expect(res.status).toBe(410)
    expect((await res.json() as { reason: string }).reason).toBe('cancelled')
  })

  it('serves an open contract before its deadline', async () => {
    seed('sent', FUTURE)
    const res = await read(readReq(), readParams)
    expect(res.status).toBe(200)
    const body = await res.json() as { contract: { status: string }; signers: unknown[] }
    expect(body.contract.status).toBe('sent')
    expect(body.signers).toHaveLength(1)
  })

  it('keeps serving a fully signed contract after its deadline: the read-only link lives on by design', async () => {
    seed('signed', PAST, 'final-hash')
    const res = await read(readReq(), readParams)
    expect(res.status).toBe(200)
  })
})

describe('POST /api/public/contracts/[token]/sign/[signerId] still refuses', () => {
  it('410s a lapsed contract and writes expired onto the row', async () => {
    seed('sent', PAST)
    const res = await sign(new NextRequest(`http://localhost:3000/api/public/contracts/${TOKEN}/sign/signer-a`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureDataUrl: 'data:image/png;base64,AAAA' }),
    }), { params: Promise.resolve({ token: TOKEN, signerId: 'signer-a' }) })
    expect(res.status).toBe(410)
    expect(statusNow()).toBe('expired')
    const sigs = sqlite.prepare('SELECT count(*) AS n FROM contract_signatures').get() as { n: number }
    expect(sigs.n).toBe(0)
  })
})

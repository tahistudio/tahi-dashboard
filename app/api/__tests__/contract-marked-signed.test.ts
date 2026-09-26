/**
 * A contract marked signed by hand is never presented as signed through the
 * signing flow, and no surface dates it "today".
 *
 * The case that found it: the Lingorama SoW, set to 'signed' through the MCP
 * update_contract tool (an admin PATCH) for an agreement executed outside the
 * system. That write touches neither signedAt nor finalHash and creates no
 * signature rows, so the public viewer showed "FULLY SIGNED" beside "0 OF 2
 * SIGNED" and dated the audit trail with the reader's own clock. Every API
 * that feeds a contract surface now carries a derived `markedSigned` flag
 * (lib/contract-signing-state.ts) and never the hash itself.
 *
 * Real routes over a real SQLite database (node:sqlite behind a D1-shaped
 * adapter, the pattern in contract-sign-notify.test.ts). The signed-PDF
 * refusals live in contract-signed-pdf-routes.test.ts and the email refusal
 * in contract-fully-signed-emails.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/access-scope', () => ({ scopedOrgIds: vi.fn().mockResolvedValue({ kind: 'all' }) }))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { NextRequest } from 'next/server'
import { GET as publicRead } from '@/app/api/public/contracts/[token]/route'
import { GET as previewData } from '@/app/api/admin/contracts/[id]/preview-data/route'
import { GET as adminList } from '@/app/api/admin/contracts/route'
import { isMarkedSigned } from '@/lib/contract-signing-state'

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

const MARKED_TOKEN = 'm'.repeat(32)
const FLOW_TOKEN = 'f'.repeat(32)

function seed() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE organisations (id text PRIMARY KEY, name text);
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
  sqlite.prepare("INSERT INTO organisations (id, name) VALUES ('org-l', 'Lingorama')").run()
  // The Lingorama shape: 'signed', no signedAt, no finalHash, two pending
  // signers, no signatures.
  sqlite.prepare(`INSERT INTO contract_documents
    (id, org_id, type, name, status, body_html, public_share_token, sent_at, signed_at, expires_at, final_hash, created_by_id, created_at, updated_at)
    VALUES ('doc-marked', 'org-l', 'sow', 'Lingorama SoW', 'signed', '<p>Terms</p>', ?, NULL, NULL, NULL, NULL, 'api-service', '2026-09-05T06:13:07.952Z', '2026-09-10T00:48:19.304Z')`)
    .run(MARKED_TOKEN)
  sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status)
    VALUES ('m-1', 'doc-marked', 'tahi', 'Liam Miller', 'business@tahi.studio', 1, 'pending'),
           ('m-2', 'doc-marked', 'client', 'Frederic Colier', 'frederic@example.com', 2, 'pending')`).run()
  // Signed through the flow: the last signature stamped signedAt and finalHash.
  sqlite.prepare(`INSERT INTO contract_documents
    (id, org_id, type, name, status, body_html, public_share_token, sent_at, signed_at, expires_at, final_hash, created_by_id, created_at, updated_at)
    VALUES ('doc-flow', 'org-l', 'nda', 'Flow NDA', 'signed', '<p>Terms</p>', ?, '2026-05-01T00:00:00Z', '2026-05-07T09:52:26.730Z', NULL, 'final-hash', 'user_liam', '2026-05-01T00:00:00Z', '2026-05-07T09:52:26.730Z')`)
    .run(FLOW_TOKEN)
  sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status, signed_at, signature_id)
    VALUES ('f-1', 'doc-flow', 'client', 'Jo Yarnall', 'jo@acme.com', 1, 'signed', '2026-05-07T09:52:26.730Z', 'sig-1')`).run()
  sqlite.prepare(`INSERT INTO contract_signatures (id, contract_id, signer_id, signature_data_url, chain_hash, signed_at)
    VALUES ('sig-1', 'doc-flow', 'f-1', 'data:image/png;base64,AAAA', 'final-hash', '2026-05-07T09:52:26.730Z')`).run()
  vi.mocked(db).mockResolvedValue(drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) as never)
}

type ContractPayload = { contract: Record<string, unknown>; signers: unknown[]; signatures: unknown[] }

async function readPublic(token: string): Promise<ContractPayload> {
  const res = await publicRead(new NextRequest(`http://localhost:3000/api/public/contracts/${token}`), {
    params: Promise.resolve({ token }),
  })
  expect(res.status).toBe(200)
  return res.json() as Promise<ContractPayload>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lib/contract-signing-state isMarkedSigned', () => {
  it('is true for signed without the finalHash the signing flow always writes', () => {
    expect(isMarkedSigned({ status: 'signed', finalHash: null })).toBe(true)
  })

  it('is false for a contract signed through the flow', () => {
    expect(isMarkedSigned({ status: 'signed', finalHash: 'abc' })).toBe(false)
  })

  it('is false for anything not signed', () => {
    for (const status of ['draft', 'sent', 'partially_signed', 'expired', 'cancelled']) {
      expect(isMarkedSigned({ status, finalHash: null })).toBe(false)
    }
  })
})

describe('GET /api/public/contracts/[token]', () => {
  it('flags the Lingorama shape as marked signed, with no signing date to show', async () => {
    seed()
    const body = await readPublic(MARKED_TOKEN)
    expect(body.contract.status).toBe('signed')
    expect(body.contract.markedSigned).toBe(true)
    expect(body.contract.signedAt).toBeNull()
    expect(body.signatures).toEqual([])
  })

  it('does not flag a contract signed through the flow', async () => {
    seed()
    const body = await readPublic(FLOW_TOKEN)
    expect(body.contract.markedSigned).toBe(false)
    expect(body.contract.signedAt).toBe('2026-05-07T09:52:26.730Z')
  })

  it('never puts the final hash on the public payload', async () => {
    seed()
    const body = await readPublic(FLOW_TOKEN)
    expect(body.contract).not.toHaveProperty('finalHash')
  })
})

describe('GET /api/admin/contracts/[id]/preview-data', () => {
  it('carries the same flag, so the admin preview reads what the client would', async () => {
    seed()
    const res = await previewData(
      new NextRequest('http://localhost:3000/api/admin/contracts/doc-marked/preview-data'),
      { params: Promise.resolve({ id: 'doc-marked' }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json() as ContractPayload & { expired: boolean }
    expect(body.contract.markedSigned).toBe(true)
    expect(body.contract).not.toHaveProperty('finalHash')
    expect(body.expired).toBe(false)
  })
})

describe('GET /api/admin/contracts', () => {
  it('marks the hand-signed row and keeps the real count beside it', async () => {
    seed()
    const res = await adminList(new NextRequest('http://localhost:3000/api/admin/contracts'))
    expect(res.status).toBe(200)
    const { items } = await res.json() as { items: Array<Record<string, unknown>> }
    const marked = items.find(i => i.id === 'doc-marked')
    const flow = items.find(i => i.id === 'doc-flow')
    expect(marked).toMatchObject({ status: 'signed', markedSigned: true, signedCount: 0, totalSigners: 2 })
    expect(flow).toMatchObject({ status: 'signed', markedSigned: false, signedCount: 1, totalSigners: 1 })
    expect(marked).not.toHaveProperty('finalHash')
  })
})

/**
 * T3.6 S4: DELETE /api/admin/contracts/[id]/send actually undoes a
 * signature, not only the document. Before this, revoking a partly-signed
 * contract reset the document back to 'draft' while its signers still read
 * 'signed' and the contract_signatures rows still existed, chained under a
 * document the UI now called unsent.
 *
 * Runs the real route over a real SQLite database (node:sqlite behind a
 * D1-shaped adapter), because what's under test is genuine SQL: which
 * signers count as "non-pending" (ne('pending')) and that every signature
 * row for THIS contract is gone, not just its own status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'

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
import { DELETE as revoke } from '@/app/api/admin/contracts/[id]/send/route'

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

const CONTRACT_ID = 'doc-1'

function seed() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE contract_documents (
      id text PRIMARY KEY, org_id text, deal_id text, type text, name text, status text,
      body_html text, public_share_token text, public_shared_at text, signed_storage_key text,
      sent_at text, signed_at text, expires_at text, final_hash text, created_by_id text,
      created_at text, updated_at text
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
    CREATE TABLE audit_log (
      id text PRIMARY KEY, actor_id text, actor_type text, action text,
      entity_type text, entity_id text, metadata text, ip_address text, created_at text
    );
  `)
  sqlite.prepare(`INSERT INTO contract_documents
    (id, org_id, type, name, status, body_html, public_share_token, public_shared_at, sent_at, signed_at, final_hash, created_by_id)
    VALUES (?, 'org-a', 'sow', 'Acme SOW', 'partially_signed', '<p>Terms</p>', 'tok_123', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, NULL, 'creator-1')`)
    .run(CONTRACT_ID)
  sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status, signed_at, signature_id)
    VALUES ('signer-a', ?, 'client', 'Jo Yarnall', 'jo@acme.com', 1, 'signed', '2026-01-02T00:00:00Z', 'sig-a')`).run(CONTRACT_ID)
  sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status)
    VALUES ('signer-b', ?, 'tahi', 'Liam Miller', 'business@tahi.studio', 2, 'pending')`).run(CONTRACT_ID)
  sqlite.prepare(`INSERT INTO contract_signatures (id, contract_id, signer_id, signature_data_url, chain_hash, signed_at)
    VALUES ('sig-a', ?, 'signer-a', 'data:image/png;base64,AAAA', 'hash-a', '2026-01-02T00:00:00Z')`).run(CONTRACT_ID)
  return { sqlite, database: drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) }
}

function req() {
  return new NextRequest(`http://localhost:3000/api/admin/contracts/${CONTRACT_ID}/send`, { method: 'DELETE' })
}

const params = { params: Promise.resolve({ id: CONTRACT_ID }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/admin/contracts/[id]/send, revoke actually resets', () => {
  it('puts every non-pending signer back to pending and clears their signature link', async () => {
    const { sqlite, database } = seed()
    vi.mocked(db).mockResolvedValue(database as never)

    const res = await revoke(req(), params)
    expect(res.status).toBe(200)

    const signers = sqlite.prepare('SELECT id, status, signed_at, signature_id FROM contract_signers ORDER BY id').all() as Array<{
      id: string; status: string; signed_at: string | null; signature_id: string | null
    }>
    expect(signers).toEqual([
      { id: 'signer-a', status: 'pending', signed_at: null, signature_id: null },
      { id: 'signer-b', status: 'pending', signed_at: null, signature_id: null },
    ])
  })

  it('deletes every signature row for the contract', async () => {
    const { sqlite, database } = seed()
    vi.mocked(db).mockResolvedValue(database as never)

    await revoke(req(), params)
    const rows = sqlite.prepare('SELECT * FROM contract_signatures WHERE contract_id = ?').all(CONTRACT_ID)
    expect(rows).toHaveLength(0)
  })

  it('resets the document to draft and clears finalHash, signedAt and the share token', async () => {
    const { sqlite, database } = seed()
    vi.mocked(db).mockResolvedValue(database as never)

    await revoke(req(), params)
    const doc = sqlite.prepare('SELECT status, final_hash, signed_at, public_share_token, sent_at FROM contract_documents WHERE id = ?').get(CONTRACT_ID) as {
      status: string; final_hash: string | null; signed_at: string | null; public_share_token: string | null; sent_at: string | null
    }
    expect(doc).toEqual({ status: 'draft', final_hash: null, signed_at: null, public_share_token: null, sent_at: null })
  })

  it('writes an auditLog row naming the discarded signature ids, before they disappear', async () => {
    const { sqlite, database } = seed()
    vi.mocked(db).mockResolvedValue(database as never)

    await revoke(req(), params)
    const rows = sqlite.prepare('SELECT action, entity_id, metadata FROM audit_log').all() as Array<{
      action: string; entity_id: string; metadata: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('contract_revoked_signatures_discarded')
    expect(rows[0].entity_id).toBe(CONTRACT_ID)
    const metadata = JSON.parse(rows[0].metadata) as { discardedSignatureIds: string[] }
    expect(metadata.discardedSignatureIds).toEqual(['sig-a'])
  })

  it('writes no auditLog row when there was nothing to discard', async () => {
    const { sqlite, database } = seed()
    // Strip the one signature so this contract has nothing signed yet.
    sqlite.prepare('DELETE FROM contract_signatures').run()
    sqlite.prepare("UPDATE contract_signers SET status = 'pending', signed_at = NULL, signature_id = NULL WHERE id = 'signer-a'").run()
    vi.mocked(db).mockResolvedValue(database as never)

    await revoke(req(), params)
    const rows = sqlite.prepare('SELECT * FROM audit_log').all()
    expect(rows).toHaveLength(0)
  })
})

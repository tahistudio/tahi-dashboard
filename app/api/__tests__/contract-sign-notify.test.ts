/**
 * T3.6/T3.7 S4: POST /api/public/contracts/[token]/sign/[signerId] tells the
 * studio on EVERY signature, not only the last one, and anchors each
 * signature to the exact body it was taken against.
 *
 * Runs the real route over a real SQLite database (node:sqlite behind a
 * D1-shaped adapter, driving the real drizzle d1 driver, matching the
 * pattern in app/api/__tests__/services-org-scope.test.ts): the thing under
 * test is genuine WHERE-clause behaviour (how many signers remain pending,
 * which signature is "most recent") that a mocked query builder ignoring
 * conditions could not prove. notifyAllAdmins and the email door
 * (deliverEmail / resolveDeliveryPolicy) are mocked, per plan, so the bell
 * and the studio email are asserted on their call arguments rather than by
 * driving a real Resend send.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'

vi.mock('@/lib/notifications', () => ({
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: vi.fn().mockResolvedValue({ success: true, suppressed: [] }),
  resolveDeliveryPolicy: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/contract-fully-signed-emails', () => ({
  sendFullySignedContractEmails: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn().mockResolvedValue({ ctx: {} }),
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

import { db } from '@/lib/db'
import { notifyAllAdmins } from '@/lib/notifications'
import { deliverEmail } from '@/lib/email-delivery'
import { sha256Hex, bodyMatchesSignedHash } from '@/lib/contract-chain'
import { NextRequest } from 'next/server'
import { POST as sign } from '@/app/api/public/contracts/[token]/sign/[signerId]/route'

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

type SeededDb = ReturnType<typeof drizzle>

const TOKEN = 'a'.repeat(32)

function req(signatureDataUrl = 'data:image/png;base64,AAAA') {
  return new NextRequest(`http://localhost:3000/api/public/contracts/${TOKEN}/sign/signer-a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureDataUrl }),
  })
}

function routeParams(signerId: string) {
  return { params: Promise.resolve({ token: TOKEN, signerId }) }
}

describe('POST /api/public/contracts/[token]/sign/[signerId], telling the studio', () => {
  let sqlite: DatabaseSync
  let database: SeededDb

  function seed(bodyHtml: string, dealId: string | null) {
    sqlite = new DatabaseSync(':memory:')
    sqlite.exec(`
      CREATE TABLE contract_documents (
        id text PRIMARY KEY,
        org_id text, deal_id text, lead_id text, proposal_id text, template_id text,
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
      CREATE TABLE team_members (
        id text PRIMARY KEY, name text, email text, clerk_user_id text
      );
      CREATE TABLE activities (
        id text PRIMARY KEY, type text, title text, description text, deal_id text,
        lead_id text, org_id text, contact_id text, created_by_id text,
        scheduled_at text, completed_at text, duration_minutes integer, outcome text,
        created_at text, updated_at text
      );
    `)
    sqlite.prepare(`INSERT INTO contract_documents
      (id, org_id, deal_id, type, name, status, body_html, public_share_token, created_by_id, created_at, updated_at)
      VALUES ('doc-1', 'org-a', ?, 'sow', 'Acme SOW', 'sent', ?, ?, 'creator-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`)
      .run(dealId, bodyHtml, TOKEN)
    sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status)
      VALUES ('signer-a', 'doc-1', 'client', 'Jo Yarnall', 'jo@acme.com', 1, 'pending')`).run()
    sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status)
      VALUES ('signer-b', 'doc-1', 'tahi', 'Liam Miller', 'business@tahi.studio', 2, 'pending')`).run()
    sqlite.prepare(`INSERT INTO team_members (id, name, email, clerk_user_id)
      VALUES ('tm-1', 'Liam Miller', 'business@tahi.studio', 'user_liam')`).run()
    database = drizzle(d1Adapter(sqlite) as unknown as AnyD1Database)
    vi.mocked(db).mockResolvedValue(database as never)
  }

  function signatureRow(id: string): { body_hash: string | null; chain_hash: string } {
    return sqlite.prepare('SELECT body_hash, chain_hash FROM contract_signatures WHERE signer_id = ?').get(id) as never
  }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.RESEND_API_KEY
  })

  it('notifies the studio on the FIRST signature, which used to be silent', async () => {
    seed('<p>Original terms</p>', null)
    const res = await sign(req(), routeParams('signer-a'))
    expect(res.status).toBe(200)
    const body = await res.json() as { contractStatus: string }
    expect(body.contractStatus).toBe('partially_signed')

    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[0]
    expect((payload as { type: string }).type).toBe('contract_partially_signed')
    expect((payload as { entityType: string }).entityType).toBe('contract')
    expect((payload as { entityId: string }).entityId).toBe('doc-1')
  })

  it('emails the studio on a partial signature when Resend is configured', async () => {
    process.env.RESEND_API_KEY = 'test_key'
    seed('<p>Original terms</p>', null)
    await sign(req(), routeParams('signer-a'))
    expect(deliverEmail).toHaveBeenCalledTimes(1)
    const [args] = vi.mocked(deliverEmail).mock.calls[0]
    expect((args as { to: string }).to).toBe('business@tahi.studio')
    expect((args as { template: string }).template).toBe('contract-partially-signed')
  })

  it('attempts no studio email on a partial signature without a Resend key', async () => {
    seed('<p>Original terms</p>', null)
    await sign(req(), routeParams('signer-a'))
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it('logs a deal activity for a partial signature only when the contract is linked to a deal', async () => {
    seed('<p>Original terms</p>', 'deal-1')
    await sign(req(), routeParams('signer-a'))
    const rows = sqlite.prepare('SELECT type, deal_id FROM activities').all() as Array<{ type: string; deal_id: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('contract_partially_signed')
    expect(rows[0].deal_id).toBe('deal-1')
  })

  it('logs no activity for an unlinked contract', async () => {
    seed('<p>Original terms</p>', null)
    await sign(req(), routeParams('signer-a'))
    const rows = sqlite.prepare('SELECT * FROM activities').all()
    expect(rows).toHaveLength(0)
  })

  it('notifies contract_signed, not the partial event, on the FINAL signature', async () => {
    seed('<p>Original terms</p>', null)
    await sign(req(), routeParams('signer-a'))
    vi.mocked(notifyAllAdmins).mockClear()
    vi.mocked(deliverEmail).mockClear()

    const res = await sign(req(), routeParams('signer-b'))
    const body = await res.json() as { contractStatus: string }
    expect(body.contractStatus).toBe('signed')

    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const [, payload] = vi.mocked(notifyAllAdmins).mock.calls[0]
    expect((payload as { type: string }).type).toBe('contract_signed')
    // The final signature keeps its own richer email (the fully-signed PDF
    // sender, mocked away here); the studio notifier sends nothing itself.
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it('anchors the signature to a hash of the body at signing time', async () => {
    const bodyHtml = '<p>Original terms</p>'
    seed(bodyHtml, null)
    await sign(req(), routeParams('signer-a'))
    const row = signatureRow('signer-a')
    expect(row.body_hash).toBe(await sha256Hex(bodyHtml))
  })

  it('chain verification diverges when the body is mutated after two signatures', async () => {
    const original = '<p>Original terms</p>'
    seed(original, null)
    await sign(req(), routeParams('signer-a'))
    await sign(req(), routeParams('signer-b'))

    const sigA = signatureRow('signer-a')
    const sigB = signatureRow('signer-b')

    // Both signatures verify clean against the body they were actually
    // taken against.
    expect(await bodyMatchesSignedHash(original, sigA.body_hash)).toBe(true)
    expect(await bodyMatchesSignedHash(original, sigB.body_hash)).toBe(true)

    // Simulate a body edit reaching the row directly (the PATCH lock refuses
    // this through the API; this proves the anchor itself, independent of
    // that guard). Re-hashing the now-current body against EITHER stored
    // anchor diverges, which is the tamper signal.
    const mutated = '<p>Mutated terms</p>'
    sqlite.prepare('UPDATE contract_documents SET body_html = ? WHERE id = ?').run(mutated, 'doc-1')

    expect(await bodyMatchesSignedHash(mutated, sigA.body_hash)).toBe(false)
    expect(await bodyMatchesSignedHash(mutated, sigB.body_hash)).toBe(false)
  })

  it('bodyMatchesSignedHash reads a pre-migration signature (no anchor) as unverifiable, not tampered', async () => {
    expect(await bodyMatchesSignedHash('<p>Anything</p>', null)).toBeNull()
  })
})

/**
 * lib/contract-fully-signed-emails.ts writes the signed PDF to R2 (and
 * signedStorageKey onto the row) before anything decides whether to send.
 *
 * The persist block's own comment said the PDF was saved before the send,
 * but it sat after two early returns: a contract with nobody to email, and
 * an environment with no RESEND_API_KEY. Either one skipped it, so the one
 * durable copy of the signed agreement was never written. Also pinned here:
 * the PDF and email carry the contract's own signing date, and a contract
 * marked signed by hand gets neither (lib/contract-signing-state.ts).
 *
 * Real SQLite (node:sqlite behind a D1-shaped adapter, the pattern in
 * contract-sign-notify.test.ts) so the storage key is read back off the row;
 * the PDF builder, the email renderer and the email door are mocked, and R2
 * is an in-memory bucket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'

const events = vi.hoisted(() => [] as string[])
const bucket = vi.hoisted(() => ({
  puts: [] as string[],
  fail: false,
  async put(key: string) {
    if (this.fail) throw new Error('R2 unavailable')
    this.puts.push(key)
    events.push(`put:${key}`)
  },
}))

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(async () => ({ env: { STORAGE: bucket } })),
}))
vi.mock('@/lib/contract-signed-pdf', () => ({
  buildSignedPdfBase64: vi.fn(() => btoa('signed-pdf')),
}))
vi.mock('@react-email/render', () => ({ render: vi.fn(async () => '<p>email</p>') }))
vi.mock('@/emails/contract-fully-signed', () => ({ ContractFullySignedEmail: vi.fn(() => null) }))
vi.mock('@/lib/email-delivery', () => ({
  deliverEmail: vi.fn(async ({ to }: { to: string }) => {
    events.push(`send:${to}`)
    return { success: true, suppressed: [] }
  }),
  resolveDeliveryPolicy: vi.fn().mockResolvedValue({}),
}))

import { db } from '@/lib/db'
import { deliverEmail } from '@/lib/email-delivery'
import { buildSignedPdfBase64 } from '@/lib/contract-signed-pdf'
import { ContractFullySignedEmail } from '@/emails/contract-fully-signed'
import { sendFullySignedContractEmails } from '@/lib/contract-fully-signed-emails'

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

const SIGNED_AT = '2026-05-07T09:52:26.730Z'
let sqlite: DatabaseSync

function seed(opts: { withRecipients?: boolean; markedSigned?: boolean } = {}) {
  const withRecipients = opts.withRecipients ?? true
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
    CREATE TABLE team_members (id text PRIMARY KEY, name text, email text, clerk_user_id text);
    CREATE TABLE audit_log (
      id text PRIMARY KEY, actor_id text, actor_type text, action text,
      entity_type text, entity_id text, metadata text, ip_address text, created_at text
    );
  `)
  sqlite.prepare(`INSERT INTO contract_documents
    (id, org_id, type, name, status, body_html, public_share_token, signed_at, final_hash, created_by_id, created_at, updated_at)
    VALUES ('doc-1', 'org-a', 'sow', 'Acme SOW', 'signed', '<p>Terms</p>', ?, ?, ?, ?, '2026-05-01T00:00:00Z', '2026-05-07T00:00:00Z')`)
    .run(
      'a'.repeat(32),
      opts.markedSigned ? null : SIGNED_AT,
      opts.markedSigned ? null : 'final-hash',
      withRecipients ? 'user_liam' : 'nobody',
    )
  const email = (e: string) => (withRecipients ? e : '')
  sqlite.prepare(`INSERT INTO contract_signers (id, contract_id, role, name, email, position, status, signed_at)
    VALUES ('s-1', 'doc-1', 'client', 'Jo Yarnall', ?, 1, ?, ?)`)
    .run(email('jo@tahi.studio'), opts.markedSigned ? 'pending' : 'signed', opts.markedSigned ? null : SIGNED_AT)
  if (!opts.markedSigned) {
    sqlite.prepare(`INSERT INTO contract_signatures (id, contract_id, signer_id, signature_data_url, chain_hash, signed_at)
      VALUES ('sig-1', 'doc-1', 's-1', 'data:image/png;base64,AAAA', 'final-hash', ?)`).run(SIGNED_AT)
  }
  sqlite.prepare("INSERT INTO team_members (id, name, email, clerk_user_id) VALUES ('tm-1', 'Liam Miller', 'business@tahi.studio', 'user_liam')").run()
  vi.mocked(db).mockResolvedValue(drizzle(d1Adapter(sqlite) as unknown as AnyD1Database) as never)
}

function storageKey(): string | null {
  return (sqlite.prepare("SELECT signed_storage_key AS k FROM contract_documents WHERE id = 'doc-1'").get() as { k: string | null }).k
}

function auditOutcomes(): string[] {
  const rows = sqlite.prepare('SELECT metadata FROM audit_log').all() as Array<{ metadata: string }>
  return rows.map(r => (JSON.parse(r.metadata) as { outcome: string }).outcome)
}

const savedKey = process.env.RESEND_API_KEY

beforeEach(() => {
  vi.clearAllMocks()
  events.length = 0
  bucket.puts.length = 0
  bucket.fail = false
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = savedKey
})

describe('sendFullySignedContractEmails, persisting the signed PDF', () => {
  it('writes the PDF and signedStorageKey even when RESEND_API_KEY is unset, and sends nothing', async () => {
    delete process.env.RESEND_API_KEY
    seed()
    await sendFullySignedContractEmails('doc-1')

    expect(bucket.puts).toEqual(['contracts/doc-1/signed.pdf'])
    expect(storageKey()).toBe('contracts/doc-1/signed.pdf')
    expect(deliverEmail).not.toHaveBeenCalled()
    expect(auditOutcomes()).toEqual(['skipped_no_resend_key'])
  })

  it('writes the PDF and signedStorageKey even when there is nobody to email', async () => {
    process.env.RESEND_API_KEY = 'test_key'
    seed({ withRecipients: false })
    await sendFullySignedContractEmails('doc-1')

    expect(storageKey()).toBe('contracts/doc-1/signed.pdf')
    expect(deliverEmail).not.toHaveBeenCalled()
  })

  it('stores the PDF before the first email goes out', async () => {
    process.env.RESEND_API_KEY = 'test_key'
    seed()
    await sendFullySignedContractEmails('doc-1')

    expect(events[0]).toBe('put:contracts/doc-1/signed.pdf')
    expect(events.slice(1).sort()).toEqual(['send:business@tahi.studio', 'send:jo@tahi.studio'])
    expect(storageKey()).toBe('contracts/doc-1/signed.pdf')
    expect(auditOutcomes()).toEqual(['sent'])
  })

  it('still sends when the storage write fails: a lost copy costs a rebuild later, never the email', async () => {
    process.env.RESEND_API_KEY = 'test_key'
    seed()
    bucket.fail = true
    await sendFullySignedContractEmails('doc-1')

    expect(storageKey()).toBeNull()
    expect(deliverEmail).toHaveBeenCalledTimes(2)
  })

  it("stamps the PDF and the email with the contract's own signing date", async () => {
    process.env.RESEND_API_KEY = 'test_key'
    seed()
    await sendFullySignedContractEmails('doc-1')

    expect(vi.mocked(buildSignedPdfBase64).mock.calls[0][0].signedAt).toBe(SIGNED_AT)
    const props = vi.mocked(ContractFullySignedEmail).mock.calls[0][0] as { signedAt: string }
    expect(props.signedAt).toBe(SIGNED_AT)
  })

  it('does nothing for a contract marked signed by hand: no PDF, no stored copy, no email', async () => {
    process.env.RESEND_API_KEY = 'test_key'
    seed({ markedSigned: true })
    await sendFullySignedContractEmails('doc-1')

    expect(buildSignedPdfBase64).not.toHaveBeenCalled()
    expect(bucket.puts).toEqual([])
    expect(storageKey()).toBeNull()
    expect(deliverEmail).not.toHaveBeenCalled()
  })
})

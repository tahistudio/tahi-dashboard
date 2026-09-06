/**
 * What a partly-withheld send is allowed to CLAIM.
 *
 * The gate filters one address at a time, which is right: a list mixing a
 * teammate with three prospects should reach the teammate. The failure was
 * downstream of that. `outcome.suppressed` was only ever read on the failure
 * path, so as soon as ONE address survived the send reported plain success and
 * the withheld ones vanished:
 *
 *   - the deal nudge kept status 'sent' and wrote "Nudge sent to a@prospect.com,
 *     b@tahi.studio" into the deal timeline, naming a person who received
 *     nothing. A studio reading that history would believe it had followed up.
 *   - the contract share partitioned cc and bcc INSIDE the per-signer loop, so
 *     one withheld cc on a three-signer contract wrote three identical
 *     suppression rows and came back three times, reading as three withheld
 *     sends when there was one.
 *
 * Pinned here: the timeline names only what was delivered, `suppressed` comes
 * back on the success path, and a constant cc is logged and reported once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const state = {
  selectRows: [] as unknown[][],
  inserts: [] as Row[],
  activities: [] as Row[],
  policy: {
    mode: 'allowlist' as 'allowlist' | 'all',
    allowedDomains: ['tahi.studio'],
    allowedOrgIds: [] as string[],
    allowedAddresses: [] as string[],
    blockedAddresses: [] as string[],
  },
  sent: [] as Row[],
}

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))
vi.mock('@/app/api/admin/deals/_access', () => ({
  requireDealAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/app/api/admin/_sales-access/artifact-scope', () => ({
  requireContractAccess: vi.fn().mockResolvedValue(null),
  requireProposalAccess: vi.fn().mockResolvedValue(null),
  requireScheduleAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/deal-activity', () => ({
  logActivity: vi.fn(async (_db: unknown, entry: Row) => { state.activities.push(entry) }),
}))
vi.mock('@/lib/app-url', () => ({ publicUrl: (p: string) => `https://portal.tahi.studio${p}` }))
vi.mock('@react-email/render', () => ({ render: vi.fn(async () => '<p>sign</p>') }))
vi.mock('@/emails/contract-sign', () => ({ ContractSignEmail: vi.fn(() => null) }))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return { eq: stub, and: stub, desc: stub, inArray: stub }
})

vi.mock('@/db/d1', () => ({
  schema: {
    dealNudges: { __table: 'deal_nudges', id: 'id', dealId: 'deal_id' },
    settings: { __table: 'settings', key: 'key', value: 'value' },
    contractDocuments: { __table: 'contract_documents', id: 'id', orgId: 'org_id', type: 'type', name: 'name', status: 'status', publicShareToken: 'token' },
    contractSigners: { __table: 'contract_signers', id: 'id', contractId: 'contract_id', role: 'role', name: 'name', email: 'email', status: 'status' },
    contacts: { __table: 'contacts', orgId: 'org_id', email: 'email' },
    emailSuppressions: { __table: 'email_suppressions', createdAt: 'created_at' },
  },
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(state.selectRows.length ? state.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  chain.set = vi.fn(() => chain)
  chain.where = vi.fn(() => {
    const promise = answer() as Promise<unknown[]> & { limit?: unknown }
    return Object.assign(promise, { limit: vi.fn(() => promise) })
  })
  const tableName = (t: unknown) => (t as { __table?: string })?.__table ?? 'unknown'
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      update: vi.fn(() => chain),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((rows: Row | Row[]) => {
          for (const row of Array.isArray(rows) ? rows : [rows]) {
            state.inserts.push({ __table: tableName(table), ...row })
          }
          return Promise.resolve(undefined)
        }),
      })),
    }),
  }
})

// deliverEmail stays REAL so the partitioning under test is the shipped one;
// only the policy read and the Resend client are fixtures.
vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: vi.fn(async (payload: Row) => {
        state.sent.push(payload)
        return { data: { id: 'msg_1' }, error: null }
      }),
    }
  },
}))

vi.mock('@/lib/email-gate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-gate')>()),
  resolveDeliveryPolicy: vi.fn(async () => state.policy),
}))

import { NextRequest } from 'next/server'
import { POST as createNudge } from '@/app/api/admin/deals/[id]/nudges/route'
import { POST as emailContract } from '@/app/api/admin/contracts/[id]/email/route'

function jsonReq(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const suppressions = () => state.inserts.filter(r => r.__table === 'email_suppressions')

beforeEach(() => {
  vi.clearAllMocks()
  state.selectRows = []
  state.inserts = []
  state.activities = []
  state.sent = []
  state.policy = {
    mode: 'allowlist',
    allowedDomains: ['tahi.studio'],
    allowedOrgIds: [],
    allowedAddresses: [],
    blockedAddresses: [],
  }
  vi.stubEnv('RESEND_API_KEY', 'test_key')
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'org_tahi')
})

// ---------------------------------------------------------------------------
// POST /api/admin/deals/[id]/nudges
// ---------------------------------------------------------------------------

describe('a nudge that reaches some of its list', () => {
  const params = { params: Promise.resolve({ id: 'deal-1' }) }

  function nudge(emails: string[]) {
    return jsonReq('/api/admin/deals/deal-1/nudges', {
      contactEmails: emails,
      subject: 'Following up',
      bodyHtml: '<p>Any thoughts?</p>',
      sendNow: true,
    })
  }

  it('names only the delivered address in the deal timeline', async () => {
    const res = await createNudge(nudge(['jo@prospect.test', 'business@tahi.studio']), params)

    expect(res.status).toBe(201)
    expect(state.activities).toHaveLength(1)
    expect(state.activities[0].title).toBe('Nudge sent to business@tahi.studio')
    expect(state.activities[0]).toMatchObject({
      metadata: {
        recipients: ['business@tahi.studio'],
        suppressed: ['jo@prospect.test'],
      },
    })
  })

  it('returns what was withheld on the SUCCESS path, not only on failure', async () => {
    const res = await createNudge(nudge(['jo@prospect.test', 'business@tahi.studio']), params)

    const body = await res.json() as { suppressed: string[]; suppressedCount: number }
    expect(body.suppressed).toEqual(['jo@prospect.test'])
    expect(body.suppressedCount).toBe(1)
  })

  it('still 409s and reports the list when nothing survives', async () => {
    const res = await createNudge(nudge(['jo@prospect.test']), params)

    expect(res.status).toBe(409)
    const body = await res.json() as { status: string; suppressed: string[] }
    expect(body.status).toBe('failed')
    expect(body.suppressed).toEqual(['jo@prospect.test'])
  })

  it('logs the withheld address even with no Resend key, rather than reporting a send', async () => {
    vi.stubEnv('RESEND_API_KEY', '')

    const res = await createNudge(nudge(['jo@prospect.test']), params)

    expect(res.status).toBe(409)
    expect(suppressions()).toHaveLength(1)
    expect(suppressions()[0]).toMatchObject({ to: 'jo@prospect.test', template: 'deal-nudge' })
  })
})

// ---------------------------------------------------------------------------
// POST /api/admin/contracts/[id]/email
// ---------------------------------------------------------------------------

describe('a contract share with a constant cc', () => {
  const params = { params: Promise.resolve({ id: 'con-1' }) }

  const DOC = {
    id: 'con-1',
    orgId: 'org-a',
    type: 'msa',
    name: 'Master services agreement',
    status: 'sent',
    token: 'tok_1',
  }
  const SIGNERS = [
    { id: 's-1', role: 'client', name: 'One', email: 'one@tahi.studio', status: 'pending' },
    { id: 's-2', role: 'client', name: 'Two', email: 'two@tahi.studio', status: 'pending' },
    { id: 's-3', role: 'client', name: 'Three', email: 'three@tahi.studio', status: 'pending' },
  ]

  it('logs and reports one withheld cc once, not once per signer', async () => {
    state.selectRows = [[DOC], SIGNERS]

    const res = await emailContract(jsonReq('/api/admin/contracts/con-1/email', {
      cc: [{ email: 'outside@acme.test' }],
    }), params)

    expect(res.status).toBe(200)
    const body = await res.json() as { sent: unknown[]; suppressed: string[] }
    expect(body.sent).toHaveLength(3)
    expect(body.suppressed).toEqual(['outside@acme.test'])
    expect(suppressions()).toHaveLength(1)
  })

  it('never hands the withheld cc to Resend on any of the three sends', async () => {
    state.selectRows = [[DOC], SIGNERS]

    await emailContract(jsonReq('/api/admin/contracts/con-1/email', {
      cc: [{ email: 'outside@acme.test' }],
    }), params)

    expect(state.sent).toHaveLength(3)
    for (const payload of state.sent) {
      expect(payload.cc).toBeUndefined()
    }
  })
})

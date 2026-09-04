/**
 * lib/contact-link-server.ts - claiming a client's waiting contact row.
 *
 * The gap this closes: nothing linked a second client seat's Clerk login to a
 * `contacts` row, so a colleague invited into the workspace signed in with a
 * valid session and resolved to no identity at all. No portal role, no
 * notifications, messages stamped with a raw Clerk id.
 *
 * The rules worth pinning are the safety ones. It claims, never creates. It
 * only looks at the caller's OWN org, so a person who is a contact at two
 * clients cannot be linked to the wrong workspace. It refuses an unverified
 * email and refuses to guess between two rows. The claim is a compare-and-set,
 * so a lost race is benign rather than an overwrite. And nothing it can hit
 * throws into the layout that calls it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: {
  selectRows: unknown[][]
  updates: { set: Record<string, unknown>; returns: unknown[] }[]
  updateReturns: unknown[][]
  audits: Record<string, unknown>[]
} = { selectRows: [], updates: [], updateReturns: [], audits: [] }

const clerkState = {
  email: 'jane@acme.com' as string | null,
  verified: true,
  throws: false,
}

vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: vi.fn().mockImplementation(() => Promise.resolve({
    users: {
      getUser: vi.fn().mockImplementation(() => {
        if (clerkState.throws) return Promise.reject(new Error('clerk down'))
        return Promise.resolve({
          primaryEmailAddressId: 'eml_1',
          emailAddresses: [{
            id: 'eml_1',
            emailAddress: clerkState.email,
            verification: { status: clerkState.verified ? 'verified' : 'unverified' },
          }],
        })
      }),
    },
  })),
}))

vi.mock('drizzle-orm', () => {
  const stub = (...args: unknown[]) => ({ args })
  return {
    eq: stub,
    and: stub,
    isNull: stub,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings), values,
    }),
  }
})

vi.mock('@/db/d1', () => ({
  schema: {
    contacts: { __table: 'contacts', id: 'id', orgId: 'org_id', email: 'email', clerkUserId: 'clerk_user_id' },
    organisations: { __table: 'organisations', id: 'id', clerkOrgId: 'clerk_org_id' },
  },
}))

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockImplementation((_db: unknown, entry: Record<string, unknown>) => {
    captured.audits.push(entry)
    return Promise.resolve(undefined)
  }),
}))

vi.mock('@/lib/db', () => {
  const answer = () => Promise.resolve(captured.selectRows.length ? captured.selectRows.shift()! : [])
  const chain: Record<string, unknown> = {}
  chain.from = vi.fn(() => chain)
  // Terminal at `where` (the email lookup) or at `limit` (single-row lookups).
  chain.where = vi.fn(() => {
    const p = answer() as Promise<unknown[]> & { limit?: unknown }
    return Object.assign(p, { limit: vi.fn(() => p) })
  })
  return {
    db: vi.fn().mockResolvedValue({
      select: vi.fn(() => chain),
      update: vi.fn(() => ({
        set: vi.fn((set: Record<string, unknown>) => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => {
              const rows = captured.updateReturns.length ? captured.updateReturns.shift()! : [{ id: 'c_1' }]
              captured.updates.push({ set, returns: rows })
              return Promise.resolve(rows)
            }),
          })),
        })),
      })),
    }),
  }
})

import { linkContactOnSignIn } from '@/lib/contact-link-server'

/** Rows the module reads, in order: linked-contact probe, org, email matches. */
function queue(linked: unknown[], org: unknown[], candidates: unknown[]) {
  captured.selectRows = [linked, org, candidates]
}

const ORG = [{ id: 'org_acme' }]

describe('linkContactOnSignIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.selectRows = []
    captured.updates = []
    captured.updateReturns = []
    captured.audits = []
    clerkState.email = 'jane@acme.com'
    clerkState.verified = true
    clerkState.throws = false
    process.env.NEXT_PUBLIC_TAHI_ORG_ID = 'org_tahi'
  })

  it('claims the waiting row at the caller own org', async () => {
    queue([], ORG, [{ id: 'c_1', email: 'Jane@Acme.com', clerkUserId: null }])

    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('linked')
    expect(captured.updates).toHaveLength(1)
    expect(captured.updates[0].set.clerkUserId).toBe('user_jane')
    expect(captured.audits[0]?.action).toBe('contact.login_linked')
  })

  it('does nothing for a Tahi session', async () => {
    const outcome = await linkContactOnSignIn('user_admin', 'org_tahi')
    expect(outcome).toBe('not_client_org')
    expect(captured.updates).toHaveLength(0)
  })

  it('does nothing without an org', async () => {
    const outcome = await linkContactOnSignIn('user_jane', null)
    expect(outcome).toBe('not_client_org')
  })

  it('never runs for the MCP service identity', async () => {
    const outcome = await linkContactOnSignIn('api-service', 'clerk_org_1')
    expect(outcome).toBe('no_user')
    expect(captured.updates).toHaveLength(0)
  })

  it('short-circuits when a contact already points at this user', async () => {
    captured.selectRows = [[{ id: 'c_1' }]]
    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('already_linked')
    // Never paid for the Clerk round trip or the email query.
    expect(captured.updates).toHaveLength(0)
  })

  it('stops when the Clerk org has no D1 organisation', async () => {
    queue([], [], [])
    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_unknown')
    expect(outcome).toBe('no_org_row')
    expect(captured.updates).toHaveLength(0)
  })

  it('refuses an unverified email', async () => {
    clerkState.verified = false
    queue([], ORG, [{ id: 'c_1', email: 'jane@acme.com', clerkUserId: null }])

    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('email_unverified')
    expect(captured.updates).toHaveLength(0)
  })

  it('creates nothing when no contact carries the email', async () => {
    queue([], ORG, [])
    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('no_match')
    expect(captured.updates).toHaveLength(0)
  })

  it('links neither row when two contacts at the org share an email', async () => {
    queue([], ORG, [
      { id: 'c_1', email: 'jane@acme.com', clerkUserId: null },
      { id: 'c_2', email: 'jane@acme.com', clerkUserId: null },
    ])

    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('ambiguous')
    expect(captured.updates).toHaveLength(0)
  })

  it('reports a lost race instead of overwriting a link', async () => {
    queue([], ORG, [{ id: 'c_1', email: 'jane@acme.com', clerkUserId: null }])
    captured.updateReturns = [[]]

    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('lost_race')
    expect(captured.audits).toHaveLength(0)
  })

  it('corrects a stale clerk id for the verified owner of the email', async () => {
    queue([], ORG, [{ id: 'c_1', email: 'jane@acme.com', clerkUserId: 'user_stale' }])

    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('relinked')
    expect(captured.updates[0].set.clerkUserId).toBe('user_jane')
    expect(captured.audits[0]?.action).toBe('contact.login_relinked')
  })

  it('degrades to not linked rather than throwing into the layout', async () => {
    clerkState.throws = true
    queue([], ORG, [])

    const outcome = await linkContactOnSignIn('user_jane', 'clerk_org_1')
    expect(outcome).toBe('no_match')
  })
})

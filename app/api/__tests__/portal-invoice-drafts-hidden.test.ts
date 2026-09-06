/**
 * A DRAFT invoice never reaches a client.
 *
 * Liam raises drafts in Xero as placeholders for work that will be billed
 * later, and as tests. Xero has not sent them and nobody has been asked to
 * pay, so the portal must behave as though they do not exist: absent from the
 * list, and a 404 on a direct id, which is the same answer a guessed id from
 * another org gets (both filters live in the WHERE clause, not in a
 * post-check, so a draft and a stranger's invoice are indistinguishable).
 *
 * These are behavioural, not shape tests. The fake D1 below actually evaluates
 * the conditions the route builds, so deleting the draft filter fails them
 * rather than passing on a mock that returns whatever it is told to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { isOrgAdmin } from '@/lib/portal-access'

// ── A condition tree the fake db can actually evaluate ───────────────────────
//
// The real drizzle operators build SQL. Here they build a tiny tree of the
// same decisions, so `.where(...)` can filter the fixture rows in JS.

type Cond =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'ne'; col: string; val: unknown }
  | { op: 'and'; parts: Cond[] }

interface Row { [key: string]: unknown }

function matches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true
  switch (cond.op) {
    case 'eq': return row[cond.col] === cond.val
    case 'ne': return row[cond.col] !== cond.val
    case 'and': return cond.parts.every(p => matches(row, p))
  }
}

vi.mock('@/lib/server-auth', () => ({ getPortalAuth: vi.fn() }))
vi.mock('@/lib/require-feature', () => ({ requirePortalFeature: vi.fn() }))
vi.mock('@/lib/portal-access', () => ({ isOrgAdmin: vi.fn() }))

// Columns are their own names, so a condition can be applied to a plain row.
vi.mock('@/db/d1', () => ({
  schema: {
    invoices: {
      id: 'id', orgId: 'orgId', status: 'status', number: 'number',
      totalUsd: 'totalUsd', amountUsd: 'amountUsd', taxAmountUsd: 'taxAmountUsd',
      discountAmountUsd: 'discountAmountUsd', currency: 'currency', notes: 'notes',
      dueDate: 'dueDate', sentAt: 'sentAt', viewedAt: 'viewedAt', paidAt: 'paidAt',
      projectId: 'projectId', subscriptionId: 'subscriptionId',
      stripeHostedInvoiceUrl: 'payUrl', xeroOnlineInvoiceUrl: 'xeroPayUrl',
      createdAt: 'createdAt', updatedAt: 'updatedAt',
    },
    invoiceItems: { id: 'id', invoiceId: 'invoiceId', description: 'description', quantity: 'quantity', unitPriceUsd: 'unitPriceUsd', totalUsd: 'totalUsd' },
    organisations: { id: 'id', name: 'name', invoiceChannel: 'invoiceChannel' },
    settings: { key: 'key', value: 'value' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  ne: (col: string, val: unknown) => ({ op: 'ne', col, val }),
  and: (...parts: Cond[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  desc: () => ({}),
}))

/** Every invoice the client's org holds, drafts included. */
const INVOICES: Row[] = [
  { id: 'inv-sent', orgId: 'org-client', status: 'sent', totalUsd: 1000, currency: 'NZD', dueDate: '2026-10-01', number: 'INV-1', payUrl: 'https://pay.example/1', xeroPayUrl: null, paidAt: null, viewedAt: null, createdAt: '2026-09-01', updatedAt: '2026-09-01' },
  { id: 'inv-draft', orgId: 'org-client', status: 'draft', totalUsd: 4200, currency: 'NZD', dueDate: '2026-11-01', number: 'INV-2', payUrl: null, xeroPayUrl: null, paidAt: null, viewedAt: null, createdAt: '2026-09-02', updatedAt: '2026-09-02' },
  { id: 'inv-paid', orgId: 'org-client', status: 'paid', totalUsd: 800, currency: 'NZD', dueDate: '2026-08-01', number: 'INV-0', payUrl: null, xeroPayUrl: null, paidAt: '2026-08-05', viewedAt: null, createdAt: '2026-08-01', updatedAt: '2026-08-05' },
]

/** Which table a chain is reading, so the fake can answer with the right rows. */
let currentTable: 'invoices' | 'items' | 'settings' | 'unknown' = 'unknown'

vi.mock('@/lib/db', () => {
  const makeChain = () => {
    let cond: Cond | undefined
    let limit = Infinity
    const chain: Record<string, unknown> = {}
    for (const key of ['leftJoin', 'innerJoin', 'orderBy', 'offset']) chain[key] = () => chain
    chain.from = (table: unknown) => {
      // The mocked schema objects are compared by identity via their `id` key.
      currentTable = (table as Record<string, string>)?.invoiceId !== undefined
        ? 'items'
        : (table as Record<string, string>)?.key !== undefined
          ? 'settings'
          : 'invoices'
      return chain
    }
    chain.where = (c: Cond) => { cond = c; return chain }
    chain.limit = (n: number) => { limit = n; return chain }
    chain.then = (resolve: (rows: Row[]) => void) => {
      const source = currentTable === 'invoices' ? INVOICES : []
      resolve(source.filter(r => matches(r, cond)).slice(0, limit))
    }
    return chain
  }
  const updateChain: Record<string, unknown> = {}
  updateChain.set = () => updateChain
  updateChain.where = () => Promise.resolve(undefined)
  return {
    db: async () => ({
      select: () => makeChain(),
      update: () => updateChain,
    }),
  }
})

const { GET: listInvoices } = await import('../portal/invoices/route')
const { GET: getInvoice } = await import('../portal/invoices/[id]/route')

interface ListBody { items?: Array<{ id: string; status: string }> }

beforeEach(() => {
  vi.mocked(requirePortalFeature).mockResolvedValue(null)
  vi.mocked(isOrgAdmin).mockResolvedValue(true)
  vi.mocked(getPortalAuth).mockResolvedValue({
    userId: 'user_client', orgId: 'org-client', clerkOrgId: 'clerk-client', impersonating: false,
  } as never)
})

describe('GET /api/portal/invoices never returns a draft', () => {
  it('omits the draft from the default list', async () => {
    const res = await listInvoices(new Request('http://localhost/api/portal/invoices?status=all') as never)
    expect(res.status).toBe(200)
    const body = await res.json() as ListBody
    const ids = (body.items ?? []).map(i => i.id)
    expect(ids).toContain('inv-sent')
    expect(ids).toContain('inv-paid')
    expect(ids).not.toContain('inv-draft')
    expect((body.items ?? []).every(i => i.status !== 'draft')).toBe(true)
  })

  it('returns nothing at all when a client explicitly asks for drafts', async () => {
    // ?status=draft must not be a back door: the draft filter is ANDed on top
    // of the status filter, so the two cancel out to an empty page.
    const res = await listInvoices(new Request('http://localhost/api/portal/invoices?status=draft') as never)
    expect(res.status).toBe(200)
    const body = await res.json() as ListBody
    expect(body.items).toEqual([])
  })

  it('still returns the issued invoices, so the exclusion is not just an empty read', async () => {
    const res = await listInvoices(new Request('http://localhost/api/portal/invoices?status=sent') as never)
    const body = await res.json() as ListBody
    expect((body.items ?? []).map(i => i.id)).toEqual(['inv-sent'])
  })
})

describe('GET /api/portal/invoices/[id] 404s a draft', () => {
  const req = (id: string) => new Request(`http://localhost/api/portal/invoices/${id}`) as never
  const params = (id: string) => ({ params: Promise.resolve({ id }) })

  it('answers 404 for a draft the client somehow has the id of', async () => {
    const res = await getInvoice(req('inv-draft'), params('inv-draft'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('answers 404 the same way for an id at another org, so a draft is not distinguishable', async () => {
    const res = await getInvoice(req('inv-elsewhere'), params('inv-elsewhere'))
    expect(res.status).toBe(404)
  })

  it('still serves an issued invoice', async () => {
    const res = await getInvoice(req('inv-sent'), params('inv-sent'))
    expect(res.status).toBe(200)
    const body = await res.json() as { invoice?: { id: string; status: string } }
    expect(body.invoice?.id).toBe('inv-sent')
    expect(body.invoice?.status).toBe('sent')
  })
})

/**
 * AR aging bucket semantics (2026-09-19 fix).
 *
 * The overview, reports/invoice-aging and financial-reports/summary aging
 * buckets all used to fold a no-due-date invoice into "current" (it read
 * `daysPastDue <= 30`, and a missing due date computed to 0 days). An
 * invoice with no due date can never be due, so it can never be "current"
 * either - it needs its own bucket, and "current" now means "has a due
 * date and is not yet due" (daysPastDue <= 0), not "0..30 days late".
 *
 * This exercises /api/admin/reports/invoice-aging end to end (real D1
 * fixture mock, same harness as invoice-drafts-not-owed.test.ts) since that
 * route is the one every other aging surface is documented to mirror.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getRequestAuth } from '@/lib/server-auth'

type Cond =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'in'; col: string; vals: unknown[] }
  | { op: 'and'; parts: Cond[] }

interface Row { [key: string]: unknown }

function matches(row: Row, cond: Cond | undefined): boolean {
  if (!cond) return true
  switch (cond.op) {
    case 'eq': return row[cond.col] === cond.val
    case 'in': return cond.vals.includes(row[cond.col])
    case 'and': return cond.parts.every(p => matches(row, p))
  }
}

const NOW = new Date('2026-09-19T00:00:00.000Z')
vi.useFakeTimers()
vi.setSystemTime(NOW)

const INVOICES: Row[] = [
  // Has a due date in the future - not yet due, belongs in "current".
  { id: 'i-not-due', status: 'sent', totalUsd: 100, currency: 'NZD', dueDate: '2099-01-01', orgId: 'o1' },
  // 18 days late - belongs in the 1-30 bucket (mirrors the Elevate INV-0064 live fact).
  { id: 'i-18-late', status: 'overdue', totalUsd: 200, currency: 'NZD', dueDate: '2026-09-01', orgId: 'o1' },
  // No due date at all - Greyhive INV-2025000024. Must never land in "current".
  { id: 'i-no-due', status: 'sent', totalUsd: 300, currency: 'NZD', dueDate: null, orgId: 'o1' },
]

const RATES: Row[] = [{ currency: 'NZD', rateToUsd: 1 }]

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org-tahi',
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: async () => null }))
vi.mock('@/lib/permissions', () => ({
  resolvePermissions: async () => ({}),
  can: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: {
    invoices: {
      id: 'id', orgId: 'orgId', status: 'status', totalUsd: 'totalUsd',
      currency: 'currency', dueDate: 'dueDate', paidAt: 'paidAt',
    },
    organisations: { id: 'id', name: 'name' },
    exchangeRates: { currency: 'currency', rateToUsd: 'rateToUsd' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  and: (...parts: Cond[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  inArray: (col: string, vals: unknown[]) => ({ op: 'in', col, vals }),
}))

vi.mock('@/lib/db', () => {
  const makeChain = () => {
    let table: 'invoices' | 'rates' | 'other' = 'other'
    let cond: Cond | undefined
    const chain: Record<string, unknown> = {}
    for (const key of ['leftJoin', 'innerJoin', 'orderBy', 'limit', 'offset', 'groupBy']) {
      chain[key] = () => chain
    }
    chain.from = (t: Record<string, string> | undefined) => {
      table = t?.status !== undefined ? 'invoices' : t?.rateToUsd !== undefined ? 'rates' : 'other'
      return chain
    }
    chain.where = (c: Cond) => { cond = c; return chain }
    chain.then = (resolve: (rows: Row[]) => void) => {
      const source = table === 'invoices' ? INVOICES : table === 'rates' ? RATES : []
      resolve(source.filter(r => matches(r, cond)))
    }
    return chain
  }
  return {
    db: async () => ({ select: () => makeChain() }),
  }
})

const { GET: invoiceAging } = await import('../admin/reports/invoice-aging/route')

beforeEach(() => {
  vi.mocked(getRequestAuth).mockResolvedValue({ orgId: 'org-tahi', userId: 'user_liam' } as never)
})

describe('GET /api/admin/reports/invoice-aging - no-due-date semantics', () => {
  interface Body {
    aging: Record<string, { count: number; totalNzd: number; invoices: Array<{ id: string }> }>
    summary: { totalOutstanding: number; invoiceCount: number; oldestDaysPastDue: number }
  }

  async function read(): Promise<Body> {
    const res = await invoiceAging(new Request('http://localhost/api/admin/reports/invoice-aging') as never)
    expect(res.status).toBe(200)
    return await res.json() as Body
  }

  it('puts the not-yet-due invoice in current', async () => {
    const body = await read()
    expect(body.aging.current.invoices.map(i => i.id)).toEqual(['i-not-due'])
  })

  it('puts the 18-days-late invoice in the 1-30 bucket, not current', async () => {
    const body = await read()
    expect(body.aging.thirtyDays.invoices.map(i => i.id)).toEqual(['i-18-late'])
  })

  it('never counts the no-due-date invoice as current', async () => {
    const body = await read()
    expect(body.aging.current.invoices.map(i => i.id)).not.toContain('i-no-due')
  })

  it('buckets the no-due-date invoice on its own', async () => {
    const body = await read()
    expect(body.aging.noDueDate.count).toBe(1)
    expect(body.aging.noDueDate.totalNzd).toBe(300)
    expect(body.aging.noDueDate.invoices.map(i => i.id)).toEqual(['i-no-due'])
  })

  it('never lets the no-due-date invoice become the oldest-overdue callout', async () => {
    const body = await read()
    // Only i-18-late is actually overdue (18 days); the no-due-date row must
    // never inflate this past that.
    expect(body.summary.oldestDaysPastDue).toBe(18)
  })
})

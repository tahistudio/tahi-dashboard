/**
 * A draft invoice moves no money figure.
 *
 * The founder's report: "I have drafted invoices in Xero, it is correctly
 * being picked up and showing on the dashboard, the only problem is it is
 * marking those drafts as money owed in the reporting on the dashboard or the
 * home page."
 *
 * These run the two money endpoints an assistant and the reports page actually
 * read (/api/admin/billing/financial-health, which backs the MCP tool
 * get_financial_health, and /api/admin/reports/invoice-aging, which backs
 * get_invoice_aging) over a fixture that contains one draft, and assert the
 * same thing twice: the draft is in NO owed, outstanding, invoiced or aging
 * total, and it IS in the drafts figure. Plus lib/financial-metrics, which is
 * the shared math behind the owner home's Owed card and the nightly snapshot.
 *
 * The last block is a source invariant: no money query may hand-roll an
 * invoice status list again. Six of them did, they disagreed with each other,
 * and that disagreement is what let a draft become money in the first place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getRequestAuth } from '@/lib/server-auth'

// ── Condition tree the fake db evaluates ─────────────────────────────────────

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

/**
 * The fixture ledger. One draft, deliberately the largest row, so any total it
 * leaks into is obvious rather than a rounding difference.
 *
 * Amounts are NZD except the USD draft, which also proves the drafts figure is
 * currency-converted like every other number on these endpoints: US$600 lands
 * as NZ$1,200 under the rates below.
 */
const INVOICES: Row[] = [
  { id: 'i-sent', status: 'sent', totalUsd: 1000, currency: 'NZD', dueDate: '2099-01-01', orgId: 'o1' },
  { id: 'i-viewed', status: 'viewed', totalUsd: 500, currency: 'NZD', dueDate: '2099-01-01', orgId: 'o1' },
  { id: 'i-overdue', status: 'overdue', totalUsd: 250, currency: 'NZD', dueDate: '2000-01-01', orgId: 'o1' },
  { id: 'i-paid', status: 'paid', totalUsd: 9000, currency: 'NZD', dueDate: '2000-01-01', orgId: 'o1' },
  { id: 'i-void', status: 'written_off', totalUsd: 700, currency: 'NZD', dueDate: '2000-01-01', orgId: 'o1' },
  { id: 'i-draft-nzd', status: 'draft', totalUsd: 4200, currency: 'NZD', dueDate: '2000-01-01', orgId: 'o1' },
  { id: 'i-draft-usd', status: 'draft', totalUsd: 600, currency: 'USD', dueDate: null, orgId: 'o1' },
]

/** buildRateMap divides each rate by NZD's, giving USD 0.5, so US$600 is NZ$1,200. */
const RATES: Row[] = [
  { currency: 'NZD', rateToUsd: 2 },
  { currency: 'USD', rateToUsd: 1 },
]

const OWED_NZD = 1000 + 500 + 250
const DRAFTS_NZD = 4200 + 1200

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org-tahi',
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: async () => null }))
vi.mock('@/lib/permissions', () => ({
  resolvePermissions: async () => ({}),
  can: () => true,
}))
vi.mock('@/lib/xero', () => ({ callXeroAPI: async () => null }))

vi.mock('@/db/d1', () => ({
  schema: {
    invoices: {
      id: 'id', orgId: 'orgId', status: 'status', totalUsd: 'totalUsd',
      currency: 'currency', dueDate: 'dueDate', paidAt: 'paidAt',
    },
    organisations: { id: 'id', name: 'name' },
    exchangeRates: { currency: 'currency', rateToUsd: 'rateToUsd' },
    deals: {}, pipelineStages: {},
    airwallexBalances: {}, xeroBankBalances: {}, xeroPnlSnapshots: {},
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: string, val: unknown) => ({ op: 'eq', col, val }),
  ne: (col: string, val: unknown) => ({ op: 'ne', col, val }),
  and: (...parts: Cond[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  inArray: (col: string, vals: unknown[]) => ({ op: 'in', col, vals }),
  gte: () => ({ op: 'and', parts: [] }),
  desc: () => ({}),
  sql: () => ({}),
  count: () => 'count',
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
    db: async () => ({
      select: () => makeChain(),
      all: async () => [],
    }),
  }
})

const { GET: financialHealth } = await import('../admin/billing/financial-health/route')
const { GET: invoiceAging } = await import('../admin/reports/invoice-aging/route')

beforeEach(() => {
  vi.mocked(getRequestAuth).mockResolvedValue({ orgId: 'org-tahi', userId: 'user_liam' } as never)
})

describe('GET /api/admin/billing/financial-health', () => {
  interface Body {
    invoices: {
      totalInvoiced: number
      totalPaid: number
      totalOutstanding: number
      count: number
      totalDrafts: number
      draftCount: number
    }
  }

  async function read(): Promise<Body['invoices']> {
    const res = await financialHealth(new Request('http://localhost/api/admin/billing/financial-health') as never)
    expect(res.status).toBe(200)
    return ((await res.json()) as Body).invoices
  }

  it('keeps both drafts out of outstanding', async () => {
    const inv = await read()
    expect(inv.totalOutstanding).toBe(OWED_NZD)
  })

  it('keeps both drafts (and the written-off row) out of total invoiced', async () => {
    const inv = await read()
    // Issued and still live: outstanding plus paid. Not the whole table, which
    // is what this figure used to be.
    expect(inv.totalInvoiced).toBe(OWED_NZD + 9000)
  })

  it('reports the drafts on their own, converted to NZD', async () => {
    const inv = await read()
    expect(inv.draftCount).toBe(2)
    expect(inv.totalDrafts).toBe(DRAFTS_NZD)
  })

  it('still counts every row in the raw count, so nothing is hidden', async () => {
    const inv = await read()
    expect(inv.count).toBe(INVOICES.length)
  })
})

describe('GET /api/admin/reports/invoice-aging', () => {
  interface Body {
    aging: Record<string, { count: number; totalNzd: number; invoices: Array<{ id: string }> }>
    drafts: { count: number; totalNzd: number }
    summary: { totalOutstanding: number; invoiceCount: number }
  }

  async function read(): Promise<Body> {
    const res = await invoiceAging(new Request('http://localhost/api/admin/reports/invoice-aging') as never)
    expect(res.status).toBe(200)
    return await res.json() as Body
  }

  it('ages only the issued and unpaid invoices', async () => {
    const body = await read()
    expect(body.summary.invoiceCount).toBe(3)
    expect(Math.round(body.summary.totalOutstanding)).toBe(OWED_NZD)
  })

  it('puts no draft in any bucket', async () => {
    const body = await read()
    const bucketed = Object.values(body.aging).flatMap(b => b.invoices.map(i => i.id))
    expect(bucketed).not.toContain('i-draft-nzd')
    expect(bucketed).not.toContain('i-draft-usd')
    expect(bucketed.sort()).toEqual(['i-overdue', 'i-sent', 'i-viewed'])
  })

  it('reports the drafts beside the buckets', async () => {
    const body = await read()
    expect(body.drafts).toEqual({ count: 2, totalNzd: DRAFTS_NZD })
  })
})

describe('lib/financial-metrics owed', () => {
  it('sums only the issued and unpaid invoices', async () => {
    const { computeCurrentMetrics } = await import('@/lib/financial-metrics')
    const { db } = await import('@/lib/db')
    const drizzle = await db() as never
    const metrics = await computeCurrentMetrics(drizzle, new Date('2026-09-06T00:00:00.000Z'))
    // The 5,200 of drafts is not in it, and neither is the written-off 700.
    expect(metrics.owedNzd).toBe(OWED_NZD)
  })
})

describe('no money query hand-rolls an invoice status list', () => {
  // Six aggregations each carried their own list and disagreed. The shared
  // vocabulary in lib/invoice-status.ts is only worth having if nothing walks
  // back around it, so this is checked rather than trusted.
  const ROOTS = ['app/api', 'lib']
  const SKIP_DIRS = new Set(['node_modules', '__tests__', '.next'])
  const BANNED = [
    /\[\s*'sent'\s*,\s*'overdue'\s*\]/,
    /\[\s*'sent'\s*,\s*'viewed'\s*,\s*'overdue'\s*\]/,
    /status\s+IN\s*\(\s*'sent'/i,
  ]

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  it('finds no inline owed-status array left behind', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8')
        if (BANNED.some(re => re.test(source))) offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})

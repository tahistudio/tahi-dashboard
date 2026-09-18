/**
 * Snapshot coverage (2026-09-19 fix).
 *
 * Live fact: MRR NZ$10,317 with mrrDeltaPct -40 because the latest prior-month
 * snapshot on file was July - August never got a row, even though the
 * snapshot-metrics cron runs daily. writeCurrentSnapshot must upsert THIS
 * month's row on every single call it is given, keyed only by monthKey, so
 * that as long as the cron fires at all in a given month that month's row
 * exists. This exercises the upsert directly against a fake D1 (an in-memory
 * map keyed by monthKey, mirroring the table's real primary key) rather than
 * a live database, since financial_snapshots.monthKey is the primary key
 * onConflictDoUpdate targets.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Fake D1: every read degrades to empty (mirrors the resilience contract
// computeCurrentMetrics already has - a missing table returns [], never
// throws), and every write lands in an in-memory map keyed by the table's
// real primary key, so onConflictDoUpdate genuinely upserts. ─────────────────
class FakeD1 {
  snapshots = new Map<string, Record<string, unknown>>()

  select() {
    const chain: Record<string, unknown> = {}
    for (const key of ['from', 'where', 'orderBy', 'limit']) chain[key] = () => chain
    ;(chain as { then: (resolve: (rows: unknown[]) => void) => void }).then = (resolve) => resolve([])
    return chain
  }

  async all() {
    return []
  }

  insert(_table: unknown) {
    return {
      values: (vals: { monthKey: string } & Record<string, unknown>) => ({
        onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => {
          const existing = this.snapshots.get(vals.monthKey)
          this.snapshots.set(vals.monthKey, existing ? { ...existing, ...set } : vals)
          return Promise.resolve(undefined)
        },
      }),
    }
  }
}

vi.mock('@/db/d1', () => ({
  schema: {
    exchangeRates: {},
    airwallexBalances: {},
    xeroBankBalances: {},
    invoices: { status: 'status', totalUsd: 'totalUsd', currency: 'currency' },
    organisations: { status: 'status' },
    xeroPnlSnapshots: { monthKey: 'monthKey' },
    financialSnapshots: { monthKey: 'monthKey' },
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  gte: () => ({}),
  inArray: () => ({}),
  sql: (strings: TemplateStringsArray) => strings,
  desc: () => ({}),
  count: () => 'count',
}))

const { writeCurrentSnapshot } = await import('@/lib/financial-snapshots')

describe('writeCurrentSnapshot', () => {
  let d1: FakeD1

  beforeEach(() => {
    d1 = new FakeD1()
  })

  it('creates this month\'s row on the first call', async () => {
    const now = new Date('2026-08-05T18:00:00.000Z')
    const result = await writeCurrentSnapshot(d1 as never, now)
    expect(result.monthKey).toBe('2026-08')
    expect(d1.snapshots.has('2026-08')).toBe(true)
  })

  it('upserts the SAME row on a second call the same month, never duplicating it', async () => {
    const day1 = new Date('2026-08-05T18:00:00.000Z')
    const day2 = new Date('2026-08-06T18:00:00.000Z')
    await writeCurrentSnapshot(d1 as never, day1)
    await writeCurrentSnapshot(d1 as never, day2)
    // One row for the whole month, not two - the primary key is monthKey.
    expect(d1.snapshots.size).toBe(1)
    expect(d1.snapshots.has('2026-08')).toBe(true)
  })

  it('every daily call in a month lands a row for that month - a cron that runs every day of August cannot skip August', async () => {
    for (let day = 1; day <= 31; day++) {
      const now = new Date(Date.UTC(2026, 7, day, 18, 0, 0))
      await writeCurrentSnapshot(d1 as never, now)
    }
    expect(d1.snapshots.size).toBe(1)
    expect(d1.snapshots.get('2026-08')).toBeTruthy()
  })

  it('writes a distinct row when the month rolls over, without touching the prior month', async () => {
    await writeCurrentSnapshot(d1 as never, new Date('2026-08-31T18:00:00.000Z'))
    await writeCurrentSnapshot(d1 as never, new Date('2026-09-01T18:00:00.000Z'))
    expect(d1.snapshots.size).toBe(2)
    expect(d1.snapshots.has('2026-08')).toBe(true)
    expect(d1.snapshots.has('2026-09')).toBe(true)
  })

  it('preserves the original createdAt across repeat writes in the same month', async () => {
    const day1 = new Date('2026-08-05T18:00:00.000Z')
    const day2 = new Date('2026-08-06T18:00:00.000Z')
    await writeCurrentSnapshot(d1 as never, day1)
    await writeCurrentSnapshot(d1 as never, day2)
    expect(d1.snapshots.get('2026-08')?.createdAt).toBe(day1.toISOString())
  })
})

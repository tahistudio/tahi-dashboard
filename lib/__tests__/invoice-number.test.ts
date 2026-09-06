/**
 * lib/__tests__/invoice-number.test.ts
 *
 * The sequence, and the reason a number cannot be handed out twice.
 *
 * Five properties are pinned here, and every one of them is money:
 *
 *   1. The FORMAT. `<prefix>-<YYYY>-<NNNN>`, with the prefix cleaned up. The
 *      settings row ships as literally `INV-`, so a naive template produces
 *      INV--2026-0001 and the number on the client's transfer stops matching
 *      the number in Xero.
 *   2. The COUNTER IS GLOBAL and it climbs. Two mints in a row are two
 *      different numbers, and the year in the middle is a label rather than a
 *      scope.
 *   3. The BUMP IS ONE STATEMENT. The test reads the SQL the mint actually
 *      issues and refuses a SELECT of the counter: a read-then-write is the
 *      race this whole module exists to avoid, and it would still pass a
 *      "numbers increment" test in a single-threaded harness.
 *   4. A UNIQUE CONFLICT RETRIES ONCE and lands on the next number, rather than
 *      failing the invoice or writing a duplicate.
 *   5. A BROKEN COUNTER DOES NOT BLOCK THE BILL. If the settings row cannot be
 *      reached, the invoice is still written, unnumbered.
 *
 * The fake handle is deliberately tiny: this module touches exactly two D1
 * methods (`all` and `run`) and one settings row, and the narrow
 * InvoiceNumberDb interface is what makes that provable.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SQL } from 'drizzle-orm'
import {
  DEFAULT_INVOICE_NUMBER_PREFIX,
  INVOICE_NUMBER_ATTEMPTS,
  INVOICE_NUMBER_PREFIX_KEY,
  INVOICE_NUMBER_SEQUENCE_KEY,
  formatInvoiceNumber,
  importedInvoiceNumber,
  isInvoiceNumberConflict,
  mintInvoiceNumber,
  normaliseInvoicePrefix,
  studioCalendarYear,
  withInvoiceNumber,
  type InvoiceNumberDb,
} from '@/lib/invoice-number'

// ── A fake D1 that only knows the two statements this module issues ──────────

/**
 * Every statement issued, flattened to readable SQL.
 *
 * Drizzle renders a template into `queryChunks`, so the strings are recovered
 * by walking the chunk list. Enough to assert "this is an UPDATE ... RETURNING
 * and not a SELECT", which is the property that matters.
 */
function sqlText(query: SQL): string {
  const chunks = (query as unknown as { queryChunks?: unknown[] }).queryChunks ?? []
  const out: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') { out.push(node); return }
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      if (Array.isArray(record.value)) { record.value.forEach(walk); return }
      if (Array.isArray(record.queryChunks)) { record.queryChunks.forEach(walk); return }
    }
  }
  chunks.forEach(walk)
  return out.join(' ').replace(/\s+/g, ' ').trim()
}

interface FakeCounter {
  db: InvoiceNumberDb
  statements: string[]
  /** The counter's current value, as the settings row would hold it. */
  value: () => string | null
}

function makeCounter(options: {
  prefix?: string | null
  start?: string | null
  /** Throw on every statement, to stand in for an unreachable counter. */
  broken?: boolean
} = {}): FakeCounter {
  const statements: string[] = []
  let stored: string | null = options.start ?? null
  let seeded = options.start !== undefined && options.start !== null

  const db: InvoiceNumberDb = {
    all: async (query: SQL) => {
      const text = sqlText(query)
      statements.push(text)
      if (options.broken) throw new Error('D1_ERROR: no such table: settings')
      if (text.startsWith('SELECT')) {
        return options.prefix === undefined ? [] : [{ value: options.prefix }]
      }
      // UPDATE ... RETURNING. The whole point: the value comes back FROM the
      // write, so two callers can never be handed the same one.
      if (!seeded) return []
      const next = String(Number(stored ?? '0') + 1)
      stored = next
      return [{ value: next }]
    },
    run: async (query: SQL) => {
      const text = sqlText(query)
      statements.push(text)
      if (options.broken) throw new Error('D1_ERROR: no such table: settings')
      // INSERT OR IGNORE: seeds the row at 0 and never overwrites it.
      if (!seeded) { stored = '0'; seeded = true }
      return undefined
    },
  }

  return { db, statements, value: () => stored }
}

/** A UNIQUE index refusal, shaped the way SQLite and D1 phrase it. */
function uniqueConflict(): Error {
  return new Error('D1_ERROR: UNIQUE constraint failed: invoices.number: SQLITE_CONSTRAINT')
}

afterEach(() => { vi.restoreAllMocks() })

// ── 1. Format ────────────────────────────────────────────────────────────────

describe('normaliseInvoicePrefix', () => {
  it('strips the trailing separator the settings row actually ships with', () => {
    // Settings > Studio details defaults this field to 'INV-'. Without the
    // strip every number reads INV--2026-0001.
    expect(normaliseInvoicePrefix('INV-')).toBe('INV')
  })

  it('strips a leading separator and surrounding whitespace', () => {
    expect(normaliseInvoicePrefix('  -TAHI-  ')).toBe('TAHI')
  })

  it('removes internal whitespace, which a bank reference cannot carry', () => {
    expect(normaliseInvoicePrefix('TAHI STUDIO')).toBe('TAHISTUDIO')
  })

  it('keeps the operator casing, which is their business', () => {
    expect(normaliseInvoicePrefix('inv')).toBe('inv')
  })

  it('falls back to the default for anything blank or not a string', () => {
    expect(normaliseInvoicePrefix('')).toBe(DEFAULT_INVOICE_NUMBER_PREFIX)
    expect(normaliseInvoicePrefix('---')).toBe(DEFAULT_INVOICE_NUMBER_PREFIX)
    expect(normaliseInvoicePrefix('   ')).toBe(DEFAULT_INVOICE_NUMBER_PREFIX)
    expect(normaliseInvoicePrefix(null)).toBe(DEFAULT_INVOICE_NUMBER_PREFIX)
    expect(normaliseInvoicePrefix(42)).toBe(DEFAULT_INVOICE_NUMBER_PREFIX)
  })

  it('caps a prefix somebody pasted a paragraph into', () => {
    expect(normaliseInvoicePrefix('A'.repeat(200))).toBe('A'.repeat(12))
  })
})

describe('formatInvoiceNumber', () => {
  it('zero-pads to four and joins prefix, year and sequence', () => {
    expect(formatInvoiceNumber('INV', 2026, 1)).toBe('INV-2026-0001')
    expect(formatInvoiceNumber('INV', 2026, 42)).toBe('INV-2026-0042')
  })

  it('gets longer rather than truncating past four digits', () => {
    // Truncating would recycle numbers, which the unique index would then
    // refuse forever. Growing is the only safe direction.
    expect(formatInvoiceNumber('INV', 2026, 12345)).toBe('INV-2026-12345')
  })
})

describe('studioCalendarYear', () => {
  it('reads the studio calendar, not UTC', () => {
    // 31 December 2026, 13:00 NZDT is 2026-12-31T00:00:00Z. Both agree here,
    // which is the easy case.
    expect(studioCalendarYear(new Date('2026-12-31T00:00:00Z'))).toBe(2026)
    // 1 January 2027, 13:00 NZDT is 2026-12-31T12:00:00Z: UTC still says 2026,
    // the studio is already in 2027, and the studio is the one raising the bill.
    expect(studioCalendarYear(new Date('2026-12-31T12:00:00Z'))).toBe(2027)
  })

  it('does not throw on an unreadable date', () => {
    expect(Number.isInteger(studioCalendarYear(new Date('nonsense')))).toBe(true)
  })
})

// ── 2 and 3. The counter ─────────────────────────────────────────────────────

describe('mintInvoiceNumber', () => {
  it('produces the expected format from the settings prefix', async () => {
    const counter = makeCounter({ prefix: 'INV-' })
    const number = await mintInvoiceNumber(counter.db, new Date('2026-09-07T02:00:00Z'))
    expect(number).toBe('INV-2026-0001')
  })

  it('increments: two mints are two different numbers', async () => {
    const counter = makeCounter({ prefix: 'INV-' })
    const now = new Date('2026-09-07T02:00:00Z')
    expect(await mintInvoiceNumber(counter.db, now)).toBe('INV-2026-0001')
    expect(await mintInvoiceNumber(counter.db, now)).toBe('INV-2026-0002')
    expect(await mintInvoiceNumber(counter.db, now)).toBe('INV-2026-0003')
    expect(counter.value()).toBe('3')
  })

  it('keeps the counter GLOBAL across a year boundary', async () => {
    // The year in the number is a label. A per-year counter would reset here
    // and hand 2027 a second INV-...-0001.
    const counter = makeCounter({ prefix: 'INV-', start: '430' })
    expect(await mintInvoiceNumber(counter.db, new Date('2026-06-01T00:00:00Z'))).toBe('INV-2026-0431')
    expect(await mintInvoiceNumber(counter.db, new Date('2027-06-01T00:00:00Z'))).toBe('INV-2027-0432')
  })

  it('falls back to the default prefix when no settings row exists', async () => {
    const counter = makeCounter({})
    const number = await mintInvoiceNumber(counter.db, new Date('2026-09-07T02:00:00Z'))
    expect(number).toBe('INV-2026-0001')
  })

  it('bumps the counter in ONE atomic statement, never a read then a write', async () => {
    const counter = makeCounter({ prefix: 'INV-' })
    await mintInvoiceNumber(counter.db, new Date('2026-09-07T02:00:00Z'))

    const bump = counter.statements.find(s => s.startsWith('UPDATE settings'))
    expect(bump, 'the counter must be bumped by an UPDATE').toBeDefined()
    // RETURNING is what makes the value exclusive to this caller. Without it
    // the route would have to read the row back, which is the race.
    expect(bump).toContain('RETURNING value')

    // And nothing SELECTs the counter. The only SELECT is the prefix.
    const selects = counter.statements.filter(s => s.startsWith('SELECT'))
    expect(selects).toHaveLength(1)
    expect(selects[0]).toContain(INVOICE_NUMBER_PREFIX_KEY)
    expect(selects[0]).not.toContain(INVOICE_NUMBER_SEQUENCE_KEY)
  })

  it('seeds the counter row with INSERT OR IGNORE, so it needs no migration', async () => {
    const counter = makeCounter({ prefix: 'INV-' })
    await mintInvoiceNumber(counter.db, new Date('2026-09-07T02:00:00Z'))
    const seed = counter.statements.find(s => s.startsWith('INSERT OR IGNORE'))
    expect(seed).toBeDefined()
    expect(seed).toContain('settings')
  })

  it('throws when the counter answers with nothing usable', async () => {
    const db: InvoiceNumberDb = {
      all: async (query: SQL) =>
        sqlText(query).startsWith('SELECT') ? [{ value: 'INV-' }] : [],
      run: async () => undefined,
    }
    await expect(mintInvoiceNumber(db, new Date())).rejects.toThrow(/usable sequence/)
  })
})

// ── 4 and 5. Writing the invoice ─────────────────────────────────────────────

describe('isInvoiceNumberConflict', () => {
  it('recognises the unique index on invoices.number', () => {
    expect(isInvoiceNumberConflict(uniqueConflict())).toBe(true)
  })

  it('does NOT claim the other unique index on the same table', () => {
    // invoices.manyrequests_id is also unique, and retrying a mint would not
    // fix that one, so it must be rethrown rather than swallowed.
    expect(isInvoiceNumberConflict(
      new Error('UNIQUE constraint failed: invoices.manyrequests_id'),
    )).toBe(false)
  })

  it('ignores unrelated failures', () => {
    expect(isInvoiceNumberConflict(new Error('D1_ERROR: no such column: number'))).toBe(false)
    expect(isInvoiceNumberConflict(null)).toBe(false)
  })
})

describe('withInvoiceNumber', () => {
  it('writes the invoice with the minted number', async () => {
    const counter = makeCounter({ prefix: 'INV-' })
    const written: Array<string | null> = []

    const number = await withInvoiceNumber(
      counter.db,
      async n => { written.push(n) },
      new Date('2026-09-07T02:00:00Z'),
    )

    expect(number).toBe('INV-2026-0001')
    expect(written).toEqual(['INV-2026-0001'])
  })

  it('retries ONCE past a unique conflict and lands on the next number', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const counter = makeCounter({ prefix: 'INV-' })
    const attempted: Array<string | null> = []
    const write = vi.fn(async (n: string | null) => {
      attempted.push(n)
      if (attempted.length === 1) throw uniqueConflict()
    })

    const number = await withInvoiceNumber(counter.db, write, new Date('2026-09-07T02:00:00Z'))

    expect(write).toHaveBeenCalledTimes(2)
    expect(attempted).toEqual(['INV-2026-0001', 'INV-2026-0002'])
    expect(number).toBe('INV-2026-0002')
  })

  it('gives up after the attempt ceiling rather than burning the sequence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const counter = makeCounter({ prefix: 'INV-' })
    const write = vi.fn(async () => { throw uniqueConflict() })

    await expect(
      withInvoiceNumber(counter.db, write, new Date('2026-09-07T02:00:00Z')),
    ).rejects.toThrow(/UNIQUE constraint failed/)
    expect(write).toHaveBeenCalledTimes(INVOICE_NUMBER_ATTEMPTS)
  })

  it('rethrows a failure that is NOT a number conflict, without retrying', async () => {
    const counter = makeCounter({ prefix: 'INV-' })
    const write = vi.fn(async () => { throw new Error('NOT NULL constraint failed: invoices.org_id') })

    await expect(
      withInvoiceNumber(counter.db, write, new Date('2026-09-07T02:00:00Z')),
    ).rejects.toThrow(/org_id/)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('still writes the invoice, unnumbered, when the counter is unreachable', async () => {
    // A settings row that will not increment is not a reason to refuse to
    // bill a client. Every reader falls back to the short id.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const counter = makeCounter({ broken: true })
    const written: Array<string | null> = []

    const number = await withInvoiceNumber(counter.db, async n => { written.push(n) })

    expect(number).toBeNull()
    expect(written).toEqual([null])
    expect(errorSpy).toHaveBeenCalled()
  })
})

// ── Imports keep their own number ────────────────────────────────────────────

describe('importedInvoiceNumber', () => {
  it('keeps what the source called it', () => {
    expect(importedInvoiceNumber('INV-0042')).toBe('INV-0042')
    expect(importedInvoiceNumber('  INV-0042  ')).toBe('INV-0042')
  })

  it('turns blank into NULL, not an empty string', () => {
    // SQLite treats NULLs as distinct in a unique index but empty strings as
    // equal, so a second blank import would collide with the first.
    expect(importedInvoiceNumber('')).toBeNull()
    expect(importedInvoiceNumber('   ')).toBeNull()
    expect(importedInvoiceNumber(undefined)).toBeNull()
    expect(importedInvoiceNumber(null)).toBeNull()
  })
})

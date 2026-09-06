/**
 * lib/invoice-number.ts
 *
 * Where an invoice number comes from, and why it cannot be handed out twice.
 *
 * The studio owns the sequence (Liam, 2026-09-06: "Tahi's own sequence pushed
 * into Xero, we control it"). Anything RAISED in the dashboard is numbered
 * here, from the settings prefix, and that number is what Xero is told as
 * InvoiceNumber. Anything IMPORTED keeps the number its source already gave it
 * (Xero's InvoiceNumber, Stripe's number when the invoice has one), because
 * renumbering a bill the client has already received is how a payment stops
 * reconciling. No row is ever renumbered once it carries a number.
 *
 * FORMAT: `<prefix>-<YYYY>-<NNNN>`, e.g. INV-2026-0001.
 *
 * The counter is GLOBAL, not per year. The year in the middle is a label, not
 * a scope: it tells a human at a glance which year the bill belongs to, while
 * the number after it keeps climbing across the boundary, so the first invoice
 * of 2027 is INV-2027-0431 rather than a second INV-...-0001. A per-year
 * counter would need the year to be part of the uniqueness argument, and every
 * concurrent mint would have to agree on which year it was in before it could
 * agree on which number it was taking.
 *
 * ── Why the counter is safe ──────────────────────────────────────────────────
 *
 * D1 has no SELECT ... FOR UPDATE, and a route cannot hold a transaction open
 * across an await, so "read the counter, add one, write it back" is a race:
 * two invoices raised in the same second read the same value and both take it.
 *
 * Two mechanisms, and the second is the one that makes it a guarantee:
 *
 *   1. ONE ATOMIC STATEMENT. The counter is bumped with
 *      `UPDATE settings SET value = value + 1 ... RETURNING value`. A single
 *      SQLite statement is atomic, and RETURNING hands the caller the value
 *      THAT statement wrote, not a value it read beforehand. Two concurrent
 *      callers therefore get 41 and 42, never 41 twice. This is the D1
 *      equivalent of a sequence, and it is why no read-then-write appears
 *      anywhere below.
 *
 *   2. A UNIQUE INDEX ON invoices.number (migration 0096). Belt to the braces.
 *      If a number ever collides anyway (a hand-edited counter row, an
 *      imported Xero number that happens to match our format, a restore that
 *      rewound the counter), the INSERT fails instead of writing a duplicate,
 *      and `withInvoiceNumber` mints a fresh number and tries again. Uniqueness
 *      is enforced by the database rather than argued for by the code.
 *
 * A minting failure never blocks the bill. If the counter is unreachable the
 * invoice is written with a NULL number, which every reader already handles by
 * falling back to the short id, and the backfill or a later edit can fix it.
 * Refusing to raise an invoice because a settings row would not increment is
 * the wrong trade for a money path.
 *
 * Pure helpers are exported separately from the two D1-touching functions so
 * the formatting rules are unit testable without a database handle
 * (CLAUDE.md: never export a non-route symbol from a route.ts).
 */

import { sql, type SQL } from 'drizzle-orm'
import { STUDIO_TIME_ZONE } from '@/lib/kickoff-slot'

/** Settings key holding the operator-editable prefix (Settings > Studio details). */
export const INVOICE_NUMBER_PREFIX_KEY = 'invoice_number_prefix'

/**
 * Settings key holding the sequence counter, as a decimal string.
 *
 * Namespaced under `invoicing.` like the other money keys
 * (invoicing.defaultChannel, invoicing.bankDetails). Deliberately NOT the same
 * row as the prefix: the prefix is edited by hand in the settings form, and a
 * form that batch-saves every field it holds would otherwise be one stray
 * keystroke away from rewinding the sequence.
 */
export const INVOICE_NUMBER_SEQUENCE_KEY = 'invoicing.numberSequence'

/** What the prefix is when the settings row is missing, blank or unusable. */
export const DEFAULT_INVOICE_NUMBER_PREFIX = 'INV'

/** Zero padding on the sequence. A longer number simply gets longer. */
export const INVOICE_SEQUENCE_PAD = 4

/** Longest prefix accepted. Long enough for a studio abbreviation, short enough to read. */
export const MAX_INVOICE_PREFIX_LENGTH = 12

/**
 * How many times a mint-and-insert is retried on a unique conflict.
 *
 * Three, not "until it works". The atomic counter means a conflict is already
 * abnormal, so a run of them is a broken counter rather than contention, and a
 * loop that keeps going would burn the sequence forever instead of surfacing
 * the fault.
 */
export const INVOICE_NUMBER_ATTEMPTS = 3

/**
 * The prefix, cleaned up.
 *
 * The stored default is literally `INV-` (the settings form ships that as its
 * placeholder and its fallback), so the trailing separator has to come off or
 * every number would read INV--2026-0001. Whitespace goes entirely: a prefix
 * with a space in it becomes an invoice number with a space in it, which is a
 * bank reference nobody types correctly. Case is the operator's business and
 * is left alone.
 */
export function normaliseInvoicePrefix(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_INVOICE_NUMBER_PREFIX
  const cleaned = raw
    .replace(/\s+/g, '')
    .replace(/^[-_/.]+/, '')
    .replace(/[-_/.]+$/, '')
    .slice(0, MAX_INVOICE_PREFIX_LENGTH)
  return cleaned === '' ? DEFAULT_INVOICE_NUMBER_PREFIX : cleaned
}

/**
 * The calendar year the studio is actually in, as a number.
 *
 * New Zealand runs UTC+12/+13, so for the first half of every working day the
 * UTC year is the studio's year, but on 31 December it is not: an invoice
 * raised at 13:00 NZDT on 31 December 2026 is a 2026 invoice, and
 * `new Date().getUTCFullYear()` would label it 2026 too only by luck of the
 * hour. Formatted in Pacific/Auckland so the label matches the day the studio
 * raised the bill, with a UTC fallback for a runtime without the zone data
 * (wrong for a handful of hours a year beats throwing on a money path).
 */
export function studioCalendarYear(now: Date): number {
  const instant = Number.isNaN(now.getTime()) ? new Date() : now
  try {
    const year = new Intl.DateTimeFormat('en-NZ', {
      timeZone: STUDIO_TIME_ZONE,
      year: 'numeric',
    }).formatToParts(instant).find(part => part.type === 'year')?.value
    const parsed = Number(year)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  } catch {
    // No zone data in this runtime. Fall through to UTC.
  }
  return instant.getUTCFullYear()
}

/**
 * Assemble the number. Pure, so the format is pinned by a test rather than by
 * whichever route happened to build it.
 */
export function formatInvoiceNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(INVOICE_SEQUENCE_PAD, '0')}`
}

/**
 * Is this the unique index on invoices.number refusing a duplicate?
 *
 * Matched on BOTH halves of SQLite's message, not just "unique constraint
 * failed": the invoices table also carries a unique index on manyrequests_id,
 * and retrying a mint would not fix that one. Anything else is rethrown.
 */
export function isInvoiceNumberConflict(err: unknown): boolean {
  const text = errorText(err).toLowerCase()
  return text.includes('unique constraint failed') && text.includes('invoices.number')
}

function errorText(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` ${err.cause.message}` : ''
    return `${err.message}${cause}`
  }
  return ''
}

/**
 * The two D1 methods the counter needs, and nothing else.
 *
 * Narrow on purpose: every caller passes a full Drizzle handle, but declaring
 * only `all` and `run` keeps the test harness to a dozen lines and makes it
 * obvious that this module reads and writes exactly one settings row.
 */
export interface InvoiceNumberDb {
  all: (query: SQL) => Promise<unknown[]>
  run: (query: SQL) => Promise<unknown>
}

/**
 * Take the next number in the sequence.
 *
 * Three statements, and the order matters:
 *
 *   1. Read the prefix. A missing row is the default, not an error.
 *   2. INSERT OR IGNORE the counter row at 0. Idempotent, so the counter needs
 *      no migration and a database that has never raised an invoice carries no
 *      dead row. Two callers racing here both end up with the row at 0, which
 *      is the correct outcome: neither has taken a number yet.
 *   3. UPDATE ... RETURNING. The atomic bump. COALESCE and CAST make a NULL,
 *      empty or garbage value read as 0 rather than blowing up, so a
 *      hand-mangled row restarts the sequence instead of stopping invoicing;
 *      the unique index then refuses the numbers that are already taken and the
 *      retry in `withInvoiceNumber` walks past them.
 *
 * Throws when the counter answers with something that is not a positive
 * integer, which is the one case where inventing a number would be worse than
 * saying so.
 */
export async function mintInvoiceNumber(
  database: InvoiceNumberDb,
  now: Date = new Date(),
): Promise<string> {
  const prefixRows = await database.all(
    sql`SELECT value FROM settings WHERE key = ${INVOICE_NUMBER_PREFIX_KEY} LIMIT 1`,
  )
  const prefix = normaliseInvoicePrefix(readValue(prefixRows[0]))

  const stamp = new Date(Number.isNaN(now.getTime()) ? Date.now() : now.getTime()).toISOString()

  await database.run(sql`
    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES (${INVOICE_NUMBER_SEQUENCE_KEY}, '0', ${stamp})
  `)

  const bumped = await database.all(sql`
    UPDATE settings
       SET value = CAST(CAST(COALESCE(value, '0') AS INTEGER) + 1 AS TEXT),
           updated_at = ${stamp}
     WHERE key = ${INVOICE_NUMBER_SEQUENCE_KEY}
    RETURNING value
  `)

  const sequence = Number(readValue(bumped[0]))
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Invoice number counter did not return a usable sequence')
  }

  return formatInvoiceNumber(prefix, studioCalendarYear(now), sequence)
}

/** The `value` column off a raw row, whatever shape the driver returned it in. */
function readValue(row: unknown): unknown {
  if (row === null || typeof row !== 'object') return null
  return (row as Record<string, unknown>).value ?? null
}

/**
 * Write an invoice with a freshly minted number, retrying past a collision.
 *
 * `write` is the caller's own insert, taking the number to stamp on the row.
 * It runs INSIDE the retry, which is the whole point: a unique conflict is only
 * visible at insert time, and the insert failed atomically so re-running it
 * with a new number is safe. Callers that do more than one write (line items,
 * an audit row) must keep those OUTSIDE this call, after it returns.
 *
 * Returns the number that was actually written, or null when the counter could
 * not be reached and the invoice was written unnumbered. Never returns without
 * having written the invoice: the only way out with no row is a rethrown error
 * from `write` itself.
 */
export async function withInvoiceNumber(
  database: InvoiceNumberDb,
  write: (number: string | null) => Promise<void>,
  now: Date = new Date(),
): Promise<string | null> {
  for (let attempt = 1; attempt <= INVOICE_NUMBER_ATTEMPTS; attempt++) {
    let number: string
    try {
      number = await mintInvoiceNumber(database, now)
    } catch (mintErr) {
      // The counter is unreachable or unusable. A bill with no number beats no
      // bill: write it unnumbered (every reader falls back to the short id) and
      // let the operator or a later edit fix it.
      console.error('[invoice-number] could not mint, writing the invoice unnumbered', mintErr)
      await write(null)
      return null
    }

    try {
      await write(number)
      return number
    } catch (writeErr) {
      if (attempt === INVOICE_NUMBER_ATTEMPTS || !isInvoiceNumberConflict(writeErr)) throw writeErr
      console.error(`[invoice-number] ${number} was taken, minting again`, writeErr)
    }
  }

  // Unreachable: the final attempt either returns or rethrows above.
  throw new Error('Could not mint a unique invoice number')
}

/**
 * The number an IMPORTED invoice keeps, or null.
 *
 * Trimmed, and blank means null rather than an empty string: an empty string is
 * a value as far as the unique index is concerned, so the second import
 * carrying one would collide with the first. NULLs are distinct, empty strings
 * are not.
 */
export function importedInvoiceNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

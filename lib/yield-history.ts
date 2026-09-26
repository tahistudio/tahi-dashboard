/**
 * lib/yield-history.ts: the one durable record that Airwallex yield has been
 * held.
 *
 * Yield positions (Airwallex Capital) are not in the public Airwallex API, so
 * they reach the dashboard only through the operator-maintained
 * finance.yieldHoldings setting, which every Airwallex sync materialises as
 * 'yield:CUR' balance rows and deletes again once the setting is emptied. So
 * after the yield is withdrawn and the setting cleared, nothing in those rows
 * shows it was ever held, and the wallet ledger does not mark transfers into
 * or out of yield either. A month-end cash rebuild from the wallet ledger
 * alone would then read low, by whatever sat in yield, for every month that
 * ended while money was there (lib/financial-snapshots.ts).
 *
 * finance.yieldFirstHeldAt is the record that outlives the rows. The sync
 * writes it the first time it sees a yield holding with money in it, whether
 * it is writing that holding or deleting it, and nothing ever clears it. When
 * the yield was first bought is not something the sync can know, so it writes
 * 'unknown', which stops every month-end cash rebuild. Someone who knows the
 * date of the first transfer into yield can set it (YYYY-MM-DD, read as
 * midnight UTC, so a day early is the safe side of New Zealand time; any
 * earlier date is safe too), and the months that ended on or before that
 * date rebuild again, because no yield was held at their month end.
 *
 * The finance.yieldHoldings row itself also counts as evidence, which covers
 * a withdrawal that happens before any sync has written the marker: the
 * settings writer empties a value but never deletes the row, so once someone
 * has recorded a holding the row is there for good, even set to [] after.
 */
import { schema } from '@/db/d1'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export const YIELD_FIRST_HELD_KEY = 'finance.yieldFirstHeldAt'

/** The operator-maintained holdings the sync materialises as 'yield:CUR' rows. */
export const YIELD_HOLDINGS_KEY = 'finance.yieldHoldings'

/** What the sync writes: yield has been held, since a date it cannot know. */
export const YIELD_FIRST_HELD_UNKNOWN = 'unknown'

/** The smallest amount that counts as money held, as the cash readers round. */
const MIN_HELD = 0.005

/**
 * Write the marker when any of `amounts` is money and no marker exists yet.
 * Insert only: an existing marker, the sync's 'unknown' or a date someone
 * set, is never touched. True when this call wrote it; a driver that reports
 * no change count is taken at its word that the write landed.
 */
export async function recordYieldHeld(drizzle: D1, amounts: Iterable<number>, nowIso: string): Promise<boolean> {
  if (![...amounts].some(amount => Math.abs(amount) >= MIN_HELD)) return false
  const result = await drizzle
    .insert(schema.settings)
    .values({ key: YIELD_FIRST_HELD_KEY, value: YIELD_FIRST_HELD_UNKNOWN, updatedAt: nowIso })
    .onConflictDoNothing({ target: schema.settings.key })
  const changes = (result as { meta?: { changes?: unknown } } | null | undefined)?.meta?.changes
  return !(typeof changes === 'number' && changes === 0)
}

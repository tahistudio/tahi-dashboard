/**
 * lib/invoice-number-backfill.ts
 *
 * Recovering the number an already-imported invoice was born with.
 *
 * invoices.number arrived in migration 0096, so every row that predates it is
 * NULL. For a bill RAISED in the dashboard that is simply the old world and it
 * stays NULL: minting a number now would put a string on a document the client
 * already holds under a different name, or under no name at all, which is worse
 * than the short-id fallback every surface already handles.
 *
 * But an IMPORTED invoice was never unnumbered. Xero and Stripe both gave it a
 * number, and the importers of the day wrote that number down, just not in a
 * column:
 *
 *   manyrequests_id   IS the ManyRequests invoice number ("INV-2025000024").
 *                     The number is the identifier on that API; there is no
 *                     separate id, which is why the column is TEXT.
 *   notes             "Imported from Xero: <InvoiceNumber>" (lib/xero-sync.ts)
 *                     "Imported from Stripe: <number ?? id>" (lib/stripe-import.ts)
 *
 * So the backfill is a RECOVERY, not a renumbering. This module decides, per
 * row, whether a real source number can be read back out, and refuses by name
 * when it cannot. It never invents one, never touches the sequence counter, and
 * never changes a row that already has a number.
 *
 * Pure, so the parsing rules and the conflict handling are unit testable
 * without a D1 handle and the route stays a thin read / plan / write
 * (CLAUDE.md: never export a non-route symbol from a route.ts).
 */

/** The prefix the Xero importer writes into notes, verbatim. */
export const XERO_NOTE_PREFIX = 'Imported from Xero: '

/** The prefix the Stripe invoice importer writes into notes, verbatim. */
export const STRIPE_NOTE_PREFIX = 'Imported from Stripe: '

/**
 * Stripe object id prefix for an invoice.
 *
 * The Stripe importer's note is `inv.number ?? inv.id`, so a DRAFT invoice (no
 * number yet) left the object id in the note instead. "in_1QxYz..." is a
 * machine handle, not something a client was ever shown, so it is refused
 * rather than written into a column whose whole purpose is to be quoted.
 */
export const STRIPE_INVOICE_ID_PREFIX = 'in_'

/** The columns the backfill reads. Everything it decides comes from these. */
export interface BackfillCandidate {
  id: string
  number: string | null
  notes: string | null
  manyrequestsId: string | null
}

/** Where a recovered number came from. Reported so the operator can spot-check it. */
export type BackfillOrigin = 'manyrequests' | 'xero' | 'stripe'

/** A row the backfill would write, or did. */
export interface BackfillFill {
  id: string
  number: string
  origin: BackfillOrigin
}

/** Why a row was left alone. */
export type BackfillRefusalReason =
  | 'already_numbered'
  | 'no_source_number'
  | 'stripe_id_not_a_number'
  | 'conflict'

/**
 * A row the backfill will not touch, with the sentence an operator reads.
 *
 * Named refusals rather than a count: "31 rows could not be filled" is not
 * something anybody can act on, and the whole point of the dry run is that the
 * plan can be argued with before it is applied.
 */
export interface BackfillRefusal {
  id: string
  reason: BackfillRefusalReason
  message: string
  /** The number that was wanted, on a conflict or a refused Stripe id. */
  candidate?: string
}

export interface BackfillPlan {
  fills: BackfillFill[]
  refusals: BackfillRefusal[]
}

/**
 * The number an imported row was born with, or null.
 *
 * The ManyRequests key wins over the notes because it is a structured column
 * rather than a string parsed out of prose: a row carrying both was imported
 * from ManyRequests and later annotated, and the column is the fact.
 */
export function recoverSourceNumber(
  candidate: BackfillCandidate,
): { number: string; origin: BackfillOrigin } | null {
  const mr = trimmed(candidate.manyrequestsId)
  if (mr) return { number: mr, origin: 'manyrequests' }

  const notes = trimmed(candidate.notes)
  if (!notes) return null

  if (notes.startsWith(XERO_NOTE_PREFIX)) {
    const value = trimmed(notes.slice(XERO_NOTE_PREFIX.length))
    if (value) return { number: value, origin: 'xero' }
  }

  if (notes.startsWith(STRIPE_NOTE_PREFIX)) {
    const value = trimmed(notes.slice(STRIPE_NOTE_PREFIX.length))
    if (value) return { number: value, origin: 'stripe' }
  }

  return null
}

/**
 * Decide what to write, and say why for everything else.
 *
 * `taken` is every number already held in D1. It matters because the unique
 * index would turn a collision into a 500 mid-batch: refusing the row by name
 * lets the rest of the plan apply and hands the operator the one case to look
 * at. Numbers filled EARLIER IN THIS PLAN join the taken set as they are
 * decided, so a batch containing the same source number twice (two rows
 * imported from the same Xero invoice, which the Xero importer's id check
 * normally prevents but a hand-inserted row does not) refuses the second
 * instead of failing the write.
 */
export function planInvoiceNumberBackfill(input: {
  candidates: BackfillCandidate[]
  taken: readonly string[]
}): BackfillPlan {
  const fills: BackfillFill[] = []
  const refusals: BackfillRefusal[] = []
  const claimed = new Set(input.taken.map(n => n.trim()).filter(n => n !== ''))

  for (const candidate of input.candidates) {
    if (trimmed(candidate.number)) {
      refusals.push({
        id: candidate.id,
        reason: 'already_numbered',
        message: 'This invoice already has a number. Nothing is ever renumbered.',
      })
      continue
    }

    const recovered = recoverSourceNumber(candidate)
    if (!recovered) {
      refusals.push({
        id: candidate.id,
        reason: 'no_source_number',
        message:
          'No source number to recover. This invoice was raised in the dashboard before invoice numbers existed, '
          + 'so it keeps the short id as its reference. The backfill never mints a sequence number for a historical row.',
      })
      continue
    }

    if (recovered.origin === 'stripe' && recovered.number.startsWith(STRIPE_INVOICE_ID_PREFIX)) {
      refusals.push({
        id: candidate.id,
        reason: 'stripe_id_not_a_number',
        message:
          'The Stripe import recorded an object id, not an invoice number, which means this bill was still a draft in '
          + 'Stripe when it was imported. It keeps the short id as its reference.',
        candidate: recovered.number,
      })
      continue
    }

    if (claimed.has(recovered.number)) {
      refusals.push({
        id: candidate.id,
        reason: 'conflict',
        message:
          'Another invoice already holds this number, so writing it would break the unique index. '
          + 'Check whether these two rows are the same bill imported twice.',
        candidate: recovered.number,
      })
      continue
    }

    claimed.add(recovered.number)
    fills.push({ id: candidate.id, number: recovered.number, origin: recovered.origin })
  }

  return { fills, refusals }
}

function trimmed(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * lib/__tests__/invoice-number-backfill.test.ts
 *
 * What the backfill will and will not write.
 *
 * The whole risk of this feature is a repair that invents document numbers. So
 * the planner is pinned on its refusals as hard as on its fills:
 *
 *   1. A row that already has a number is REFUSED, by name. Nothing is ever
 *      renumbered.
 *   2. A row with no recoverable source number is REFUSED. It is not handed one
 *      from the studio sequence: that number would appear on nothing the client
 *      holds, and it would burn a live sequence value on history.
 *   3. A Stripe note carrying an object id ("in_...") rather than a number is
 *      REFUSED. The importer's note is `number ?? id`, so a draft invoice left
 *      the machine handle behind, and a machine handle is not something anyone
 *      was ever asked to quote.
 *   4. A number already held by another row is REFUSED, including one claimed
 *      earlier in the same plan. The unique index would otherwise turn it into
 *      a 500 halfway through the batch.
 *   5. What IS recovered comes from the three places the importers of the day
 *      actually wrote it down, and the origin is reported so it can be checked.
 */

import { describe, it, expect } from 'vitest'
import {
  STRIPE_NOTE_PREFIX,
  XERO_NOTE_PREFIX,
  planInvoiceNumberBackfill,
  recoverSourceNumber,
  type BackfillCandidate,
} from '@/lib/invoice-number-backfill'

function candidate(over: Partial<BackfillCandidate> = {}): BackfillCandidate {
  return { id: 'inv-1', number: null, notes: null, manyrequestsId: null, ...over }
}

describe('recoverSourceNumber', () => {
  it('reads the ManyRequests key, which IS that invoice number', () => {
    expect(recoverSourceNumber(candidate({ manyrequestsId: 'INV-2025000024' })))
      .toEqual({ number: 'INV-2025000024', origin: 'manyrequests' })
  })

  it('reads the number the Xero importer wrote into notes', () => {
    expect(recoverSourceNumber(candidate({ notes: `${XERO_NOTE_PREFIX}INV-0431` })))
      .toEqual({ number: 'INV-0431', origin: 'xero' })
  })

  it('reads the number the Stripe importer wrote into notes', () => {
    expect(recoverSourceNumber(candidate({ notes: `${STRIPE_NOTE_PREFIX}A1B2C3D4-0007` })))
      .toEqual({ number: 'A1B2C3D4-0007', origin: 'stripe' })
  })

  it('prefers the structured column over prose when a row carries both', () => {
    const found = recoverSourceNumber(candidate({
      manyrequestsId: 'INV-2025000024',
      notes: `${XERO_NOTE_PREFIX}INV-0431`,
    }))
    expect(found).toEqual({ number: 'INV-2025000024', origin: 'manyrequests' })
  })

  it('finds nothing in a note the importers never wrote', () => {
    // The Stripe CHARGE importer writes "Stripe payment: ..." and the hourly
    // export writes "Auto-generated for ...". Neither carries a number.
    expect(recoverSourceNumber(candidate({ notes: 'Stripe payment: Retainer' }))).toBeNull()
    expect(recoverSourceNumber(candidate({ notes: 'Auto-generated for August 2026 billable hours' }))).toBeNull()
    expect(recoverSourceNumber(candidate({ notes: '   ' }))).toBeNull()
    expect(recoverSourceNumber(candidate())).toBeNull()
  })
})

describe('planInvoiceNumberBackfill', () => {
  it('fills the rows whose source number is recoverable, and names the origin', () => {
    const { fills, refusals } = planInvoiceNumberBackfill({
      candidates: [
        candidate({ id: 'a', manyrequestsId: 'INV-2025000024' }),
        candidate({ id: 'b', notes: `${XERO_NOTE_PREFIX}INV-0431` }),
      ],
      taken: [],
    })
    expect(fills).toEqual([
      { id: 'a', number: 'INV-2025000024', origin: 'manyrequests' },
      { id: 'b', number: 'INV-0431', origin: 'xero' },
    ])
    expect(refusals).toEqual([])
  })

  it('never renumbers a row that already has a number', () => {
    const { fills, refusals } = planInvoiceNumberBackfill({
      candidates: [candidate({ id: 'a', number: 'INV-2026-0001', manyrequestsId: 'INV-2025000024' })],
      taken: ['INV-2026-0001'],
    })
    expect(fills).toEqual([])
    expect(refusals[0]).toMatchObject({ id: 'a', reason: 'already_numbered' })
  })

  it('never mints for a dashboard-raised historical row', () => {
    // The refusal is the feature. This bill was raised before numbering
    // existed, was sent under its short id, and keeps it.
    const { fills, refusals } = planInvoiceNumberBackfill({
      candidates: [candidate({ id: 'a', notes: 'Raised from onboarding' })],
      taken: [],
    })
    expect(fills).toEqual([])
    expect(refusals[0]).toMatchObject({ id: 'a', reason: 'no_source_number' })
    expect(refusals[0].message).toContain('never mints')
  })

  it('refuses a Stripe object id standing in for a number', () => {
    const { fills, refusals } = planInvoiceNumberBackfill({
      candidates: [candidate({ id: 'a', notes: `${STRIPE_NOTE_PREFIX}in_1QxYz9CabcDEF` })],
      taken: [],
    })
    expect(fills).toEqual([])
    expect(refusals[0]).toMatchObject({
      id: 'a',
      reason: 'stripe_id_not_a_number',
      candidate: 'in_1QxYz9CabcDEF',
    })
  })

  it('refuses a number another row already holds', () => {
    const { fills, refusals } = planInvoiceNumberBackfill({
      candidates: [candidate({ id: 'a', notes: `${XERO_NOTE_PREFIX}INV-0431` })],
      taken: ['INV-0431'],
    })
    expect(fills).toEqual([])
    expect(refusals[0]).toMatchObject({ id: 'a', reason: 'conflict', candidate: 'INV-0431' })
  })

  it('refuses the SECOND row claiming a number inside the same plan', () => {
    // Two rows recovering the same source number would pass a per-row check
    // and then break the unique index on the write.
    const { fills, refusals } = planInvoiceNumberBackfill({
      candidates: [
        candidate({ id: 'a', notes: `${XERO_NOTE_PREFIX}INV-0431` }),
        candidate({ id: 'b', notes: `${XERO_NOTE_PREFIX}INV-0431` }),
      ],
      taken: [],
    })
    expect(fills).toEqual([{ id: 'a', number: 'INV-0431', origin: 'xero' }])
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({ id: 'b', reason: 'conflict' })
  })

  it('accounts for every candidate exactly once', () => {
    const candidates = [
      candidate({ id: 'a', manyrequestsId: 'INV-2025000024' }),
      candidate({ id: 'b', number: 'INV-2026-0001' }),
      candidate({ id: 'c' }),
      candidate({ id: 'd', notes: `${STRIPE_NOTE_PREFIX}in_123` }),
    ]
    const { fills, refusals } = planInvoiceNumberBackfill({ candidates, taken: [] })
    expect(fills.length + refusals.length).toBe(candidates.length)
    expect([...fills.map(f => f.id), ...refusals.map(r => r.id)].sort())
      .toEqual(['a', 'b', 'c', 'd'])
  })
})

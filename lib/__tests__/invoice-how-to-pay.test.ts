/**
 * lib/__tests__/invoice-how-to-pay.test.ts
 *
 * The block a client is shown when there is nothing to click, and the rule for
 * when there is.
 *
 * This module is shared by three surfaces that MUST agree word for word: the
 * portal list projection, the portal detail projection and the invoice email.
 * A difference between them is a client reading two different account numbers
 * for the same bill, so the shape is pinned here once rather than re-asserted
 * three times against three routes.
 *
 * The five rules that matter:
 *
 *   1. A link beats a transfer, whichever rail issued it. resolveInvoicePayUrl
 *      prefers Stripe's hosted page and falls back to Xero's online invoice,
 *      and buildHowToPay refuses to build a block when either exists.
 *   2. Only the Xero rail gets a block. A Stripe client always ends up with a
 *      hosted page, and a bank transfer against a Stripe invoice reconciles
 *      against nothing.
 *   3. Only a bill that is STILL OWED gets a block. A Xero invoice paid by
 *      transfer and marked paid here never gets an OnlineInvoiceUrl, so rules
 *      1 and 2 stay true forever, and both portal projections return every
 *      non-draft invoice: without this the settled row goes on quoting an
 *      account number under the words "How to pay".
 *   4. The reference, the amount and the currency always exist, because they
 *      come off the invoice rather than off a setting. There is no state in
 *      which the client cannot quote the right reference for the right amount.
 *   5. Nothing studio-side is in the block. No rail label, no Xero id, no
 *      reconciliation state (Liam, 2026-09-06: "the client sees only what they
 *      need to act").
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_REFERENCE_HINT,
  SETTLED_INVOICE_STATUSES,
  buildHowToPay,
  hasBankDestination,
  isInvoiceSettled,
  readInvoicePayContext,
  resolveInvoicePayUrl,
} from '@/lib/invoice-how-to-pay'
import { INVOICE_CHANNEL_SETTING_KEY } from '@/lib/invoice-channel'
import {
  BANK_DETAILS_SETTING_KEY,
  XERO_EMAIL_MODE_SETTING_KEY,
} from '@/lib/invoice-pay-settings'

const INVOICE = {
  id: 'inv-1042-9c31-4b77-8e05-6f1d2a94c7b3',
  status: 'sent',
  totalUsd: 4312.5,
  currency: 'NZD',
  dueDate: '2026-09-30',
  paidAt: null,
}

const BANK = {
  bankName: 'ANZ',
  accountName: 'Tahi Studio Ltd',
  accountNumber: '01-0242-0198765-00',
  referenceHint: 'Quote the reference on your transfer.',
}

describe('resolveInvoicePayUrl', () => {
  it('prefers the Stripe hosted page', () => {
    expect(resolveInvoicePayUrl('https://invoice.stripe.com/i/1', 'https://in.xero.com/abc'))
      .toBe('https://invoice.stripe.com/i/1')
  })

  it('falls back to the Xero online invoice', () => {
    expect(resolveInvoicePayUrl(null, 'https://in.xero.com/abc')).toBe('https://in.xero.com/abc')
  })

  it('treats an empty or whitespace column as no link', () => {
    expect(resolveInvoicePayUrl('', '   ')).toBeNull()
    expect(resolveInvoicePayUrl(undefined, null)).toBeNull()
  })

  it('trims, so a padded column cannot ship a broken href', () => {
    expect(resolveInvoicePayUrl('  https://invoice.stripe.com/i/1  ', null))
      .toBe('https://invoice.stripe.com/i/1')
  })
})

describe('buildHowToPay', () => {
  it('builds the block for a Xero-rail invoice with no link', () => {
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: INVOICE,
      bankDetails: BANK,
    })

    expect(block).toEqual({
      bankName: 'ANZ',
      accountName: 'Tahi Studio Ltd',
      accountNumber: '01-0242-0198765-00',
      // The invoice number, which is what the client quotes on the transfer.
      reference: 'INV-1042',
      amount: 4312.5,
      currency: 'NZD',
      dueDate: '2026-09-30',
      hint: BANK.referenceHint,
    })
  })

  it('carries nothing studio-side: no rail, no Xero id, no reconciliation state', () => {
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: INVOICE,
      bankDetails: BANK,
    })!

    expect(Object.keys(block).sort()).toEqual([
      'accountName',
      'accountNumber',
      'amount',
      'bankName',
      'currency',
      'dueDate',
      'hint',
      'reference',
    ])
  })

  it('returns null once either rail has issued a pay page', () => {
    for (const payUrl of ['https://invoice.stripe.com/i/1', 'https://in.xero.com/abc']) {
      expect(buildHowToPay({ channel: 'xero', payUrl, invoice: INVOICE, bankDetails: BANK }))
        .toBeNull()
    }
  })

  it('returns null on the Stripe rail, link or no link', () => {
    expect(buildHowToPay({ channel: 'stripe', payUrl: null, invoice: INVOICE, bankDetails: BANK }))
      .toBeNull()
  })

  it('returns null once the bill is settled, however it was settled', () => {
    // The failure this closes: the client bank-transfers INV-1042, Liam marks
    // it paid here, and because the invoice was never approved inside Xero it
    // still has no OnlineInvoiceUrl. Both portal projections return every
    // non-draft invoice, so the settled row would go on telling the client the
    // account number, the reference and the amount under "How to pay".
    for (const status of SETTLED_INVOICE_STATUSES) {
      expect(buildHowToPay({
        channel: 'xero',
        payUrl: null,
        invoice: { ...INVOICE, status },
        bankDetails: BANK,
      })).toBeNull()
    }
  })

  it('returns null on a paidAt with no matching status, because either means paid', () => {
    // A Stripe webhook stamps paidAt before anything rewrites the status.
    expect(buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: { ...INVOICE, status: 'sent', paidAt: '2026-09-20T02:00:00.000Z' },
      bankDetails: BANK,
    })).toBeNull()
  })

  it('still names the reference and the amount when the studio has published no bank details', () => {
    // A half-built settings page must not cost the client the one thing they
    // can always act on: the right reference for the right amount.
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: INVOICE,
      bankDetails: {},
    })!

    expect(block.reference).toBe('INV-1042')
    expect(block.amount).toBe(4312.5)
    expect(block.currency).toBe('NZD')
    expect(block).not.toHaveProperty('accountNumber')
    expect(block.hint).toBe(DEFAULT_REFERENCE_HINT)
  })

  it('makes the REFERENCE the real invoice number when the row has one', () => {
    // The reference is the string the client types into their bank, so it has
    // to be the same string Xero calls the bill and the same one their emailed
    // copy prints. A UUID fragment reconciles against nothing.
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: { ...INVOICE, number: 'INV-2026-0042' },
      bankDetails: BANK,
    })!
    expect(block.reference).toBe('INV-2026-0042')
  })

  it('falls back to the short id for a row raised before invoice numbers existed', () => {
    for (const number of [null, undefined, '   ']) {
      const block = buildHowToPay({
        channel: 'xero',
        payUrl: null,
        invoice: { ...INVOICE, number },
        bankDetails: BANK,
      })!
      expect(block.reference).toBe('INV-1042')
    }
  })

  it('falls back to the default hint rather than omitting it', () => {
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: INVOICE,
      bankDetails: { ...BANK, referenceHint: '   ' },
    })!
    expect(block.hint).toBe(DEFAULT_REFERENCE_HINT)
  })

  it('defaults a null currency to NZD rather than printing nothing', () => {
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: { ...INVOICE, currency: null },
      bankDetails: BANK,
    })!
    expect(block.currency).toBe('NZD')
  })
})

describe('isInvoiceSettled', () => {
  it('names the three states that owe nothing, whatever their case', () => {
    expect(isInvoiceSettled({ status: 'paid' })).toBe(true)
    expect(isInvoiceSettled({ status: 'written_off' })).toBe(true)
    expect(isInvoiceSettled({ status: 'cancelled' })).toBe(true)
    // Imports do not agree on case, and a mismatch here is a settled bill
    // still asking to be paid.
    expect(isInvoiceSettled({ status: ' PAID ' })).toBe(true)
  })

  it('leaves every state that still owes money alone', () => {
    for (const status of ['draft', 'sent', 'viewed', 'overdue', '', undefined, null]) {
      expect(isInvoiceSettled({ status })).toBe(false)
    }
  })

  it('counts a paidAt on its own, and ignores an empty one', () => {
    expect(isInvoiceSettled({ status: 'sent', paidAt: '2026-09-20T02:00:00.000Z' })).toBe(true)
    expect(isInvoiceSettled({ status: 'sent', paidAt: '   ' })).toBe(false)
    expect(isInvoiceSettled({ status: 'sent', paidAt: null })).toBe(false)
  })
})

describe('hasBankDestination', () => {
  it('is false when the block names nowhere to send the money', () => {
    // The portal can say "we will be in touch"; an email cannot print a
    // "How to pay" heading over an empty card.
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: INVOICE,
      bankDetails: {},
    })
    expect(hasBankDestination(block)).toBe(false)
    expect(hasBankDestination(null)).toBe(false)
  })

  it('is true as soon as any destination field is published', () => {
    const block = buildHowToPay({
      channel: 'xero',
      payUrl: null,
      invoice: INVOICE,
      bankDetails: { accountNumber: '01-0242-0198765-00' },
    })
    expect(hasBankDestination(block)).toBe(true)
  })
})

describe('readInvoicePayContext', () => {
  it('reads the rail, the bank details and who sends out of the settings rows', () => {
    const ctx = readInvoicePayContext(
      [
        { key: INVOICE_CHANNEL_SETTING_KEY, value: 'stripe' },
        { key: BANK_DETAILS_SETTING_KEY, value: JSON.stringify(BANK) },
        { key: XERO_EMAIL_MODE_SETTING_KEY, value: 'both' },
      ],
      'xero',
    )

    // The client's own rail wins over the studio default.
    expect(ctx.channel).toBe('xero')
    expect(ctx.bankDetails.accountNumber).toBe('01-0242-0198765-00')
    expect(ctx.xeroEmailMode).toBe('both')
  })

  it('falls back to the studio default when the client names no rail', () => {
    const ctx = readInvoicePayContext(
      [{ key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero' }],
      null,
    )
    expect(ctx.channel).toBe('xero')
  })

  it('lands on Stripe, empty details and our own email when nothing is stored', () => {
    const ctx = readInvoicePayContext([], null)
    expect(ctx.channel).toBe('stripe')
    expect(ctx.bankDetails).toEqual({})
    expect(ctx.xeroEmailMode).toBe('dashboard')
  })

  it('does not let a malformed stored value escape as a rail, a mode or a bank blob', () => {
    // `settings` is untyped TEXT: a hand-edited row must degrade, never leak.
    const ctx = readInvoicePayContext(
      [
        { key: INVOICE_CHANNEL_SETTING_KEY, value: 'xero_bank' },
        { key: BANK_DETAILS_SETTING_KEY, value: 'not json' },
        { key: XERO_EMAIL_MODE_SETTING_KEY, value: 'carrier pigeon' },
      ],
      'also not a rail',
    )
    expect(ctx.channel).toBe('stripe')
    expect(ctx.bankDetails).toEqual({})
    expect(ctx.xeroEmailMode).toBe('dashboard')
  })
})

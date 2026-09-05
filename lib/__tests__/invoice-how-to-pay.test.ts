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
 * The four rules that matter:
 *
 *   1. A link beats a transfer, whichever rail issued it. resolveInvoicePayUrl
 *      prefers Stripe's hosted page and falls back to Xero's online invoice,
 *      and buildHowToPay refuses to build a block when either exists.
 *   2. Only the Xero rail gets a block. A Stripe client always ends up with a
 *      hosted page, and a bank transfer against a Stripe invoice reconciles
 *      against nothing.
 *   3. The reference, the amount and the currency always exist, because they
 *      come off the invoice rather than off a setting. There is no state in
 *      which the client cannot quote the right reference for the right amount.
 *   4. Nothing studio-side is in the block. No rail label, no Xero id, no
 *      reconciliation state (Liam, 2026-09-06: "the client sees only what they
 *      need to act").
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_REFERENCE_HINT,
  buildHowToPay,
  hasBankDestination,
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
  totalUsd: 4312.5,
  currency: 'NZD',
  dueDate: '2026-09-30',
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

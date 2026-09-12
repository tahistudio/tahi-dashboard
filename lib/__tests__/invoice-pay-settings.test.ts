/**
 * lib/invoice-pay-settings.ts: the four pay-path settings and their door.
 *
 * `settings` is an untyped key/value table of TEXT, so the shape of these
 * values is enforced here or nowhere. What that buys, concretely:
 *
 *   bankDetails            a malformed blob would otherwise only be discovered
 *                          as an empty "How to pay" block on a live client
 *                          invoice, with no error anywhere.
 *   bankDetailsByCurrency  the same, plus two of its own: a currency code the
 *                          studio does not invoice in would save and never
 *                          resolve, and an account with neither an account
 *                          number nor an IBAN would put a "How to pay" heading
 *                          over nowhere to send the money.
 *   xeroPaymentAccountCode a mistyped code does not fail loudly. It posts real
 *                          payments against the wrong Xero account, and those
 *                          have to be found and reversed by hand.
 *   xeroEmailMode          a value outside the vocabulary silently resolves
 *                          back to the default, so nobody can tell the setting
 *                          did not take.
 *
 * An empty value is the CLEAR on all three and is always allowed: GET
 * synthesises the default for the mode, and the other two are legitimately
 * absent (no bank details published, no push-back to Xero wanted).
 */
import { describe, it, expect } from 'vitest'

import {
  BANK_ACCOUNT_FIELD_LABELS,
  BANK_DETAILS_BY_CURRENCY_SETTING_KEY,
  BANK_DETAILS_SETTING_KEY,
  CURRENCY_ACCOUNT_FIELDS,
  DEFAULT_XERO_EMAIL_MODE,
  INVOICE_CURRENCIES,
  INVOICE_PAY_SETTING_KEYS,
  XERO_EMAIL_MODES,
  XERO_EMAIL_MODE_SETTING_KEY,
  XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY,
  isXeroEmailMode,
  parseBankDetails,
  parseBankDetailsByCurrency,
  resolveXeroEmailMode,
  resolveXeroPaymentAccountCode,
  validateBankDetails,
  validateBankDetailsByCurrency,
  validateInvoicePaySetting,
  validateXeroEmailMode,
  validateXeroPaymentAccountCode,
} from '@/lib/invoice-pay-settings'

describe('the keys themselves', () => {
  it('names all four under the invoicing namespace', () => {
    expect(INVOICE_PAY_SETTING_KEYS).toEqual([
      'invoicing.bankDetails',
      'invoicing.bankDetailsByCurrency',
      'invoicing.xeroPaymentAccountCode',
      'invoicing.xeroEmailMode',
    ])
  })
})

describe('invoicing.xeroEmailMode', () => {
  it('defaults to our own email, the one the studio controls', () => {
    // It is the only one that can carry a portal deep link, and it matches
    // every other message the client gets.
    expect(DEFAULT_XERO_EMAIL_MODE).toBe('dashboard')
    expect(resolveXeroEmailMode(undefined)).toBe('dashboard')
    expect(resolveXeroEmailMode('')).toBe('dashboard')
    expect(resolveXeroEmailMode('carrier pigeon')).toBe('dashboard')
  })

  it('reads a stored mode back', () => {
    expect(resolveXeroEmailMode('xero')).toBe('xero')
    expect(resolveXeroEmailMode('both')).toBe('both')
  })

  it('knows its own vocabulary', () => {
    for (const mode of XERO_EMAIL_MODES) expect(isXeroEmailMode(mode.value)).toBe(true)
    expect(isXeroEmailMode('dashboard_and_xero')).toBe(false)
    expect(isXeroEmailMode(null)).toBe(false)
    expect(isXeroEmailMode(3)).toBe(false)
  })

  it('rejects a value outside the vocabulary and names the alternatives', () => {
    const bad = validateXeroEmailMode('email')
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toContain(XERO_EMAIL_MODE_SETTING_KEY)
      expect(bad.error).toContain('dashboard, xero, both')
    }
  })

  it('lets the clear through', () => {
    expect(validateXeroEmailMode('').ok).toBe(true)
    expect(validateXeroEmailMode(null).ok).toBe(true)
    expect(validateXeroEmailMode(undefined).ok).toBe(true)
  })
})

describe('invoicing.xeroPaymentAccountCode', () => {
  it('accepts a Xero account code', () => {
    expect(validateXeroPaymentAccountCode('090').ok).toBe(true)
    expect(validateXeroPaymentAccountCode('BANK-01').ok).toBe(true)
    expect(validateXeroPaymentAccountCode(' 090 ').ok).toBe(true)
  })

  it('refuses an account NAME pasted into the code box', () => {
    // The failure mode this catches: "ANZ Business Account" stored as a code
    // posts nothing, or worse posts somewhere unexpected, with no error until
    // a human reconciles the month.
    const bad = validateXeroPaymentAccountCode('ANZ Business Account')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain(XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY)

    expect(validateXeroPaymentAccountCode('090/12').ok).toBe(false)
    expect(validateXeroPaymentAccountCode('12345678901').ok).toBe(false)
    expect(validateXeroPaymentAccountCode(90).ok).toBe(false)
  })

  it('lets the clear through, which is how push-back is switched off', () => {
    expect(validateXeroPaymentAccountCode('').ok).toBe(true)
    expect(validateXeroPaymentAccountCode(null).ok).toBe(true)
  })

  it('resolves a stored code, trimmed, or null', () => {
    expect(resolveXeroPaymentAccountCode(' 090 ')).toBe('090')
    expect(resolveXeroPaymentAccountCode('')).toBeNull()
    expect(resolveXeroPaymentAccountCode('   ')).toBeNull()
    expect(resolveXeroPaymentAccountCode(null)).toBeNull()
    expect(resolveXeroPaymentAccountCode(90)).toBeNull()
  })
})

describe('invoicing.bankDetails', () => {
  it('accepts the full blob and any subset of it', () => {
    expect(validateBankDetails(JSON.stringify({
      accountName: 'Tahi Studio Limited',
      accountNumber: '12-3456-7890123-00',
      bankName: 'ANZ',
      referenceHint: 'Use the invoice number as the reference',
    })).ok).toBe(true)

    expect(validateBankDetails(JSON.stringify({ accountName: 'Tahi Studio Limited' })).ok).toBe(true)
    expect(validateBankDetails('{}').ok).toBe(true)
  })

  it('refuses anything that is not a JSON object', () => {
    for (const value of ['not json', '"a string"', '[1,2]', '42', 'null']) {
      expect(validateBankDetails(value).ok).toBe(false)
    }
  })

  it('refuses a field it does not know, which is how a typo is caught', () => {
    const bad = validateBankDetails(JSON.stringify({ accountNmae: 'Tahi Studio Limited' }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error).toContain('accountNmae')
      expect(bad.error).toContain('accountName')
    }
  })

  it('refuses a non-string field', () => {
    const bad = validateBankDetails(JSON.stringify({ accountNumber: 12345678 }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error).toContain('accountNumber')
  })

  it('holds the account number to digits, dashes and spaces', () => {
    expect(validateBankDetails(JSON.stringify({ accountNumber: '12-3456-7890123-00' })).ok).toBe(true)
    expect(validateBankDetails(JSON.stringify({ accountNumber: '1234 5678 9012' })).ok).toBe(true)
    // A letter here is the wrong field pasted in, and this string goes in
    // front of a client about to move money.
    expect(validateBankDetails(JSON.stringify({ accountNumber: 'ANZ 12-3456' })).ok).toBe(false)
    expect(validateBankDetails(JSON.stringify({ accountNumber: 'IBAN GB29 NWBK' })).ok).toBe(false)
    // Empty is not a violation, it is an unfilled field.
    expect(validateBankDetails(JSON.stringify({ accountNumber: '' })).ok).toBe(true)
  })

  it('lets the clear through', () => {
    expect(validateBankDetails('').ok).toBe(true)
    expect(validateBankDetails(null).ok).toBe(true)
  })

  it('reads a stored blob tolerantly, because the reader is client-facing', () => {
    expect(parseBankDetails(JSON.stringify({
      accountName: '  Tahi Studio Limited  ',
      bankName: 'ANZ',
      accountNumber: '',
      unknown: 'dropped',
      referenceHint: 7,
    }))).toEqual({ accountName: 'Tahi Studio Limited', bankName: 'ANZ' })

    // A bad row degrades to an empty block, never to a 500 on a client page.
    expect(parseBankDetails('not json')).toEqual({})
    expect(parseBankDetails('[1,2]')).toEqual({})
    expect(parseBankDetails(null)).toEqual({})
    expect(parseBankDetails('')).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// invoicing.bankDetailsByCurrency
// ---------------------------------------------------------------------------
//
// The studio invoices in five currencies and holds an Airwallex global account
// for each. One shared account quoted a GBP client a New Zealand account
// number, which their bank either returns or converts at its own rate.
//
// Every account below is made up. Nothing in this repo carries the studio's
// real banking, and the numbers here are zeros and sequences on purpose.
describe('invoicing.bankDetailsByCurrency', () => {
  const GBP_ACCOUNT = {
    bankName: 'Example Bank',
    accountName: 'Tahi Studio Ltd',
    location: 'United Kingdom',
    accountNumber: '00000000',
    sortCode: '00-00-00',
    swift: 'AAAAGB0AXXX',
  }

  it('accepts an account for each currency the studio invoices in', () => {
    for (const currency of INVOICE_CURRENCIES) {
      const blob = JSON.stringify({ [currency]: GBP_ACCOUNT })
      expect(validateBankDetailsByCurrency(blob)).toEqual({ ok: true })
    }
  })

  it('refuses a currency the studio does not invoice in', () => {
    // Not a vocabulary check for its own sake: a JPY account would save, would
    // never resolve (the resolver only looks up the five), and would read as
    // configured in settings while every yen invoice quoted the fallback.
    const result = validateBankDetailsByCurrency(JSON.stringify({ JPY: GBP_ACCOUNT }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('does not invoice in "JPY"')
      expect(result.error).toContain('NZD, GBP, USD, AUD, EUR')
    }
  })

  it('refuses an account that names nowhere to send the money, with a sentence', () => {
    // The failure this rule exists for: it saves, it resolves, and the client
    // reads a "How to pay" heading over a bank name with nothing to pay into.
    const result = validateBankDetailsByCurrency(JSON.stringify({
      GBP: { bankName: 'Example Bank', accountName: 'Tahi Studio Ltd', sortCode: '00-00-00' },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(
        'invoicing.bankDetailsByCurrency.GBP needs an account number or an IBAN, otherwise the'
        + ' How to pay block on a GBP invoice names nowhere to send the money.',
      )
    }
  })

  it('takes an IBAN as the destination, because the EUR account has no account number', () => {
    const blob = JSON.stringify({
      EUR: { bankName: 'Example Bank', iban: 'EE00 0000 0000 0000 0000', swift: 'AAAAEE0AXXX' },
    })
    expect(validateBankDetailsByCurrency(blob)).toEqual({ ok: true })
  })

  it('holds the account number and the IBAN to their shapes', () => {
    const badNumber = validateBankDetailsByCurrency(JSON.stringify({
      GBP: { ...GBP_ACCOUNT, accountNumber: 'ask Liam' },
    }))
    expect(badNumber.ok).toBe(false)
    if (!badNumber.ok) expect(badNumber.error).toContain('digits, dashes and spaces')

    const badIban = validateBankDetailsByCurrency(JSON.stringify({
      EUR: { iban: 'EE00-0000-0000' },
    }))
    expect(badIban.ok).toBe(false)
    if (!badIban.ok) expect(badIban.error).toContain('letters, digits and spaces')
  })

  it('refuses a field it does not know, so a typo is not stored as data', () => {
    const result = validateBankDetailsByCurrency(JSON.stringify({
      GBP: { ...GBP_ACCOUNT, sortcode: '00-00-00' },
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('does not know the field "sortcode"')
  })

  it('treats an empty account and an empty value as the clear', () => {
    expect(validateBankDetailsByCurrency(JSON.stringify({ GBP: {} })).ok).toBe(true)
    expect(validateBankDetailsByCurrency('').ok).toBe(true)
    expect(validateBankDetailsByCurrency(null).ok).toBe(true)
  })

  it('refuses a value that is not a JSON object keyed by currency', () => {
    expect(validateBankDetailsByCurrency('not json').ok).toBe(false)
    expect(validateBankDetailsByCurrency('[1,2]').ok).toBe(false)
    expect(validateBankDetailsByCurrency(JSON.stringify({ GBP: 'Example Bank' })).ok).toBe(false)
  })

  it('round trips: what validates is what parses back, trimmed', () => {
    const typed = {
      GBP: { ...GBP_ACCOUNT, accountName: '  Tahi Studio Ltd  ', referenceHint: '' },
      USD: {
        accountName: 'Tahi Studio Ltd',
        location: 'United States',
        accountNumber: '000000000000',
        achRouting: '123456789',
        fedwireRouting: '987654321',
        swift: 'AAAAUS0AXXX',
      },
    }
    const blob = JSON.stringify(typed)
    expect(validateBankDetailsByCurrency(blob)).toEqual({ ok: true })

    const parsed = parseBankDetailsByCurrency(blob)
    expect(parsed.GBP).toEqual({ ...GBP_ACCOUNT, accountName: 'Tahi Studio Ltd' })
    expect(parsed.USD).toEqual(typed.USD)
    // Untouched currencies are absent rather than empty, so the resolver falls
    // through to the default account instead of matching a hollow object.
    expect(parsed.NZD).toBeUndefined()
    expect(parsed.EUR).toBeUndefined()
  })

  it('parses a hand-edited row tolerantly: a bad blob is no accounts, never a throw', () => {
    expect(parseBankDetailsByCurrency('not json')).toEqual({})
    expect(parseBankDetailsByCurrency('[1,2]')).toEqual({})
    expect(parseBankDetailsByCurrency(null)).toEqual({})
    // Unknown currency, unknown field and a non-string all dropped, and the
    // currency left with nothing goes with them.
    expect(parseBankDetailsByCurrency(JSON.stringify({
      JPY: { accountNumber: '1' },
      GBP: { accountNumber: '00000000', sortcode: '00-00-00', swift: 12 },
      USD: {},
    }))).toEqual({ GBP: { accountNumber: '00000000' } })
  })

  it('gives every currency a field set, and never an empty one', () => {
    for (const currency of INVOICE_CURRENCIES) {
      const fields = CURRENCY_ACCOUNT_FIELDS[currency]
      expect(fields.length).toBeGreaterThan(0)
      // Each set has to name somewhere to send the money, or the editor could
      // not produce an account the validator accepts.
      expect(fields.includes('accountNumber') || fields.includes('iban')).toBe(true)
      for (const field of fields) {
        expect(BANK_ACCOUNT_FIELD_LABELS[field]).toBeTruthy()
      }
    }
    // The five shapes, straight off the five Airwallex accounts.
    expect(CURRENCY_ACCOUNT_FIELDS.GBP).toContain('sortCode')
    expect(CURRENCY_ACCOUNT_FIELDS.USD).toContain('achRouting')
    expect(CURRENCY_ACCOUNT_FIELDS.USD).toContain('fedwireRouting')
    expect(CURRENCY_ACCOUNT_FIELDS.AUD).toContain('bsb')
    expect(CURRENCY_ACCOUNT_FIELDS.NZD).toContain('bankCode')
    expect(CURRENCY_ACCOUNT_FIELDS.NZD).toContain('branchCode')
    expect(CURRENCY_ACCOUNT_FIELDS.EUR).toContain('iban')
    expect(CURRENCY_ACCOUNT_FIELDS.EUR).not.toContain('accountNumber')
  })
})

describe('validateInvoicePaySetting', () => {
  it('routes each key to its own validator', () => {
    expect(validateInvoicePaySetting(BANK_DETAILS_SETTING_KEY, 'nope').ok).toBe(false)
    expect(validateInvoicePaySetting(BANK_DETAILS_BY_CURRENCY_SETTING_KEY, 'nope').ok).toBe(false)
    expect(validateInvoicePaySetting(
      BANK_DETAILS_BY_CURRENCY_SETTING_KEY,
      JSON.stringify({ CHF: { accountNumber: '00000000' } }),
    ).ok).toBe(false)
    expect(validateInvoicePaySetting(XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY, 'a b').ok).toBe(false)
    expect(validateInvoicePaySetting(XERO_EMAIL_MODE_SETTING_KEY, 'post').ok).toBe(false)
  })

  it('waves through every key it does not own, so the route can call it always', () => {
    expect(validateInvoicePaySetting('invoicing.prefix', 'anything at all').ok).toBe(true)
    expect(validateInvoicePaySetting('branding.logoUrl', '{{{').ok).toBe(true)
  })
})

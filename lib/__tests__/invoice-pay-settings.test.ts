/**
 * lib/invoice-pay-settings.ts: the three pay-path settings and their door.
 *
 * `settings` is an untyped key/value table of TEXT, so the shape of these
 * values is enforced here or nowhere. What that buys, concretely:
 *
 *   bankDetails            a malformed blob would otherwise only be discovered
 *                          as an empty "How to pay" block on a live client
 *                          invoice, with no error anywhere.
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
  BANK_DETAILS_SETTING_KEY,
  DEFAULT_XERO_EMAIL_MODE,
  INVOICE_PAY_SETTING_KEYS,
  XERO_EMAIL_MODES,
  XERO_EMAIL_MODE_SETTING_KEY,
  XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY,
  isXeroEmailMode,
  parseBankDetails,
  resolveXeroEmailMode,
  resolveXeroPaymentAccountCode,
  validateBankDetails,
  validateInvoicePaySetting,
  validateXeroEmailMode,
  validateXeroPaymentAccountCode,
} from '@/lib/invoice-pay-settings'

describe('the keys themselves', () => {
  it('names all three under the invoicing namespace', () => {
    expect(INVOICE_PAY_SETTING_KEYS).toEqual([
      'invoicing.bankDetails',
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

describe('validateInvoicePaySetting', () => {
  it('routes each key to its own validator', () => {
    expect(validateInvoicePaySetting(BANK_DETAILS_SETTING_KEY, 'nope').ok).toBe(false)
    expect(validateInvoicePaySetting(XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY, 'a b').ok).toBe(false)
    expect(validateInvoicePaySetting(XERO_EMAIL_MODE_SETTING_KEY, 'post').ok).toBe(false)
  })

  it('waves through every key it does not own, so the route can call it always', () => {
    expect(validateInvoicePaySetting('invoicing.prefix', 'anything at all').ok).toBe(true)
    expect(validateInvoicePaySetting('branding.logoUrl', '{{{').ok).toBe(true)
  })
})

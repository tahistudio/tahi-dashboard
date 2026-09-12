/**
 * lib/invoice-pay-settings.ts
 *
 * The three studio settings the pay path needs, their shapes, and the one
 * validator the settings route runs before storing any of them.
 *
 *   invoicing.bankDetails              JSON. What a client is told to pay INTO
 *                                      when there is no pay-now link (a Xero
 *                                      invoice waiting on approval, an org
 *                                      with online invoicing switched off).
 *                                      ONE account, kept as the fallback.
 *   invoicing.bankDetailsByCurrency    JSON. The same, but one account per
 *                                      currency, because the studio holds an
 *                                      Airwallex global account per currency
 *                                      and each has its own field shape. This
 *                                      is what a client's invoice quotes when
 *                                      their currency has an entry.
 *   invoicing.xeroPaymentAccountCode   The Xero bank account code a hand
 *                                      mark-paid records the payment against.
 *                                      Unset means push-back to Xero is
 *                                      skipped rather than guessed: posting a
 *                                      payment to the wrong account is a
 *                                      reconciliation mess to unpick by hand.
 *   invoicing.xeroEmailMode            Who emails a Xero-rail invoice: our
 *                                      template, Xero's, or both.
 *
 * `settings` is a key/value table of TEXT, so everything here is a string on
 * the way in and out and the shape has to be enforced at the door. It is
 * enforced at the door precisely because there is no schema behind it: a
 * malformed bankDetails blob would only be discovered by the client-facing
 * "How to pay" block failing to render, on a live invoice.
 *
 * Pure: no D1 handle, no fetch. Both the API route and (next slice) the
 * settings UI read the same vocabulary, and CLAUDE.md forbids exporting a
 * non-route symbol from a route.ts, so it has to live here.
 *
 * This slice OWNS the keys and their validation, and nothing else. There is no
 * settings UI, no portal change and no email change here; the slice that
 * builds the "How to pay" block and the Xero-rail email owns those.
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** JSON bank details shown to a client who has to pay by transfer. */
export const BANK_DETAILS_SETTING_KEY = 'invoicing.bankDetails'

/** Xero bank account code a dashboard mark-paid records the payment against. */
export const XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY = 'invoicing.xeroPaymentAccountCode'

/** Who sends the email for a Xero-rail invoice. */
export const XERO_EMAIL_MODE_SETTING_KEY = 'invoicing.xeroEmailMode'

// ---------------------------------------------------------------------------
// invoicing.xeroEmailMode
// ---------------------------------------------------------------------------

/**
 * The three ways a Xero-rail invoice can reach the client, in the order they
 * are offered.
 *
 *   dashboard  our own template, with the portal link and the pay link we
 *              captured. The default: it is the email the studio controls, it
 *              matches every other message the client gets, and it is the only
 *              one that can carry a portal deep link.
 *   xero       let Xero send its own PDF and stay out of the way.
 *   both       both, for a client who wants the formal Xero copy on file.
 */
export const XERO_EMAIL_MODES = [
  { value: 'dashboard', label: 'Our email only' },
  { value: 'xero', label: 'Xero sends it' },
  { value: 'both', label: 'Both' },
] as const

export type XeroEmailMode = (typeof XERO_EMAIL_MODES)[number]['value']

/** What a Xero-rail invoice does when nobody has said otherwise. */
export const DEFAULT_XERO_EMAIL_MODE: XeroEmailMode = 'dashboard'

export function isXeroEmailMode(value: unknown): value is XeroEmailMode {
  return typeof value === 'string' && XERO_EMAIL_MODES.some(m => m.value === value)
}

/** The stored value read as a mode, falling back to the default. */
export function resolveXeroEmailMode(stored: unknown): XeroEmailMode {
  return isXeroEmailMode(stored) ? stored : DEFAULT_XERO_EMAIL_MODE
}

// ---------------------------------------------------------------------------
// invoicing.bankDetails
// ---------------------------------------------------------------------------

/**
 * What a client needs in order to pay by transfer. Every field is optional,
 * because a half-filled block is still more use than none and the studio may
 * legitimately have only some of it (a UK client sees a sort code, an NZ one
 * sees a 16-digit account number).
 *
 * `referenceHint` is the sentence that tells the client what to put in the
 * transfer reference, e.g. "Use the invoice number as the reference".
 */
export interface InvoiceBankDetails {
  accountName?: string
  accountNumber?: string
  bankName?: string
  referenceHint?: string
}

/** The only fields the blob may carry. Anything else is a typo, not data. */
export const BANK_DETAIL_FIELDS = ['accountName', 'accountNumber', 'bankName', 'referenceHint'] as const

/**
 * An account number is digits, dashes and spaces. Deliberately loose about
 * grouping (NZ writes 12-3456-7890123-00, the UK writes 12345678 with a
 * separate sort code) and deliberately strict about everything else: a letter
 * in here is a paste of the wrong field, and this string is going in front of
 * a client about to move money.
 */
const ACCOUNT_NUMBER_SHAPE = /^[0-9\- ]+$/

/** The result of validating one setting value. */
export type SettingValidation =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Read a stored bankDetails blob, tolerantly. Anything unparseable, or not an
 * object, reads as "no bank details" rather than throwing: the surface that
 * renders this is client-facing and a bad row must degrade to an empty block,
 * not a 500. Unknown keys are dropped and non-string values ignored.
 */
export function parseBankDetails(stored: string | null | undefined): InvoiceBankDetails {
  if (typeof stored !== 'string' || stored.trim() === '') return {}
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const source = raw as Record<string, unknown>
  const out: InvoiceBankDetails = {}
  for (const field of BANK_DETAIL_FIELDS) {
    const value = source[field]
    if (typeof value === 'string' && value.trim() !== '') out[field] = value.trim()
  }
  return out
}

/**
 * Validate a bankDetails value on its way IN. Strict where parseBankDetails is
 * tolerant, because this is the moment a mistake can still be reported to the
 * person making it.
 *
 * Accepts: a JSON object string with any subset of the four fields, each a
 * string; and the empty value, which is the clear.
 */
export function validateBankDetails(value: unknown): SettingValidation {
  if (value == null || value === '') return { ok: true }
  if (typeof value !== 'string') {
    return { ok: false, error: `${BANK_DETAILS_SETTING_KEY} must be a JSON string.` }
  }

  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return { ok: false, error: `${BANK_DETAILS_SETTING_KEY} must be valid JSON.` }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: `${BANK_DETAILS_SETTING_KEY} must be a JSON object with any of ${BANK_DETAIL_FIELDS.join(', ')}.`,
    }
  }

  const source = raw as Record<string, unknown>

  for (const key of Object.keys(source)) {
    if (!(BANK_DETAIL_FIELDS as readonly string[]).includes(key)) {
      return {
        ok: false,
        error: `${BANK_DETAILS_SETTING_KEY} does not know the field "${key}". Allowed fields: ${BANK_DETAIL_FIELDS.join(', ')}.`,
      }
    }
  }

  for (const field of BANK_DETAIL_FIELDS) {
    const fieldValue = source[field]
    if (fieldValue === undefined || fieldValue === null) continue
    if (typeof fieldValue !== 'string') {
      return { ok: false, error: `${BANK_DETAILS_SETTING_KEY}.${field} must be a string.` }
    }
  }

  const accountNumber = typeof source.accountNumber === 'string' ? source.accountNumber.trim() : ''
  if (accountNumber !== '' && !ACCOUNT_NUMBER_SHAPE.test(accountNumber)) {
    return {
      ok: false,
      error: `${BANK_DETAILS_SETTING_KEY}.accountNumber may only contain digits, dashes and spaces.`,
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// invoicing.xeroPaymentAccountCode
// ---------------------------------------------------------------------------

/**
 * Xero account codes are short alphanumeric strings, up to 10 characters, and
 * a code with a space or a slash in it is a name that has been pasted into the
 * wrong box. Getting this wrong does not fail loudly; it posts real payments
 * against the wrong account.
 */
const ACCOUNT_CODE_SHAPE = /^[A-Za-z0-9-]{1,10}$/

export function validateXeroPaymentAccountCode(value: unknown): SettingValidation {
  if (value == null || value === '') return { ok: true }
  if (typeof value !== 'string' || !ACCOUNT_CODE_SHAPE.test(value.trim())) {
    return {
      ok: false,
      error: `${XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY} must be a Xero account code: up to 10 letters, digits or dashes, e.g. "090". Leave it empty to stop the dashboard pushing payments to Xero.`,
    }
  }
  return { ok: true }
}

/** The stored code, trimmed, or null when there is nothing usable. */
export function resolveXeroPaymentAccountCode(stored: unknown): string | null {
  if (typeof stored !== 'string') return null
  const trimmed = stored.trim()
  return trimmed === '' ? null : trimmed
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

export function validateXeroEmailMode(value: unknown): SettingValidation {
  if (value == null || value === '') return { ok: true }
  if (!isXeroEmailMode(value)) {
    return {
      ok: false,
      error: `${XERO_EMAIL_MODE_SETTING_KEY} must be one of ${XERO_EMAIL_MODES.map(m => m.value).join(', ')}, or empty to fall back to ${DEFAULT_XERO_EMAIL_MODE}.`,
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// invoicing.bankDetailsByCurrency
// ---------------------------------------------------------------------------

/**
 * One account per currency, because the studio holds one per currency.
 *
 * invoicing.bankDetails above is ONE account. It was written when the studio
 * banked in one place, and it quotes that one account under every invoice, so
 * a GBP client reading a GBP bill is told to send pounds to a New Zealand
 * account number. The bank either refuses it or converts it at their own rate
 * and takes the spread, and either way the studio chases a payment that never
 * arrives in the currency it billed.
 *
 * The studio holds an Airwallex global account per currency, and each has a
 * different field shape: New Zealand wants a bank code and a branch code, the
 * United Kingdom a sort code, the United States an ACH routing number AND a
 * Fedwire one (they differ, and paying into the wrong rail is a returned
 * payment), Australia a BSB, the euro account an IBAN and no account number at
 * all. So this is not "the same four boxes, five times": the shape is per
 * currency, and CURRENCY_ACCOUNT_FIELDS below names it.
 *
 * The legacy key stays readable as the fallback rather than being migrated
 * away: it holds a real account that is still correct for the currency it was
 * entered in, and a client whose currency has no entry yet is better served by
 * that account than by a blank block.
 */
export const BANK_DETAILS_BY_CURRENCY_SETTING_KEY = 'invoicing.bankDetailsByCurrency'

/** The five currencies the studio invoices in, and the only keys the map may carry. */
export const INVOICE_CURRENCIES = ['NZD', 'GBP', 'USD', 'AUD', 'EUR'] as const

export type InvoiceCurrency = (typeof INVOICE_CURRENCIES)[number]

export function isInvoiceCurrency(value: unknown): value is InvoiceCurrency {
  return typeof value === 'string' && (INVOICE_CURRENCIES as readonly string[]).includes(value)
}

/**
 * One bank account, in the widest shape any of the five needs.
 *
 * Extends the legacy single-account shape rather than replacing it, so the old
 * stored value IS a valid account and bankDetailsForCurrency can hand either
 * back without a conversion step in between.
 *
 * `location` is the country the account is held in ("United Kingdom"), which
 * is what an international transfer form asks for by name.
 */
export interface InvoiceBankAccount extends InvoiceBankDetails {
  location?: string
  sortCode?: string
  swift?: string
  achRouting?: string
  fedwireRouting?: string
  bsb?: string
  bankCode?: string
  branchCode?: string
  iban?: string
}

/** The only fields an account may carry. Anything else is a typo, not data. */
export const BANK_ACCOUNT_FIELDS = [
  'bankName',
  'accountName',
  'location',
  'accountNumber',
  'iban',
  'sortCode',
  'bsb',
  'bankCode',
  'branchCode',
  'achRouting',
  'fedwireRouting',
  'swift',
  'referenceHint',
] as const

export type BankAccountField = (typeof BANK_ACCOUNT_FIELDS)[number]

/**
 * What each field is CALLED, everywhere it is shown.
 *
 * One map, read by the settings editor and by the client-facing block, so the
 * box Liam types a sort code into is the row the client reads "Sort code" on.
 * These are the bookkeeper's words rather than ours, and "SWIFT/BIC" carries
 * both names because banks are split on which one they ask for.
 */
export const BANK_ACCOUNT_FIELD_LABELS: Record<BankAccountField, string> = {
  bankName: 'Bank',
  accountName: 'Account name',
  location: 'Bank location',
  accountNumber: 'Account number',
  iban: 'IBAN',
  sortCode: 'Sort code',
  bsb: 'BSB',
  bankCode: 'Bank code',
  branchCode: 'Branch code',
  achRouting: 'ACH routing',
  fedwireRouting: 'Fedwire routing',
  swift: 'SWIFT/BIC',
  referenceHint: 'Reference hint',
}

/** Shown in a monospace row: identifiers a client copies digit for digit. */
export const BANK_ACCOUNT_MONO_FIELDS: readonly BankAccountField[] = [
  'accountNumber',
  'iban',
  'sortCode',
  'bsb',
  'bankCode',
  'branchCode',
  'achRouting',
  'fedwireRouting',
  'swift',
]

/** On every account, whichever currency it is: who is being paid, and where. */
const COMMON_ACCOUNT_FIELDS: readonly BankAccountField[] = ['bankName', 'accountName', 'location']

/**
 * The identifier fields each currency's account actually has, in the order a
 * transfer form asks for them.
 *
 * Straight off the five Airwallex global accounts. A field that is not here is
 * not a field that account has: offering a sort code box under the USD account
 * invites a number that means nothing on that rail.
 */
export const CURRENCY_ACCOUNT_FIELDS: Record<InvoiceCurrency, readonly BankAccountField[]> = {
  NZD: [...COMMON_ACCOUNT_FIELDS, 'accountNumber', 'bankCode', 'branchCode', 'referenceHint'],
  GBP: [...COMMON_ACCOUNT_FIELDS, 'accountNumber', 'sortCode', 'swift', 'referenceHint'],
  USD: [...COMMON_ACCOUNT_FIELDS, 'accountNumber', 'achRouting', 'fedwireRouting', 'swift', 'referenceHint'],
  AUD: [...COMMON_ACCOUNT_FIELDS, 'accountNumber', 'bsb', 'referenceHint'],
  EUR: [...COMMON_ACCOUNT_FIELDS, 'iban', 'swift', 'referenceHint'],
}

/** currency code -> the account the studio is paid into in that currency. */
export type InvoiceBankAccountsByCurrency = Partial<Record<InvoiceCurrency, InvoiceBankAccount>>

/**
 * Read a stored per-currency blob, tolerantly, for the reason parseBankDetails
 * is tolerant: the surface this feeds is client-facing, and a hand-edited row
 * has to degrade to an empty block rather than a 500.
 *
 * Unknown currencies are dropped, unknown fields are dropped, non-strings and
 * blanks are ignored, and a currency whose account comes out empty is dropped
 * with it, so bankDetailsForCurrency falls through to the legacy account
 * rather than returning an object with nothing in it.
 */
export function parseBankDetailsByCurrency(
  stored: string | null | undefined,
): InvoiceBankAccountsByCurrency {
  if (typeof stored !== 'string' || stored.trim() === '') return {}
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  const source = raw as Record<string, unknown>
  const out: InvoiceBankAccountsByCurrency = {}

  for (const currency of INVOICE_CURRENCIES) {
    const entry = source[currency]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const fields = entry as Record<string, unknown>
    const account: InvoiceBankAccount = {}
    for (const field of BANK_ACCOUNT_FIELDS) {
      const value = fields[field]
      if (typeof value === 'string' && value.trim() !== '') account[field] = value.trim()
    }
    if (Object.keys(account).length > 0) out[currency] = account
  }

  return out
}

/**
 * An IBAN is letters, digits and the spaces people group them with. Checked
 * for the reason the account number is: this string goes in front of a client
 * about to move money, and a punctuation mark in it is a paste of something
 * else.
 */
const IBAN_SHAPE = /^[A-Za-z0-9 ]+$/

/**
 * Validate a per-currency blob on its way IN. Strict where
 * parseBankDetailsByCurrency is tolerant, because this is the moment a mistake
 * can still be reported to the person making it.
 *
 * The rule worth naming out loud: an account with neither an account number
 * nor an IBAN names nowhere to send the money. It would save, it would
 * resolve, and the client would read a "How to pay" heading over a bank name
 * and nothing to pay into, which is worse than no block at all.
 */
export function validateBankDetailsByCurrency(value: unknown): SettingValidation {
  if (value == null || value === '') return { ok: true }
  if (typeof value !== 'string') {
    return { ok: false, error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY} must be a JSON string.` }
  }

  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return { ok: false, error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY} must be valid JSON.` }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY} must be a JSON object keyed by currency code: ${INVOICE_CURRENCIES.join(', ')}.`,
    }
  }

  const source = raw as Record<string, unknown>

  for (const currency of Object.keys(source)) {
    if (!isInvoiceCurrency(currency)) {
      return {
        ok: false,
        error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY} does not invoice in "${currency}". Allowed currencies: ${INVOICE_CURRENCIES.join(', ')}.`,
      }
    }

    const entry = source[currency]
    if (entry == null) continue
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      return {
        ok: false,
        error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY}.${currency} must be a JSON object with any of ${BANK_ACCOUNT_FIELDS.join(', ')}.`,
      }
    }

    const fields = entry as Record<string, unknown>

    for (const field of Object.keys(fields)) {
      if (!(BANK_ACCOUNT_FIELDS as readonly string[]).includes(field)) {
        return {
          ok: false,
          error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY}.${currency} does not know the field "${field}". Allowed fields: ${BANK_ACCOUNT_FIELDS.join(', ')}.`,
        }
      }
    }

    const trimmed: Record<string, string> = {}
    for (const field of BANK_ACCOUNT_FIELDS) {
      const fieldValue = fields[field]
      if (fieldValue === undefined || fieldValue === null) continue
      if (typeof fieldValue !== 'string') {
        return {
          ok: false,
          error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY}.${currency}.${field} must be a string.`,
        }
      }
      if (fieldValue.trim() !== '') trimmed[field] = fieldValue.trim()
    }

    // Nothing filled in is the clear for that currency, and falls back to the
    // legacy account like any currency that was never entered at all.
    if (Object.keys(trimmed).length === 0) continue

    const accountNumber = trimmed.accountNumber ?? ''
    const iban = trimmed.iban ?? ''

    if (accountNumber === '' && iban === '') {
      return {
        ok: false,
        error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY}.${currency} needs an account number or an IBAN, otherwise the How to pay block on a ${currency} invoice names nowhere to send the money.`,
      }
    }

    if (accountNumber !== '' && !ACCOUNT_NUMBER_SHAPE.test(accountNumber)) {
      return {
        ok: false,
        error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY}.${currency}.accountNumber may only contain digits, dashes and spaces.`,
      }
    }

    if (iban !== '' && !IBAN_SHAPE.test(iban)) {
      return {
        ok: false,
        error: `${BANK_DETAILS_BY_CURRENCY_SETTING_KEY}.${currency}.iban may only contain letters, digits and spaces.`,
      }
    }
  }

  return { ok: true }
}

/** Every key this module validates, for the route and for the tests. */
export const INVOICE_PAY_SETTING_KEYS = [
  BANK_DETAILS_SETTING_KEY,
  BANK_DETAILS_BY_CURRENCY_SETTING_KEY,
  XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY,
  XERO_EMAIL_MODE_SETTING_KEY,
] as const

/**
 * Validate one settings write. Returns ok for any key this module does not
 * own, so the route can call it unconditionally.
 *
 * An empty value is always the clear and is always allowed: GET synthesises
 * the default for xeroEmailMode, and the other two are legitimately absent
 * (no bank details published, no Xero push-back wanted).
 */
export function validateInvoicePaySetting(key: string, value: unknown): SettingValidation {
  switch (key) {
    case BANK_DETAILS_SETTING_KEY:
      return validateBankDetails(value)
    case BANK_DETAILS_BY_CURRENCY_SETTING_KEY:
      return validateBankDetailsByCurrency(value)
    case XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY:
      return validateXeroPaymentAccountCode(value)
    case XERO_EMAIL_MODE_SETTING_KEY:
      return validateXeroEmailMode(value)
    default:
      return { ok: true }
  }
}

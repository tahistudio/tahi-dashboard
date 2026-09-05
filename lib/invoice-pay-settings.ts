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

/** Every key this module validates, for the route and for the tests. */
export const INVOICE_PAY_SETTING_KEYS = [
  BANK_DETAILS_SETTING_KEY,
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
    case XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY:
      return validateXeroPaymentAccountCode(value)
    case XERO_EMAIL_MODE_SETTING_KEY:
      return validateXeroEmailMode(value)
    default:
      return { ok: true }
  }
}

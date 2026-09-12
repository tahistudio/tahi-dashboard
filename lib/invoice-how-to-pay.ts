/**
 * lib/invoice-how-to-pay.ts
 *
 * What a client is told when there is nothing to click.
 *
 * A Stripe-rail invoice always ends in a hosted pay page, so the client's job
 * is one button. A Xero-rail invoice does not: the push route holds every
 * dashboard-raised invoice at DRAFT on purpose (Liam, 2026-09-06), and Xero
 * only issues an OnlineInvoiceUrl once the bill is approved by hand. Between
 * those two moments the client has a real bill, a real due date and NOTHING to
 * act on, which is the gap this module closes: bank details from the studio
 * settings, the invoice reference to quote, the amount and the date.
 *
 * Founder decision (2026-09-06): "the client sees only what they need to act:
 * for a Xero invoice, a How to pay block (amount, due date, invoice number as
 * reference, and the pay-now link when present). No internal channel label."
 * So nothing here carries the rail, the Xero id or any other studio-side fact.
 *
 * Pure, and shared by three callers that must agree word for word: the portal
 * list projection, the portal detail projection and the invoice email. A block
 * that differs between the portal and the email is a client reading two
 * different account numbers for the same bill.
 *
 * WHICH account is a question with one answer, in bankDetailsForCurrency
 * below: the studio holds an Airwallex global account per currency, so a GBP
 * invoice quotes the GBP account and falls back to the legacy single account
 * only when that currency has not been filled in. The invoice's own currency
 * decides it, never the studio's default billing currency.
 */

import {
  BANK_ACCOUNT_FIELDS,
  BANK_ACCOUNT_FIELD_LABELS,
  BANK_ACCOUNT_MONO_FIELDS,
  BANK_DETAILS_BY_CURRENCY_SETTING_KEY,
  BANK_DETAILS_SETTING_KEY,
  DEFAULT_XERO_EMAIL_MODE,
  XERO_EMAIL_MODE_SETTING_KEY,
  isInvoiceCurrency,
  parseBankDetails,
  parseBankDetailsByCurrency,
  resolveXeroEmailMode,
  type BankAccountField,
  type InvoiceBankAccount,
  type InvoiceBankAccountsByCurrency,
  type InvoiceBankDetails,
  type XeroEmailMode,
} from '@/lib/invoice-pay-settings'
import {
  INVOICE_CHANNEL_SETTING_KEY,
  resolveInvoiceChannel,
  type InvoiceChannel,
} from '@/lib/invoice-channel'
import { invoiceReference } from '@/lib/invoice-billing'
import {
  PAID_STATUSES,
  VOID_STATUSES,
  isPaidInvoice,
  isVoidInvoice,
  normaliseInvoiceStatus,
} from '@/lib/invoice-status'

/**
 * The client-facing "How to pay" block.
 *
 * Every bank field is optional because a half-filled block still beats none
 * (and the studio may legitimately publish only some of it), but `reference`,
 * `amount` and `currency` always exist: they come off the invoice, not off a
 * setting, so there is no state in which the client cannot at least quote the
 * right reference for the right amount.
 *
 * `hint` is the sentence telling the client what to put in the transfer
 * reference. It falls back to a default rather than being omitted, because a
 * bank transfer with no reference is the payment the studio then has to chase
 * and match by hand.
 */
export interface InvoiceHowToPay {
  bankName?: string
  accountName?: string
  accountNumber?: string
  /** Country the account is held in, e.g. "United Kingdom". */
  location?: string
  sortCode?: string
  swift?: string
  achRouting?: string
  fedwireRouting?: string
  bsb?: string
  bankCode?: string
  branchCode?: string
  iban?: string
  /** The invoice number the client quotes on the transfer. */
  reference: string
  amount: number
  currency: string
  dueDate: string | null
  hint: string
}

/** What the client is told to reference when the studio has not written its own. */
export const DEFAULT_REFERENCE_HINT =
  'Please use the reference above so we can match your payment to this invoice.'

/** The invoice columns a How to pay block is built from. */
export interface HowToPayInvoice {
  id: string
  /**
   * invoices.number, the real invoice number, when the row carries one. This
   * becomes the bank reference the client quotes, which is the whole reason
   * the number exists: it is the string that has to match on their transfer,
   * on their email and in Xero. NULL or absent falls back to the short id,
   * unchanged from before migration 0096.
   */
  number?: string | null
  /**
   * Required, and required for a reason: the block is a demand for money, so
   * every caller has to say out loud whether this bill is still owed. Making
   * it optional would let a settled invoice through by omission.
   */
  status: string
  totalUsd: number
  currency: string | null
  dueDate: string | null
  paidAt?: string | null
}

/**
 * The invoice states that owe nothing: paid, plus every flavour of dead.
 *
 * Derived from lib/invoice-status.ts rather than hand-listed, so this and the
 * money aggregations share one reading of the column. That module names
 * 'cancelled', 'void', 'voided' and 'refunded' alongside 'written_off' for the
 * same reason this list always named 'cancelled': the codebase does not write
 * them, but a Xero or Stripe import could hand us one, and the cost of naming
 * them is nil against the cost of quoting an account number under a dead bill.
 *
 * Note what is NOT here: 'draft'. A draft owes nothing either, but it never
 * reaches a client surface at all (both portal routes exclude it), and calling
 * it "settled" would let a studio-side caller read a placeholder as paid.
 */
export const SETTLED_INVOICE_STATUSES: readonly string[] = [
  ...PAID_STATUSES,
  ...VOID_STATUSES,
]

/**
 * Is this bill done with?
 *
 * `paidAt` is checked as well as the status because the two are written by
 * different paths (the PATCH route sets both, a Stripe webhook sets paidAt
 * first) and either one on its own means the client owes nothing.
 */
export function isInvoiceSettled(
  invoice: { status?: string | null; paidAt?: string | null },
): boolean {
  const status = normaliseInvoiceStatus(invoice.status)
  if (isPaidInvoice(status) || isVoidInvoice(status)) return true
  return typeof invoice.paidAt === 'string' && invoice.paidAt.trim() !== ''
}

/**
 * The pay-path facts a route needs, read out of the settings K/V rows.
 *
 * One helper rather than three inline reads so the portal list, the portal
 * detail and the send route resolve the rail the same way. `settings` is
 * untyped TEXT, so every value goes through the validators in
 * lib/invoice-pay-settings rather than being trusted.
 */
export interface InvoicePayContext extends InvoiceBankSettings {
  channel: InvoiceChannel
  bankDetails: InvoiceBankDetails
  bankAccounts: InvoiceBankAccountsByCurrency
  xeroEmailMode: XeroEmailMode
}

export function readInvoicePayContext(
  rows: Array<{ key: string; value: string | null }>,
  orgChannel: unknown,
): InvoicePayContext {
  const map = new Map<string, string | null>()
  for (const row of rows) map.set(row.key, row.value)

  return {
    channel: resolveInvoiceChannel(orgChannel, map.get(INVOICE_CHANNEL_SETTING_KEY)),
    bankDetails: parseBankDetails(map.get(BANK_DETAILS_SETTING_KEY)),
    bankAccounts: parseBankDetailsByCurrency(map.get(BANK_DETAILS_BY_CURRENCY_SETTING_KEY)),
    xeroEmailMode: map.has(XERO_EMAIL_MODE_SETTING_KEY)
      ? resolveXeroEmailMode(map.get(XERO_EMAIL_MODE_SETTING_KEY))
      : DEFAULT_XERO_EMAIL_MODE,
  }
}

/**
 * The two stored bank settings, as one argument.
 *
 * Both optional so a caller that only has the legacy value (an old fixture, a
 * preview) still type-checks, and so `InvoicePayContext` above satisfies this
 * shape without being wrapped.
 */
export interface InvoiceBankSettings {
  /** invoicing.bankDetailsByCurrency, parsed. */
  bankAccounts?: InvoiceBankAccountsByCurrency
  /** invoicing.bankDetails, parsed. The one account, kept as the fallback. */
  bankDetails?: InvoiceBankDetails
}

/**
 * THE resolver. Which account a client paying THIS invoice is told to pay into.
 *
 * Three steps, in this order and no other:
 *
 *   1. the account for the invoice's own currency. A GBP bill quotes the GBP
 *      account, full stop: that is the whole point of the key.
 *   2. the legacy single account, for a currency the studio has not filled in
 *      yet. Not perfect, but a real account and a number the client can ring
 *      about beats a "How to pay" heading over nothing.
 *   3. null, and the surfaces above degrade: the portal says the studio will
 *      be in touch, and the email drops the block entirely rather than print a
 *      heading with no account under it.
 *
 * The currency is the INVOICE's, never the studio's default billing currency:
 * the client is being asked for the amount on the bill, in the currency on the
 * bill, so the account has to be the one that receives that currency.
 *
 * Pure, and the only place this decision is made. Every surface that renders
 * the block (both portal projections, the client invoice card, the two bank
 * email variants) reaches it through here, because a client reading one
 * account number in their email and a different one in the portal for the same
 * bill is the exact failure this module exists to prevent.
 */
export function bankDetailsForCurrency(
  settings: InvoiceBankSettings | null | undefined,
  currency: string | null | undefined,
): InvoiceBankAccount | null {
  if (!settings) return null

  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : ''
  if (isInvoiceCurrency(code)) {
    const account = settings.bankAccounts?.[code]
    if (account && Object.keys(account).length > 0) return account
  }

  const legacy = settings.bankDetails
  if (legacy && Object.keys(legacy).length > 0) return legacy

  return null
}

/** One rendered line of the block: what it is called, and what it says. */
export interface HowToPayRow {
  field: BankAccountField
  label: string
  value: string
  /** Copied digit for digit, so it renders monospace. */
  mono?: boolean
}

/**
 * The bank lines of the block, in order, with only the fields that are set.
 *
 * Shared rather than re-listed per surface for the reason the module is
 * shared: the email, the portal card and the admin preview have to name the
 * same fields with the same words. `referenceHint` is not a row (it is the
 * sentence under the block) and the reference, the amount and the due date are
 * not rows either, because each surface places those itself.
 */
export function howToPayRows(block: InvoiceHowToPay): HowToPayRow[] {
  const rows: HowToPayRow[] = []
  for (const field of BANK_ACCOUNT_FIELDS) {
    // Not a row: it is the sentence UNDER the block, and it is already on the
    // block as `hint` with the studio default filled in.
    if (field === 'referenceHint') continue
    const value = block[field]
    if (typeof value !== 'string' || value.trim() === '') continue
    rows.push({
      field,
      label: BANK_ACCOUNT_FIELD_LABELS[field],
      value,
      ...(BANK_ACCOUNT_MONO_FIELDS.includes(field) ? { mono: true } : {}),
    })
  }
  return rows
}

/**
 * The client's pay link for this invoice, or null.
 *
 * Stripe's hosted page first, then Xero's own online invoice. Deliberately
 * NOT gated on the rail: a link that exists is a link the client can pay on,
 * and refusing to show a captured Xero page because the org is nominally on
 * Stripe would leave a payable bill unpayable.
 */
export function resolveInvoicePayUrl(
  stripeHostedInvoiceUrl: string | null | undefined,
  xeroOnlineInvoiceUrl: string | null | undefined,
): string | null {
  for (const url of [stripeHostedInvoiceUrl, xeroOnlineInvoiceUrl]) {
    if (typeof url === 'string' && url.trim() !== '') return url.trim()
  }
  return null
}

/**
 * Build the block, or null when the client does not need one.
 *
 * Three conditions, all necessary:
 *
 *   the Xero rail   a Stripe client always gets a hosted page eventually, and
 *                   a bank transfer against a Stripe invoice would not
 *                   reconcile.
 *   no pay link     a link beats a transfer every time, for both sides.
 *   still owed      the one that is easy to forget. A Xero invoice that the
 *                   client bank-transferred and Liam then marked paid here
 *                   never gets an OnlineInvoiceUrl (it was never approved
 *                   inside Xero), so the first two conditions stay true
 *                   forever, and both portal projections return every
 *                   non-draft invoice. Without this the settled row keeps
 *                   telling the client the account number, the reference and
 *                   the amount, under the words "How to pay".
 */
export function buildHowToPay(input: {
  channel: InvoiceChannel
  payUrl: string | null | undefined
  invoice: HowToPayInvoice
  /** Both stored keys. The account is picked off the INVOICE's currency. */
  bankSettings: InvoiceBankSettings
}): InvoiceHowToPay | null {
  const { channel, payUrl, invoice, bankSettings } = input
  if (channel !== 'xero') return null
  if (typeof payUrl === 'string' && payUrl.trim() !== '') return null
  if (isInvoiceSettled(invoice)) return null

  // The invoice currency decides everything below: which account, and what the
  // amount is denominated in. Resolved once, here, so no caller can pass one
  // currency's account under another currency's total.
  const currency = invoice.currency ?? 'NZD'
  const account = bankDetailsForCurrency(bankSettings, currency) ?? {}

  const hint = account.referenceHint?.trim()

  // Every field the account actually carries, and no empty rows: a field left
  // blank in settings must not become a labelled line with nothing after it.
  const fields: Partial<Record<Exclude<BankAccountField, 'referenceHint'>, string>> = {}
  for (const field of BANK_ACCOUNT_FIELDS) {
    if (field === 'referenceHint') continue
    const value = account[field]
    if (typeof value === 'string' && value.trim() !== '') fields[field] = value.trim()
  }

  return {
    ...fields,
    reference: invoiceReference(invoice.id, invoice.number),
    amount: invoice.totalUsd,
    currency,
    dueDate: invoice.dueDate,
    hint: hint && hint !== '' ? hint : DEFAULT_REFERENCE_HINT,
  }
}

/**
 * Does the block name somewhere to actually send the money?
 *
 * The projection carries the block for every unpaid Xero invoice with no link,
 * so the portal can say "the studio will be in touch with payment details"
 * rather than nothing. An EMAIL is different: a "How to pay" heading over an amount
 * and a reference, with no account to pay into, reads as a broken template to
 * the person holding the bill. So the email renders the block only when this
 * is true and falls back to the plain portal CTA otherwise.
 */
export function hasBankDestination(howToPay: InvoiceHowToPay | null | undefined): boolean {
  if (!howToPay) return false
  // `iban` is in here because the EUR account has no account number at all:
  // an IBAN IS the destination on that rail, and leaving it out would send
  // every euro client the plain portal CTA with the account sitting unused.
  return !!(howToPay.accountNumber || howToPay.iban || howToPay.bankName || howToPay.accountName)
}

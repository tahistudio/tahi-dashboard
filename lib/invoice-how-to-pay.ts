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
 */

import {
  BANK_DETAILS_SETTING_KEY,
  DEFAULT_XERO_EMAIL_MODE,
  XERO_EMAIL_MODE_SETTING_KEY,
  parseBankDetails,
  resolveXeroEmailMode,
  type InvoiceBankDetails,
  type XeroEmailMode,
} from '@/lib/invoice-pay-settings'
import {
  INVOICE_CHANNEL_SETTING_KEY,
  resolveInvoiceChannel,
  type InvoiceChannel,
} from '@/lib/invoice-channel'
import { invoiceReference } from '@/lib/invoice-billing'

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
 * The invoice states that owe nothing.
 *
 * 'cancelled' is not a status this codebase writes (the columns are
 * draft | sent | viewed | paid | overdue | written_off) but it is a status a
 * Xero or Stripe import could hand us, and the cost of listing it is nil
 * against the cost of quoting an account number under a voided bill.
 */
export const SETTLED_INVOICE_STATUSES: readonly string[] = ['paid', 'written_off', 'cancelled']

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
  const status = typeof invoice.status === 'string' ? invoice.status.trim().toLowerCase() : ''
  if (SETTLED_INVOICE_STATUSES.includes(status)) return true
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
export interface InvoicePayContext {
  channel: InvoiceChannel
  bankDetails: InvoiceBankDetails
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
    xeroEmailMode: map.has(XERO_EMAIL_MODE_SETTING_KEY)
      ? resolveXeroEmailMode(map.get(XERO_EMAIL_MODE_SETTING_KEY))
      : DEFAULT_XERO_EMAIL_MODE,
  }
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
  bankDetails: InvoiceBankDetails
}): InvoiceHowToPay | null {
  const { channel, payUrl, invoice, bankDetails } = input
  if (channel !== 'xero') return null
  if (typeof payUrl === 'string' && payUrl.trim() !== '') return null
  if (isInvoiceSettled(invoice)) return null

  const hint = bankDetails.referenceHint?.trim()

  return {
    ...(bankDetails.bankName ? { bankName: bankDetails.bankName } : {}),
    ...(bankDetails.accountName ? { accountName: bankDetails.accountName } : {}),
    ...(bankDetails.accountNumber ? { accountNumber: bankDetails.accountNumber } : {}),
    reference: invoiceReference(invoice.id, invoice.number),
    amount: invoice.totalUsd,
    currency: invoice.currency ?? 'NZD',
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
  return !!(howToPay.accountNumber || howToPay.bankName || howToPay.accountName)
}

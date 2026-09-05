/**
 * lib/invoice-channel.ts
 *
 * Which rail a client is billed on, and how an unset client resolves.
 *
 * There are exactly two channels. 'stripe' means the bill is a Stripe invoice
 * and the client pays on Stripe's hosted invoice page. 'xero' means the bill
 * is a Xero invoice, which carries its own pay-now link, so there is no need
 * to split "Xero paid by card" from "Xero paid by bank transfer" at the client
 * level.
 *
 * A client may carry no channel at all (organisations.invoiceChannel is NULL),
 * which means "whatever the studio default is". The studio default lives in
 * the settings key below and is itself 'stripe' when unset, so the resolution
 * never returns null and no caller has to invent a fallback.
 *
 * Pure, so the resolution is unit testable without a D1 handle and both the
 * API route and the UI agree (CLAUDE.md: never export a non-route symbol from
 * a route.ts).
 */

/** The two rails, in the order they are offered in the UI. */
export const INVOICE_CHANNELS = [
  { value: 'stripe', label: 'Stripe' },
  { value: 'xero', label: 'Xero' },
] as const

export type InvoiceChannel = (typeof INVOICE_CHANNELS)[number]['value']

/** Settings key holding the studio-wide default channel. */
export const INVOICE_CHANNEL_SETTING_KEY = 'invoicing.defaultChannel'

/** What the studio bills on when nobody has said otherwise. */
export const DEFAULT_INVOICE_CHANNEL: InvoiceChannel = 'stripe'

export function isInvoiceChannel(value: unknown): value is InvoiceChannel {
  return (
    typeof value === 'string' &&
    INVOICE_CHANNELS.some(c => c.value === value)
  )
}

/**
 * The channel an invoice for this client would actually use.
 *
 * `orgChannel` is organisations.invoiceChannel (NULL until someone names one)
 * and `studioDefault` is the stored settings value. Anything unrecognised on
 * either side (an empty string, a stale 'xero_bank' from an earlier draft of
 * this feature, a number) falls through rather than escaping as a channel, so
 * the result is always one of the two rails.
 */
export function resolveInvoiceChannel(
  orgChannel: unknown,
  studioDefault: unknown,
): InvoiceChannel {
  if (isInvoiceChannel(orgChannel)) return orgChannel
  if (isInvoiceChannel(studioDefault)) return studioDefault
  return DEFAULT_INVOICE_CHANNEL
}

/** Human label for a channel, e.g. 'Stripe'. Unknown values read as the default. */
export function invoiceChannelLabel(value: unknown): string {
  const channel = isInvoiceChannel(value) ? value : DEFAULT_INVOICE_CHANNEL
  return INVOICE_CHANNELS.find(c => c.value === channel)!.label
}

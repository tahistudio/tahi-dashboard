/**
 * lib/invoice-defaults.ts
 *
 * What a new invoice should already say before the operator touches it.
 *
 * The New Invoice slide-over used to open on "Dashboard only" with NZD and an
 * empty due date every single time, whoever the client was, so the rail was
 * decided from memory once per bill. These three helpers turn the client row
 * (organisations.invoiceChannel resolved against the studio default,
 * organisations.paymentTerms, organisations.preferredCurrency) into the three
 * values the form opens with. They are suggestions: the operator still owns
 * every field afterwards.
 *
 * Pure on purpose, so the arithmetic is unit testable without a D1 handle or a
 * browser clock (CLAUDE.md: never export a non-route symbol from a route.ts).
 */

import {
  DEFAULT_INVOICE_CHANNEL,
  isInvoiceChannel,
  resolveInvoiceChannel,
  type InvoiceChannel,
} from '@/lib/invoice-channel'
import { isInvoicedTerms, paymentTermDays } from '@/lib/invoice-billing'

/** What the studio bills in when a client has said nothing. */
export const DEFAULT_INVOICE_CURRENCY = 'NZD'

/** How the studio-default read is going, from the caller's data layer. */
export interface StudioDefaultFetch {
  /** The request has not answered yet. */
  loading: boolean
  /** The request answered with an error. Terminal, not a longer wait. */
  failed: boolean
}

/** Everything the form needs to know about which rail a client is on. */
export interface ChannelDefaults {
  /**
   * The rail the client names for itself, or null when
   * organisations.invoiceChannel has never been set.
   */
  clientChannel: InvoiceChannel | null
  /**
   * The rail an invoice would actually go out on. Only meaningful when
   * `known` is true: otherwise it is the hardcoded fallback standing in for an
   * answer nobody gave.
   */
  effectiveChannel: InvoiceChannel
  /** The studio default has not answered yet, and this client needs it. */
  pending: boolean
  /**
   * The rail is a fact rather than a guess. False only when this client has no
   * rail of its own AND the studio default could not be read.
   */
  known: boolean
}

/**
 * Which rail a client is on, and whether that is actually known.
 *
 * Three states, not two, because the UI has three sentences to choose between
 * and the difference is money:
 *
 * - The client names a rail. Nothing else is needed, whatever the settings
 *   request is doing, and the operator can be told the client "usually bills
 *   through" it.
 * - The client names nothing and the studio default has arrived. The rail is
 *   the studio's, so the sentence has to say so rather than attribute a
 *   history to a client that has never been assigned one. Almost every
 *   organisation row is this case today.
 * - The client names nothing and the studio default cannot be read. A failed
 *   read is NOT a longer wait: the app's SWR config does not retry or
 *   revalidate on focus, so one failure sticks for the session. Answering
 *   'stripe' here would open every unset client on a rail nobody chose and
 *   print it as fact, which is why `known` goes false and the caller is
 *   expected to stay silent and leave the destination alone.
 */
export function resolveChannelDefaults(
  orgChannel: unknown,
  studioDefault: unknown,
  fetchState: StudioDefaultFetch,
): ChannelDefaults {
  const clientChannel = isInvoiceChannel(orgChannel) ? orgChannel : null
  const needsStudioDefault = clientChannel === null
  return {
    clientChannel,
    effectiveChannel: resolveInvoiceChannel(clientChannel, studioDefault),
    pending: needsStudioDefault && fetchState.loading,
    known: !needsStudioDefault || (!fetchState.loading && !fetchState.failed),
  }
}

/**
 * The destination chip a new invoice opens on for this client.
 *
 * Takes the ALREADY resolved channel (resolveInvoiceChannel(org.invoiceChannel,
 * studioDefault)), so the org-versus-studio precedence lives in exactly one
 * place. Anything unrecognised lands on the studio-wide default rather than
 * escaping as a destination.
 *
 * Note this never returns 'manual'. "Dashboard only" is a deliberate operator
 * choice (a bill raised here and pushed nowhere), never a default.
 */
export function defaultDestination(effectiveChannel: unknown): InvoiceChannel {
  return isInvoiceChannel(effectiveChannel) ? effectiveChannel : DEFAULT_INVOICE_CHANNEL
}

/**
 * Due date (YYYY-MM-DD) a new invoice opens on, given the client's terms and
 * the day it is being raised.
 *
 * 'card' and an unset or unknown value both mean "there are no net terms
 * here", which is due today: a card client pays on the spot, and inventing net
 * 14 for a client nobody has classified would quietly push money out two
 * weeks. That is why this does NOT lean on paymentTermDays' own net_14
 * fallback, which answers a different question (how long an INVOICED client
 * gets).
 *
 * The arithmetic runs on the YYYY-MM-DD parts in UTC, never through a local
 * Date, so an operator in NZDT does not get yesterday's date back off an ISO
 * timestamp that has already ticked over in UTC, and a +N never lands on the
 * wrong side of a daylight-saving change.
 *
 * `todayIso` is any ISO string, date-only or a full timestamp. An unreadable
 * one returns '' (leave the field blank) rather than guessing a date onto a
 * bill.
 */
export function defaultDueDate(paymentTerms: unknown, todayIso: string): string {
  const startUtc = utcMidnightFromIso(todayIso)
  if (startUtc === null) return ''
  const days = isInvoicedTerms(paymentTerms) ? paymentTermDays(paymentTerms) : 0
  return new Date(startUtc + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * The calendar day the operator is actually looking at, as YYYY-MM-DD.
 *
 * This is the "today" to hand defaultDueDate. It has to be the LOCAL day, not
 * the UTC one: New Zealand runs UTC+12/+13, so for the first half of every
 * working day `new Date().toISOString()` still names yesterday, and a card
 * client's invoice would open already due in the past. Everything else on this
 * surface reads invoices.dueDate as a local calendar day too (the list parses
 * it with a T00:00:00 suffix), so this keeps the whole page on one calendar.
 *
 * Pure in the sense that matters: the clock is the caller's argument.
 */
export function localCalendarDay(now: Date): string {
  if (Number.isNaN(now.getTime())) return ''
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Currency a new invoice opens in.
 *
 * `preferredCurrency` is organisations.preferredCurrency, which is free text in
 * the schema and can be blank, lower case or padded. Pass `allowed` (the
 * picker's own option list) so a client carrying a currency the form cannot
 * offer falls back to the studio one instead of selecting nothing at all.
 */
export function defaultCurrency(
  preferredCurrency: unknown,
  fallback: string = DEFAULT_INVOICE_CURRENCY,
  allowed?: readonly string[],
): string {
  if (typeof preferredCurrency !== 'string') return fallback
  const code = preferredCurrency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return fallback
  if (allowed && !allowed.includes(code)) return fallback
  return code
}

/**
 * Midnight UTC of the calendar day an ISO string names, as epoch ms.
 * Reads the YYYY-MM-DD prefix directly so the string's own day is kept, and
 * returns null when the string does not carry a real one.
 */
function utcMidnightFromIso(iso: unknown): number | null {
  if (typeof iso !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const ms = Date.UTC(year, month - 1, day)
  // Date.UTC rolls an impossible day forward (31 April becomes 1 May) and
  // maps years 0 to 99 into the 1900s, so reject anything that did not
  // survive the round trip as the day it named.
  const back = new Date(ms)
  if (
    back.getUTCFullYear() !== year
    || back.getUTCMonth() !== month - 1
    || back.getUTCDate() !== day
  ) {
    return null
  }
  return ms
}

/**
 * lib/invoice-billing.ts
 *
 * Pure decisions shared by the money path: who an invoice email goes to, and
 * what "invoice me" net terms mean.
 *
 * Kept out of the route handlers so both the admin send-email route and the
 * onboarding completion route agree, and so the rules are unit testable
 * without a D1 handle (CLAUDE.md: never export a non-route symbol from a
 * route.ts).
 */

// ── Payment terms ────────────────────────────────────────────────────────────

/**
 * organisations.paymentTerms vocabulary.
 * 'card' (or null) = card on file via Stripe. The net_* values record a client
 * who chose "invoice me", which is also what entitles them to the portal
 * without a live subscription.
 */
export const PAYMENT_TERMS = ['card', 'net_7', 'net_14', 'net_30'] as const
export type PaymentTerms = (typeof PAYMENT_TERMS)[number]

/** What a client who picks "invoice me" at onboarding gets by default. */
export const DEFAULT_INVOICE_TERMS: PaymentTerms = 'net_14'

const TERM_DAYS: Record<PaymentTerms, number> = {
  card: 0,
  net_7: 7,
  net_14: 14,
  net_30: 30,
}

export function isPaymentTerms(value: unknown): value is PaymentTerms {
  return typeof value === 'string' && (PAYMENT_TERMS as readonly string[]).includes(value)
}

/**
 * Does this stored value mean "bill me on net terms" rather than "card on
 * file"? This is the entitlement signal the onboarding gate reads, so it must
 * be strict: an unknown or empty value is NOT net terms.
 */
export function isInvoicedTerms(value: unknown): boolean {
  return isPaymentTerms(value) && value !== 'card'
}

/** Days a net-terms invoice is due in. Unknown values fall back to net 14. */
export function paymentTermDays(value: unknown): number {
  if (!isPaymentTerms(value) || value === 'card') return TERM_DAYS[DEFAULT_INVOICE_TERMS]
  return TERM_DAYS[value]
}

/** Human label for the terms, e.g. for an invoice note or the client detail. */
export function paymentTermsLabel(value: unknown): string {
  if (!isInvoicedTerms(value)) return 'Card on file'
  return `Net ${paymentTermDays(value)}`
}

/**
 * Due date (YYYY-MM-DD) for an invoice raised on `fromIso` under these terms.
 * Date-only so it matches the rest of invoices.dueDate, which the UI parses
 * with a `T00:00:00` suffix.
 */
export function dueDateForTerms(fromIso: string, value: unknown): string {
  const base = new Date(fromIso)
  const start = Number.isNaN(base.getTime()) ? new Date() : base
  const due = new Date(start.getTime() + paymentTermDays(value) * 24 * 60 * 60 * 1000)
  return due.toISOString().slice(0, 10)
}

// ── Invoice email recipients ─────────────────────────────────────────────────

export interface BillingContactRow {
  email: string | null
  name: string | null
  portalRole?: string | null
  isPrimary?: boolean | number | null
}

export interface InvoiceRecipient {
  email: string
  name: string
}

/**
 * The billing audience at an org: every contact the portal would let open an
 * invoice. Billing is a workspace-admin surface (lib/portal-access.ts), so it
 * is exactly portalRole 'admin' plus the primary contact.
 *
 * Deliberately NOT tolerant. An org with no admin and no primary (imported
 * from ManyRequests, or created outside the two flows that set isPrimary) gets
 * an EMPTY list, so the caller fails loudly rather than broadcasting the
 * amount, the due date and the notes to a designer or a contractor at the
 * client. Generic on the row type so a caller can keep its own columns (id,
 * clerkUserId) on the rows that come back.
 */
export function selectBillingContacts<T extends BillingContactRow>(contacts: T[]): T[] {
  return contacts.filter(c => c.portalRole === 'admin' || !!c.isPrimary)
}

/**
 * Who receives the invoice email.
 *
 * The old behaviour picked ONE contact (the primary, by an ORDER BY), so a
 * client whose finance person is a second seat never saw their bill. This is
 * the billing audience above, narrowed to the rows with a usable email and
 * de-duplicated case-insensitively, order preserved.
 *
 * Empty means "nobody at this client is designated to receive bills", which is
 * a 400 at the route, not a reason to mail everyone.
 */
export function selectInvoiceRecipients(contacts: BillingContactRow[]): InvoiceRecipient[] {
  const withEmail = selectBillingContacts(contacts).filter(
    (c): c is BillingContactRow & { email: string } =>
      typeof c.email === 'string' && c.email.trim().length > 0)

  const seen = new Set<string>()
  const out: InvoiceRecipient[] = []
  for (const c of withEmail) {
    const email = c.email.trim()
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ email, name: c.name?.trim() || email })
  }
  return out
}

/**
 * The identifier a human uses for this invoice: subjects, emails, the portal,
 * the bank reference, the Xero InvoiceNumber.
 *
 * The real number when the row has one (invoices.number, minted from the
 * settings prefix for anything raised here, or carried over from Xero or
 * Stripe on an import), otherwise the first eight characters of the id in
 * upper case, exactly as every surface printed before migration 0096.
 *
 * The fallback is not a formality. Every invoice that predates the column is
 * NULL and always will be: the backfill only fills the rows whose source
 * number is recoverable, and none of them are ever renumbered. So both branches
 * are live, and passing the number is what makes the reference on the client's
 * email match the reference on their bank transfer and the number in Xero.
 */
export function invoiceReference(invoiceId: string, invoiceNumber?: string | null): string {
  if (typeof invoiceNumber === 'string' && invoiceNumber.trim() !== '') return invoiceNumber.trim()
  return invoiceId.slice(0, 8).toUpperCase()
}

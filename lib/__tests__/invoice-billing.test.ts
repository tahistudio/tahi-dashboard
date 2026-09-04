/**
 * Unit tests for lib/invoice-billing.ts: who an invoice email reaches, and
 * what "invoice me" net terms mean.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INVOICE_TERMS,
  dueDateForTerms,
  invoiceReference,
  isInvoicedTerms,
  isPaymentTerms,
  paymentTermDays,
  paymentTermsLabel,
  selectBillingContacts,
  selectInvoiceRecipients,
} from '@/lib/invoice-billing'

describe('payment terms', () => {
  it('recognises only the known vocabulary', () => {
    expect(isPaymentTerms('net_14')).toBe(true)
    expect(isPaymentTerms('card')).toBe(true)
    expect(isPaymentTerms('net_45')).toBe(false)
    expect(isPaymentTerms(null)).toBe(false)
    expect(isPaymentTerms(14)).toBe(false)
  })

  it('treats only net terms as invoiced, never card or junk', () => {
    // This is the portal entitlement signal, so it has to fail closed.
    expect(isInvoicedTerms('net_7')).toBe(true)
    expect(isInvoicedTerms('net_14')).toBe(true)
    expect(isInvoicedTerms('net_30')).toBe(true)
    expect(isInvoicedTerms('card')).toBe(false)
    expect(isInvoicedTerms('')).toBe(false)
    expect(isInvoicedTerms(null)).toBe(false)
    expect(isInvoicedTerms(undefined)).toBe(false)
    expect(isInvoicedTerms('yes')).toBe(false)
  })

  it('maps terms to days, falling back to the default', () => {
    expect(paymentTermDays('net_7')).toBe(7)
    expect(paymentTermDays('net_30')).toBe(30)
    expect(paymentTermDays('card')).toBe(paymentTermDays(DEFAULT_INVOICE_TERMS))
    expect(paymentTermDays('nonsense')).toBe(14)
  })

  it('labels terms for humans', () => {
    expect(paymentTermsLabel('net_30')).toBe('Net 30')
    expect(paymentTermsLabel('card')).toBe('Card on file')
    expect(paymentTermsLabel(null)).toBe('Card on file')
  })

  it('produces a date-only due date the invoice surfaces can parse', () => {
    expect(dueDateForTerms('2026-09-01T00:00:00.000Z', 'net_7')).toBe('2026-09-08')
    expect(dueDateForTerms('2026-09-01T00:00:00.000Z', 'net_30')).toBe('2026-10-01')
  })

  it('does not blow up on an unparseable timestamp', () => {
    expect(dueDateForTerms('not a date', 'net_14')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('selectInvoiceRecipients', () => {
  it('reaches every billing contact, not just the primary', () => {
    // The old behaviour picked one row by ORDER BY, so a client's finance
    // person never saw their bill.
    expect(selectInvoiceRecipients([
      { email: 'owner@acme.test', name: 'Ana', portalRole: 'admin', isPrimary: true },
      { email: 'finance@acme.test', name: 'Fin', portalRole: 'admin', isPrimary: false },
    ])).toEqual([
      { email: 'owner@acme.test', name: 'Ana' },
      { email: 'finance@acme.test', name: 'Fin' },
    ])
  })

  it('excludes member seats that cannot open the invoice in the portal', () => {
    const out = selectInvoiceRecipients([
      { email: 'owner@acme.test', name: 'Ana', portalRole: 'admin', isPrimary: true },
      { email: 'designer@acme.test', name: 'Dee', portalRole: 'member', isPrimary: false },
    ])
    expect(out.map(r => r.email)).toEqual(['owner@acme.test'])
  })

  it('keeps the primary contact even without an explicit admin role', () => {
    // portalRole is not reliably populated for primary contacts (see
    // lib/portal-access.ts), so isPrimary is a first-class signal here too.
    const out = selectInvoiceRecipients([
      { email: 'owner@acme.test', name: 'Ana', portalRole: 'member', isPrimary: 1 },
    ])
    expect(out).toEqual([{ email: 'owner@acme.test', name: 'Ana' }])
  })

  it('never broadcasts to the whole org when nobody is designated', () => {
    // Orgs imported from ManyRequests carry no isPrimary and no portalRole
    // 'admin'. Mailing the amount, the due date and the notes to a designer or
    // a contractor at the client is worse than failing loudly, so this is
    // empty and the route 400s.
    const out = selectInvoiceRecipients([
      { email: 'a@acme.test', name: 'A', portalRole: 'member', isPrimary: false },
      { email: 'b@acme.test', name: 'B', portalRole: 'member', isPrimary: null },
    ])
    expect(out).toEqual([])
  })

  it('keeps the caller rows intact through selectBillingContacts', () => {
    // The bell row needs contact ids, so the audience filter is generic over
    // the row type rather than projecting to email + name.
    const rows = [
      { id: 'c1', email: 'owner@acme.test', name: 'Ana', portalRole: 'admin', isPrimary: true },
      { id: 'c2', email: 'designer@acme.test', name: 'Dee', portalRole: 'member', isPrimary: false },
    ]
    expect(selectBillingContacts(rows).map(c => c.id)).toEqual(['c1'])
  })

  it('drops blank emails and de-duplicates case-insensitively', () => {
    const out = selectInvoiceRecipients([
      { email: 'Owner@Acme.test', name: 'Ana', portalRole: 'admin', isPrimary: true },
      { email: ' owner@acme.test ', name: 'Ana again', portalRole: 'admin', isPrimary: false },
      { email: '   ', name: 'Blank', portalRole: 'admin', isPrimary: false },
      { email: null, name: 'None', portalRole: 'admin', isPrimary: false },
    ])
    expect(out).toEqual([{ email: 'Owner@Acme.test', name: 'Ana' }])
  })

  it('returns nothing for an org with no contacts', () => {
    expect(selectInvoiceRecipients([])).toEqual([])
  })

  it('falls back to the email when a contact has no name', () => {
    expect(selectInvoiceRecipients([
      { email: 'owner@acme.test', name: '  ', portalRole: 'admin', isPrimary: true },
    ])).toEqual([{ email: 'owner@acme.test', name: 'owner@acme.test' }])
  })
})

describe('invoiceReference', () => {
  it('is the short uppercase prefix used across the UI and emails', () => {
    expect(invoiceReference('0f3a9b2c-1111-2222-3333-444455556666')).toBe('0F3A9B2C')
  })
})

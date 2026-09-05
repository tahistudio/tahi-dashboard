/**
 * lib/__tests__/xero-invoice-email.test.ts
 *
 * "Let Xero send its own copy", and the one thing that makes it safe.
 *
 * Xero REFUSES to email an invoice that is not AUTHORISED, and the push route
 * holds every dashboard-raised invoice at DRAFT on purpose (Liam, 2026-09-06),
 * so "still a draft" is the ORDINARY state of a freshly pushed bill rather
 * than an edge case. Firing the Email call blind would answer 400, the client
 * would receive nothing at all, and the send route would have stood our own
 * template down on the strength of a send that never happened.
 *
 * So the status is read FIRST and the outcome is always reported, never
 * thrown: the caller decides whether to send ours instead, and the studio is
 * told what actually reached the client.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  emailInvoiceFromXero,
  readXeroInvoiceStatus,
  readXeroSentToContact,
  xeroEmailBlockReason,
  type XeroInvoiceEmailDeps,
} from '@/lib/xero-invoice-email'

/** A pair of injected Xero calls plus the spies to assert against. */
function deps(over: Partial<XeroInvoiceEmailDeps> = {}) {
  const readInvoice = vi.fn().mockResolvedValue({ Invoices: [{ Status: 'AUTHORISED' }] })
  const emailInvoice = vi.fn().mockResolvedValue(undefined)
  return { readInvoice, emailInvoice, ...over } as XeroInvoiceEmailDeps & {
    readInvoice: ReturnType<typeof vi.fn>
    emailInvoice: ReturnType<typeof vi.fn>
  }
}

/** An AUTHORISED invoice Xero has already emailed once. */
function alreadyEmailed() {
  return deps({
    readInvoice: vi.fn().mockResolvedValue({
      Invoices: [{ Status: 'AUTHORISED', SentToContact: true }],
    }),
  })
}

describe('readXeroInvoiceStatus', () => {
  it('reads the status off the first invoice', () => {
    expect(readXeroInvoiceStatus({ Invoices: [{ Status: 'AUTHORISED' }] })).toBe('AUTHORISED')
  })

  it('answers null for anything that is not a usable payload', () => {
    for (const payload of [null, undefined, 'nope', {}, { Invoices: [] }, { Invoices: [{}] }]) {
      expect(readXeroInvoiceStatus(payload)).toBeNull()
    }
  })
})

describe('readXeroSentToContact', () => {
  it('reads Xero\'s own record that it has mailed this invoice', () => {
    expect(readXeroSentToContact({ Invoices: [{ SentToContact: true }] })).toBe(true)
  })

  it('reads anything that is not an explicit true as "not sent"', () => {
    // A missing or odd flag must never be the reason a client goes without
    // their bill, so the guard only fires on a definite yes.
    for (const payload of [
      null, undefined, 'nope', {}, { Invoices: [] }, { Invoices: [{}] },
      { Invoices: [{ SentToContact: false }] },
      { Invoices: [{ SentToContact: 'true' }] },
    ]) {
      expect(readXeroSentToContact(payload)).toBe(false)
    }
  })
})

describe('xeroEmailBlockReason', () => {
  it('lets an AUTHORISED invoice through', () => {
    expect(xeroEmailBlockReason('AUTHORISED')).toBeNull()
  })

  it('names a draft in words the studio can act on', () => {
    // The sentence matters: this is the state EVERY pushed invoice starts in,
    // and "Xero answered 400" would send someone to the network tab.
    expect(xeroEmailBlockReason('DRAFT')).toBe('Xero invoice is still a draft')
    expect(xeroEmailBlockReason('SUBMITTED')).toBe('Xero invoice is still a draft')
  })

  it('names the other states rather than pretending they are drafts', () => {
    expect(xeroEmailBlockReason('PAID')).toBe('Xero already has this invoice paid')
    expect(xeroEmailBlockReason('VOIDED')).toContain('VOIDED')
    expect(xeroEmailBlockReason(null)).toBe('Could not read the invoice back from Xero')
  })
})

describe('emailInvoiceFromXero', () => {
  it('emails an AUTHORISED invoice and reports the send', async () => {
    const d = deps()
    const outcome = await emailInvoiceFromXero('xero-1', { deps: d })

    expect(outcome).toEqual({ status: 'sent' })
    expect(d.emailInvoice).toHaveBeenCalledWith('xero-1')
  })

  it('never calls the Email endpoint for a draft, and says why', async () => {
    const d = deps({ readInvoice: vi.fn().mockResolvedValue({ Invoices: [{ Status: 'DRAFT' }] }) })
    const outcome = await emailInvoiceFromXero('xero-1', { deps: d })

    expect(outcome).toEqual({ status: 'skipped', reason: 'Xero invoice is still a draft' })
    // The whole point: a blind call would 400 and the client would get nothing.
    expect(d.emailInvoice).not.toHaveBeenCalled()
  })

  it('skips an invoice that was never pushed to Xero', async () => {
    const d = deps()
    for (const id of [null, undefined, '   ']) {
      const outcome = await emailInvoiceFromXero(id, { deps: d })
      expect(outcome.status).toBe('skipped')
      expect(outcome.reason).toMatch(/never been pushed/i)
    }
    expect(d.readInvoice).not.toHaveBeenCalled()
  })

  it('reports a failed status read rather than throwing at the route', async () => {
    const d = deps({ readInvoice: vi.fn().mockRejectedValue(new Error('Xero is down')) })
    const outcome = await emailInvoiceFromXero('xero-1', { deps: d })

    expect(outcome).toEqual({ status: 'failed', reason: 'Xero is down' })
    expect(d.emailInvoice).not.toHaveBeenCalled()
  })

  it('reports a refused send rather than throwing at the route', async () => {
    const d = deps({ emailInvoice: vi.fn().mockRejectedValue(new Error('Xero answered 400')) })
    const outcome = await emailInvoiceFromXero('xero-1', { deps: d })

    expect(outcome).toEqual({ status: 'failed', reason: 'Xero answered 400' })
  })

  it('treats a read that came back with no status as a skip, not a send', async () => {
    const d = deps({ readInvoice: vi.fn().mockResolvedValue(null) })
    const outcome = await emailInvoiceFromXero('xero-1', { deps: d })

    expect(outcome.status).toBe('skipped')
    expect(outcome.reason).toBe('Could not read the invoice back from Xero')
    expect(d.emailInvoice).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The resend guard
// ---------------------------------------------------------------------------
describe('emailInvoiceFromXero: not mailing the client twice', () => {
  it('refuses a second Xero send once Xero and the dashboard both say it went', async () => {
    // The realistic path: the send route calls this BEFORE its D1 write and its
    // notification write, either of which can throw and 500 after Xero has
    // already delivered. The operator retries, and without this guard Xero
    // mails the client a second PDF.
    const d = alreadyEmailed()
    const outcome = await emailInvoiceFromXero('xero-1', { alreadySent: true, deps: d })

    expect(outcome).toEqual({ status: 'skipped', reason: 'Xero has already emailed this invoice' })
    expect(d.emailInvoice).not.toHaveBeenCalled()
  })

  it('still sends the first time, even for an invoice Xero had already mailed', async () => {
    // An invoice imported from Xero that Xero emailed before we knew about it.
    // We have never sent it, so this is a first send and it goes.
    const d = alreadyEmailed()
    const outcome = await emailInvoiceFromXero('xero-1', { alreadySent: false, deps: d })

    expect(outcome).toEqual({ status: 'sent' })
    expect(d.emailInvoice).toHaveBeenCalledWith('xero-1')
  })

  it('lets the approve-then-resend flow through, which is what the fallback is for', async () => {
    // Pushed as a DRAFT, our template went out (so sentAt is stamped), Xero
    // refused. Liam approves it in Xero and hits Resend: Xero has still never
    // mailed it, so SentToContact is false and Xero's copy goes.
    const d = deps()
    const outcome = await emailInvoiceFromXero('xero-1', { alreadySent: true, deps: d })

    expect(outcome).toEqual({ status: 'sent' })
    expect(d.emailInvoice).toHaveBeenCalledWith('xero-1')
  })

  it('costs no extra Xero call: the flag rides on the status read', async () => {
    const d = alreadyEmailed()
    await emailInvoiceFromXero('xero-1', { alreadySent: true, deps: d })

    expect(d.readInvoice).toHaveBeenCalledTimes(1)
  })
})

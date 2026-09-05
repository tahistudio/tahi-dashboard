/**
 * lib/xero-invoice-email.ts
 *
 * Letting Xero send its own copy of a Xero-rail invoice.
 *
 * Liam, 2026-09-06: "Xero-rail email: both, behind a studio toggle (send our
 * template with the portal link, let Xero send its PDF, or both)." The toggle
 * is invoicing.xeroEmailMode (lib/invoice-pay-settings.ts). This module owns
 * the half of it that talks to Xero.
 *
 * The one rule that makes this safe: XERO REFUSES TO EMAIL A DRAFT.
 * POST /Invoices/{id}/Email only works on an AUTHORISED invoice, and the push
 * route holds every dashboard-raised invoice at DRAFT on purpose, so "still a
 * draft" is the ORDINARY state of a freshly pushed bill rather than an edge
 * case. Firing the call blind would answer 400, the client would receive
 * nothing at all, and the route would have skipped its own email on the
 * strength of a send that never happened. So the status is read FIRST and a
 * refusal is a reported skip that the caller answers by sending our template
 * instead.
 *
 * Injectable Xero calls, so the three modes and the draft fallback are pinned
 * by tests without a Xero tenant.
 */

import { callXeroAPI, callXeroAPIOrThrow, XeroAPIError } from '@/lib/xero'

/** What one attempt at "let Xero email it" did. */
export type XeroEmailStatus = 'sent' | 'skipped' | 'failed'

export interface XeroEmailOutcome {
  status: XeroEmailStatus
  /** Plain-words explanation, present on anything other than a clean send. */
  reason?: string
}

/** The half of GET /Invoices/{id} this decision is made from. */
interface XeroInvoiceStatusRead {
  Invoices?: Array<{ Status?: string }>
}

export interface XeroInvoiceEmailDeps {
  /** GET /Invoices/{id}. Returns null when Xero could not be reached. */
  readInvoice: (xeroInvoiceId: string) => Promise<unknown>
  /** POST /Invoices/{id}/Email. Resolves on a send, throws on a refusal. */
  emailInvoice: (xeroInvoiceId: string) => Promise<void>
}

/** Xero's status for this invoice, or null when the read gave us nothing. */
export function readXeroInvoiceStatus(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const invoice = (payload as XeroInvoiceStatusRead).Invoices?.[0]
  const status = invoice?.Status
  return typeof status === 'string' && status.trim() !== '' ? status.trim() : null
}

/**
 * Why Xero will not email an invoice in this state, or null when it will.
 *
 * DRAFT and SUBMITTED are both "not issued yet" as far as the email endpoint
 * is concerned, and both are states a dashboard-pushed invoice legitimately
 * sits in while it waits for Liam, so they get the sentence a human can act
 * on rather than a status code.
 */
export function xeroEmailBlockReason(status: string | null): string | null {
  if (status === 'AUTHORISED') return null
  if (status === null) return 'Could not read the invoice back from Xero'
  if (status === 'DRAFT' || status === 'SUBMITTED') return 'Xero invoice is still a draft'
  if (status === 'PAID') return 'Xero already has this invoice paid'
  return `Xero has this invoice as ${status}, not AUTHORISED`
}

/**
 * The real Xero calls.
 *
 * `emailInvoice` goes through callXeroAPIOrThrow rather than callXeroAPI for
 * one reason: POST /Invoices/{id}/Email answers 204 NO CONTENT on success, and
 * callXeroAPIOrThrow ends in `res.json()`, which throws on an empty body. That
 * throw is a SUCCESSFUL send, not a failure, and callXeroAPI would flatten it
 * to the same null it returns for a 400.
 *
 * So exactly ONE kind of throw is swallowed: the JSON decode of an empty body,
 * which arrives as a SyntaxError. Everything else is re-thrown and reported as
 * a failure, including the two that are easy to mistake for the empty-body
 * case: a token that could not be obtained (a plain Error from
 * callXeroAPIOrThrow) and a fetch that never reached Xero. Swallowing those
 * would report a send that did not happen, and in 'xero' mode the send route
 * stands OUR template down on the strength of that report, so the client would
 * receive nothing at all.
 */
export const liveXeroInvoiceEmailDeps: XeroInvoiceEmailDeps = {
  readInvoice: (xeroInvoiceId) =>
    callXeroAPI<XeroInvoiceStatusRead>('GET', `/Invoices/${xeroInvoiceId}`),
  emailInvoice: async (xeroInvoiceId) => {
    try {
      await callXeroAPIOrThrow('POST', `/Invoices/${xeroInvoiceId}/Email`, {})
    } catch (err) {
      if (err instanceof XeroAPIError) throw err
      // 204 No Content: the send happened, only the JSON decode did not.
      if (err instanceof SyntaxError) return
      throw err
    }
  },
}

/**
 * Ask Xero to email this invoice.
 *
 * Never throws. Every outcome is reported so the caller can decide whether to
 * send our own template instead, and so the studio is told what actually
 * reached the client rather than a bare success.
 */
export async function emailInvoiceFromXero(
  xeroInvoiceId: string | null | undefined,
  deps: XeroInvoiceEmailDeps = liveXeroInvoiceEmailDeps,
): Promise<XeroEmailOutcome> {
  if (typeof xeroInvoiceId !== 'string' || xeroInvoiceId.trim() === '') {
    return { status: 'skipped', reason: 'This invoice has never been pushed to Xero' }
  }

  let status: string | null
  try {
    status = readXeroInvoiceStatus(await deps.readInvoice(xeroInvoiceId))
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : 'Could not read the invoice back from Xero',
    }
  }

  const blocked = xeroEmailBlockReason(status)
  if (blocked) return { status: 'skipped', reason: blocked }

  try {
    await deps.emailInvoice(xeroInvoiceId)
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : 'Xero refused to send the email',
    }
  }

  return { status: 'sent' }
}

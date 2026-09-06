/**
 * lib/email-delivery.ts
 *
 * THE ONE DOOR OUT. Every email this platform sends goes through
 * `deliverEmail` below, and this is the only module in the tree allowed to
 * hold a Resend client or to speak to api.resend.com. A test
 * (lib/__tests__/no-resend-bypass.test.ts) walks the source tree and fails if
 * a second one appears, because a choke point with a side door is not a choke
 * point.
 *
 * WHY IT EXISTS. Liam, 2026-09-06: no real client and no teammate may receive
 * any email from this system until he has verified it himself, and that
 * includes staci@ and nathan@. Before this module there were nine independent
 * ways to put a message in someone's inbox: five Resend SDK clients (lib/email,
 * lib/contract-fully-signed-emails, and the contract, proposal and schedule
 * share routes), three raw fetches to api.resend.com (the AI reply draft
 * sender, the monthly billing summary, the deal nudge), and the pre-call
 * digest cron. "Nothing goes out yet" could only ever be an intention. It is
 * now a setting with a default, and the default is closed.
 *
 * THE RULE lives in lib/email-allowlist.ts, pure and re-exported from here.
 * Four layers, in this order: `email.blockedAddresses` (never, ahead of
 * everything), `email.deliveryMode`, `email.allowedOrgIds` (an exempt client,
 * over that client's own contact addresses only), then `email.allowedAddresses`
 * and `email.allowedDomains`, both of which must pass. Everything else is
 * withheld ONE ADDRESS AT A TIME: a mixed To line delivers to the addresses
 * that pass and withholds the rest rather than failing whole. A send with
 * nothing left never reaches Resend.
 *
 * FAIL CLOSED. `email.deliveryMode` resolves to 'allowlist' when the row is
 * missing, empty, misspelled, or when the settings read itself throws. The
 * only way to mail an outside address is for someone to store the exact string
 * 'all', and the settings UI puts a named-consequence confirm in front of that.
 *
 * EVERY WITHHELD ADDRESS IS RECORDED in `email_suppressions` (migration 0094)
 * and counted back to the caller, so "did that reach them?" is answered by a
 * row rather than a shrug.
 *
 * NOTE ON SCOPE. This gate governs mail this platform hands to Resend, which
 * is not the only way a client can receive something. Three other transports
 * send from their own systems and never show us an address, so each asks the
 * same rule through lib/email-gate.ts before it acts:
 *
 *   - Xero emails a Xero-rail invoice (lib/xero-invoice-email.ts). It takes no
 *     address at all, so app/api/admin/invoices/[id]/send-email lets it fire
 *     only when the POLICY authorises that client, never because one billing
 *     contact happens to be on tahi.studio.
 *   - Stripe emails a finalised send_invoice bill.
 *     app/api/admin/invoices/stripe-create refuses before creating one.
 *   - Clerk emails its own organisation invitations. All three minting routes
 *     (admin team invite, portal invites, portal people) call
 *     guardOutboundAddress first.
 *
 * That is the whole set as of 2026-09-06. Mailerlite is named in CLAUDE.md as a
 * mailing rail but app/api/admin/integrations/mailerlite is still a stub that
 * posts nothing, and no HubSpot code in this tree sends mail. Both become a
 * transport the day someone finishes them, and both should come through
 * lib/email-gate.ts when they do.
 */

import type { ReactElement } from 'react'
import { Resend } from 'resend'

import { emailFromAddress } from '@/lib/email-from'
import { partitionRecipients, type DeliveryPolicy } from '@/lib/email-allowlist'
import {
  recordEmailSuppressions,
  resolveDeliveryPolicy,
  resolveOrgRecipientScope,
} from '@/lib/email-gate'

// The rule and the log travel with the door, so a caller never has to know it
// is three modules. lib/email-allowlist.ts stays importable on its own by the
// settings route and the 'use client' settings UI (no D1, no SDK), and
// lib/email-gate.ts stays importable by a transport we do not own (D1, still
// no SDK).
export * from '@/lib/email-allowlist'
export {
  ALLOWLIST_HELD_BACK,
  clearEmailSuppressions,
  guardOutboundAddress,
  listEmailSuppressions,
  recordEmailSuppressions,
  resolveDeliveryPolicy,
  resolveOrgRecipientScope,
  type OutboundAddressDecision,
  type SuppressionContext,
} from '@/lib/email-gate'

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/** A file hung off a send. Base64 content, the way Resend wants it. */
export interface EmailAttachment {
  filename: string
  content: string
  contentType?: string
}

export interface EmailDeliveryRequest {
  /** One address or many. Filtered per address. */
  to: string | string[]
  subject: string
  /**
   * The body, as a React element or as rendered HTML. One or the other; a
   * request carrying neither is refused rather than sent empty.
   */
  react?: ReactElement
  html?: string
  /** The plain text alternative. Missing costs deliverability, not a send. */
  text?: string
  /** Defaults to the one studio lockup in lib/email-from.ts. */
  from?: string
  cc?: string[]
  bcc?: string[]
  replyTo?: string
  attachments?: EmailAttachment[]
  /**
   * Which email this is, in kebab case, e.g. 'invoice-sent'. Written to the
   * suppression log so "what have we withheld from that client" is answerable.
   */
  template: string
  /** The client this send belongs to, when there is one. */
  orgId?: string | null
  /**
   * An already-resolved policy, for a caller sending in a loop.
   *
   * A fan-out (an announcement to every contact, a per-signer contract) calls
   * this once per recipient, and resolving the policy is a settings read each
   * time. Passing it costs one read for the whole fan-out. Leave it unset and
   * the policy is read here, which is the right default for a single send.
   */
  policy?: DeliveryPolicy
}

export interface EmailDeliveryResult {
  /** True when Resend accepted the (possibly filtered) send. */
  success: boolean
  error?: string
  /** Addresses handed to Resend, across to, cc and bcc. */
  delivered: string[]
  /** Addresses withheld by the allowlist, across to, cc and bcc. */
  suppressed: string[]
  /** `suppressed.length`, so a caller can report it without recounting. */
  suppressedCount: number
  /** True when the allowlist left nothing to send and Resend was not called. */
  blocked: boolean
  /**
   * Resend's id for the accepted message, when it gave one. Persisted by the
   * AI reply draft sender as `ai_reply_drafts.resend_message_id`, which is how
   * a bounce is traced back to a row.
   */
  messageId?: string | null
}

let _resend: Resend | null = null

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}

function asArray(value: string | string[] | undefined): string[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * THE ONLY WAY OUT. Filter, record, then (if anything is left) send.
 *
 * The order matters. The filter and the log run BEFORE the API key is looked
 * at, so a worker with no RESEND_API_KEY still produces a suppression row.
 * That is what makes the gate provable without putting a message in anyone's
 * inbox.
 */
export async function deliverEmail(req: EmailDeliveryRequest): Promise<EmailDeliveryResult> {
  const policy = req.policy ?? await resolveDeliveryPolicy()
  // Who the send's client actually is, so an exempted org widens the gate for
  // that client's own people and not for whoever else is cc'd on the line.
  const scope = await resolveOrgRecipientScope(req.orgId, policy)

  const to = partitionRecipients(asArray(req.to), policy, scope)
  const cc = partitionRecipients(asArray(req.cc), policy, scope)
  const bcc = partitionRecipients(asArray(req.bcc), policy, scope)

  const suppressed = [...to.suppressed, ...cc.suppressed, ...bcc.suppressed]
  const delivered = [...to.allowed, ...cc.allowed, ...bcc.allowed]

  await recordEmailSuppressions(
    suppressed,
    { template: req.template, subject: req.subject, orgId: req.orgId ?? null },
    policy,
  )

  // Nothing addressable left. A cc-only send is not a send: Resend requires a
  // `to`, and a message whose only surviving recipients are cc or bcc is one
  // its intended reader was never going to get.
  //
  // `blocked` is the allowlist's answer specifically, which is why it is not
  // simply "to.allowed is empty". Callers turn it into a 409 titled "Held back
  // by the email allowlist", and a caller that passed [''] withheld nobody: it
  // supplied nobody, and sending its operator to a settings page would be a
  // lie about where the fix is.
  if (to.allowed.length === 0) {
    return {
      success: false,
      error: suppressed.length > 0
        ? `Held back by the email allowlist (${suppressed.length} recipient${suppressed.length === 1 ? '' : 's'}).`
        : 'No recipients.',
      delivered: [],
      suppressed,
      suppressedCount: suppressed.length,
      blocked: suppressed.length > 0,
    }
  }

  if (!req.react && !req.html) {
    return {
      success: false,
      error: 'Nothing to send: the request carried neither react nor html.',
      delivered: [],
      suppressed,
      suppressedCount: suppressed.length,
      blocked: false,
    }
  }

  const resend = getResend()
  if (!resend) {
    return {
      success: false,
      error: 'RESEND_API_KEY not configured',
      delivered: [],
      suppressed,
      suppressedCount: suppressed.length,
      blocked: false,
    }
  }

  try {
    // Resend types the body as a union (react OR html) and we choose between
    // them at runtime, which no amount of spreading will narrow. One assertion,
    // at the single point where it is unavoidable, into the SDK's own
    // parameter type rather than to `any`.
    const payload = {
      from: req.from ?? emailFromAddress(),
      to: to.allowed,
      subject: req.subject,
      ...(cc.allowed.length ? { cc: cc.allowed } : {}),
      ...(bcc.allowed.length ? { bcc: bcc.allowed } : {}),
      ...(req.replyTo ? { replyTo: req.replyTo } : {}),
      ...(req.text && req.text.trim() ? { text: req.text } : {}),
      ...(req.attachments?.length ? { attachments: req.attachments } : {}),
      ...(req.react ? { react: req.react } : { html: req.html }),
    } as Parameters<typeof resend.emails.send>[0]

    const { data, error } = await resend.emails.send(payload)

    if (error) {
      return {
        success: false,
        error: error.message,
        delivered: [],
        suppressed,
        suppressedCount: suppressed.length,
        blocked: false,
      }
    }

    return {
      success: true,
      delivered,
      suppressed,
      suppressedCount: suppressed.length,
      blocked: false,
      messageId: data?.id ?? null,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send email',
      delivered: [],
      suppressed,
      suppressedCount: suppressed.length,
      blocked: false,
    }
  }
}

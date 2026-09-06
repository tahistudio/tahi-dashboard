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
 * THE RULE lives in lib/email-allowlist.ts, pure and re-exported from here. A
 * recipient is delivered to when EITHER its domain is in
 * `email.allowedDomains` (case-insensitive; plus aliases pass, they live in
 * the local part) OR the send carries an `orgId` listed in
 * `email.allowedOrgIds`. Everything else is withheld ONE ADDRESS AT A TIME: a
 * mixed To line delivers to the addresses that pass and withholds the rest
 * rather than failing whole. A send with nothing left never reaches Resend.
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
 * NOTE ON SCOPE. This gate governs mail this platform hands to Resend. It is
 * not the only way a client can receive something: a Xero-rail invoice can be
 * emailed by Xero itself (lib/xero-invoice-email.ts), which never sees an
 * address because Xero holds the contact. The one caller of that path
 * (app/api/admin/invoices/[id]/send-email) asks the pure rule first and stands
 * Xero down when every recipient would be withheld.
 */

import type { ReactElement } from 'react'
import { Resend } from 'resend'
import { desc } from 'drizzle-orm'

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { emailFromAddress } from '@/lib/email-from'
import {
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
  SUPPRESSION_REASON_NOT_ALLOWED,
  closedPolicy,
  partitionRecipients,
  resolveAllowedDomains,
  resolveAllowedOrgIds,
  resolveDeliveryMode,
  type DeliveryPolicy,
  type EmailSuppressionRow,
} from '@/lib/email-allowlist'

// The rule travels with the door, so a caller never has to know it is two
// modules. lib/email-allowlist.ts stays importable on its own by the settings
// route and the 'use client' settings UI, neither of which may pull in a
// Resend client or a D1 handle.
export * from '@/lib/email-allowlist'

// ---------------------------------------------------------------------------
// Reading the policy
// ---------------------------------------------------------------------------

interface SettingRow {
  key: string
  value: string | null
}

/**
 * The live policy, read from the settings table.
 *
 * Every failure path lands on the closed policy: no D1 binding, a thrown
 * query, a settings table that has not been created. The gate is only worth
 * having if the broken case is the safe case.
 */
export async function resolveDeliveryPolicy(): Promise<DeliveryPolicy> {
  try {
    const database = await db()
    const rows = (await database
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)) as SettingRow[]

    const map = new Map<string, string | null>()
    for (const row of rows) map.set(row.key, row.value)

    return {
      mode: resolveDeliveryMode(map.get(DELIVERY_MODE_SETTING_KEY)),
      allowedDomains: resolveAllowedDomains(map.get(ALLOWED_DOMAINS_SETTING_KEY)),
      allowedOrgIds: resolveAllowedOrgIds(map.get(ALLOWED_ORG_IDS_SETTING_KEY)),
    }
  } catch {
    return closedPolicy()
  }
}

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
 * Record every withheld address. Best-effort by design: if this write fails
 * the recipient is still withheld, because throwing (and so failing the
 * caller's whole send) makes nobody safer, and losing the log entry makes
 * nobody less safe.
 */
async function recordSuppressions(
  addresses: readonly string[],
  req: EmailDeliveryRequest,
): Promise<void> {
  if (addresses.length === 0) return
  try {
    const database = await db()
    const now = new Date().toISOString()
    await database.insert(schema.emailSuppressions).values(
      addresses.map(address => ({
        id: crypto.randomUUID(),
        createdAt: now,
        to: address,
        orgId: req.orgId ?? null,
        template: req.template,
        subject: req.subject,
        reason: SUPPRESSION_REASON_NOT_ALLOWED,
      })),
    )
  } catch {
    // Swallowed on purpose. See the doc comment above.
  }
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
  const policy = await resolveDeliveryPolicy()

  const to = partitionRecipients(asArray(req.to), policy, req.orgId)
  const cc = partitionRecipients(asArray(req.cc), policy, req.orgId)
  const bcc = partitionRecipients(asArray(req.bcc), policy, req.orgId)

  const suppressed = [...to.suppressed, ...cc.suppressed, ...bcc.suppressed]
  const delivered = [...to.allowed, ...cc.allowed, ...bcc.allowed]

  await recordSuppressions(suppressed, req)

  // Nothing addressable left. A cc-only send is not a send: Resend requires a
  // `to`, and a message whose only surviving recipients are cc or bcc is one
  // its intended reader was never going to get.
  if (to.allowed.length === 0) {
    return {
      success: false,
      error: suppressed.length > 0
        ? `Held back by the email allowlist (${suppressed.length} recipient${suppressed.length === 1 ? '' : 's'}).`
        : 'No recipients.',
      delivered: [],
      suppressed,
      suppressedCount: suppressed.length,
      blocked: true,
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

// ---------------------------------------------------------------------------
// The log
// ---------------------------------------------------------------------------

/** The most recent suppressions, newest first. */
export async function listEmailSuppressions(limit = 100): Promise<EmailSuppressionRow[]> {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.emailSuppressions)
    .orderBy(desc(schema.emailSuppressions.createdAt))
    .limit(limit)
  return rows as EmailSuppressionRow[]
}

/** Empty the log. Every row, no filter: this is the Clear button. */
export async function clearEmailSuppressions(): Promise<void> {
  const database = await db()
  await database.delete(schema.emailSuppressions)
}
